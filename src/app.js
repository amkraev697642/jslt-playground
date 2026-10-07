import { basicSetup, EditorView } from "codemirror";
import { Compartment } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import { keymap } from "@codemirror/view";
import { json } from "@codemirror/lang-json";
import { xml } from "@codemirror/lang-xml";
import { linter, setDiagnostics } from "@codemirror/lint";
import { compile, fromJS, toJS } from "jslt-js";
import { jsltLanguage, jsltHighlight, jsltAssist, toDiagnostic, jsonSyntaxErrors } from "jslt-editor/codemirror";
import { formatJslt } from "jslt-editor/core";
import { examples } from "./examples.js";
import { XML_DEFAULTS, parseXml, domToJson, jsonToXml } from "./xml.js";

const $ = (id) => document.getElementById(id);
const pretty = (v) => JSON.stringify(v, null, 2);
const setText = (view, text) => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });

const b64 = {
  async enc(obj) {
    const gz = new Blob([JSON.stringify(obj)]).stream().pipeThrough(new CompressionStream("gzip"));
    const bytes = new Uint8Array(await new Response(gz).arrayBuffer());
    return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  },
  async dec(str) {
    const bin = atob(str.replace(/-/g, "+").replace(/_/g, "/"));
    const gz = new Blob([Uint8Array.from(bin, (c) => c.charCodeAt(0))]).stream().pipeThrough(new DecompressionStream("gzip"));
    return JSON.parse(await new Response(gz).text());
  },
};

const theme = new Compartment();
const root = document.documentElement;
const isDark = () => root.dataset.theme === "dark";
const themeExt = () => theme.of(isDark() ? oneDark : []);

// Input and output are JSON or XML (see xml.js for how XML maps to JSON); xo holds the two selectable conventions.
const inLang = new Compartment(), outLang = new Compartment();
const inExt = (f) => (f === "xml" ? xml() : [json(), linter(jsonSyntaxErrors)]);
const outExt = (f) => (f === "xml" ? xml() : json());
let fmt = { in: "json", out: "json" }, xo = { ...XML_DEFAULTS };

// files[0] is the main program; the others are importable by name. files[active] is what the JSLT editor shows.
let files = [{ name: "main.jslt", text: "" }], active = 0, errFile = null;
const ctx = () => ({ files: new Map(files.map((f) => [f.name, f.text])) });

let timer;
const schedule = () => { clearTimeout(timer); timer = setTimeout(run, 250); };
const editable = [basicSetup, themeExt(), EditorView.updateListener.of((u) => {
  if (!u.docChanged) return;
  if (u.view === jslt) files[active].text = u.state.doc.toString();
  schedule(); save();
})];

const format = () => {
  const text = jslt.state.doc.toString(), out = formatJslt(text);
  if (out !== text) setText(jslt, out);
  return true;
};

const input = new EditorView({ parent: $("input"), extensions: [editable, inLang.of(inExt("json"))] });
const jslt = new EditorView({ parent: $("jslt"), extensions: [editable, jsltLanguage, jsltHighlight, jsltAssist(ctx), keymap.of([{ key: "Shift-Alt-f", run: format }])] });
const output = new EditorView({ parent: $("output"), extensions: [basicSetup, themeExt(), outLang.of(outExt("json")), EditorView.editable.of(false)] });

$("theme").onclick = () => {
  root.dataset.theme = isDark() ? "light" : "dark";
  try { localStorage.setItem("jslt-theme", root.dataset.theme); } catch {}
  [input, jslt, output].forEach((v) => v.dispatch({ effects: theme.reconfigure(isDark() ? oneDark : []) }));
};

function setFormats() {
  input.dispatch({ effects: inLang.reconfigure(inExt(fmt.in)) });
  output.dispatch({ effects: outLang.reconfigure(outExt(fmt.out)) });
  $("fin").value = fmt.in; $("fout").value = fmt.out;
  $("xattr").value = xo.attr; $("xarr").value = xo.arrays;
  $("inl").textContent = fmt.in.toUpperCase(); $("outl").textContent = fmt.out.toUpperCase();
  $("xmlopts").hidden = fmt.in !== "xml" && fmt.out !== "xml";
}

function status(msg, ok) { $("status").textContent = msg; $("status").className = ok ? "ok" : ""; }

function renderTabs() {
  const bar = $("tabs");
  bar.replaceChildren(...files.map((f, i) => {
    const t = document.createElement("button");
    t.className = "tab" + (i === active ? " active" : "") + (f.name === errFile ? " err" : "");
    t.textContent = f.name;
    t.title = i ? `import "${f.name}" as name` : "main program";
    t.onclick = () => switchTo(i);
    if (i) {
      const x = document.createElement("span");
      x.className = "x"; x.textContent = "×"; x.title = "Remove file";
      x.onclick = (e) => { e.stopPropagation(); files.splice(i, 1); switchTo(Math.min(active, files.length - 1), true); };
      t.append(x);
    }
    return t;
  }), Object.assign(document.createElement("button"), { className: "tab add", textContent: "+", title: "Add a file to import", onclick: addFile }));
}

function switchTo(i, force) {
  if (i !== active || force) { active = i; setText(jslt, files[i].text); }
  renderTabs(); run();
}

