import { MinCursorMXD, MinCursorMYD } from "@/types/constants";
import { IPoint, ISize, TextEditingStates, ShieldDispatcherNames, ElementStatus } from "@/types";
import StageStore from "@/modules/stage/StageStore";
import DrawerMask from "@/modules/stage/drawer/DrawerMask";
import DrawerProvisional from "@/modules/stage/drawer/DrawerProvisional";
import StageSelection from "@/modules/stage/StageSelection";
import StageCursor from "@/modules/stage/StageCursor";
import StageEvent from "@/modules/stage/StageEvent";
import DrawerBase from "@/modules/stage/drawer/DrawerBase";
import ShieldRenderer from "@/modules/render/renderer/drawer/ShieldRenderer";
import CommonUtils from "@/utils/CommonUtils";
import ElementUtils from "@/modules/elements/utils/ElementUtils";
import { clamp, isBoolean, isNumber, some } from "lodash";
import StageConfigure from "@/modules/stage/StageConfigure";
import IStageConfigure from "@/types/IStageConfigure";
import IElement, { ElementObject, IElementArbitrary, IElementText, TreeNodeDropType } from "@/types/IElement";
import IStageStore from "@/types/IStageStore";
import IStageSelection from "@/types/IStageSelection";
import { IDrawerHtml, IDrawerMask, IDrawerProvisional } from "@/types/IStageDrawer";
import IStageShield, { stageParams, StageShieldElementsStatus } from "@/types/IStageShield";
import IStageCursor from "@/types/IStageCursor";
import { Creator, CreatorCategories, CreatorTypes } from "@/types/Creator";
import IStageEvent from "@/types/IStageEvent";
import CanvasUtils from "@/utils/CanvasUtils";
import { FontStyle, FontStyler, StrokeTypes, TextCase, TextDecoration, TextVerticalAlign } from "@/styles/ElementStyles";
import IController from "@/types/IController";
import ElementRotation from "@/modules/elements/rotation/ElementRotation";
import VerticesTransformer from "@/modules/handler/transformer/VerticesTransformer";
import BorderTransformer from "@/modules/handler/transformer/BorderTransformer";
import MathUtils from "@/utils/MathUtils";
import { AutoFitPadding } from "@/types/Stage";
import IStageAlign, { IStageAlignFuncs } from "@/types/IStageAlign";
import StageAlign from "@/modules/stage/StageAlign";
import { HandCreator, MoveableCreator } from "@/types/CreatorDicts";
import CornerController from "@/modules/handler/controller/CornerController";
import DOMUtils from "@/utils/DOMUtils";
import RenderQueue from "@/modules/render/RenderQueue";
import { ElementActionTypes, ElementsCommandTypes, ElementsActionParam, ICommandElementObject, IElementsCommandPayload } from "@/types/ICommand";
import LodashUtils from "@/utils/LodashUtils";
import { IElementGroup } from "@/types/IElementGroup";
import DrawerHtml from "@/modules/stage/drawer/DrawerHtml";
import ElementText from "@/modules/elements/ElementText";
import IUndoRedo from "@/types/IUndoRedo";
import UndoRedo from "@/modules/base/UndoRedo";
import { TextEditorPressTypes, TextFontStyleUpdateTypes } from "@/types/IText";
import GlobalConfig from "@/config";
import { computed, makeObservable, observable, reaction } from "mobx";
import TextElementUtils from "@/modules/elements/utils/TextElementUtils";
import CommandHelper from "@/modules/command/helpers/CommandHelper";
import ElementArbitrary from "@/modules/elements/ElementArbitrary";
import CreatorHelper from "@/types/CreatorHelper";

const ElementsBusyStatus = [StageShieldElementsStatus.ROTATING, StageShieldElementsStatus.TRANSFORMING, StageShieldElementsStatus.CORNER_MOVING, StageShieldElementsStatus.MOVING];

export default class StageShield extends DrawerBase implements IStageShield, IStageAlignFuncs {
  // 当前正在使用的工具
  currentCreator: Creator = HandCreator;
  // 上一个使用的工具
  prevCreatorType: CreatorTypes;
  // 鼠标操作
  cursor: IStageCursor;
  // 遮罩画板用以绘制鼠标样式,工具图标等
  mask: IDrawerMask;
  // 前景画板
  provisional: IDrawerProvisional;
  // html画板
  html: IDrawerHtml;
  // 配置
  configure: IStageConfigure;
  // 数据存储
  store: IStageStore;
  // 选区操作
  selection: IStageSelection;
  // 事件处理中心
  event: IStageEvent;
  // 对齐
  align: IStageAlign;
  // 撤销
  undoRedo: IUndoRedo<IElementsCommandPayload, boolean>;
  // 舞台缩放比例
  stageScale: number = 1;
  // 画布在世界中的坐标,画布始终是居中的,所以坐标都是相对于画布中心点的,当画布尺寸发生变化时,需要重新计算
  stageWorldCoord: IPoint = {
    x: 0,
    y: 0,
  };
  // 画布容器尺寸
  stageRect: DOMRect;
  // canvas渲染容器
  renderEl: HTMLDivElement;
  // 组件状态
  elementsStatus: StageShieldElementsStatus = StageShieldElementsStatus.NONE;
  // 光标移动队列
  private _cursorMoveQueue: RenderQueue = new RenderQueue();
  // 重绘队列
  private _redrawQueue: RenderQueue = new RenderQueue();
  // 重绘标志
  private _shouldRedraw: boolean = false;
  // 最近一次鼠标按下时间戳
  private _latestMousedownTimestamp: number = 0;
  // 是否在鼠标抬起时选中顶层组件
  private _shouldSelectTopAWhilePressUp: boolean = true;
  // 之后一个切换工具的命令id
  private _tailCreatorCommandId: string;

  // 画布矩形顶点坐标
  get stageRectPoints(): IPoint[] {
    return CommonUtils.getRectBySize(this.stageRect);
  }
  // 舞台矩形顶点坐标
  get stageWordRectCoords(): IPoint[] {
    return CommonUtils.getBoxByCenter(this.stageWorldCoord, { width: this.stageRect.width / this.stageScale, height: this.stageRect.height / this.stageScale });
  }

  // 鼠标按下位置
  private _pressDownPosition: IPoint;
  // 鼠标按下时距离世界坐标中心点的偏移
  private _pressDownStageWorldCoord: IPoint;
  // 鼠标抬起位置
  private _pressUpPosition: IPoint;
  // 鼠标抬起时距离世界坐标中心点的偏移
  private _pressUpStageWorldCoord: IPoint;
  // 鼠标按下并移动时的位置
  private _pressMovePosition: IPoint;
  // 鼠标移动时距离世界坐标中心点的偏移
  private _pressMoveStageWorldCoord: IPoint;
  // 鼠标是否按下过
  private _isPressDown: boolean = false;
  // 舞台是否在移动
  private _isStageMoving: boolean = false;
  // 移动舞台前的原始坐标
  private _originalStageWorldCoord: IPoint;
  // 编辑前的原始数据
  private _originalEditingUDataList: Array<ICommandElementObject>;

  // 组件是否处于活动中
  get isElementsBusy(): boolean {
    return ElementsBusyStatus.includes(this.elementsStatus) || this.isTextCreating || this.isTextEditing || this.isArbitraryDrawing || this.isArbitraryEditing;
  }

  // 舞台是否在移动
  get isStageMoving(): boolean {
    return this._isStageMoving;
  }

  // 是否是绘制工具
  get isDrawerActive(): boolean {
    return [CreatorCategories.shapes, CreatorCategories.freedom].includes(this.currentCreator?.category);
  }

  // 是否是文本工具
  get isTextCreating(): boolean {
    return [CreatorCategories.text].includes(this.currentCreator?.category);
  }

  get isTextEditing(): boolean {
    return !this.store.isEditingEmpty && this.store.editingElements[0].model.type === CreatorTypes.text;
  }

  // 是否是手绘工具
  get isHandActive(): boolean {
    return this.currentCreator?.type === CreatorTypes.hand;
  }

  // 是否是移动工具
  get isMoveableActive(): boolean {
    return this.currentCreator?.type === CreatorTypes.moveable;
  }

  // 是否是任意绘制工具
  get isArbitraryDrawing(): boolean {
    return this.currentCreator?.type === CreatorTypes.arbitrary;
  }

  get isArbitraryEditing(): boolean {
    return !this.store.isEditingEmpty && this.store.editingElements[0].model.type === CreatorTypes.arbitrary;
  }

  // 舞台计算参数
  get stageParams(): stageParams {
    return {
      rect: this.stageRect,
      worldCoord: this.stageWorldCoord,
      scale: this.stageScale,
    };
  }

  // 移动偏移量
  get movingOffset(): IPoint {
    return {
      x: Math.floor(this._pressMoveStageWorldCoord.x - this._pressDownStageWorldCoord.x),
      y: Math.floor(this._pressMoveStageWorldCoord.y - this._pressDownStageWorldCoord.y),
    };
  }

  constructor() {
    super();
    this.configure = new StageConfigure();
    this.event = new StageEvent(this);
    this.store = new StageStore(this);
    this.cursor = new StageCursor(this);
    this.provisional = new DrawerProvisional(this);
    this.html = new DrawerHtml(this);
    this.selection = new StageSelection(this);
    this.align = new StageAlign(this);
    this.mask = new DrawerMask(this);
    this.undoRedo = new UndoRedo();
    this.renderer = new ShieldRenderer(this);
    makeObservable(this, {
      stageParams: computed,
      stageRect: observable,
      stageWorldCoord: observable,
      stageScale: observable,
      elementsStatus: observable,
    });
    reaction(
      () => this.stageParams,
      () => {
        GlobalConfig.stageParams = this.stageParams;
      },
    );
    reaction(
      () => this.elementsStatus,
      () => {
        this.emit(ShieldDispatcherNames.elementsStatusChanged, this.elementsStatus);
      },
    );
    this._requestAnimationRedraw();
    window.shield = this;
  }

  /**
   * 添加重绘任务
   *
   * @param shieldForceRedraw
   */
  private async _addRedrawTask(shieldForceRedraw?: boolean): Promise<void> {
    return new Promise(resolve => {
      this._redrawQueue.add({
        run: async () => {
          await Promise.all([this.selection.refresh(), this.redraw(shieldForceRedraw), this.mask.redraw(), this.provisional.redraw()]);
          resolve();
        },
      });
    });
  }

  /**
   * 重绘所有组件
   *
   * TODO 有性能问题，比较直观的浮现方式
   * 1. 打开控制台
   * 2. 绘制一个矩形
   * 3. 立刻拖动
   * 4. 发现拖动缓慢
   */
  private async _requestAnimationRedraw(): Promise<void> {
    requestAnimationFrame(async () => {
      await this._addRedrawTask(this._shouldRedraw);
      this._shouldRedraw = false;
      // 如果存在编辑中的文本组件
      if (!this.store.isEditingTextEmpty && !DOMUtils.isFocusOnInput()) {
        this.html.focusTextCursorInput();
      }
      await this._requestAnimationRedraw();
    });
  }

  /**
   * 根据数据创建更新命令
   *
   * @param uDataList
   * @param rDataList
   * @param commandType
   * @param id
   */
  private async _addCommandByDataList({ payload, id }: { id?: string; payload: IElementsCommandPayload }): Promise<void> {
    const command = CommandHelper.createElementsChangedCommand({
      id,
      store: this.store,
      payload,
    });
    this.undoRedo.add(command);
  }

  /**
   * 创建组件平移命令
   *
   * @param elements
   * @param elementsUpdateFunction
   */
  private async _addTranslateCommand(elements: IElement[], elementsUpdateFunction: () => Promise<void>): Promise<void> {
    elements = this._flatWithAncestors(elements);
    const [uDataList, rDataList] = await CommandHelper.batchCreateDataList(elements, [element => element.toTranslateJson()], [ElementActionTypes.Updated], {
      eachRDataListOperatingFunction: elementsUpdateFunction,
    });
    await this._addCommandByDataList({
      payload: {
        uDataList,
        rDataList,
        type: ElementsCommandTypes.ElementsUpdated,
      },
    });
  }

  /**
   * 执行操作
   *
   * @param action
   * @param args
   */
  async executeMethod<T extends any[]>(action: (...args: T) => void, ...args: T): Promise<void> {
    await action(...args);
    this._shouldRedraw = true;
  }

  /**
   * 设置组件位置
   *
   * @param elements
   * @param value
   */
  async _setElementsPosition(elements: IElement[], value: IPoint): Promise<void> {
    await this._addTranslateCommand(elements, async () => {
      await this.store.setElementsPosition(elements, value);
      this._refreshAncesorsByDetachedElements(elements);
    });
    elements.forEach(element => {
      element.onPositionChanged();
      this._refreshAncestorsTransformed(element);
    });
  }

  /**
   * 设置组件位置
   *
   * @param elements
   * @param value
   */
  async setElementsPosition(elements: IElement[], value: IPoint): Promise<void> {
    await this.executeMethod(async () => await this._setElementsPosition(elements, value));
  }

