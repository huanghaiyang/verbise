import { DrawerMaskModelTypes, ElementStatus, IPoint } from "@/types";
import RenderTaskCargo from "@/modules/render/RenderTaskCargo";
import MaskTaskPath from "@/modules/render/mask/task/MaskTaskPath";
import MaskTaskClear from "@/modules/render/mask/task/MaskTaskClear";
import MaskTaskTransformer from "@/modules/render/mask/task/MaskTaskTransformer";
import BaseRenderer from "@/modules/render/renderer/drawer/BaseRenderer";
import MaskTaskRotate from "@/modules/render/mask/task/MaskTaskRotate";
import CommonUtils from "@/utils/CommonUtils";
import MathUtils from "@/utils/MathUtils";
import MaskTaskIndicator from "@/modules/render/mask/task/MaskTaskIndicator";
import IElement, { IElementText } from "@/types/IElement";
import { IDrawerMask } from "@/types/IStageDrawer";
import { IMaskRenderer } from "@/types/IStageRenderer";
import { IMaskModel, IRotationModel } from "@/types/IModel";
import { IRenderTask } from "@/types/IRenderTask";
import { ControllerStyle, DefaultControllerRadius, SelectionIndicatorMargin, SelectionIndicatorStyle, SelectionStyle } from "@/styles/MaskStyles";
import MaskTaskCursorPosition from "@/modules/render/mask/task/MaskTaskCursorPosition";
import { CreatorCategories, CreatorTypes } from "@/types/Creator";
import MaskTaskCircleTransformer from "@/modules/render/mask/task/MaskTaskCircleTransformer";
import { TransformerTypes } from "@/types/ITransformer";
import ElementRotation from "@/modules/elements/rotation/ElementRotation";
import VerticesTransformer from "@/modules/handler/transformer/VerticesTransformer";
import BorderTransformer from "@/modules/handler/transformer/BorderTransformer";
import { IPointController } from "@/types/IController";
import IElementRotation from "@/types/IElementRotation";
import ElementText from "@/modules/elements/ElementText";
import ElementTaskTextCursor from "@/modules/render/shield/task/ElementTaskTextCursor";
import { pick } from "lodash";
import ElementTaskTextSelection from "@/modules/render/shield/task/ElementTaskTextSelection";
import ElementTaskTextSelectionCursor from "@/modules/render/shield/task/ElementTaskTextSelectionCursor";
import { TextSelectionCursorType } from "@/types/IText";
import ElementTaskTextHighlightUnderline from "@/modules/render/shield/task/ElementTaskTextHighlightUnderline";
import { StageShieldElementsStatus } from "@/types/IStageShield";
import GlobalConfig from "@/config";
import { ElementStyles } from "@/styles/ElementStyles";
import LodashUtils from "@/utils/LodashUtils";

/**
 * 蒙版渲染器
 */
export default class MaskRenderer extends BaseRenderer<IDrawerMask> implements IMaskRenderer {
  /**
   * 最后光标渲染状态 - 用于检测是否需要清理残留
   */
  private _lastCursorRendered = false;
  /**
   * 最后选区渲染状态 - 用于检测是否需要清理残留
   */
  private _lastSelectionRendered = false;

  /**
   * 获取控制器样式
   * 
   * @param styles 原始样式
   * @returns 处理后的样式
   */
  private _getStyle(styles: ElementStyles): ElementStyles {
    const result = LodashUtils.jsonClone(styles) as ElementStyles;
    result.strokes.forEach((item) => {
      item.width /= GlobalConfig.stageParams.scale;
    });
    return result;
  }

