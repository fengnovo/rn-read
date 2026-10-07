import type { Position } from "./types";
// Keep the latest position, including the quiet tail of a burst, and serialize
// writes so a slow earlier save cannot replace the final position.
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