  /**
   * 创建组件变换命令
   *
   * @param elements
   * @param elementsUpdateFunction
   */
  private async _addTransformCommand(elements: IElement[], elementsUpdateFunction: () => Promise<void>): Promise<void> {
    elements = this._flatWithAncestors(elements);
    const [uDataList, rDataList] = await CommandHelper.batchCreateDataList(elements, [element => element.toTransformJson()], [ElementActionTypes.Updated], {
      elementsOperatingFunction: async () => {
        await elementsUpdateFunction();
        await this._reflowTextIfy(elements, true);
      },
    });
    await this._addCommandByDataList({
      payload: {
        uDataList,
        rDataList,
        type: ElementsCommandTypes.ElementsUpdated,
      },
    });
  }

  /**
   * 设置组件宽度
   *
   * @param elements
   * @param value
   */
  async _setElementsWidth(elements: IElement[], value: number): Promise<void> {
    await this._addTransformCommand(elements, async () => {
      await this.store.setElementsWidth(elements, value);
      this._refreshAncesorsByDetachedElements(elements);
      elements.forEach(element => {
        element.onWidthChanged();
        this._refreshAncestorsTransformed(element);
      });
    });
  }

  /**
   * 设置组件宽度
   *
   * @param elements
   * @param value
   */
  async setElementsWidth(elements: IElement[], value: number): Promise<void> {
    await this.executeMethod(async () => await this._setElementsWidth(elements, value));
  }

  /**
   * 设置组件高度
   *
   * @param elements
   * @param value
   */
  async _setElementsHeight(elements: IElement[], value: number): Promise<void> {
    await this._addTransformCommand(elements, async () => {
      await this.store.setElementsHeight(elements, value);
      this._refreshAncesorsByDetachedElements(elements);
      elements.forEach(element => {
        element.onHeightChanged();
        this._refreshAncestorsTransformed(element);
      });
    });
  }

  /**
   * 设置组件高度
   *
   * @param elements
   * @param value
   */
  async setElementsHeight(elements: IElement[], value: number): Promise<void> {
    await this.executeMethod(async () => await this._setElementsHeight(elements, value));
  }

  /**
   * 设置组件Y倾斜角度
   *
   * @param elements
   * @param value
   */
  async _setElementsLeanYAngle(elements: IElement[], value: number): Promise<void> {
    await this._addTransformCommand(elements, async () => {
      await this.store.setElementsLeanYAngle(elements, value);
      this._refreshAncesorsByDetachedElements(elements);
      elements.forEach(element => {
        element.onLeanyAngleChanged();
        this._refreshAncestorsTransformed(element);
      });
    });
  }

  /**
   * 设置组件Y倾斜角度
   *
   * @param elements
   * @param value
   */
  async setElementsLeanYAngle(elements: IElement[], value: number): Promise<void> {
    await this.executeMethod(async () => await this._setElementsLeanYAngle(elements, value));
  }

  /**
   * 设置组件角度
   *
   * @param elements
   * @param value
   */
  async _setElementsAngle(elements: IElement[], value: number): Promise<void> {
    await this._addTransformCommand(elements, async () => {
      await this.store.setElementsAngle(elements, value);
      this._refreshAncesorsByDetachedElements(elements);
      elements.forEach(element => {
        element.onAngleChanged();
        this._refreshAncestorsTransformed(element);
      });
    });
  }

  /**
   * 设置组件角度
   *
   * @param elements
   * @param value
   */
  async setElementsAngle(elements: IElement[], value: number): Promise<void> {
    await this.executeMethod(async () => await this._setElementsAngle(elements, value));
  }

  /**
   * 设置组件圆角
   *
   * @param elements
   * @param value
   * @param index
   */
  async _setElementsCorners(elements: IElement[], value: number, index?: number): Promise<void> {
    const [uDataList, rDataList] = await CommandHelper.batchCreateDataList(elements, [element => element.toCornerJson()], [ElementActionTypes.Updated], {
      elementsOperatingFunction: async () => {
        await this.store.setElementsCorners(elements, value, index);
      },
    });
    await this._addCommandByDataList({
      payload: {
        uDataList,
        rDataList,
        type: ElementsCommandTypes.ElementsUpdated,
      },
    });
    elements.forEach(element => element.onCornerChanged());
  }

  /**
   * 设置组件圆角
   *
   * @param elements
   * @param value
   * @param index
   */
  async setElementsCorners(elements: IElement[], value: number, index?: number): Promise<void> {
    await this.executeMethod(async () => await this._setElementsCorners(elements, value, index));
  }

  /**
   * 创建边框更新命令
   *
   * @param elements
   * @param elementsUpdateFunction
   */
  private async _addStrokeCommand(elements: IElement[], elementsUpdateFunction: () => Promise<void>): Promise<void> {
    const [uDataList, rDataList] = await CommandHelper.batchCreateDataList(elements, [element => element.toStrokesJson()], [ElementActionTypes.Updated], {
      eachRDataListOperatingFunction: elementsUpdateFunction,
    });
    await this._addCommandByDataList({
      payload: { uDataList, rDataList, type: ElementsCommandTypes.ElementsUpdated },
    });
  }

  /**
   * 设置组件边框类型
   *
   * @param elements
   * @param value
   * @param index
   */
  async _setElementsStrokeType(elements: IElement[], value: StrokeTypes, index: number): Promise<void> {
    await this._addStrokeCommand(elements, async () => {
      await this.store.setElementsStrokeType(elements, value, index);
    });
    elements.forEach(element => element.onStrokeTypeChanged());
  }

  /**
   * 设置组件边框类型
   *
   * @param elements
   * @param value
   * @param index
   */
  async setElementsStrokeType(elements: IElement[], value: StrokeTypes, index: number): Promise<void> {
    await this.executeMethod(async () => await this._setElementsStrokeType(elements, value, index));
  }

  /**
   * 设置组件边框宽度
   *
   * @param elements
   * @param value
   * @param index
   */
  async _setElementsStrokeWidth(elements: IElement[], value: number, index: number): Promise<void> {
    await this._addStrokeCommand(elements, async () => {
      await this.store.setElementsStrokeWidth(elements, value, index);
    });
    elements.forEach(element => element.onStrokeWidthChanged());
  }

  /**
   * 设置组件边框宽度
   *
   * @param elements
   * @param value
   * @param index
   */
  async setElementsStrokeWidth(elements: IElement[], value: number, index: number): Promise<void> {
    await this.executeMethod(async () => await this._setElementsStrokeWidth(elements, value, index));
  }

  /**
   * 设置组件边框颜色
   *
   * @param elements
   * @param value
   * @param index
   */
  async _setElementsStrokeColor(elements: IElement[], value: string, index: number): Promise<void> {
    await this._addStrokeCommand(elements, async () => {
      await this.store.setElementsStrokeColor(elements, value, index);
    });
    elements.forEach(element => element.onStrokeColorChanged());
  }

  /**
   * 设置组件边框颜色
   *
   * @param elements
   * @param value
   * @param index
   */
  async setElementsStrokeColor(elements: IElement[], value: string, index: number): Promise<void> {
    await this.executeMethod(async () => await this._setElementsStrokeColor(elements, value, index));
  }

  /**
   * 设置组件边框颜色透明度
   *
   * @param elements
   * @param value
   * @param index
   */
  async _setElementsStrokeColorOpacity(elements: IElement[], value: number, index: number): Promise<void> {
    await this._addStrokeCommand(elements, async () => {
      await this.store.setElementsStrokeColorOpacity(elements, value, index);
    });
    elements.forEach(element => element.onStrokeColorOpacityChanged());
  }

  /**
   * 设置组件边框颜色透明度
   *
   * @param elements
   * @param value
   * @param index
   */
  async setElementsStrokeColorOpacity(elements: IElement[], value: number, index: number): Promise<void> {
    await this.executeMethod(async () => await this._setElementsStrokeColorOpacity(elements, value, index));
  }

  /**
   * 添加组件描边
   *
   * @param elements
   * @param prevIndex
   */
  async _addElementsStroke(elements: IElement[], prevIndex: number): Promise<void> {
    await this._addStrokeCommand(elements, async () => {
      await this.store.addElementsStroke(elements, prevIndex);
    });
    elements.forEach(element => element.onStrokeAdded());
  }

  /**
   * 添加组件描边
   *
   * @param elements
   * @param prevIndex
   */
  async addElementsStroke(elements: IElement[], prevIndex: number): Promise<void> {
    await this.executeMethod(async () => await this._addElementsStroke(elements, prevIndex));
  }

  /**
   * 删除组件描边
   *
   * @param elements
   * @param index
   */
  async _removeElementsStroke(elements: IElement[], index: number): Promise<void> {
    await this._addStrokeCommand(elements, async () => {
      await this.store.removeElementsStroke(elements, index);
    });
    elements.forEach(element => element.onStrokeRemoved());
  }

  /**
   * 删除组件描边
   *
   * @param elements
   * @param index
   */
  async removeElementsStroke(elements: IElement[], index: number): Promise<void> {
    await this.executeMethod(async () => await this._removeElementsStroke(elements, index));
  }

  /**
   * 创建填充更新命令
   *
   * @param elements
   * @param elementsUpdateFunction
   */
  private async _addFillCommand(elements: IElement[], elementsUpdateFunction: () => Promise<void>): Promise<void> {
    const [uDataList, rDataList] = await CommandHelper.batchCreateDataList(elements, [element => element.toFillsJson()], [ElementActionTypes.Updated], {
      elementsOperatingFunction: elementsUpdateFunction,
    });
    await this._addCommandByDataList({
      payload: {
        uDataList,
        rDataList,
        type: ElementsCommandTypes.ElementsUpdated,
      },
    });
  }

  /**
   * 设置组件填充颜色
   *
   * @param elements
   * @param value
   * @param index
   */
  async _setElementsFillColor(elements: IElement[], value: string, index: number): Promise<void> {
    await this._addFillCommand(elements, async () => {
      await this.store.setElementsFillColor(elements, value, index);
    });
    elements.forEach(element => element.onFillColorChanged());
  }

  /**
   * 设置组件填充颜色
   *
   * @param elements
   * @param value
   * @param index
   */
  async setElementsFillColor(elements: IElement[], value: string, index: number): Promise<void> {
    await this.executeMethod(async () => await this._setElementsFillColor(elements, value, index));
  }

  /**
   * 设置组件填充颜色透明度
   *
   * @param elements
   * @param value
   * @param index
   */
  async _setElementsFillColorOpacity(elements: IElement[], value: number, index: number): Promise<void> {
    await this._addFillCommand(elements, async () => {
      await this.store.setElementsFillColorOpacity(elements, value, index);
    });
    elements.forEach(element => element.onFillColorOpacityChanged());
  }

  /**
   * 设置组件填充颜色透明度
   *
   * @param elements
   * @param value
   * @param index
   */
  async setElementsFillColorOpacity(elements: IElement[], value: number, index: number): Promise<void> {
    await this.executeMethod(async () => await this._setElementsFillColorOpacity(elements, value, index));
  }

  /**
   * 添加组件填充
   *
   * @param elements
   * @param prevIndex
   */
  async _addElementsFill(elements: IElement[], prevIndex: number): Promise<void> {
    await this._addFillCommand(elements, async () => {
      await this.store.addElementsFill(elements, prevIndex);
    });
    elements.forEach(element => element.onFillAdded());
  }

  /**
   * 添加组件填充
   *
   * @param elements
   * @param prevIndex
   */
  async addElementsFill(elements: IElement[], prevIndex: number): Promise<void> {
    await this.executeMethod(async () => await this._addElementsFill(elements, prevIndex));
  }

  /**
   * 删除组件填充
   *
   * @param elements
   * @param index
   */
  async _removeElementsFill(elements: IElement[], index: number): Promise<void> {
    await this._addFillCommand(elements, async () => {
      await this.store.removeElementsFill(elements, index);
    });
    elements.forEach(element => element.onFillRemoved());
  }

  /**
   * 删除组件填充
   *
   * @param elements
   * @param index
   */
  async removeElementsFill(elements: IElement[], index: number): Promise<void> {
    await this.executeMethod(async () => await this._removeElementsFill(elements, index));
  }

  /**
   * 创建字体样式更新命令
   *
   * @param elements
   * @param elementsUpdateFunction
   * @param updateType
   */
  private async _addFontStyleCommand(elements: IElement[], elementsUpdateFunction: () => Promise<void>, updateType: TextFontStyleUpdateTypes): Promise<void> {
    const shouldRelationUndoCommand = TextElementUtils.shouldRelationUndoCommand(updateType);
    const commandId = CommonUtils.getRandomId();
    const [uDataList, rDataList] = await CommandHelper.batchCreateDataList(elements, [element => element.toFontStyleJson()], [ElementActionTypes.Updated], {
      elementsOperatingFunction: elementsUpdateFunction,
      eachUDataListOperatingFunction: async element => {
        if (shouldRelationUndoCommand && element.isEditing && element instanceof ElementText) {
          element.refreshUndoCommandObject();
        }
      },
      eachRDataListOperatingFunction: async element => {
        if (shouldRelationUndoCommand && element.isEditing && element instanceof ElementText) {
          element.relationUndoCommand(commandId);
        }
      },
    });
    await this._addCommandByDataList({
      id: commandId,
      payload: {
        uDataList,
        rDataList,
        type: ElementsCommandTypes.ElementsUpdated,
      },
    });
  }