  /**
   * 执行蒙版渲染的主流程
   * 1. 创建渲染任务队列
   * 2. 按顺序处理选区/控制器/光标等组件的绘制
   * 3. 管理渲染状态缓存(_lastCursorRendered等)
   * 4. 处理边缘情况（如光标移出舞台时的残留）
   * @async
   */
  async redraw(): Promise<void> {
    // 初始化渲染任务容器
    let cargo = new RenderTaskCargo([]);
    let cursorRendered = false;
    let selectionTasks: IRenderTask[] = [];
    const {
      store: { nonHomologousElements },
      configure: { rotationIconEnable },
      selection: { rangeElement },
      cursor,
      isDrawerActive,
      isTextEditing,
      elementsStatus,
    } = this.drawer.shield;

    // 选区绘制阶段 ================
    if (elementsStatus !== StageShieldElementsStatus.MOVING) {
      selectionTasks = this.createMaskSelectionTasks();
      cargo.addAll(selectionTasks);
      if (selectionTasks.length) {
        this._lastSelectionRendered = true; // 标记选区已渲染
      }
      // 形变控制器绘制阶段 ===========
      const transformerTasks = this.createMaskTransformerTasks();
      if (transformerTasks.length) {
        cargo.addAll(transformerTasks);
      }
      // 普通控制器绘制阶段 ============
      const controllerTasks = this.createControllerTasks();
      if (controllerTasks.length) {
        cargo.addAll(controllerTasks);
      }

      let rotation: IElementRotation | null = null;
      // 特殊组件处理（单个无父组件）===
      if (nonHomologousElements.length === 1) {
        const element = nonHomologousElements[0];
        // 添加旋转图标（当组件允许旋转且处于完成状态）
        if (element.rotationEnable && element.status === ElementStatus.finished) {
          rotation = element.rotation;
        }
        // 添加指示器
        element.isValid && cargo.add(this.createMaskIndicatorTask(element));
      } else if (nonHomologousElements.length > 1 && rangeElement.subs.length > 0) {
        // 多选时添加范围组件的旋转任务
        rotation = rangeElement.rotation;
      }
      if (rotation && rotationIconEnable) {
        cargo.add(this.createMaskRotateTask(rotation));
      }
    }

    // 光标绘制阶段 ================
    const task = cursor.getTask();
    if (task) {
      cargo.add(task);
      this._lastCursorRendered = true;
      cursorRendered = true; // 标记本次循环已渲染光标
    }

    // 激活状态下的附加绘制任务 ====
    if (isDrawerActive) {
      cargo.add(this.createMaskCursorPositionTask()); // 坐标显示
      cargo.add(this.createMaskArbitraryCursorTask()); // 自定义光标
    }

    // 文本编辑状态下的绘制任务
    if (isTextEditing) {
      // 文本编辑时，绘制光标位置的指示器
      cargo.add(this.createTextElementCursorTask());
      // 文本编辑时，绘制选区
      cargo.add(this.createTextElementSelectionTask());
      // 文本编辑时，绘制选区的光标
      cargo.addAll(this.createTextElementSelectionCursorTasks());
    }

    // 文本鼠标命中时，绘制下划线
    cargo.addAll(this.createTextElementsHighlightUndelineTasks());
    // 范围组件中心指示器
    cargo.add(this.createRangeElementCenterIndicatorTask());

    // 任务执行与状态清理 ==========
    if (!cargo.isEmpty()) {
      // 添加前置清除任务确保画布干净
      cargo.prepend(this.createMaskClearTask());
      await this.renderCargo(cargo);
    } else {
      // 处理光标/选区移出舞台的残留
      if ((this._lastCursorRendered || this._lastSelectionRendered) && !selectionTasks.length && !cursorRendered) {
        cargo.add(new MaskTaskClear(null, this.canvas));
        await this.renderCargo(cargo);
        // 重置状态缓存
        this._lastCursorRendered = false;
        this._lastSelectionRendered = false;
      } else {
        cargo = null; // 无任务需要执行
      }
    }
  }

  /**
   * 创建光标位置坐标显示任务
   * 在光标右下方20像素处显示当前世界坐标系中的坐标值
   * @returns {IRenderTask | undefined} 返回渲染任务对象，当光标不存在时返回undefined
   */
  private createMaskCursorPositionTask(): IRenderTask {
    // 获取当前光标位置（舞台坐标系）
    const {
      cursor: { worldValue },
    } = this.drawer.shield;
    if (!worldValue) return;

    // 构建坐标显示模型
    const model: IMaskModel = {
      point: {
        // 在光标右下方20像素处显示（考虑舞台缩放比例）
        x: worldValue.x + 20 / GlobalConfig.stageParams.scale,
        y: worldValue.y + 20 / GlobalConfig.stageParams.scale,
      },
      type: DrawerMaskModelTypes.cursorPosition,
      text: `${MathUtils.precise(worldValue.x, 1)},${MathUtils.precise(worldValue.y, 1)}`, // 格式化坐标值
    };

    // 创建并返回渲染任务
    return new MaskTaskCursorPosition(model, this.canvas, SelectionIndicatorStyle);
  }

