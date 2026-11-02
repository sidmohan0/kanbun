# Authoring the analytics starter

`build.mjs` is an asset-authoring tool, not an application dependency. Use the bundled Spreadsheets
skill/runtime (`@oai/artifact-tool`) in a disposable directory with its prescribed `node_modules`
symlink. Copy this one builder there, run it with that runtime's Node executable and an output
folder, and inspect all five rendered sheets. The builder executes synthetic input/boundary checks,
removes fixture data, recalculates, exports the blank workbook and writes its hash-bound proof.

Copy `kanbun-analytics-starter.xlsx` and `proof.json` to `apps/web/public/analytics/`, naming the proof
`starter-proof.json`. Do not add the authoring library to project dependencies. Format the committed
builder in the repository devcontainer before the final authoring run; its exact bytes are part of
the proof. Keep image previews and intermediate output outside tracked source.

Run repository checks in the devcontainer:

```sh
./scripts/devcontainer.sh exec node --test scripts/analytics-starter.test.mjs
./scripts/devcontainer.sh exec pnpm --filter @kanbun/worker test analytics-starter.test.ts
./scripts/devcontainer.sh exec bash .devcontainer/verify-lock.sh pnpm --filter @kanbun/verifier test:recovery app-analytics-starter.spec.ts
```

`inspect-xlsx.mjs` only reads the known checked-in ZIP/XML artifact for regression checks. It is not
an upload parser or production API. Formula authoring/recalculation uses the spreadsheet runtime.
The Google import examples are literal setup text; no local test claims to grant remote access.