  /**
   * 重新排版文本
   *
   * @param elements
   * @param force 是否强制重新排版
   * @param changed 是否是因为文本内容变化才重新排版
   */
  private async _reflowTextIfy(elements: IElement[], force?: boolean, changed?: boolean): Promise<IElementText[]> {
    const reflowedElements: IElementText[] = [];
    await Promise.all(
      elements.map(async element => {
        if (element instanceof ElementText) {
          // 文本改变必定会引发重新排版
          const reflowed = element.reflowText(force || changed);
          if (reflowed) {
            reflowedElements.push(element);
          }
        }
      }),
    );
    if (reflowedElements.length > 0) {
      await this._addRedrawTask(true);
      reflowedElements.forEach(element => element.onTextReflowed(changed));
      await Promise.all(elements.map(async element => element instanceof ElementText && element.refreshTextCursors()));
      await this._addRedrawTask(true);
    }
    return reflowedElements;
  }

  /**
   * 设置组件文本对齐方式
   *
   * @param elements
   * @param value
   */
  async _setElementsTextAlign(elements: IElement[], value: CanvasTextAlign): Promise<void> {
    await this._addFontStyleCommand(
      elements,
      async () => {
        await this.store.setElementsTextAlign(elements, value);
        await this._addRedrawTask(true);
        await this._reflowTextIfy(elements, true);
        elements.forEach(element => element.onTextAlignChanged());
      },
      TextFontStyleUpdateTypes.FONT_TEXT_ALIGN,
    );
  }

  /**
   * 设置组件文本对齐方式
   *
   * @param elements
   * @param value
   */
  async setElementsTextAlign(elements: IElement[], value: CanvasTextAlign): Promise<void> {
    await this.executeMethod(async () => await this._setElementsTextAlign(elements, value));
  }

  /**
   * 设置组件文本垂直对齐方式
   *
   * @param elements
   * @param value
   */
  async _setElementsTextVerticalAlign(elements: IElement[], value: TextVerticalAlign): Promise<void> {
    await this._addFontStyleCommand(
      elements,
      async () => {
        await this.store.setElementsTextVerticalAlign(elements, value);
        await this._addRedrawTask(true);
        await this._reflowTextIfy(elements, true);
        elements.forEach(element => element.onTextVerticalAlignChanged());
      },
      TextFontStyleUpdateTypes.FONT_TEXT_VERTICAL_ALIGN,
    );
  }

  /**
   * 设置组件文本垂直对齐方式
   *
   * @param elements
   * @param value
   */
  async setElementsTextVerticalAlign(elements: IElement[], value: TextVerticalAlign): Promise<void> {
    await this.executeMethod(async () => await this._setElementsTextVerticalAlign(elements, value));
  }

  /**
   * 设置组件文本基线
   *
   * @param elements
   * @param value
   */
  async _setElementsTextBaseline(elements: IElement[], value: CanvasTextBaseline): Promise<void> {
    await this._addFontStyleCommand(
      elements,
      async () => {
        await this.store.setElementsTextBaseline(elements, value);
      },
      TextFontStyleUpdateTypes.FONT_TEXT_BASELINE,
    );
    elements.forEach(element => element.onTextBaselineChanged());
  }

  /**
   * 设置组件文本基线
   *
   * @param elements
   * @param value
   */
  async setElementsTextBaseline(elements: IElement[], value: CanvasTextBaseline): Promise<void> {
    await this.executeMethod(async () => await this._setElementsTextBaseline(elements, value));
  }

  /**
   * 设置组件字体样式
   *
   * @param elements
   * @param value
   */
  async _setElementsFontStyler(elements: IElement[], value: FontStyler): Promise<void> {
    await this._addFontStyleCommand(
      elements,
      async () => {
        await this.store.setElementsFontStyler(elements, value);
        await this._addRedrawTask(true);
        await this._reflowTextIfy(elements, true);
        elements.forEach(element => element.onFontStylerChanged());
      },
      TextFontStyleUpdateTypes.FONT_STYLER,
    );
  }

  /**
   * 设置组件字体样式
   *
   * @param elements
   * @param value
   */
  async setElementsFontStyler(elements: IElement[], value: FontStyler): Promise<void> {
    await this.executeMethod(async () => await this._setElementsFontStyler(elements, value));
  }

  /**
   * 设置组件字体大小
   *
   * @param elements
   * @param value
   */
  async _setElementsFontSize(elements: IElement[], value: number): Promise<void> {
    await this._addFontStyleCommand(
      elements,
      async () => {
        await this.store.setElementsFontSize(elements, value);
        await this._addRedrawTask(true);
        await this._reflowTextIfy(elements, true);
        elements.forEach(element => {
          element.onFontSizeChanged();
          if (!(element as IElementText).isSelectionAvailable && element.fontLineHeightAutoFit) {
            element.onFontLineHeightChanged();
          }
        });
      },
      TextFontStyleUpdateTypes.FONT_SIZE,
    );
  }

  /**
   * 设置组件字体大小
   *
   * @param elements
   * @param value
   */
  async setElementsFontSize(elements: IElement[], value: number): Promise<void> {
    await this.executeMethod(async () => await this._setElementsFontSize(elements, value));
  }

  /**
   * 设置组件字体
   *
   * @param elements
   * @param value
   */
  async _setElementsFontFamily(elements: IElement[], value: string): Promise<void> {
    await this._addFontStyleCommand(
      elements,
      async () => {
        await this.store.setElementsFontFamily(elements, value);
        await this._addRedrawTask(true);
        await this._reflowTextIfy(elements, true);
        elements.forEach(element => element.onFontFamilyChanged());
      },
      TextFontStyleUpdateTypes.FONT_FAMILY,
    );
  }

  /**
   * 设置组件字体
   *
   * @param elements
   * @param value
   */
  async setElementsFontFamily(elements: IElement[], value: string): Promise<void> {
    await this.executeMethod(async () => await this._setElementsFontFamily(elements, value));
  }

  /**
   * 设置组件字体行高
   *
   * @param elements
   * @param value
   */
  async _setElementsFontLineHeight(elements: IElement[], value: number): Promise<void> {
    await this._addFontStyleCommand(
      elements,
      async () => {
        await this.store.setElementsFontLineHeight(elements, value);
      },
      TextFontStyleUpdateTypes.FONT_LINE_HEIGHT,
    );
    elements.forEach(element => {
      element.onFontLineHeightChanged();
      element.onFontLineHeightFactorChanged();
    });
  }

  /**
   * 设置组件字体行高
   *
   * @param elements
   * @param value
   */
  async setElementsFontLineHeight(elements: IElement[], value: number): Promise<void> {
    await this.executeMethod(async () => await this._setElementsFontLineHeight(elements, value));
  }

  /**
   * 设置组件字体行高倍数
   *
   * @param elements
   * @param value
   */
  async _setElementsFontLineHeightFactor(elements: IElement[], value: number): Promise<void> {
    await this._addFontStyleCommand(
      elements,
      async () => {
        await this.store.setElementsFontLineHeightFactor(elements, value);
      },
      TextFontStyleUpdateTypes.FONT_LINE_HEIGHT_FACTOR,
    );
    elements.forEach(element => {
      element.onFontLineHeightFactorChanged();
      element.onFontLineHeightChanged();
    });
  }

  /**
   * 设置组件字体行高倍数
   *
   * @param elements
   * @param value
   */
  async setElementsFontLineHeightFactor(elements: IElement[], value: number): Promise<void> {
    await this.executeMethod(async () => await this._setElementsFontLineHeightFactor(elements, value));
  }

  /**
   * 设置组件字体行高自动适应
   *
   * @param elements
   * @param value
   */
  async _setElementsFontLineHeightAutoFit(elements: IElement[], value: boolean): Promise<void> {
    await this._addFontStyleCommand(
      elements,
      async () => {
        await this.store.setElementsFontLineHeightAutoFit(elements, value);
      },
      TextFontStyleUpdateTypes.FONT_LINE_HEIGHT_AUTO_FIT,
    );
    elements.forEach(element => {
      element.onFontLineHeightAutoFitChanged();
      element.onFontLineHeightChanged();
    });
  }

  /**
   * 设置组件字体行高自动适应
   *
   * @param elements
   * @param value
   */
  async setElementsFontLineHeightAutoFit(elements: IElement[], value: boolean): Promise<void> {
    await this.executeMethod(async () => await this._setElementsFontLineHeightAutoFit(elements, value));
  }

  /**
   * 设置组件字体颜色
   *
   * @param elements
   * @param value
   */
  async _setElementsFontColor(elements: IElement[], value: string): Promise<void> {
    await this._addFontStyleCommand(
      elements,
      async () => {
        await this.store.setElementsFontColor(elements, value);
      },
      TextFontStyleUpdateTypes.FONT_COLOR,
    );
    elements.forEach(element => element.onFontColorChanged());
  }

  /**
   * 设置组件字体颜色
   *
   * @param elements
   * @param value
   */
  async setElementsFontColor(elements: IElement[], value: string): Promise<void> {
    await this.executeMethod(async () => await this._setElementsFontColor(elements, value));
  }

  /**
   * 设置组件字体颜色透明度
   *
   * @param elements
   * @param value
   */
  async _setElementsFontColorOpacity(elements: IElement[], value: number): Promise<void> {
    await this._addFontStyleCommand(
      elements,
      async () => {
        await this.store.setElementsFontColorOpacity(elements, value);
      },
      TextFontStyleUpdateTypes.FONT_COLOR_OPACITY,
    );
    elements.forEach(element => element.onFontColorOpacityChanged());
  }

  /**
   * 设置组件字体颜色透明度
   *
   * @param elements
   * @param value
   */
  async setElementsFontColorOpacity(elements: IElement[], value: number): Promise<void> {
    await this.executeMethod(async () => await this._setElementsFontColorOpacity(elements, value));
  }

  /**
   * 设置组件字间距
   *
   * @param elements
   * @param value
   */
  async _setElementsFontLetterSpacing(elements: IElement[], value: number): Promise<void> {
    await this._addFontStyleCommand(
      elements,
      async () => {
        await this.store.setElementsFontLetterSpacing(elements, value);
        await this._addRedrawTask(true);
        await this._reflowTextIfy(elements, true);
        elements.forEach(element => element.onFontLetterSpacingChanged());
      },
      TextFontStyleUpdateTypes.FONT_LETTER_SPACING,
    );
  }

  /**
   * 设置组件字间距
   *
   * @param elements
   * @param value
   */
  async setElementsFontLetterSpacing(elements: IElement[], value: number): Promise<void> {
    await this.executeMethod(async () => await this._setElementsFontLetterSpacing(elements, value));
  }

  /**
   * 设置组件文本装饰
   *
   * @param elements
   * @param value
   */
  async _setElementsTextDecoration(elements: IElement[], value: TextDecoration): Promise<void> {
    await this._addFontStyleCommand(
      elements,
      async () => {
        await this.store.setElementsTextDecoration(elements, value);
      },
      TextFontStyleUpdateTypes.FONT_TEXT_DECORATION,
    );
    elements.forEach(element => element.onTextDecorationChanged());
  }

  /**
   * 设置组件文本装饰
   *
   * @param elements
   * @param value
   */
  async setElementsTextDecoration(elements: IElement[], value: TextDecoration): Promise<void> {
    await this.executeMethod(async () => await this._setElementsTextDecoration(elements, value));
  }

  /**
   * 设置组件文本装饰颜色
   *
   * @param elements
   * @param value
   */
  async _setElementsTextDecorationColor(elements: IElement[], value: string): Promise<void> {
    await this._addFontStyleCommand(
      elements,
      async () => {
        await this.store.setElementsTextDecorationColor(elements, value);
      },
      TextFontStyleUpdateTypes.FONT_TEXT_DECORATION_COLOR,
    );
    elements.forEach(element => element.onTextDecorationColorChanged());
  }

  /**
   * 设置组件文本装饰颜色
   *
   * @param elements
   * @param value
   */
  async setElementsTextDecorationColor(elements: IElement[], value: string): Promise<void> {
    await this.executeMethod(async () => await this._setElementsTextDecorationColor(elements, value));
  }

  /**
   * 设置组件文本装饰透明度
   *
   * @param elements
   * @param value
   */
  async _setElementsTextDecorationOpacity(elements: IElement[], value: number): Promise<void> {
    await this._addFontStyleCommand(
      elements,
      async () => {
        await this.store.setElementsTextDecorationOpacity(elements, value);
      },
      TextFontStyleUpdateTypes.FONT_TEXT_DECORATION_OPACITY,
    );
    elements.forEach(element => element.onTextDecorationOpacityChanged());
  }

  /**
   * 设置组件文本装饰透明度
   *
   * @param elements
   * @param value
   */
  async setElementsTextDecorationOpacity(elements: IElement[], value: number): Promise<void> {
    await this.executeMethod(async () => await this._setElementsTextDecorationOpacity(elements, value));
  }

  /**
   * 设置组件文本装饰
   *
   * @param elements
   * @param value
   */
  async _setElementsTextDecorationThickness(elements: IElement[], value: number): Promise<void> {
    await this._addFontStyleCommand(
      elements,
      async () => {
        await this.store.setElementsTextDecorationThickness(elements, value);
      },
      TextFontStyleUpdateTypes.FONT_TEXT_DECORATION_THICKNESS,
    );
    elements.forEach(element => element.onTextDecorationThicknessChanged());
  }

  /**
   * 设置组件文本装饰
   *
   * @param elements
   * @param value
   */
  async setElementsTextDecorationThickness(elements: IElement[], value: number): Promise<void> {
    await this.executeMethod(async () => await this._setElementsTextDecorationThickness(elements, value));
  }