  /**
   * 创建选区路径绘制任务
   * 1. 获取选区模型集合（包含主选区和子选区）
   * 2. 为每个有效路径模型创建路径渲染任务
   * 3. 自动适配当前舞台缩放比例
   * @returns {IRenderTask[]} 选区路径渲染任务数组
   */
  private createMaskSelectionTasks(): IRenderTask[] {
    const { selection } = this.drawer.shield;
    const tasks: IRenderTask[] = [];
    // 合并主选区和子选区模型
    const models: IMaskModel[] = [...selection.getModels(), selection.selectionModel];
    models.forEach(model => {
      if (model?.points?.length > 0) {
        // 创建缩放适配的路径任务
        const task = new MaskTaskPath(model, this.canvas, this._getStyle(SelectionStyle));
        tasks.push(task);
      }
    });
    return tasks;
  }

  /**
   * 创建一个清空mask的任务
   *
   * @returns
   */
  private createMaskClearTask(): IRenderTask {
    return new MaskTaskClear(null, this.canvas);
  }

  /**
   * 创建形变控制器任务
   * 根据组件类型分发不同的形变处理器：
   * - 圆形组件：MaskTaskCircleTransformer
   * - 矩形组件：MaskTaskTransformer
   * @returns {IRenderTask[]} 形变控制器任务数组
   */
  private createMaskTransformerTasks(): IRenderTask[] {
    const {
      selection: { transformerModels },
    } = this.drawer.shield;
    return transformerModels
      .map(model => {
        switch (model.element.transformerType) {
          case TransformerTypes.circle:
            return new MaskTaskCircleTransformer(model, this.canvas, this._getStyle(ControllerStyle));
          case TransformerTypes.rect:
            return new MaskTaskTransformer(model, this.canvas, this._getStyle(ControllerStyle));
          default:
            return null;
        }
      })
      .filter(task => !!task);
  }

  /**
   * 创建控制器任务
   *
   * @returns
   */
  private createControllerTasks(): IRenderTask[] {
    const {
      store: { primarySelectedElement },
      selection: { rangeElement },
    } = this.drawer.shield;
    const element = primarySelectedElement || rangeElement;
    if (element) {
      const { controllers = [] } = element;
      return controllers
        .map(controller => {
          if (!(controller instanceof ElementRotation) && !(controller instanceof VerticesTransformer) && !(controller instanceof BorderTransformer)) {
            const model: IMaskModel = {
              point: {
                x: (controller as IPointController).x,
                y: (controller as IPointController).y,
              },
              type: DrawerMaskModelTypes.transformer,
              radius: DefaultControllerRadius,
            };
            return new MaskTaskCircleTransformer(model, this.canvas, this._getStyle(ControllerStyle));
          }
          return null;
        })
        .filter(model => !!model);
    }
    return [];
  }

  /**
   * 创建一个绘制旋转图标的任务
   *
   * @param rotation
   * @returns
   */
  private createMaskRotateTask(rotation: IElementRotation): IRenderTask {
    const model: IRotationModel = {
      point: { x: rotation.x, y: rotation.y },
      type: DrawerMaskModelTypes.rotate,
      ...pick(rotation, ["points", "angle", "width", "height"]),
    };
    return new MaskTaskRotate(model, this.canvas);
  }

  /**
   * 给出一个组件创建一个绘制尺寸指示器的任务
   *
   * @param element
   */
  private createMaskIndicatorTask(element: IElement): IRenderTask {
    let p1: IPoint, p2: IPoint;
    switch (element.model.type) {
      case CreatorTypes.line: {
        [p1, p2] = [...element.rotateCoords].sort((a, b) => a.x - b.x);
        break;
      }
      default: {
        if (element.model.angle % 90 === 0 && element.model.leanYAngle === 0) {
          const { maxBoxCoords } = element;
          p1 = maxBoxCoords[3];
          p2 = maxBoxCoords[2];
        } else {
          // 获取最左侧，最下侧，最右侧三个点
          const [leftPoint, bottomPoint, rightPoint] = CommonUtils.getLBRPoints(element.rotateBoxCoords, true);
          // 计算最下侧点与最左侧点，最下侧点与最右侧点的夹角
          let leftAngle = MathUtils.transformToAcuteAngle(MathUtils.calcAngle(bottomPoint, leftPoint) + 180);
          // 计算最下侧点与最右侧点，最下侧点与最右侧点的夹角
          let rightAngle = MathUtils.transformToAcuteAngle(MathUtils.calcAngle(bottomPoint, rightPoint) + 180);
          // 取夹角较小的点
          const point = leftAngle < rightAngle ? leftPoint : rightPoint;
          // 将点按x坐标排序
          [p1, p2] = [point, bottomPoint].sort((a, b) => a.x - b.x);
        }
        break;
      }
    }
    // 计算夹角
    const angle = MathUtils.calcAngle(p1, p2);
    // 生成指示器数据对象
    const model: IMaskModel = {
      point: MathUtils.calcSegmentLineCenterCrossPoint(p1, p2, true, SelectionIndicatorMargin / GlobalConfig.stageParams.scale),
      angle,
      type: DrawerMaskModelTypes.indicator,
      text: `${element.width} x ${element.height}`,
    };
    return new MaskTaskIndicator(model, this.canvas, SelectionIndicatorStyle);
  }