function addFile() {
  const name = (prompt('File name, imported as: import "name" as alias', "lib.jslt") || "").trim();
  if (!name || files.some((f) => f.name === name)) return;
  files.push({ name, text: "// def helper(x) $x\n" });
  switchTo(files.length - 1);
}

function run() {
  jslt.dispatch(setDiagnostics(jslt.state, []));
  errFile = null;
  let data;
  if (fmt.in === "xml") input.dispatch(setDiagnostics(input.state, []));
  try { data = fromJS(fmt.in === "xml" ? domToJson(parseXml(input.state.doc.toString()), xo) : JSON.parse(input.state.doc.toString())); }
  catch (e) {
    if (fmt.in === "xml" && e.line) {
      // the parser may point past the end of the line (a missing closing tag); keep the range one visible character wide
      const l = input.state.doc.line(Math.min(e.line, input.state.doc.lines));
      let from = l.from + Math.max(e.col - 1, 0), to = from + 1;
      if (to > l.to) { to = l.to; from = Math.max(l.from, to - 1); }
      if (to <= from) from = Math.max(0, to - 1);
      input.dispatch(setDiagnostics(input.state, [{ from, to, severity: "error", message: e.message }]));
    }
    renderTabs();
    return fail((fmt.in === "xml" ? "Input XML: " : "Input JSON: ") + e.message);
  }
  const byName = ctx().files;
  const resolver = { resolve(name) {
    if (!byName.has(name)) throw new Error(`no such file: ${name} (add a tab with that name)`);
    return byName.get(name);
  } };
  const t0 = performance.now();
  try {
    const result = compile(files[0].text, files[0].name, { resolver }).applyInput(data);
    const js = toJS(result);
    setText(output, fmt.out === "xml" ? jsonToXml(js, xo) : pretty(js));
    status(`ok · ${(performance.now() - t0).toFixed(1)} ms`, true);
  } catch (e) {
    const src = e.getSource ? e.getSource() : null;
    errFile = files.some((f) => f.name === src) ? src : files[0].name;
    if (e.getLine && files[active].name === errFile) jslt.dispatch(setDiagnostics(jslt.state, [toDiagnostic(e, jslt.state.doc)]));
    fail(e.message);
  }
  renderTabs();
}
function fail(msg) { setText(output, ""); status(msg); }

const snapshot = () => ({ i: input.state.doc.toString(), f: files.map((f) => ({ n: f.name, t: f.text })), fi: fmt.in, fo: fmt.out, xo });
function save() {
  try { localStorage.setItem("jslt-playground", JSON.stringify(snapshot())); } catch {}
}
// st: {i: input text, f: [{n, t}], fi/fo: input/output format, xo: XML conventions}; the first version stored {i, j} (one program, no files).
function load(st) {
  files = (st.f || [{ n: "main.jslt", t: st.j }]).map((f) => ({ name: f.n, text: f.t }));
  active = 0;
  fmt = { in: st.fi || "json", out: st.fo || "json" };
  xo = { ...XML_DEFAULTS, ...(st.xo || {}) };
  setFormats();
  setText(input, st.i);
  setText(jslt, files[0].text);
  renderTabs();
  run();
}
const fromExample = (x) => ({ i: x.inputText ?? pretty(x.input), fi: x.inputFormat, fo: x.outputFormat, f: [{ n: "main.jslt", t: x.jslt }, ...(x.files || []).map((f) => ({ n: f.name, t: f.text }))] });

$("examples").append(...examples.map((e, n) => new Option(e.name, n)));
$("examples").onchange = (e) => load(fromExample(examples[e.target.value]));
$("format").onclick = format;
const formatsChanged = () => { setFormats(); save(); run(); };
$("fin").onchange = (e) => { fmt.in = e.target.value; formatsChanged(); };
$("fout").onchange = (e) => { fmt.out = e.target.value; formatsChanged(); };
$("xattr").onchange = (e) => { xo.attr = e.target.value; save(); run(); };
$("xarr").onchange = (e) => { xo.arrays = e.target.value; save(); run(); };

$("share").onclick = async () => {
  const s = await b64.enc(snapshot());
  history.replaceState(null, "", "#s=" + s);
  try { await navigator.clipboard.writeText(location.href); status("link copied", true); } catch { status("link is in the address bar", true); }
};

document.querySelectorAll(".gutter").forEach((g) => {
  g.onpointerdown = (down) => {
    const [a, b] = [g.previousElementSibling, g.nextElementSibling];
    const [wa, wb] = [a.offsetWidth, b.offsetWidth];
    g.setPointerCapture(down.pointerId);
    g.onpointermove = (m) => {
      const d = Math.max(-wa + 120, Math.min(wb - 120, m.clientX - down.clientX));
      a.style.flex = `0 0 ${wa + d}px`; b.style.flex = `0 0 ${wb - d}px`;
    };
    g.onpointerup = () => { g.onpointermove = null; };
  };
});

(async () => {
  let st;
  try { if (location.hash.startsWith("#s=")) st = await b64.dec(location.hash.slice(3)); } catch {}
  try { st ??= JSON.parse(localStorage.getItem("jslt-playground")); } catch {}
  load(st || fromExample(examples[0]));
})();