  /**
   * 设置段落间距
   *
   * @param elements
   * @param value
   */
  async _setElementsParagraphSpacing(elements: IElement[], value: number): Promise<void> {
    await this._addFontStyleCommand(
      elements,
      async () => {
        await this.store.setElementsParagraphSpacing(elements, value);
      },
      TextFontStyleUpdateTypes.FONT_PARAGRAPH_SPACING,
    );
    elements.forEach(element => element.onParagraphSpacingChanged());
  }

  /**
   * 设置段落间距
   *
   * @param elements
   * @param value
   */
  async setElementsParagraphSpacing(elements: IElement[], value: number): Promise<void> {
    await this.executeMethod(async () => await this._setElementsParagraphSpacing(elements, value));
  }

  /**
   * 设置组件文本装饰
   *
   * @param elements
   * @param value
   */
  async _setElementsTextCase(elements: IElement[], value: TextCase): Promise<void> {
    await this._addFontStyleCommand(
      elements,
      async () => {
        await this.store.setElementsTextCase(elements, value);
        await this._addRedrawTask(true);
        await this._reflowTextIfy(elements, true);
        elements.forEach(element => element.onTextCaseChanged());
      },
      TextFontStyleUpdateTypes.FONT_TEXT_CASE,
    );
  }

  /**
   * 设置组件文本装饰
   *
   * @param elements
   * @param value
   */
  async setElementsTextCase(elements: IElement[], value: TextCase): Promise<void> {
    await this.executeMethod(async () => await this._setElementsTextCase(elements, value));
  }

  /**
   * 锁定比例
   *
   * @param elements
   * @param value
   */
  async _setElementsRatioLocked(elements: IElement[], value: boolean): Promise<void> {
    await this.store.setElementsRatioLocked(elements, value);
    elements.forEach(element => element.onRatioLockedChanged());
  }

  /**
   * 锁定比例
   *
   * @param elements
   * @param value
   */
  async setElementsRatioLocked(elements: IElement[], value: boolean): Promise<void> {
    await this.executeMethod(async () => await this._setElementsRatioLocked(elements, value));
  }

  /**
   * 设置组件旋转角度
   *
   * @param elements
   * @param value
   */
  async _setElementsRotate(elements: IElement[], value: number): Promise<void> {
    await this._addTransformCommand(elements, async () => {
      await this.store.setElementsRotate(elements, value);
      this._refreshAncesorsByDetachedElements(elements);
      elements.forEach(element => {
        element.onAngleChanged();
        this._refreshAncestorsTransformed(element);
      });
    });
  }

  /**
   * 设置组件旋转角度
   *
   * @param elements
   * @param value
   */
  async setElementsRotate(elements: IElement[], value: number): Promise<void> {
    await this.executeMethod(async () => await this._setElementsRotate(elements, value));
  }

  /**
   * 设置组件水平翻转
   *
   * @param elements
   */
  async _setElementsFlipX(elements: IElement[]): Promise<void> {
    await this._addTransformCommand(elements, async () => {
      await this.store.setElementsFlipX(elements);
      this._refreshAncesorsByDetachedElements(elements);
      elements.forEach(element => {
        element.onFlipXChanged();
        this._refreshAncestorsTransformed(element);
      });
    });
  }

  /**
   * 设置组件水平翻转
   *
   * @param elements
   */
  async setElementsFlipX(elements: IElement[]): Promise<void> {
    await this.executeMethod(async () => await this._setElementsFlipX(elements));
  }

  /**
   * 设置组件垂直翻转
   *
   * @param elements
   */
  async _setElementsFlipY(elements: IElement[]): Promise<void> {
    await this._addTransformCommand(elements, async () => {
      await this.store.setElementsFlipY(elements);
      this._refreshAncesorsByDetachedElements(elements);
      elements.forEach(element => {
        element.onFlipYChanged();
        this._refreshAncestorsTransformed(element);
      });
    });
  }

  /**
   * 设置组件垂直翻转
   *
   * @param elements
   */
  async setElementsFlipY(elements: IElement[]): Promise<void> {
    await this.executeMethod(async () => await this._setElementsFlipY(elements));
  }

  /**
   * 初始化
   *
   * @param renderEl
   */
  async init(renderEl: HTMLDivElement): Promise<void> {
    this.renderEl = renderEl;
    await Promise.all([this.initNode(), this.event.init()]);
    this._addEventListeners();
  }

  /**
   * 添加一个任务到鼠标移动队列
   *
   * @param task
   */
  private _addCursorQueueTask(task: () => Promise<void>): void {
    this._cursorMoveQueue.add({
      run: task,
    });
  }

  /**
   * 添加事件监听
   */
  private _addEventListeners() {
    this.event.on("resize", this._refreshSize.bind(this));
    this.event.on("cursorMove", e => this._addCursorQueueTask(() => this._handleCursorMove(e)));
    this.event.on("pressDown", e => this._addCursorQueueTask(() => this._handlePressDown(e)));
    this.event.on("pressUp", e => this._addCursorQueueTask(() => this._handlePressUp(e)));
    this.event.on("cursorLeave", this._handleCursorLeave.bind(this));
    this.event.on("dblClick", this._handleDblClick.bind(this));
    this.event.on("wheelScale", this._handleWheelScale.bind(this));
    this.event.on("wheelMove", this._handleWheelMove.bind(this));
    this.event.on("scaleReduce", this.setScaleReduce.bind(this));
    this.event.on("scaleIncrease", this.setScaleIncrease.bind(this));
    this.event.on("scaleAutoFit", this.setScaleAutoFit.bind(this));
    this.event.on("scale100", this.setScale100.bind(this));
    this.event.on("pasteImages", this._handleImagesPasted.bind(this));
    this.event.on("deleteSelects", this._handleSelectsDelete.bind(this));
    this.event.on("selectAll", this.selectAll.bind(this));
    this.event.on("selectCopy", this._handleSelectCopy.bind(this));
    this.event.on("pasteElements", this._handlePasteElements.bind(this));
    this.event.on("cancel", this._handleCancel.bind(this));
    this.event.on("selectMoveableCreator", () => this.setCreator(MoveableCreator, true));
    this.event.on("selectHandCreator", () => this.setCreator(HandCreator, true));
    this.event.on("groupAdd", this._handleGroupAdd.bind(this));
    this.event.on("groupRemove", this._handleGroupCancel.bind(this));
    this.event.on("undo", this.execUndo.bind(this));
    this.event.on("redo", this.execRedo.bind(this));
    this.html.on("textInput", this._handleTextInput.bind(this));
    this.html.on("textUpdate", this._handleTextUpdate.bind(this));
  }

  /**
   * 初始化画布
   */
  initNode(): HTMLCanvasElement | HTMLDivElement {
    super.initNode();

    const maskCanvas = this.mask.initNode();
    const provisionalCanvas = this.provisional.initNode();
    const htmlDrawer = this.html.initNode();

    this.renderEl.insertBefore(maskCanvas, this.renderEl.firstChild);
    this.renderEl.insertBefore(htmlDrawer, this.mask.node);
    this.renderEl.insertBefore(provisionalCanvas, this.html.node);

    this.node.id = "shield";
    this.renderEl.insertBefore(this.node, this.provisional.node);

    return this.node;
  }

  /**
   * 执行组件操作
   */
  private async _doElementsOperating(): Promise<void> {
    switch (this.elementsStatus) {
      case StageShieldElementsStatus.ROTATING: {
        this._rotateElements();
        break;
      }
      case StageShieldElementsStatus.MOVING: {
        this._dragElements();
        break;
      }
      case StageShieldElementsStatus.TRANSFORMING: {
        this._transformElements();
        break;
      }
      case StageShieldElementsStatus.CORNER_MOVING: {
        this._movingElementsCorner();
        break;
      }
    }
  }

  /**
   * 处理祖先组件
   *
   * @param elements
   * @param func
   */
  private _refreshAncestors(elements: IElement[], func: (group: IElementGroup) => void): void {
    const ancestors = this.store.getAncestorsByDetachedElements(elements);
    ancestors.forEach(func);
  }

  /**
   * 刷新祖先组件的原始数据
   *
   * @param elements
   */
  private _refreshAncestorsOriginals(elements: IElement[]): void {
    this._refreshAncestors(elements, group => group.refreshOriginals());
  }

  /**
   * 刷新组件的祖先组件
   *
   * @param elements
   */
  private _refreshAncesorsByDetachedElements(elements: IElement[]): void {
    this._refreshAncestors(elements, group => (group as IElementGroup).refreshBySubs());
  }

  /**
   * 鼠标移动事件
   *
   * @param e
   */
  async _handleCursorMove(e: MouseEvent): Promise<void> {
    this.cursor.transform(e);
    this.cursor.updateStyle(e);

    // 只有在未对组件进行旋转/移动/形变的情况下才会启用组件命中逻辑
    if (this.isMoveableActive && !this.isElementsBusy) {
      this.selection.hitTargetElements(this.cursor.worldValue);
    }

    // 判断鼠标是否按下
    if (this._isPressDown) {
      this.calcPressMove(e);
      if (this.isTextEditing) {
        this._tryRetrieveTextCursor(TextEditorPressTypes.PRESS_MOVE, true);
      } else if (this.isArbitraryDrawing) {
        // 移动过程中创建组件
        this._updateArbitraryTailOnMovement(e);
      } else if (this.isDrawerActive) {
        // 移动过程中创建组件
        this._creatingElementOnMovement(e);
      } else if (this.isMoveableActive) {
        // 如果是选择模式
        if (this.store.isSelectedEmpty) {
          // 没有选中组件，那么就创建一个范围组件
          this._updateRange();
        } else if (this.checkCursorPressMovedALittle(e)) {
          let mOperating: boolean = ElementsBusyStatus.includes(this.elementsStatus);
          if (!mOperating) {
            const mMoving =
              this.elementsStatus === StageShieldElementsStatus.MOVE_READY &&
              ![StageShieldElementsStatus.ROTATING, StageShieldElementsStatus.TRANSFORMING, StageShieldElementsStatus.CORNER_MOVING].includes(this.elementsStatus) &&
              this.store.isSelectedContainsTarget() &&
              this.store.isEditingEmpty;
            if (mMoving) {
              // 已经确定是拖动操作的情况下，做如下逻辑判断
              if (this.elementsStatus !== StageShieldElementsStatus.MOVING) {
                this._refreshAncestorsOriginals(this.store.detachedSelectedElements);
              }
              this.elementsStatus = StageShieldElementsStatus.MOVING;
              mOperating = true;
            } else {
              this.elementsStatus = StageShieldElementsStatus.NONE;
            }
          }
          if (mOperating) {
            await this._doElementsOperating();
          }
        }
      } else if (this.isHandActive) {
        this._isStageMoving = true;
        this._dragStage(e);
      }
    } else if (this.isMoveableActive) {
      this.selection.tryActiveController(this.cursor.worldValue);
    }
    // 如果正在操作组件，那么就清除目标组件的isTarget状态
    if (this.isElementsBusy) {
      this.store.cancelTargetElements();
    }
  }

  /**
   * 触发编辑组件的舞台变化事件
   */
  private triggetEditingElementsStageChanged(): void {
    requestAnimationFrame(() => {
      this.store.editingElements.forEach(element => element.onStageChanged());
    });
  }

  /**
   * 舞台拖动
   *
   * @param e
   */
  private _dragStage(e: MouseEvent): void {
    this.executeMethod(() => {
      this._refreshStageWorldCoord(e);
      this.store.refreshStageElements();
      this.triggetEditingElementsStageChanged();
    });
  }

  /**
   * 拖动组件移动
   */
  private _dragElements(): void {
    this.executeMethod(() => {
      const { selectedElements } = this.store;
      this.store.updateElementsCoordsByOffset(selectedElements, this.movingOffset);
      this._refreshAncesorsByDetachedElements(selectedElements);
      selectedElements.forEach(element => {
        element.isDragging = true;
        element.onTranslating();
      });
    });
  }

  /**
   * 组件半径
   */
  private _movingElementsCorner(): void {
    this.executeMethod(() => {
      const { selectedElements } = this.store;
      this.store.updateElementsCorner(selectedElements, this.movingOffset);
      selectedElements.forEach(element => {
        element.isCornerMoving = true;
        element.onCornerChanging();
      });
    });
  }

  /**
   * 组件形变
   */
  private _transformElements(): void {
    this.executeMethod(() => {
      const { selectedElements } = this.store;
      if (this.store.isMultiSelected) {
        this.selection.rangeElement.isTransforming = true;
        this.store.updateElementsTransform([this.selection.rangeElement], this.movingOffset);
      } else {
        this.store.updateElementsTransform(selectedElements, this.movingOffset);
      }
      this._refreshAncesorsByDetachedElements(selectedElements);
      selectedElements.forEach(element => {
        element.isTransforming = true;
        element.onTransforming();
      });
    });
  }

  /**
   * 旋转组件
   */
  private _rotateElements(): void {
    this.executeMethod(() => {
      const { selectedElements, nonHomologousElements } = this.store;
      if (this.store.isMultiSelected) {
        this.selection.rangeElement.isRotating = true;
        this.store.updateElementsRotation([this.selection.rangeElement], this._pressMovePosition);
      } else {
        this.store.updateElementsRotation(nonHomologousElements, this._pressMovePosition);
      }
      this._refreshAncesorsByDetachedElements(selectedElements);
      selectedElements.forEach(element => {
        element.isRotating = true;
        element.onRotating();
      });
    });
  }