  /**
   * 创建一个光标圆
   *
   * @returns
   */
  private createMaskArbitraryCursorTask(): IRenderTask {
    const { currentCreator, cursor } = this.drawer.shield;
    if (currentCreator.category === CreatorCategories.freedom) {
      const model: IMaskModel = {
        point: cursor.value,
        type: DrawerMaskModelTypes.cursor,
        radius: DefaultControllerRadius,
      };
      return new MaskTaskCircleTransformer(model, this.canvas, this._getStyle(ControllerStyle));
    }
  }

  /**
   * 获取当前正在编辑的文本元素
   *
   * @returns
   */
  private _getEditingTextElement(): IElementText | null {
    const { isEditingEmpty, editingElements } = this.drawer.shield.store;
    if (isEditingEmpty) return null;
    const element = editingElements[0];
    if (element instanceof ElementText) {
      return element;
    }
    return null;
  }

  /**
   * 创建一个文本元素的光标任务
   *
   * @returns
   */
  private createTextElementCursorTask(): IRenderTask | null {
    const element = this._getEditingTextElement();
    if (!element) return null;
    if (element.isCursorVisible) {
      return new ElementTaskTextCursor(element, this.canvas);
    }
    return null;
  }

  /**
   * 创建一组文本元素选区的光标任务
   *
   * @returns
   */
  private createTextElementSelectionCursorTasks(): IRenderTask[] {
    const element = this._getEditingTextElement();
    if (!element) return [];
    if (element.isSelectionAvailable) {
      return [new ElementTaskTextSelectionCursor(element, this.canvas, TextSelectionCursorType.START), new ElementTaskTextSelectionCursor(element, this.canvas, TextSelectionCursorType.END)];
    }
    return [];
  }

  /**
   * 创建一个文本元素的选区任务
   *
   * @returns
   */
  private createTextElementSelectionTask(): IRenderTask | null {
    const element = this._getEditingTextElement();
    if (!element) return null;
    if (element.isSelectionAvailable) {
      return new ElementTaskTextSelection(element, this.canvas);
    }
    return null;
  }

  /**
   * 创建一组文本组件的下划线任务
   *
   * @returns
   */
  private createTextElementsHighlightUndelineTasks(): IRenderTask[] {
    const tasks: IRenderTask[] = [];
    this.drawer.shield.store.targetElements.forEach(element => {
      if (!element.isSelected && !element.isEditing && element instanceof ElementText) {
        tasks.push(new ElementTaskTextHighlightUnderline(element, this.canvas));
      }
    });
    return tasks;
  }

  /**
   * 创建一个范围组件的中心指示器任务
   *
   * @returns
   */
  private createRangeElementCenterIndicatorTask(): IRenderTask | null {
    if (![StageShieldElementsStatus.MOVING, StageShieldElementsStatus.ROTATING, StageShieldElementsStatus.TRANSFORMING].includes(this.drawer.shield.elementsStatus)) {
      return null;
    }
    const rangeElement = this.drawer.shield.selection.rangeElement;
    if (!rangeElement) return null;
    const {
      centerCoord: { x, y },
    } = rangeElement;
    const model: IMaskModel = {
      point: { x, y },
      type: DrawerMaskModelTypes.transformer,
      radius: DefaultControllerRadius,
    };
    return new MaskTaskCircleTransformer(model, this.canvas, this._getStyle(ControllerStyle));
  }
}
