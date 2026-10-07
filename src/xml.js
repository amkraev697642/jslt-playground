// XML <-> JSON for the playground. Conventions, two of them selectable in the UI:
//   attr:   "@" | "_" | ""  attributes become "@name" / "_name", or are dropped when ""
//   arrays: "repeated" | "always"  repeated sibling elements become an array; "always" makes every child element one
// Text of an element that also has attributes or child elements is "#text"; an element with only text is that string
// (empty element: ""); the root element is the single top-level key. Values stay strings: XML has no types.
export const XML_DEFAULTS = { attr: "@", arrays: "repeated" };

function elementToValue(el, o) {
  const attrs = [];
  if (o.attr) for (let i = 0; i < (el.attributes ? el.attributes.length : 0); i++) attrs.push(el.attributes[i]);
  const kids = [];
  let text = "";
  for (const n of Array.from(el.childNodes || [])) {
    if (n.nodeType === 1) kids.push(n);
    else if (n.nodeType === 3 || n.nodeType === 4) text += n.nodeValue;
  }
  text = text.trim();
  if (!attrs.length && !kids.length) return text;
  const obj = {};
  for (const a of attrs) obj[o.attr + a.name] = a.value;
  const groups = new Map();
  for (const k of kids) {
    if (!groups.has(k.nodeName)) groups.set(k.nodeName, []);
    groups.get(k.nodeName).push(elementToValue(k, o));
  }
  for (const [name, list] of groups) obj[name] = list.length > 1 || o.arrays === "always" ? list : list[0];
  if (text) obj["#text"] = text;
  return obj;
}

// rootEl: an Element (or anything shaped like one: nodeName, attributes, childNodes).
export function domToJson(rootEl, o = XML_DEFAULTS) {
  return { [rootEl.nodeName]: elementToValue(rootEl, o) };
}

// Browser only. Throws an Error with .line / .col (1-based, when the parser says where) on malformed XML.
export function parseXml(text) {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  const bad = doc.getElementsByTagName("parsererror")[0];
  if (bad) {
    const msg = bad.textContent.replace(/\s+/g, " ").trim();
    const m = /error on line (\d+) at column (\d+): (.*?)(?: Below is a rendering.*)?$/.exec(msg);
    throw Object.assign(new Error(m ? `${m[3]} (line ${m[1]}, column ${m[2]})` : msg), m ? { line: +m[1], col: +m[2] } : {});
  }
  return doc.documentElement;
}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escAttr = (s) => esc(s).replace(/"/g, "&quot;");
const xmlName = (k) => {
  const n = String(k).replace(/[^\w.:-]/g, "_");
  return /^[A-Za-z_:]/.test(n) ? n : "_" + n;
};

// A top-level object with exactly one key is the root element; anything else is wrapped in <root> (a top-level array as <item>s).
export function jsonToXml(value, o = XML_DEFAULTS) {
  const isAttr = (k) => !!o.attr && k.startsWith(o.attr) && k.length > o.attr.length;
  const lines = [];
  const write = (name, v, depth) => {
    const pad = "  ".repeat(depth), tag = xmlName(name);
    if (Array.isArray(v)) { v.forEach((item) => write(name, item, depth)); return; }
    if (v === null || v === undefined) { lines.push(`${pad}<${tag}/>`); return; }
    if (typeof v !== "object") { lines.push(`${pad}<${tag}>${esc(v)}</${tag}>`); return; }
    const keys = Object.keys(v);
    const attrs = keys.filter(isAttr).map((k) => ` ${xmlName(k.slice(o.attr.length))}="${escAttr(v[k])}"`).join("");
    const kids = keys.filter((k) => !isAttr(k) && k !== "#text");
    const text = v["#text"];
    if (!kids.length) { lines.push(text === undefined ? `${pad}<${tag}${attrs}/>` : `${pad}<${tag}${attrs}>${esc(text)}</${tag}>`); return; }
    lines.push(`${pad}<${tag}${attrs}>`);
    if (text !== undefined) lines.push(`${pad}  ${esc(text)}`);
    kids.forEach((k) => write(k, v[k], depth + 1));
    lines.push(`${pad}</${tag}>`);
  };
  const keys = value && typeof value === "object" && !Array.isArray(value) ? Object.keys(value) : [];
  const rooted = keys.length === 1 && !isAttr(keys[0]) && keys[0] !== "#text" && !Array.isArray(value[keys[0]]);
  if (rooted) write(keys[0], value[keys[0]], 0);
  else write("root", Array.isArray(value) ? { item: value } : value, 0);
  return lines.join("\n");
}