  /**
   * 更新选区
   */
  private _updateRange(): void {
    // 计算选区
    const rangeCoords = CommonUtils.getBoxByPoints([this._pressDownStageWorldCoord, this._pressMoveStageWorldCoord]);
    // 更新选区，命中组件
    this.selection.setRange(rangeCoords);
  }

  /**
   * 鼠标离开画布事件
   */
  async _handleCursorLeave(): Promise<void> {
    this.cursor.clear();
    this.cursor.setStyle("default");
  }

  /**
   * 预处理旋转状态
   *
   * @param controller
   */
  private _preProcessRotationStates(controller: IController): void {
    this.store.updateElementById(controller.host.id, {
      isRotatingTarget: true,
    });
    // 如果是选区旋转，则只处理选区组件
    if (this.store.isMultiSelected) {
      // 计算选区旋转的中心点等数据信息
      this.store.refreshElementsRotationStates([this.selection.rangeElement], this._pressDownPosition);
    } else {
      this.store.refreshRotatingStates(this._pressDownPosition);
    }
  }

  /**
   * 执行组件选中操作
   *
   * @param e
   */
  private _doSelect(e: MouseEvent): void {
    // 获取鼠标点击的组件
    const targetElement = this.selection.getElementOnCoord(this.cursor.worldValue);
    // 如果目标组件处于编辑中，则不切换选中状态
    if (this.store.editingElements.findIndex(element => element.id === targetElement?.id) !== -1) {
      return;
    }
    // 判断当前鼠标位置的组件是否已经被选中
    const isSelectContainsTarget = this.store.isSelectedContainsTarget();
    if (targetElement) {
      if (e.ctrlKey) {
        this.store.toggleSelectElement(targetElement);
      } else {
        // 如果当前鼠标位置的组件没有被选中，则将当前组件设置为选中状态，其他组件取消选中状态
        if (!isSelectContainsTarget) {
          this._clearSelects();
          this.store.selectElement(targetElement);
        }
        // 准备拖动
        this.elementsStatus = StageShieldElementsStatus.MOVE_READY;
      }
    }
  }

  /**
   * 处理当鼠标按下时的组件是否应该选中
   *
   * @param e
   */
  private _trySelect(e: MouseEvent): void {
    this._addSelectedChangedCommand(async () => await this._doSelect(e));
  }

  /**
   * 鼠标按下事件
   *
   * @param e
   */
  async _handlePressDown(e: MouseEvent): Promise<void> {
    this._latestMousedownTimestamp = window.performance.now();
    this._isPressDown = true;
    this.calcPressDown(e);

    if (this.isTextEditing) {
      if (this._isCursorOnEditingElement()) {
        this._tryRetrieveTextCursor(TextEditorPressTypes.PRESS_DOWN, false);
      } else {
        await this._commitEidting();
        this._shouldSelectTopAWhilePressUp = false;
      }
    } else if (this.isTextCreating) {
      this.html.createTextInput(this.cursor.value);
    } else if (this.isDrawerActive && !this.store.isSelectedEqCreating()) {
      // 如果当前是绘制模式或则是开始绘制自由多边形，则清空选区
      this._clearSelects();
    } else if (this.isMoveableActive) {
      // 尝试激活控制器（未选中的组件不会参与控制器的命中）
      const controller = this.selection.tryActiveController(this.cursor.worldValue);
      if (controller) {
        const elements = [...this.store.selectedElements, this.selection.rangeElement];
        this.store.refreshElementsOriginalAngles(elements, { deepSubs: true });
        this.store.refreshElementsOriginals(elements, { deepSubs: true });
      }
      if (controller instanceof ElementRotation) {
        this._preProcessRotationStates(controller);
        this.elementsStatus = StageShieldElementsStatus.ROTATING;
      } else if (controller instanceof VerticesTransformer || controller instanceof BorderTransformer) {
        this.elementsStatus = StageShieldElementsStatus.TRANSFORMING;
      } else if (controller instanceof CornerController) {
        this.elementsStatus = StageShieldElementsStatus.CORNER_MOVING;
      } else {
        this._trySelect(e);
      }
      // 对于子组件的形变、旋转、位移，需要刷新祖先组件的原始数据
      if ([StageShieldElementsStatus.MOVING, StageShieldElementsStatus.ROTATING, StageShieldElementsStatus.TRANSFORMING].includes(this.elementsStatus)) {
        this._refreshAncestorsOriginals(this.store.detachedSelectedElements);
      }
    } else if (this.isHandActive) {
      this._originalStageWorldCoord = LodashUtils.jsonClone(this.stageWorldCoord);
    }
  }

  /**
   * 判断光标是否在选中的组件上
   */
  private _isCursorOnEditingElement(): boolean {
    const targetElement = this.selection.getElementOnCoord(this.cursor.worldValue);
    return this.store.editingElements.includes(targetElement);
  }

  /**
   * 尝试命中文本组件的光标
   *
   * @param pressType - 按压类型
   */
  private _tryRetrieveTextCursor(pressType: TextEditorPressTypes, isSelectionMove?: boolean): void {
    const { selectedElements } = this.store;
    const targetElement = this.selection.getElementOnCoord(this.cursor.worldValue);
    if (targetElement && targetElement instanceof ElementText && selectedElements[0] === targetElement) {
      if (pressType !== TextEditorPressTypes.PRESS_UP) {
        (targetElement as ElementText).refreshTextCursorAtPosition(this.cursor.worldValue, isSelectionMove);
        this._retreiveTextCursorInput(targetElement as unknown as IElementText);
      }
      (targetElement as ElementText).onEditorPressChange(pressType);
    }
  }

  /**
   * 添加一个工具切换的命令
   */
  private async _addCreatorChangedCommand(): Promise<void> {
    // 组件创建生效，生成一个切换绘图工具切换的命令
    const command = await CommandHelper.createByActionParams([], ElementsCommandTypes.ElementsCreatorChanged, this.store);
    Object.assign(command.payload, {
      prevCreatorType: this.prevCreatorType,
      creatorType: this.currentCreator.type,
    });
    this.undoRedo.add(command);
    this._tailCreatorCommandId = command.id;
  }

  /**
   * 创建一个组件选中状态改变的命令
   *
   * @param operatingFunction
   */
  private async _addSelectedChangedCommand(operatingFunction?: () => Promise<void>): Promise<void> {
    const prevSelectedIds: Set<string> = new Set(this.store.selectedElementIds);
    operatingFunction && (await operatingFunction());
    const selectedIds: Set<string> = new Set(this.store.selectedElementIds);
    if (!LodashUtils.isSetEqual(prevSelectedIds, selectedIds)) {
      const command = await CommandHelper.createByActionParams([], ElementsCommandTypes.ElementsSelected, this.store);
      Object.assign(command.payload, {
        prevSelectedIds,
        selectedIds,
      });
      this.undoRedo.add(command);
    }
  }

  /**
   * 处理自由折线下的鼠标按下事件
   */
  private async _handleArbitraryPressUp(): Promise<void> {
    let element: IElement = this.store.creatingElements[0];
    let uDataList: ICommandElementObject[] = [];
    let rDataList: ICommandElementObject[] = [];
    if (element) {
      uDataList.push(
        ...(await CommandHelper.createDataListByActionParams([
          {
            type: ElementActionTypes.Creating,
            data: [element],
          },
        ])),
      );
    }
    element = this.store.creatingArbitraryElement(this.cursor.worldValue, true);
    if ((element as IElementArbitrary).tailCoordIndex === 0) {
      uDataList.push({ type: ElementActionTypes.StartCreating, model: { id: element.id } });
      // 组件创建生效，生成一个组件创建的命令
      rDataList.push(
        ...(await CommandHelper.createDataListByActionParams([
          {
            type: ElementActionTypes.StartCreating,
            data: [element],
          },
        ])),
      );
      await this._addCommandByDataList({
        id: element.id,
        payload: {
          uDataList,
          rDataList,
          type: ElementsCommandTypes.ElementsStartCreating,
        },
      });
    } else {
      rDataList.push(
        ...(await CommandHelper.createDataListByActionParams([
          {
            type: ElementActionTypes.Creating,
            data: [element],
          },
        ])),
      );
      await this._addCommandByDataList({
        id: element.id,
        payload: {
          uDataList,
          rDataList,
          type: ElementsCommandTypes.ElementsCreating,
        },
      });
    }
    if (element?.model.isFold) {
      this.commitArbitraryDrawing();
    }
  }

  /**
   * 清除舞台组件状态
   */
  private _clearSelects(): void {
    // 清空所有组件的选中状态
    this.selection.clearSelects();
    // 清空选区
    this.selection.setRange([]);
  }

  /**
   * 结束组件操作
   */
  private async _endElementsOperating(): Promise<void> {
    // 判断是否是拖动组件操作，并且判断拖动位移是否有效
    switch (this.elementsStatus) {
      case StageShieldElementsStatus.MOVING: {
        await this._endElementsDrag();
        break;
      }
      case StageShieldElementsStatus.ROTATING: {
        await this._endElementsRotate();
        break;
      }
      case StageShieldElementsStatus.TRANSFORMING: {
        await this._endElementsTransform();
        break;
      }
      case StageShieldElementsStatus.CORNER_MOVING: {
        await this._endMovingElementsCorner();
        break;
      }
    }
  }

  /**
   * 当结束组件操作时更新组件状态
   */
  private _clearElementsStatus(): void {
    if (ElementsBusyStatus.includes(this.elementsStatus) && this.store.isEditingEmpty) {
      this.elementsStatus = StageShieldElementsStatus.NONE;
    }
  }

  /**
   * 判断鼠标抬起时是否需要选中顶层组件
   */
  private _trySelectTopA(): void {
    if (this._shouldSelectTopAWhilePressUp) {
      this._addSelectedChangedCommand(async () => await this._selectTopAElement(this.store.selectedElements));
    }
    this._shouldSelectTopAWhilePressUp = true;
  }

  /**
   * 鼠标抬起事件
   *
   * @param e
   */
  async _handlePressUp(e: MouseEvent): Promise<void> {
    this._isPressDown = false;
    this.calcPressUp(e);
    if (this.isTextEditing) {
      this._tryRetrieveTextCursor(TextEditorPressTypes.PRESS_UP, false);
    } else if (this.isArbitraryDrawing) {
      // 如果是绘制模式，则完成组件的绘制
      this._isPressDown = true;
      await this._handleArbitraryPressUp();
    } else if (this.isDrawerActive) {
      this.store.finishCreatingElement();
    } else if (this.isMoveableActive) {
      // 先判断是否选中组件
      if (this.store.isSelectedEmpty) {
        this._trySelectRange();
      } else if (this.checkCursorPressUpALittle(e)) {
        await this._endElementsOperating();
        this._clearElementsStatus();
      } else if (!e.ctrlKey && !e.shiftKey && !this.isArbitraryEditing) {
        this._trySelectTopA();
      }
    } else if (this.isHandActive) {
      this._processHandCreatorMove(e);
    }
    // 非自由折线模式，绘制完成之后重绘
    if (!this.isArbitraryDrawing) {
      await this._tryCommitElementCreated();
    }
  }

  /**
   * 尝试选中选区内的组件
   */
  private async _trySelectRange(): Promise<void> {
    this._addSelectedChangedCommand(async () => {
      this.selection.selectRange();
      this.selection.setRange(null);
    });
  }

  /**
   * 创建文本光标输入框并聚焦
   * @param textElement - 文本组件
   */
  private _retreiveTextCursorInput(textElement: IElementText): void {
    if (!textElement || !(textElement instanceof ElementText)) {
      return;
    }
    this.html.createTextCursorInput();
    requestAnimationFrame(() => {
      this.html.focusTextCursorInput();
    });
  }

  /**
   * 更新组件编辑前的原始数据
   *
   * @param element
   */
  private async _refreshOrignalEditingDataList(element: IElement): Promise<void> {
    this._originalEditingUDataList = await CommandHelper.createDataList(this.store.editingElements, ElementActionTypes.Updated, {
      dataTransfer: async element => await element.toOriginalTransformJson(),
    });
    if (element instanceof ElementArbitrary) {
      // 自由折线工具在编辑时，会调整控制点，进而会影响组件的位置和尺寸，导致组件所属的祖先组件的位置和尺寸也需要变更，因此需要记录所有的祖先组件的原始数据
      this._originalEditingUDataList.push(
        ...(await CommandHelper.createDataList(element.ancestorGroups, ElementActionTypes.Updated, {
          dataTransfer: async element => await element.toOriginalTransformJson(),
        })),
      );
    }
  }

  /**
   * 在开始编辑组件时，处理组件相关数据
   *
   * @param element
   */
  private async _onElementEditStart(element: IElement): Promise<void> {
    this._refreshOrignalEditingDataList(element);
    if (element instanceof ElementText) {
      // 如果是文本编辑模式，则创建文本光标输入框并聚焦
      this._retreiveTextCursorInput(element as IElementText);
    }
  }

  /**
   * 尝试编辑组件
   *
   * @param element
   */
  private async _tryEditElement(element: IElement): Promise<void> {
    this.store.beginEditElements([element]);
    await this._onElementEditStart(element);
  }

