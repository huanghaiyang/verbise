import GlobalConfig from "@/config";
import ElementRenderHelper from "@/modules/elements/utils/ElementRenderHelper";
import ElementUtils from "@/modules/elements/utils/ElementUtils";
import ElementTaskBase from "@/modules/render/shield/task/ElementTaskBase";
import { RenderRect } from "@/types/IRender";
import CanvasUtils from "@/utils/CanvasUtils";

export default class ElementTaskEllipse extends ElementTaskBase {
  /**
   * 运行任务
   */
  async run(): Promise<void> {
    if (!this.canvas || !this.element) return;

    const {
      innermostStrokeCoordIndex,
      unLeanStrokeCoords,
      model: {
        styles,
        styles: { strokes },
      },
      center,
      angle,
      flipX,
      leanY,
      actualAngle,
      shield,
    } = this.element;
    // 渲染选项
    const options = {
      angle,
      flipX,
      leanY,
      actualAngle,
    };
    // 计算未倾斜的描边舞台坐标
    const unLeanStrokePoints = ElementUtils.batchCalcStageRelativePoints(unLeanStrokeCoords);
    // 内描边的舞台坐标
    const innermostStrokePoints = unLeanStrokePoints[innermostStrokeCoordIndex];
    // 内描边的渲染盒模型
    const renderRect = ElementRenderHelper.calcRenderRect(innermostStrokePoints, center, GlobalConfig.stageParams.scale) as RenderRect;

    // 绘制填充
    styles.fills.forEach(fillStyle => {
      CanvasUtils.drawEllipseFillWithScale(
        this.canvas,
        center,
        {
          rx: renderRect.width / 2 / GlobalConfig.stageParams.scale,
          ry: renderRect.height / 2 / GlobalConfig.stageParams.scale,
        },
        fillStyle,
        renderRect,
        options,
      );
    });

    // 绘制边框
    unLeanStrokePoints.forEach((points, index) => {
      const renderRect = ElementRenderHelper.calcRenderRect(points, center, GlobalConfig.stageParams.scale) as RenderRect;
      CanvasUtils.drawEllipseStrokeWithScale(
        this.canvas,
        center,
        {
          rx: renderRect.width / 2 / GlobalConfig.stageParams.scale,
          ry: renderRect.height / 2 / GlobalConfig.stageParams.scale,
        },
        strokes[index],
        renderRect,
        options,
      );
    });
  }
}
