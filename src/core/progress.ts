/** 只有已完成导入且文件仍可访问的状态才允许打开阅读器。 */
export function isReadableStatus(status: string): boolean {
  return status === "ready" || status === "ready_with_warnings";
}
/**
 * 按可滚动内容高度恢复阅读位置。
 * 新记录优先使用比例适配屏幕变化；旧记录没有比例时再退回绝对 scrollY。
 */
export function restorePosition(
  position: { progress?: number; scrollY?: number },
  height: number,
  viewport: number,
): number {
  const max = Math.max(0, height - viewport);
  const y =
    typeof position.progress === "number" && Number.isFinite(position.progress)
      ? position.progress * max
      : (position.scrollY ?? 0);
  return Math.min(max, Math.max(0, Number.isFinite(y) ? y : 0));
}