  /**
   * 处理鼠标双击事件
   *
   * @param e
   */
  async _handleDblClick(e: MouseEvent): Promise<void> {
    if (this.isMoveableActive) {
      let topAElement = this._getTopAElemnt(this.store.stageElements);
      if (topAElement?.isGroup) {
        topAElement = this._getTopAElemnt((topAElement as IElementGroup).deepSubs.filter(element => !element.isGroup));
      }
      if (topAElement) {
        this.store.setElementsDetachedSelected([topAElement], true);
        if (topAElement.editingEnable) {
          await this._tryEditElement(topAElement);
        }
      }
    }
  }

  /**
   * 绘制完成之后的重绘
   */
  private async _tryCommitElementCreated(): Promise<void> {
    await Promise.all([this._addRedrawTask(true), this._commitElementCreated()]);
  }

  /**
   * 扁平化组件和其祖先组件,返回的结果链表有序
   *
   * @param elements - 组件列表
   * @returns 扁平化后的组件列表
   */
  private _flatWithAncestors(elements: IElement[]): IElement[] {
    const ancestorIds = ElementUtils.getAncestorIdsByDetachedElements(elements);
    const ids = new Set(ancestorIds);
    elements.forEach(element => {
      ids.add(element.id);
    });
    return this.store.getOrderedElementsByIds(Array.from(ids));
  }

  /**
   * 刷新组件祖先组件的变换状态
   * @param element - 组件
   */
  private _refreshAncestorsTransformed(element: IElement): void {
    if (element.isGroupSubject && element.isDetachedSelected) {
      element.ancestorGroups.forEach(group => {
        group.onTransformAfter();
      });
    }
  }

  /**
   * 创建组件原始平移命令
   *
   * @param elements
   */
  private async _addOriginalTranslateCommand(elements: IElement[]): Promise<void> {
    elements = this._flatWithAncestors(elements);
    const [uDataList, rDataList] = await CommandHelper.batchCreateDataList(
      elements,
      [element => element.toOriginalTranslateJson(), element => element.toTranslateJson()],
      [ElementActionTypes.Updated],
    );
    await this._addCommandByDataList({
      payload: {
        uDataList,
        rDataList,
        type: ElementsCommandTypes.ElementsUpdated,
      },
    });
  }

  /**
   * 结束组件拖拽操作
   */
  private async _endElementsDrag(): Promise<void> {
    const { selectedElements } = this.store;
    await this._addOriginalTranslateCommand(selectedElements);
    // 取消组件拖动状态
    selectedElements.forEach(element => {
      element.isDragging = false;
      element.onTranslateAfter();
      this._refreshAncestorsTransformed(element);
    });
    if (this.store.isMultiSelected) {
      this.selection.rangeElement.isDragging = false;
    }
  }

  /**
   * 创建组件原始旋转命令
   *
   * @param elements
   */
  private async _addOrignalRotateCommand(elements: IElement[]): Promise<void> {
    elements = this._flatWithAncestors(elements);
    const [uDataList, rDataList] = await CommandHelper.batchCreateDataList(elements, [element => element.toOriginalRotateJson(), element => element.toRotateJson()], [ElementActionTypes.Updated]);
    await this._addCommandByDataList({
      payload: {
        uDataList,
        rDataList,
        type: ElementsCommandTypes.ElementsUpdated,
      },
    });
  }

  /**
   * 结束组件旋转操作
   */
  private async _endElementsRotate() {
    const { selectedElements } = this.store;
    await this._addOrignalRotateCommand(selectedElements);
    // 更新组件状态
    selectedElements.forEach(element => {
      element.isRotatingTarget = false;
      element.isRotating = false;
      element.onRotateAfter();
      this._refreshAncestorsTransformed(element);
    });
    if (this.store.isMultiSelected) {
      this.selection.rangeElement.isRotating = false;
    }
    this.store.clearRotatingStates();
  }

  /**
   * 创建组件原始变换命令
   *
   * @param elements
   */
  private async _addOriginalTransformCommand(elements: IElement[]): Promise<void> {
    elements = this._flatWithAncestors(elements);
    const [uDataList, rDataList] = await CommandHelper.batchCreateDataList(
      elements,
      [element => element.toOriginalTransformJson(), element => element.toTransformJson()],
      [ElementActionTypes.Updated],
    );
    await this._addCommandByDataList({
      payload: {
        uDataList,
        rDataList,
        type: ElementsCommandTypes.ElementsUpdated,
      },
    });
  }

  /**
   * 结束组件变换操作
   */
  private async _endElementsTransform() {
    await this._addOriginalTransformCommand(this.store.selectedElements);
    // 更新组件状态
    this.store.selectedElements.forEach(element => {
      element.isTransforming = false;
      element.onTransformAfter();
      this._refreshAncestorsTransformed(element);
    });
    if (this.store.isMultiSelected) {
      this.selection.rangeElement.isTransforming = false;
    }
  }

  /**
   * 结束组件圆角半径操作
   */
  private async _endMovingElementsCorner(): Promise<void> {
    const [uDataList, rDataList] = await CommandHelper.batchCreateDataList(
      this.store.selectedElements,
      [element => element.toOriginalCornerJson(), element => element.toCornerJson()],
      [ElementActionTypes.Updated],
    );
    await this._addCommandByDataList({
      payload: {
        uDataList,
        rDataList,
        type: ElementsCommandTypes.ElementsUpdated,
      },
    });
    // 更新组件状态
    this.store.selectedElements.forEach(element => {
      element.isCornerMoving = false;
      element.refreshOriginals();
      element.onCornerChanged();
    });
  }

  /**
   * 获取当前鼠标位置最顶层的组件，如果有脱离组合被选中的组件，则提高其优先级
   *
   * @param elements
   * @returns
   */
  private _getTopAElemnt(elements: IElement[]): IElement {
    const detachedSelectedElements = elements.filter(element => element.isDetachedSelected);
    return ElementUtils.getTopAElementByCoord(detachedSelectedElements.length ? detachedSelectedElements : elements, this.cursor.worldValue);
  }

  /**
   * 选中组件
   *
   * @param element
   */
  private _doSelectElement(element: IElement): void {
    this.store.deSelectElements(
      this.store.selectedElements.filter(el => {
        if (element && element.isGroup) {
          return el.ancestorGroup !== element;
        }
        return el !== element;
      }),
    );
    !!element && this.store.selectElement(element);
  }

  /**
   * 将除当前鼠标位置的组件设置为被选中，其他组件取消选中状态
   */
  private _selectTopAElement(elements: IElement[]): void {
    const topAElement = this._getTopAElemnt(elements);
    this._doSelectElement(topAElement);
  }

  /**
   * 处理手型工具移动事件
   *
   * @param e
   */
  private _processHandCreatorMove(e: MouseEvent): void {
    this._refreshStageWorldCoord(e);
    this.store.refreshStageElements();
    this._isStageMoving = false;
  }

  /**
   * 如果组件成功创建，则需要删除当前组件的切换工具命令，使撤销操作更流畅
   */
  private _deleteTailCreatorCommand(): void {
    const tailUndoCommand = this.undoRedo.tailUndoCommand;
    if (tailUndoCommand && tailUndoCommand.id === this._tailCreatorCommandId) {
      this.undoRedo.pop();
      this._tailCreatorCommandId = null;
    }
  }

  /**
   * 新增添加组件的命令
   *
   * @param elements
   */
  private async _addAddedCommand(elements: IElement[]): Promise<void> {
    const actionParams: ElementsActionParam[] = [
      {
        type: ElementActionTypes.Added,
        data: elements,
      },
    ];
    const command = await CommandHelper.createByActionParams(actionParams, ElementsCommandTypes.ElementsAdded, this.store);
    this.undoRedo.add(command);
  }

  /**
   * 创建添加组件命令
   *
   * @param elements - 组件列表
   */
  private async _tryAddAddedCommand(elements: IElement[]): Promise<void> {
    this._deleteTailCreatorCommand();
    await this._addAddedCommand(elements);
  }

  /**
   * 发送组件创建事件
   *
   * @param elements - 组件列表
   */
  private _emitElementsCreated(elements: IElement[]): void {
    this.setCreator(MoveableCreator, false);
    this.emit(ShieldDispatcherNames.elementCreated, elements);
  }

  /**
   * 提交绘制
   */
  private async _commitElementCreated(): Promise<void> {
    const provisionalElements = this.store.provisionalElements;
    if (provisionalElements.length) {
      this.store.updateElements(provisionalElements, {
        isProvisional: false,
        isOnStage: true,
      });
      this._emitElementsCreated(provisionalElements);
      await this._tryAddAddedCommand(provisionalElements);
    }
  }

  /**
   * 鼠标按下时计算位置
   *
   * @param e
   */
  calcPressDown(e: MouseEvent): void {
    this._pressDownPosition = this.cursor.transform(e);
    this._pressDownStageWorldCoord = ElementUtils.calcWorldCoord(this._pressDownPosition);
  }

  /**
   * 鼠标抬起时计算位置
   *
   * @param e
   */
  calcPressUp(e: MouseEvent): void {
    this._pressUpPosition = this.cursor.transform(e);
    this._pressUpStageWorldCoord = ElementUtils.calcWorldCoord(this._pressUpPosition);
  }

  /**
   * 鼠标按压并移动时候，计算偏移量
   *
   * @param e
   */
  calcPressMove(e: MouseEvent): void {
    this._pressMovePosition = this.cursor.transform(e);
    this._pressMoveStageWorldCoord = ElementUtils.calcWorldCoord(this._pressMovePosition);
  }

  /**
   * 检查鼠标是否移动过短（移动距离过短，可能为误触）
   *
   * @param e
   * @returns
   */
  checkCursorPressMovedALittle(e: MouseEvent): boolean {
    return (
      Math.abs(this._pressMoveStageWorldCoord.x - this._pressDownStageWorldCoord.x) >= MinCursorMXD || Math.abs(this._pressMoveStageWorldCoord.y - this._pressDownStageWorldCoord.y) >= MinCursorMYD
    );
  }

  /**
   * 检查鼠标抬起是否移动过短（移动距离过短，可能为误触）
   *
   * @param e
   * @returns
   */
  checkCursorPressUpALittle(e: MouseEvent): boolean {
    return Math.abs(this._pressUpStageWorldCoord.x - this._pressDownStageWorldCoord.x) >= MinCursorMXD || Math.abs(this._pressUpStageWorldCoord.y - this._pressDownStageWorldCoord.y) >= MinCursorMYD;
  }

  /**
   * 刷新画布尺寸
   */
  private async _refreshSize(): Promise<void> {
    this.executeMethod(() => {
      const rect = this.renderEl.getBoundingClientRect();
      this.stageRect = rect;
      this._updateCanvasSize(rect);
      this.store.refreshStageElements();
      this.triggetEditingElementsStageChanged();
    });
  }

  /**
   * 更新所有画布尺寸
   *
   * @param size
   */
  private _updateCanvasSize(size: DOMRect): void {
    this.mask.updateSize(size);
    this.provisional.updateSize(size);
    this.html.updateSize(size);
    this.updateSize(size);
  }

  /**
   * 设置当前工具
   *
   * @param creator
   */
  async setCreator(creator: Creator, isSupportUndoRedo?: boolean): Promise<void> {
    if (creator.type === this.currentCreator?.type) return;
    this.currentCreator = creator;
    isSupportUndoRedo && (await this._addCreatorChangedCommand());
    this.prevCreatorType = this.currentCreator?.type;
    this.cursor.updateStyle();
    this.emit(ShieldDispatcherNames.creatorChanged, this.currentCreator);
  }

  /**
   * 尝试渲染工具
   *
   * @param e
   */
  _creatingElementOnMovement(e: MouseEvent): IElement {
    if (this.checkCursorPressMovedALittle(e)) {
      return this.store.creatingElement([this._pressDownStageWorldCoord, this._pressMoveStageWorldCoord]);
    }
  }

  /**
   * 更新自由折线组件
   *
   * @param e
   * @returns
   */
  _updateArbitraryTailOnMovement(e: MouseEvent): IElement {
    const creatingElement = this.store.creatingElements[0] as IElementArbitrary;
    if (creatingElement && creatingElement.tailCoordIndex >= 0 && this.checkCursorPressMovedALittle(e)) {
      return this.store.creatingArbitraryElement(this._pressMoveStageWorldCoord, false);
    }
  }

  /**
   * 刷新当前舞台世界坐标
   */
  private _refreshStageWorldCoord(e: MouseEvent): void {
    if (!this._originalStageWorldCoord) return;
    const point = CommonUtils.getEventPosition(e, this.stageRect, this.stageScale);
    this.stageWorldCoord = {
      x: this._originalStageWorldCoord.x - (point.x - this._pressDownPosition.x),
      y: this._originalStageWorldCoord.y - (point.y - this._pressDownPosition.y),
    };
  }

  /**
   *  检查缩放值
   *
   * @param deltaScale
   * @returns
   */
  private _checkScale(deltaScale: number): number {
    let value = clamp(this.stageScale + deltaScale, 0.02, 5);
    // 2位小数精度
    value = MathUtils.precise(value, 2);
    if (this.stageScale === 0.02) {
      if (deltaScale > 0) {
        value = 0.1;
      }
    }
    return value;
  }

  /**
   * 设置缩放
   *
   * @param value
   */
  async setScale(value: number): Promise<void> {
    await this.executeMethod(() => {
      this.stageScale = value;
      CanvasUtils.scale = value;
      this.html.updateSize(this.renderEl.getBoundingClientRect());
      this.emit(ShieldDispatcherNames.scaleChanged, value);
      this.store.refreshStageElements();
      this.triggetEditingElementsStageChanged();
    });
  }

