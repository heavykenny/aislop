# aislop for VS Code

Surfaces [aislop](https://github.com/scanaislop/aislop) code-quality findings as
diagnostics (squiggles) directly in the editor, plus a status-bar score.

This extension does **not** bundle a scanner. It shells out to the `aislop` CLI
you already have installed and parses its `aislop scan <path> --json` envelope.

## Requirements

Install the CLI globally (or point `aislop.path` at a local binary):

```bash
npm i -g aislop
```

## Features

- Scans the workspace on activation and re-scans a file on save.
- Publishes findings to the `aislop` diagnostic collection with the rule id
  (`engine/rule`) and message at the reported line/column.
- Status-bar item showing the latest score out of 100; click it to re-scan.
- Command **aislop: Scan Workspace** (`aislop.scanWorkspace`).
- If the CLI is missing, shows a friendly prompt instead of crashing.

## Settings

| Setting             | Default    | Description                          |
| ------------------- | ---------- | ------------------------------------ |
| `aislop.path`       | `"aislop"` | Path to the aislop CLI executable.   |
| `aislop.scanOnSave` | `true`     | Re-scan a file when it is saved.     |

## Develop

```bash
npm install      # install dev deps (@types/vscode, typescript)
npm run compile  # tsc -> out/extension.js
```

Then press `F5` in VS Code to launch an Extension Development Host with the
extension loaded. The build is fully self-contained: this package has its own
`package.json` and `tsconfig.json` and is not part of the root aislop build.
