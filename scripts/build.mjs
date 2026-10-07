// Bundles the playground (CodeMirror, jslt-editor, jslt-js) into one self-contained file: no CDN at runtime.
import { build } from "esbuild";

await build({
  entryPoints: ["src/app.js"],
  bundle: true,
  format: "esm",
  minify: true,
  sourcemap: true,
  target: "es2022",
  outfile: "public/dist/app.js",
  logLevel: "info",
});