  /**
   * 滚轮缩放
   *
   * @param deltaScale
   * @param e
   */
  private _handleWheelScale(deltaScale: number, e: MouseEvent): void {
    const prevCursorPosition = CommonUtils.getEventPosition(e, this.stageRect, this.stageScale);
    const cursorCoord = ElementUtils.calcWorldCoord(prevCursorPosition);
    const value = this._checkScale(deltaScale);
    const cursorCoordOffsetX = (e.clientX - this.stageRect.left) / value;
    const cursorCoordOffsetY = (e.clientY - this.stageRect.top) / value;
    const stageRectCoordX = cursorCoord.x - cursorCoordOffsetX;
    const stageRectCoordY = cursorCoord.y - cursorCoordOffsetY;
    const stageWorldCoordX = stageRectCoordX + this.stageRect.width / 2 / value;
    const stageWorldCoordY = stageRectCoordY + this.stageRect.height / 2 / value;
    this.stageWorldCoord = {
      x: stageWorldCoordX,
      y: stageWorldCoordY,
    };
    this.setScale(value);
  }

  /**
   * 舞台滚动
   *
   * @param delta
   */
  private _handleWheelMove(delta: IPoint): void {
    this.executeMethod(() => {
      this.stageWorldCoord.x += delta.x / 2 / this.stageScale;
      this.stageWorldCoord.y += delta.y / 2 / this.stageScale;
      this.store.refreshStageElements();
      this.store.editingElements.forEach(element => element.onStageChanged());
    });
  }

  /**
   * 给定矩形计算自动适应缩放值
   *
   * @param box
   * @returns
   */
  _calcScaleAutoFitValueByBox(box: IPoint[]): number {
    const { width, height } = CommonUtils.calcRectangleSize(box);
    return this._calcScaleAutoFitValueBySize(width, height);
  }

  /**
   * 给定尺寸计算自动适应缩放值
   *
   * @param width
   * @param height
   * @returns
   */
  _calcScaleAutoFitValueBySize(width: number, height: number): number {
    let scale = MathUtils.precise(CommonUtils.calcScale(this.stageRect, { width, height }, AutoFitPadding * this.stageScale), 2);
    scale = clamp(scale, 0.02, 1);
    return scale;
  }

  /**
   * 计算给定组件的自动适应缩放值
   *
   * @param elements
   * @returns
   */
  _calcElementsAutoFitValue(elements: IElement[]): number {
    const elementsBox = CommonUtils.getBoxByPoints(elements.map(element => element.maxOutlineBoxCoords).flat());
    return this._calcScaleAutoFitValueByBox(elementsBox);
  }

  /**
   * 根据给定的组件进行舞台自适应，表征中心位置并缩放
   *
   * @param elements
   */
  private async _setStageAutoFitByElements(elements: IElement[], options?: { scalePrdicate?: (scale: number) => boolean; relocatePredicate?: (scale: number) => boolean }): Promise<void> {
    const { scalePrdicate = () => true, relocatePredicate = () => true } = options || {};
    const value = this._calcElementsAutoFitValue(elements);
    if (relocatePredicate(value)) {
      const center = MathUtils.calcCenter(elements.map(element => element.rotateOutlineCoords.flat()).flat());
      this.stageWorldCoord = center;
    }
    scalePrdicate(value) && (await this.setScale(value));
    this.store.refreshStageElements();
  }

  /**
   * 舞台自适应
   */
  setScaleAutoFit(): void {
    if (!this.store.isVisibleEmpty) {
      this._setStageAutoFitByElements(this.store.visibleElements);
    } else {
      this.stageWorldCoord = { x: 0, y: 0 };
      this.setScale(1);
    }
  }

  /**
   * 舞台缩小
   */
  setScaleReduce(): void {
    const value = this._checkScale(-0.05);
    this.setScale(value);
  }

  /**
   * 舞台放大
   */
  setScaleIncrease(): void {
    const value = this._checkScale(0.05);
    this.setScale(value);
  }

  /**
   * 舞台100%缩放
   */
  setScale100(): void {
    this.setScale(1);
  }

  /**
   * 处理图片粘贴
   *
   * @param imageData
   * @param e
   * @param callback
   */
  async _handleImagesPasted(imageDatas: ImageData[], e?: Event, callback?: () => Promise<void>): Promise<void> {
    this._clearSelects();
    const elements = await this.store.insertImageElements(imageDatas, this.cursor.worldValue);
    await this._setStageAutoFitByElements(elements, {
      scalePrdicate: scale => scale < this.stageScale,
      relocatePredicate: scale => scale < this.stageScale,
    });
    await this._tryAddAddedCommand(elements);
    callback && (await callback());
  }

  /**
   * 图片上传
   *
   * @param images
   */
  async uploadImages(images: File[]): Promise<void> {
    if (images.length) {
      await this.event.onImagesUpload(images);
    }
  }

  /**
   * 处理选中组件删除
   */
  async _handleSelectsDelete(): Promise<void> {
    if (this.store.isSelectedEmpty) {
      return;
    }
    const { list, ancestors } = this.store.findRemovedElemements(this.store.selectedElements);
    const actionParams: ElementsActionParam[] = [];
    list.forEach(element => {
      actionParams.push({
        type: ElementActionTypes.Removed,
        data: [element],
      });
    });
    // 如果存在子组件被删除，但是父组件没有被删除，则需要解除绑定关系并更新父组件的一些属性数据
    ancestors.forEach(ancestor => {
      actionParams.push({
        type: ElementActionTypes.GroupUpdated,
        data: [ancestor],
      });
    });
    const uDataList = await CommandHelper.createDataListByActionParams(actionParams);
    const elementIds = new Set(list.map(element => element.id));
    ancestors.forEach(ancestor => {
      this.store.updateElementModel(ancestor.id, {
        subIds: (ancestor as IElementGroup).model.subIds.filter(subId => !elementIds.has(subId)),
      });
      (ancestor as IElementGroup).refreshBySubsWithout(Array.from(elementIds));
      ancestor.refreshOriginals();
    });
    const rDataList = await CommandHelper.createDataListByActionParams(actionParams);
    await this._addCommandByDataList({
      payload: {
        uDataList,
        rDataList,
        type: ElementsCommandTypes.ElementsRemoved,
      },
    });
    this.store.removeElements(list);
  }

  /**
   * 选中所有组件
   */
  selectAll(): void {
    this._addSelectedChangedCommand(async () => await this.store.selectAll());
  }

  /**
   * 处理选中组件复制
   */
  async _handleSelectCopy(): Promise<void> {
    const elementsJson = await this.store.copySelectElements();
    const data = JSON.stringify(elementsJson);
    DOMUtils.copyValueToClipboard(data);
  }

  /**
   * 处理粘贴组件
   * @param elementsJson
   */
  async _handlePasteElements(elementsJson: Array<ElementObject>): Promise<void> {
    let uDataList: ICommandElementObject[] = [];
    let rDataList: ICommandElementObject[] = [];
    const elements = await this.store.pasteElements(
      elementsJson,
      async actionParams => {
        uDataList.push(...(await CommandHelper.createDataListByActionParams(actionParams)));
      },
      async actionParams => {
        rDataList.push(...(await CommandHelper.createDataListByActionParams(actionParams)));
      },
    );
    await this._addCommandByDataList({
      payload: {
        uDataList: uDataList.reverse(),
        rDataList,
        type: ElementsCommandTypes.ElementsAdded,
      },
    });
    this.store.setElementsDetachedSelected(elements, true);
  }

  /**
   * 操作取消的处理
   */
  _handleCancel(): void {
    if (this.isArbitraryDrawing) {
      this.commitArbitraryDrawing();
    } else if (this.isArbitraryEditing) {
      this.commitEditingDrawing();
    }
  }

  /**
   * 处理组件组合操作
   */
  async _handleGroupAdd(): Promise<void> {
    if (this.isElementsBusy) return;
    if (this.store.isSelectedEmpty) return;
    let uDataList: ICommandElementObject[] = [];
    let rDataList: ICommandElementObject[] = [];
    let group: IElementGroup | null = null;
    await this.store.createElementGroup(
      this.store.selectedElements,
      async (params: ElementsActionParam[]) => {
        uDataList.push(...(await CommandHelper.createDataListByActionParams(params)));
      },
      async (params: ElementsActionParam[]) => {
        rDataList.push(...(await CommandHelper.createDataListByActionParams(params)));
        const tailParam: ElementsActionParam = params[params.length - 1];
        if (tailParam?.data?.length) {
          group = tailParam.data[0] as IElementGroup;
        }
      },
    );
    if (group) {
      this._clearSelects();
      this.store.setElementsDetachedSelected([group], true);
    }
    await this._addCommandByDataList({
      payload: {
        uDataList,
        rDataList,
        type: ElementsCommandTypes.GroupAdded,
      },
    });
  }

  /**
   * 处理组件组合取消操作
   */
  async _handleGroupCancel(): Promise<void> {
    if (this.isElementsBusy) return;
    const groups = this.store.getSelectedAncestorElementGroups();
    if (groups.length === 0) return;
    const actionParams: ElementsActionParam[] = [];
    groups.forEach(group => {
      actionParams.push({
        type: ElementActionTypes.Removed,
        data: [group],
      });
      group.subs.forEach(sub => {
        actionParams.push({
          type: ElementActionTypes.Moved,
          data: [sub],
        });
      });
    });
    const uDataList = await CommandHelper.createDataListByActionParams(actionParams);
    this.store.cancelGroups(groups);
    const rDataList = await CommandHelper.createDataListByActionParams(actionParams);
    await this._addCommandByDataList({
      payload: {
        uDataList,
        rDataList,
        type: ElementsCommandTypes.GroupRemoved,
      },
    });
    groups.forEach(group => {
      this.store.selectElements(group.subs);
    });
  }

  /**
   * 在撤销或者回退的时候，更新组件编辑状态
   *
   * @param dataList
   */
  private async _doElementEditingOnUndoRedo(dataList: ICommandElementObject[]): Promise<void> {
    const list = dataList.filter(item => item.type === ElementActionTypes.Updated && item.effect.hasOwnProperty("isEditing"));
    await Promise.all(
      list.map(async item => {
        const {
          effect,
          model: { id },
        } = item;
        const { isEditing, status } = effect as { isEditing?: boolean; status?: ElementStatus };
        const element = this.store.getElementById(id);
        if (!element) return;
        if (isBoolean(isEditing)) {
          if (isEditing) {
            if (!this.store.editingElementIds.has(id)) {
              await this._tryEditElement(this.store.getElementById(id));
            }
          } else {
            this.store.updateElementById(id, { isEditing });
          }
        }
        if (isNumber(status)) {
          this.store.updateElementById(id, { status });
        }
      }),
    );
  }

  /**
   * 执行撤销或者回退操作
   *
   * @param isRedo
   * @returns
   */
  private async _doUndoRedo(isRedo: boolean): Promise<void> {
    let command = isRedo ? this.undoRedo.tailRedoCommand : this.undoRedo.tailUndoCommand;
    if (!command) return;
    let {
      payload: { type, creatorType, prevCreatorType, uDataList, rDataList },
      id,
    } = command;
    if (!(type === ElementsCommandTypes.ElementsUpdated)) {
      this.store.deSelectAll();
    }

    // 执行命令
    await this.undoRedo.execute(isRedo);

    let nextCreatorType: CreatorTypes | null = null;
    switch (type) {
      case ElementsCommandTypes.ElementsCreatorChanged: {
        nextCreatorType = isRedo ? creatorType : prevCreatorType || MoveableCreator.type;
        this._tailCreatorCommandId = id;
        break;
      }
      default: {
        if (isRedo) {
          switch (type) {
            case ElementsCommandTypes.ElementsUpdated: {
              await this._doElementEditingOnUndoRedo(rDataList);
              break;
            }
            case ElementsCommandTypes.ElementsStartCreating: {
              nextCreatorType = rDataList[0].model.type;
              break;
            }
            case ElementsCommandTypes.ElementsCreating: {
              const nextRedoCommand = this.undoRedo.tailRedoCommand;
              if (nextRedoCommand) {
                const {
                  payload: { type: nextCommandType },
                } = nextRedoCommand;
                switch (nextCommandType) {
                  case ElementsCommandTypes.ElementsAdded: {
                    // 先把创建中的组件删除
                    this.store.clearCreatingElements();
                    // 再把组件加回来
                    await this.undoRedo.execute(true);
                    nextCreatorType = MoveableCreator.type;
                    type = nextCommandType;
                    break;
                  }
                }
              }
              break;
            }
            case ElementsCommandTypes.ElementsAdded: {
              nextCreatorType = MoveableCreator.type; // 组件添加完成后，需要切换到移动工具
              break;
            }
          }
        } else {
          switch (type) {
            case ElementsCommandTypes.ElementsUpdated: {
              await this._doElementEditingOnUndoRedo(uDataList);
              break;
            }
            case ElementsCommandTypes.ElementsAdded: {
              const prevUndoCommand = this.undoRedo.tailUndoCommand;
              if (prevUndoCommand) {
                const {
                  payload: { type: prevCommandType, rDataList: prevRDataList },
                } = prevUndoCommand;
                switch (prevCommandType) {
                  case ElementsCommandTypes.ElementsCreating: {
                    // 先把组件加回来
                    await CommandHelper.restoreDataList(rDataList, true, this.store);
                    // 数据恢复
                    await CommandHelper.restoreDataList(prevRDataList, true, this.store);
                    nextCreatorType = prevRDataList[0].model.type;
                    type = prevCommandType;
                    break;
                  }
                  case ElementsCommandTypes.ElementsAdded: {
                    this.store.setElementsDetachedSelectedByIds(
                      prevRDataList.map(item => item.model.id),
                      true,
                    );
                    break;
                  }
                }
              }
              break;
            }
          }
        }
        this.emit(ShieldDispatcherNames.primarySelectedChanged, this.store.primarySelectedElement);

        if (
          [
            ElementsCommandTypes.ElementsRearranged,
            ElementsCommandTypes.ElementsRemoved,
            ElementsCommandTypes.ElementsAdded,
            ElementsCommandTypes.GroupAdded,
            ElementsCommandTypes.GroupRemoved,
            ElementsCommandTypes.DetachedElementsRemoved,
            ElementsCommandTypes.ElementsMoved,
            ElementsCommandTypes.ElementsCreating,
            ElementsCommandTypes.ElementsStartCreating,
          ].includes(type)
        ) {
          this.store.refreshStageElements();
          this.store.throttleRefreshTreeNodes();
        }
        await this._addRedrawTask(true);
        const shouldKeepPressDownCommandTypes = [ElementsCommandTypes.ElementsCreating];
        if (isRedo) {
          shouldKeepPressDownCommandTypes.push(ElementsCommandTypes.ElementsStartCreating);
        }
        this._isPressDown = shouldKeepPressDownCommandTypes.includes(type);
        break;
      }
    }

    nextCreatorType !== null && (await this.setCreator(CreatorHelper.getCreatorByType(nextCreatorType), false));
  }

