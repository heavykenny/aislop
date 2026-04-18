# CI / CD

## Fastest path — `aislop init`

Run `npx aislop init` and answer "yes" to the GitHub Actions workflow prompt. It writes `.aislop/config.yml` and `.github/workflows/aislop.yml` for you. Commit both and your quality gate is live.

## GitHub Actions

```yaml
# .github/workflows/aislop.yml
name: aislop

on:
  push:
    branches: [main]
  pull_request:

jobs:
  quality-gate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npx aislop@latest ci .
```

Or the composite action (one-liner):

```yaml
- uses: actions/checkout@v4
- uses: heavykenny/aislop@v0.5
```

`aislop ci` outputs JSON and exits with code 1 if the score is below the configured threshold or any error-severity diagnostic is present.

## GitLab CI

```yaml
# .gitlab-ci.yml
aislop:
  image: node:20
  script:
    - npx aislop@latest ci .
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
    - if: $CI_COMMIT_BRANCH == "main"
```

## CircleCI

```yaml
# .circleci/config.yml
version: 2.1
jobs:
  aislop:
    docker:
      - image: cimg/node:20.0
    steps:
      - checkout
      - run: npx aislop@latest ci .
workflows:
  quality-gate:
    jobs:
      - aislop
```

## Quality gate

Set a minimum score in `.aislop/config.yml`:

```yaml
ci:
  failBelow: 70
  format: json
```

The CI command exits with code 1 when the score drops below `failBelow`, or when any error-severity diagnostic is present.

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
  "schemaVersion": "1",
  "cliVersion": "0.5.0",
  "score": 87,
  "label": "Healthy",
  "engines": {
    "format":       { "issues": 0, "skipped": false, "elapsed": 406 },
    "lint":         { "issues": 0, "skipped": false, "elapsed": 378 },
    "code-quality": { "issues": 1, "skipped": false, "elapsed": 812 },
    "ai-slop":      { "issues": 2, "skipped": false, "elapsed": 455 },
    "security":     { "issues": 0, "skipped": false, "elapsed": 1103 }
  },
  "diagnostics": [ ... ]
}
```
