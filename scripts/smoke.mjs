// Headless-Chrome check of the built playground (npm run build first): field completion and quiet errors.
// Needs Chrome (CHROME_BIN overrides the macOS/Linux default) and Node 22+ (global WebSocket). No other dependencies.
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../public");
const chromeBin = [process.env.CHROME_BIN, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"].filter(Boolean).find(existsSync);
if (!chromeBin) throw new Error("Chrome not found; set CHROME_BIN");
if (!existsSync(path.join(root, "dist/app.js"))) throw new Error("run npm run build first");

const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const server = createServer((req, res) => {
  const file = path.join(root, req.url === "/" ? "index.html" : req.url.split("?")[0]);
  if (!file.startsWith(root) || !existsSync(file)) { res.writeHead(404).end(); return; }
  res.writeHead(200, { "content-type": types[path.extname(file)] || "application/octet-stream" }).end(readFileSync(file));
}).listen(0);
const port = server.address().port, cdpPort = 9400 + Math.floor(Math.random() * 400);
const chrome = spawn(chromeBin, ["--headless=new", "--disable-gpu", "--no-sandbox", `--remote-debugging-port=${cdpPort}`, "--window-size=1400,900", `http://127.0.0.1:${port}/`], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const record = (name, ok, detail) => { results.push({ name, ok }); console.log((ok ? "PASS" : "FAIL") + " - " + name + (detail ? ": " + detail : "")); };
let ws, id = 0;
const pending = new Map();
const send = (method, params = {}) => new Promise((resolve, reject) => { const i = ++id; pending.set(i, { resolve, reject }); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJs = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails)); return r.result.value; };
async function waitFor(expr, timeout = 8000) { const t0 = Date.now(); for (;;) { const v = await evalJs(expr); if (v) return v; if (Date.now() - t0 > timeout) return v; await sleep(50); } }

const view = (n) => `globalThis.playground.${n}`;
const setDoc = (n, text, caret) => evalJs(`(function () { var v = ${view(n)}; v.focus(); v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: ${JSON.stringify(text)} }, selection: { anchor: ${caret} } }); })()`);
const shown = () => evalJs(`({ status: document.getElementById("status").textContent, ok: document.getElementById("status").className === "ok",
  mark: (document.querySelector("#jslt .cm-lintRange-error") || {}).textContent || "", stale: document.getElementById("output").classList.contains("stale"),
  output: globalThis.playground.output.state.doc.toString().length })`);

try {
  let page;
  for (let i = 0; i < 40 && !page; i++) { try { page = (await (await fetch(`http://localhost:${cdpPort}/json`)).json()).find((p) => p.type === "page"); } catch { /* not up yet */ } if (!page) await sleep(200); }
  ws = new WebSocket(page.webSocketDebuggerUrl);
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); } };
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  await send("Page.enable");
  await waitFor(`!!globalThis.playground && document.getElementById("status").className === "ok"`);
  const s0 = await shown();
  record("the page loads and runs the first example", s0.ok && s0.output > 0, JSON.stringify(s0));

  // `.` completion: the keys of the input JSON, before any letter
  const key = await evalJs(`Object.keys(JSON.parse(${view("input")}.state.doc.toString()))[0]`);
  await setDoc("jslt", "let a = ", 8);
  await send("Input.insertText", { text: "." });
  const pop = await waitFor(`(function () { var o = document.querySelector(".cm-tooltip-autocomplete"); return o && o.textContent.indexOf(${JSON.stringify(key)}) >= 0 ? o.textContent : ""; })()`, 3000);
  record(`typing "." opens the popup with the input's keys (first: ${key})`, !!pop, JSON.stringify((pop || "").slice(0, 60)));

  // quiet errors, caret away from the unfinished line: nothing for a while, then an underline under the "." and the old output stays, dimmed
  const broken = "let a = 1\nlet b = .x\n.\nlet c = 2\n{}"; // the "." on its own line continues .x and needs a field name
  await setDoc("jslt", broken, broken.length);
  await sleep(900);
  const early = await shown();
  record("a half-typed program shows no error yet", early.mark === "" && !/expected|rror/.test(early.status), JSON.stringify(early));
  await waitFor(`!!document.querySelector("#jslt .cm-lintRange-error")`, 4000);
  const late = await shown();
  record("after a pause the error is an underline under the unfinished '.', and the last output stays, dimmed", late.mark === "." && late.stale && late.output > 0 && /expected/.test(late.status), JSON.stringify(late));

  // caret at the unfinished token: it waits longer (5 s)
  await setDoc("jslt", broken, "let a = 1\nlet b = .x\n.".length);
  await sleep(2600);
  const typing = await shown();
  record("while the caret is at the unfinished '.' the error waits", typing.mark === "" && !/expected/.test(typing.status), JSON.stringify(typing));
  await waitFor(`!!document.querySelector("#jslt .cm-lintRange-error")`, 4500);
  record("and appears once the longer wait is over", (await shown()).mark === ".");

  // state saved by another page of the same origin (the retired playground used "jslt-playground") is not restored
  await evalJs(`localStorage.removeItem("jslt-playground-state"); localStorage.setItem("jslt-playground", JSON.stringify({ i: "{}", f: [{ n: "main.jslt", t: "{ v" }], fi: "json", fo: "xml" })); location.reload(); 1`);
  await sleep(1200);
  await waitFor(`!!globalThis.playground && document.getElementById("status").className === "ok"`, 5000);
  const own = await evalJs(`({ fout: document.getElementById("fout").value, ok: document.getElementById("status").className === "ok", sel: document.getElementById("examples").value })`);
  record("a saved state under the old key is ignored: first example, JSON output, no error", own.ok && own.fout === "json" && own.sel === "0", JSON.stringify(own));

  await setDoc("jslt", "{ \"ok\": true }", 14);
  await waitFor(`document.getElementById("status").className === "ok"`, 3000);
  const fixed = await shown();
  record("a working program clears the error and the dimming", fixed.ok && !fixed.stale && fixed.mark === "", JSON.stringify(fixed));
} catch (e) {
  record("smoke run", false, String(e && e.message || e));
} finally {
  const failed = results.filter((r) => !r.ok);
  const bar = "=".repeat(64);
  console.log("\n" + bar + "\n " + (failed.length ? `SMOKE TEST FAILED: ${failed.length} of ${results.length} checks` : `SMOKE TEST PASSED: all ${results.length} checks`) + "\n" + bar);
  process.exitCode = failed.length ? 1 : 0;
  try { chrome.kill(); } catch { /* gone */ }
  server.close();
}