  /**
   * 执行撤销
   */
  async execUndo(): Promise<void> {
    await this._doUndoRedo(false);
  }

  /**
   * 执行重做
   */
  async execRedo(): Promise<void> {
    await this._doUndoRedo(true);
  }

  /**
   * 处理输入
   *
   * @param value
   * @param fontStyle
   * @param size
   * @param position
   */
  async _handleTextInput(value: string, fontStyle: FontStyle, size: ISize, position: IPoint): Promise<void> {
    this._clearSelects();
    const coord = ElementUtils.calcWorldCoord(position);
    const element = (await this.store.insertTextElement(value, fontStyle, CommonUtils.getBoxByLeftTop(coord, size))) as IElementText;
    // 如果差值小于50ms，则可以判定是鼠标点击舞台时触发的blur事件
    if (window.performance.now() - this._latestMousedownTimestamp <= 50) {
      this._shouldSelectTopAWhilePressUp = false;
    }
    await this._addRedrawTask(true);
    // 因为文本录入时使用的是textarea，但是渲染时是canvas，导致宽度和高度计算不正确（目前没有其他好方法），所以此处需要使用渲染后的文本节点重新计算尺寸
    element.refreshTextSizeCoords();
    element.refresh();
    await this._tryAddAddedCommand([element]);
    this._emitElementsCreated([element]);
  }

  /**
   * 处理文本更新
   *
   * @param value
   * @param states
   */
  async _handleTextUpdate(value: string, states: TextEditingStates): Promise<void> {
    if (this.isTextEditing) {
      const textElement = this.store.selectedElements[0] as IElementText;
      const result = await textElement.updateText(value, states);
      if (!result) return;
      const { changed, reflow } = result;
      await this._addRedrawTask(true);
      if (reflow) {
        await this._reflowTextIfy([textElement], true, changed);
      }
    }
  }

  /**
   * 刷新组件位置
   *
   * @param elements
   */
  private _processOnAlignChanged(elements: IElement[]): void {
    elements.forEach(element => {
      element.onPositionChanged();
      this._refreshAncestorsTransformed(element);
    });
  }

  /**
   * 左对齐
   *
   * @param elements
   */
  async setElementsAlignLeft(elements: IElement[]): Promise<void> {
    await this.executeMethod(async () => {
      await this._addTranslateCommand(elements, async () => {
        await this.align.setElementsAlignLeft(elements);
        this._refreshAncesorsByDetachedElements(elements);
      });
      this._processOnAlignChanged(elements);
    });
  }

  /**
   * 右对齐
   *
   * @param elements
   */
  async setElementsAlignRight(elements: IElement[]): Promise<void> {
    this.executeMethod(async () => {
      await this._addTranslateCommand(elements, async () => {
        await this.align.setElementsAlignRight(elements);
        this._refreshAncesorsByDetachedElements(elements);
      });
      this._processOnAlignChanged(elements);
    });
  }

  /**
   * 顶部对齐
   *
   * @param elements
   */
  async setElementsAlignTop(elements: IElement[]): Promise<void> {
    this.executeMethod(async () => {
      await this._addTranslateCommand(elements, async () => {
        await this.align.setElementsAlignTop(elements);
        this._refreshAncesorsByDetachedElements(elements);
      });
      this._processOnAlignChanged(elements);
    });
  }

  /**
   * 底部对齐
   *
   * @param elements
   */
  async setElementsAlignBottom(elements: IElement[]): Promise<void> {
    this.executeMethod(async () => {
      await this._addTranslateCommand(elements, async () => {
        await this.align.setElementsAlignBottom(elements);
        this._refreshAncesorsByDetachedElements(elements);
      });
      this._processOnAlignChanged(elements);
    });
  }

  /**
   * 水平居中
   *
   * @param elements
   */
  async setElementsAlignCenter(elements: IElement[]): Promise<void> {
    this.executeMethod(async () => {
      await this._addTranslateCommand(elements, async () => {
        await this.align.setElementsAlignCenter(elements);
        this._refreshAncesorsByDetachedElements(elements);
      });
      this._processOnAlignChanged(elements);
    });
  }

  /**
   * 垂直居中
   *
   * @param elements
   */
  async setElementsAlignMiddle(elements: IElement[]): Promise<void> {
    this.executeMethod(async () => {
      await this._addTranslateCommand(elements, async () => {
        await this.align.setElementsAlignMiddle(elements);
        this._refreshAncesorsByDetachedElements(elements);
      });
      this._processOnAlignChanged(elements);
    });
  }

  /**
   * 水平平均分布
   *
   * @param elements
   */
  async setElementsAverageVertical(elements: IElement[]): Promise<void> {
    await this.executeMethod(async () => {
      await this._addTranslateCommand(elements, async () => {
        await this.align.setElementsAverageVertical(elements);
        this._refreshAncesorsByDetachedElements(elements);
      });
      this._processOnAlignChanged(elements);
    });
  }

  /**
   * 垂直平均分布
   *
   * @param elements
   */
  async setElementsAverageHorizontal(elements: IElement[]): Promise<void> {
    await this.executeMethod(async () => {
      await this._addTranslateCommand(elements, async () => {
        await this.align.setElementsAverageHorizontal(elements);
        this._refreshAncesorsByDetachedElements(elements);
      });
      this._processOnAlignChanged(elements);
    });
  }

  /**
   * 提交自由折线
   */
  async commitArbitraryDrawing(): Promise<void> {
    if (this.isArbitraryDrawing) {
      this._isPressDown = false;
      let failed: boolean = true;
      const arbitraryElement = this.store.creatingElements[0] as IElementArbitrary;
      if (arbitraryElement) {
        if (arbitraryElement.model.coords.length >= 2) {
          this.store.finishCreatingElement();
          await this._tryCommitElementCreated();
          failed = false;
        } else {
          this.store.clearCreatingElements();
        }
      }
      if (failed) {
        this._emitElementsCreated(null);
      }
    }
  }

  /**
   * 结束组件编辑
   *
   * @param elements
   */
  private async _addCommandAfterEditing(elements: IElement[]): Promise<void> {
    const rDataList = await CommandHelper.createDataList(elements, ElementActionTypes.Updated, {
      dataTransfer: async element => await element.toJson(),
    });
    await Promise.all(
      elements.map(async element => {
        if (element instanceof ElementArbitrary) {
          rDataList.push(
            ...(await CommandHelper.createDataList(element.ancestorGroups, ElementActionTypes.GroupUpdated, {
              dataTransfer: async element => await element.toJson(),
              eachOperatingFunction: async group => {
                (group as IElementGroup).refreshBySubs();
                group.refreshOriginals();
              },
            })),
          );
        }
      }),
    );
    await this._addCommandByDataList({
      payload: {
        uDataList: this._originalEditingUDataList,
        rDataList,
        type: ElementsCommandTypes.ElementsUpdated,
      },
    });
    this._originalEditingUDataList = null;
  }

  /**
   * 提交编辑
   */
  private async _commitEidting(): Promise<void> {
    this._addCommandAfterEditing(this.store.editingElements);
    this.store.endEditingElements(this.store.editingElements);
    this.elementsStatus = StageShieldElementsStatus.NONE;
  }

  /**
   * 提交编辑绘制
   */
  async commitEditingDrawing(): Promise<void> {
    if (this.isArbitraryEditing) {
      await this._commitEidting();
    }
  }

  /**
   * 组件下移
   *
   * @param elements 要修改的元件集合
   */
  async _setElementsGoDown(elements: IElement[]): Promise<void> {
    const uDataList: Array<ICommandElementObject> = [];
    const rDataList: Array<ICommandElementObject> = [];
    await this.store.setElementsGoDown(
      elements,
      async (params: ElementsActionParam[]) => {
        uDataList.push(...(await CommandHelper.createRearrangeDataList(params)));
      },
      async (params: ElementsActionParam[]) => {
        rDataList.push(...(await CommandHelper.createRearrangeDataList(params)));
      },
    );
    await this._addCommandByDataList({
      payload: {
        uDataList,
        rDataList,
        type: ElementsCommandTypes.ElementsRearranged,
      },
    });
    elements.forEach(element => element.onLayerChanged());
  }

  /**
   * 组件下移
   *
   * @param elements 要修改的元件集合
   */
  async setElementsGoDown(elements: IElement[]): Promise<void> {
    await this.executeMethod(async () => await this._setElementsGoDown(elements));
  }

  /**
   * 组件上移
   *
   * @param elements 要修改的元件集合
   */
  async _setElementsShiftMove(elements: IElement[]): Promise<void> {
    const uDataList: Array<ICommandElementObject> = [];
    const rDataList: Array<ICommandElementObject> = [];
    await this.store.setElementsShiftMove(
      elements,
      async (params: ElementsActionParam[]) => {
        uDataList.push(...(await CommandHelper.createRearrangeDataList(params)));
      },
      async (params: ElementsActionParam[]) => {
        rDataList.push(...(await CommandHelper.createRearrangeDataList(params)));
      },
    );
    await this._addCommandByDataList({
      payload: {
        uDataList,
        rDataList,
        type: ElementsCommandTypes.ElementsRearranged,
      },
    });
    elements.forEach(element => element.onLayerChanged());
  }

  /**
   * 组件上移
   *
   * @param elements 要修改的元件集合
   */
  async setElementsShiftMove(elements: IElement[]): Promise<void> {
    await this.executeMethod(async () => await this._setElementsShiftMove(elements));
  }

  /**
   * 切换目标
   *
   * @param ids 目标id集合
   * @param isTarget 是否目标
   */
  toggleElementsTarget(ids: string[], isTarget: boolean): void {
    this.store.toggleElementsTarget(ids, isTarget);
  }

  /**
   * 切换组件选中状态(组件脱离组合的独立选中状态切换)
   *
   * @param ids 组件id集合
   */
  toggleElementsDetachedSelected(ids: string[]): void {
    this._addSelectedChangedCommand(async () => await this.store.toggleElementsDetachedSelected(ids));
  }

  /**
   * 设置组件选中状态(组件脱离组合的独立选中状态切换)
   *
   * @param ids
   * @param isDetachedSelected
   */
  setElementsDetachedSelectedByIds(ids: string[], isDetachedSelected: boolean): void {
    this._addSelectedChangedCommand(async () => await this.store.setElementsDetachedSelectedByIds(ids, isDetachedSelected));
  }

  /**
   * 设置组件选中状态(组件脱离组合的独立选中状态切换)
   *
   * @param elements
   * @param isDetachedSelected
   */
  setElementsDetachedSelected(elements: IElement[], isDetachedSelected: boolean): void {
    this._addSelectedChangedCommand(async () => await this.store.setElementsDetachedSelected(elements, isDetachedSelected));
  }

  /**
   * 移动组件到指定位置
   *
   * @param ids
   * @param target
   * @param dropType
   */
  async moveElementsTo(ids: string[], target: string, dropType: TreeNodeDropType): Promise<void> {
    const uDataList: Array<ICommandElementObject> = [];
    const rDataList: Array<ICommandElementObject> = [];
    await this.store.moveElementsTo(
      ids,
      target,
      dropType,
      async (actionParams: ElementsActionParam[]) => {
        uDataList.push(...(await CommandHelper.createDataListByActionParams(actionParams)));
      },
      async (actionParams: ElementsActionParam[]) => {
        rDataList.push(...(await CommandHelper.createDataListByActionParams(actionParams)));
      },
    );
    await this._addCommandByDataList({
      payload: {
        uDataList,
        rDataList,
        type: ElementsCommandTypes.ElementsMoved,
      },
    });
  }
}
