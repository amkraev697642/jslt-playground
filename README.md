# JSLT playground

An in-browser playground for [JSLT](https://github.com/schibsted/jslt), the JSON query and transformation language: **https://amkraev697642.github.io/jslt-playground/**

It runs entirely in your browser on [jslt-js](https://www.npmjs.com/package/jslt-js), with the editor from [jslt-editor](https://www.npmjs.com/package/jslt-editor). Nothing is sent to a server.

- JSON or XML input and output, with selectable XML conventions
- Tabs for imported files (`import "lib.jslt" as lib`)
- Highlighting, completion, hover docs, formatting and error markers
- Examples, light and dark theme, and shareable links (the state is in the URL)

## Development

```sh
npm install
npm run build   # bundles src/app.js into public/dist/app.js
npm test
npx serve public   # or any static server, then open the printed URL
```

The Pages workflow builds and deploys on every push to `main`. One-time setting: Settings → Pages → Source = GitHub Actions.

## License

Apache-2.0
