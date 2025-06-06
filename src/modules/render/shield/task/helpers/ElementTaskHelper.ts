/**
 * TODO renderRect逻辑需要异到CanvasUtils中
 */
import ElementRenderHelper from "@/modules/elements/utils/ElementRenderHelper";
import ElementUtils from "@/modules/elements/utils/ElementUtils";
import { IElementRect, IElementText } from "@/types/IElement";
import { RenderRect } from "@/types/IRender";
import { ITextCursor } from "@/types/IText";
import CanvasUtils from "@/utils/CanvasUtils";
import CursorTextSvg from "@/assets/svg/cursor-text.svg";

export default class ElementTaskHelper {
  /**
   * 绘制矩形
   *
   * @param element
   * @param canvas
   */
  static drawArcRect(element: IElementRect, canvas: HTMLCanvasElement): void {
    const {
      arcCoords,
      arcFillCoords,
      model: { styles },
      angle,
      flipX,
      leanY,
      actualAngle,
    } = element;
    // 渲染选项
    const options = {
      angle,
      flipX,
      leanY,
      actualAngle,
    };
    // 计算弧线的舞台坐标
    const arcPoints = ElementUtils.batchCalcStageRelativeArcPoints(arcCoords);
    // 计算弧线填充的舞台坐标
    const arcFillPoints = ElementUtils.calcStageRelativeArcPoints(arcFillCoords);
    // 计算渲染盒子的画布坐标
    const renderRect = ElementRenderHelper.calcElementRenderRect(element) as RenderRect;
    // 绘制填充
    styles.fills.forEach(fillStyle => {
      CanvasUtils.drawInnerArcPathFillWithScale(canvas, renderRect, arcFillPoints, fillStyle, options);
    });
    // 绘制边框
    arcPoints.forEach((points, index) => {
      CanvasUtils.drawArcPathStrokeWidthScale(canvas, points, renderRect, styles.strokes[index], options);
    });
  }

  /**
   * 绘制文本光标
   *
   * @param element
   * @param canvas
   * @param textCursor
   */
  static drawTextCursor(element: IElementText, canvas: HTMLCanvasElement, textCursor: ITextCursor): void {
    const { angle, flipX, leanY, actualAngle } = element;
    if (!textCursor) return;
    // 计算渲染盒子的画布坐标
    const renderRect = ElementRenderHelper.calcElementRenderRect(element) as RenderRect;
    const { x: desX, y: desY, width: desWidth, height: desHeight } = textCursor;

    // 渲染选项
    const options = {
      angle,
      flipX,
      leanY,
      actualAngle,
    };
    // 绘制光标
    CanvasUtils.drawImgLike(
      canvas,
      CursorTextSvg,
      {
        ...renderRect,
        desX,
        desY,
        desWidth,
        desHeight,
      },
      {
        ...options,
      },
    );
  }
}
