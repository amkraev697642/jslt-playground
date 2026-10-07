import { test } from "node:test";
import assert from "node:assert/strict";
import { compile, fromJS, toJS } from "jslt-js";
import { examples } from "../src/examples.js";
import { toDiagnostic } from "jslt-editor/codemirror";

for (const e of examples) {
  test(`playground example: ${e.name}`, () => {
    const byName = new Map((e.files || []).map((f) => [f.name, f.text]));
    const resolver = { resolve: (n) => byName.get(n) };
    const out = toJS(compile(e.jslt, "x.jslt", { resolver }).applyInput(fromJS(e.input)));
    assert.notEqual(out, undefined);
  });
}

test("toDiagnostic points at the offending token (1-based line/col)", () => {
  const src = '{"a": }';
  let err;
  try { compile(src, "x.jslt"); } catch (e) { err = e; }
  const doc = { lines: 1, length: src.length, line: () => ({ from: 0, to: src.length }), sliceString: (f, t) => src.slice(f, t) };
  const d = toDiagnostic(err, doc);
  assert.equal(src.slice(d.from, d.to), "}");
});

test("imports example resolves lib.jslt and an error inside it names that file", () => {
  const ex = examples.find((e) => e.files);
  const byName = new Map(ex.files.map((f) => [f.name, f.text]));
  const out = toJS(compile(ex.jslt, "main.jslt", { resolver: { resolve: (n) => byName.get(n) } }).applyInput(fromJS(ex.input)));
  assert.deepEqual(out, { customer: "Ada Lovelace", total: "24.98 EUR" });
  byName.set("lib.jslt", "def money(n\n");
  let err;
  try { compile(ex.jslt, "main.jslt", { resolver: { resolve: (n) => byName.get(n) } }); } catch (e) { err = e; }
  assert.equal(err.getSource(), "lib.jslt");
});

import { domToJson, jsonToXml, XML_DEFAULTS } from "../src/xml.js";

// hand-built DOM-shaped nodes: Node has no DOMParser
const el = (nodeName, attrs = {}, ...children) => ({
  nodeType: 1, nodeName,
  attributes: Object.entries(attrs).map(([name, value]) => ({ name, value })),
  childNodes: children.map((c) => (typeof c === "string" ? { nodeType: 3, nodeValue: c } : c)),
});
const order = el("order", { id: "SO-1" },
  "\n  ", el("customer", {}, el("name", {}, "Acme")), "\n  ",
  el("line", { sku: "A" }, el("price", {}, "9.99")),
  el("line", { sku: "B" }, el("price", {}, "5")),
  el("note", { lang: "en" }, "hi"), el("empty"));

test("domToJson: attributes, repeated elements, #text, empty element", () => {
  assert.deepEqual(domToJson(order), { order: {
    "@id": "SO-1", customer: { name: "Acme" },
    line: [{ "@sku": "A", price: "9.99" }, { "@sku": "B", price: "5" }],
    note: { "@lang": "en", "#text": "hi" }, empty: "",
  } });
});

test("domToJson options: attribute prefix, dropped attributes, arrays always", () => {
  assert.equal(domToJson(order, { attr: "_", arrays: "repeated" }).order._id, "SO-1");
  const dropped = domToJson(order, { attr: "", arrays: "repeated" }).order;
  assert.equal(dropped["@id"], undefined);
  assert.equal(dropped.note, "hi");
  assert.deepEqual(domToJson(order, { attr: "@", arrays: "always" }).order.customer, [{ name: ["Acme"] }]);
});

test("jsonToXml: root, attributes, text, arrays, escaping, nulls", () => {
  const out = jsonToXml({ invoice: { "@no": 'A"1', customer: "Smith & Co", line: [{ "@sku": "A", "#text": "<w>" }, { "@sku": "B" }], gone: null } });
  assert.equal(out, [
    '<invoice no="A&quot;1">',
    "  <customer>Smith &amp; Co</customer>",
    '  <line sku="A">&lt;w&gt;</line>',
    '  <line sku="B"/>',
    "  <gone/>",
    "</invoice>",
  ].join("\n"));
});

test("jsonToXml: anything that is not a single-key object is wrapped in <root>; names are made valid", () => {
  assert.equal(jsonToXml({ a: 1, b: 2 }), "<root>\n  <a>1</a>\n  <b>2</b>\n</root>");
  assert.equal(jsonToXml([1, 2]), "<root>\n  <item>1</item>\n  <item>2</item>\n</root>");
  assert.equal(jsonToXml({ x: [1, 2] }), "<root>\n  <x>1</x>\n  <x>2</x>\n</root>");
  assert.equal(jsonToXml({ "1 a": 5 }), "<_1_a>5</_1_a>");
});

test("XML conversion round-trips an element tree through the default conventions", () => {
  const json = domToJson(order);
  const xml = jsonToXml(json, XML_DEFAULTS);
  assert.match(xml, /<order id="SO-1">/);
  assert.match(xml, /<line sku="B">\n\s+<price>5<\/price>\n\s+<\/line>/);
});
