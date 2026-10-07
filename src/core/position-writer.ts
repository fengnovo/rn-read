import type { Position } from "./types";

/**
 * 合并阅读器连续发出的滚动位置，并按顺序写入数据库。
 * 普通滚动最多每 600ms 保存一次；离开页面或切到后台时可调用 flush 立即落盘。
 */
export function createPositionWriter(
  initial: Position,
  save: (position: Position) => Promise<unknown>,
  onError: (error: unknown) => void,
) {
  let position = { ...initial },
    lastWrite = -Infinity,
    dirty = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let writes = Promise.resolve();
  const flush = () => {
    clearTimeout(timer);
    timer = undefined;
    if (!dirty) return writes;
    dirty = false;
    lastWrite = Date.now();
    const snapshot = { ...position };
    writes = writes.then(() => save(snapshot)).then(() => {}, onError);
    return writes;
  };
  return {
    flush,
    update(value: Position, immediate = false) {
      position = { ...position, ...value };
      dirty = true;
      const remaining = 600 - (Date.now() - lastWrite);
      if (immediate || remaining <= 0) void flush();
      else if (timer === undefined)
        timer = setTimeout(() => void flush(), remaining);
    },
  };
}
