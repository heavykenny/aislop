# CI / CD

## GitHub Actions

```yaml
- uses: actions/setup-node@v6
  with:
    node-version: 20

- run: npx aislop ci
```

`aislop ci` outputs JSON and exits with code 1 if the score is below the configured threshold.

## Quality gate

Set a minimum score in `.aislop/config.yml`:

```yaml
ci:
  failBelow: 70
  format: json
```

The CI command exits with code 1 when the score drops below `failBelow`.

## Pre-commit hook

Scan only staged files to keep commits clean:

```bash
npx aislop scan --staged
```

## Scan changed files

Scan only files that differ from `HEAD` (useful in CI for PR checks):

```bash
npx aislop scan --changes
```

## JSON output

Both `aislop ci` and `aislop scan --json` produce structured JSON output suitable for parsing in CI pipelines:

```json
{
  "version": "0.1.3",
  "score": 85,
  "label": "Healthy",
  "engines": { ... },
  "diagnostics": [ ... ],
  "summary": {
    "errors": 0,
    "warnings": 3,
    "fixable": 1,
    "files": 142,
    "elapsed": "2.1s"
  }
}
```
