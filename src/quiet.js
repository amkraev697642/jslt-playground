// A live error is shown only after the user paused. Where the caret sits at the error line (or the line just below it) the
// construct is probably still being typed, so it waits longer.
export const IDLE_MS = 1500;
export const TYPING_MS = 5000;

export function errorDelay(errLine, caretLine, focused) {
  return focused && Math.abs(errLine - caretLine) <= 1 ? TYPING_MS : IDLE_MS;
}
