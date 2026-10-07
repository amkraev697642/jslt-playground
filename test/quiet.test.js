import { test } from "node:test";
import assert from "node:assert/strict";
import { errorDelay, IDLE_MS, TYPING_MS } from "../src/quiet.js";

test("an error waits longer while the caret is on its line or next to it", () => {
  assert.equal(errorDelay(5, 5, true), TYPING_MS);
  assert.equal(errorDelay(5, 4, true), TYPING_MS);
  assert.equal(errorDelay(5, 6, true), TYPING_MS);
  assert.equal(errorDelay(5, 9, true), IDLE_MS);
  assert.equal(errorDelay(5, 5, false), IDLE_MS); // editor not focused: nobody is typing there
});
