# CI / CD

## Fastest path: `aislop init`

Run `npx aislop init` and answer "yes" to the GitHub Actions workflow prompt. It writes `.aislop/config.yml` and `.github/workflows/aislop.yml` for you. Commit both and your quality gate is live.

`.github/workflows/aislop.yml` is the GitHub Actions workflow file. You can rename the file, but it must live under `.github/workflows/`. `.aislop/config.yml` is the aislop policy file: thresholds, engines, scoring, and telemetry live there.

## GitHub Actions

Recommended Marketplace Action:

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

      - uses: scanaislop/aislop@v0.10.2
        with:
          version: latest
```

For deterministic CI, pin both layers:

```yaml
- uses: actions/checkout@v4

- uses: scanaislop/aislop@v0.10.2
  with:
    version: "0.10.2"
```

Versioning has two separate knobs:

- `uses: scanaislop/aislop@v0.10.2` is the GitHub Action wrapper ref. It must be a real Git tag, branch, or SHA. GitHub does not resolve `@latest` unless this repository creates and maintains such a ref.
- `version: latest` is the npm CLI version the Action runs. It maps to the npm `latest` dist-tag.

Manual workflow without the Marketplace Action:

```yaml
- uses: actions/checkout@v4
- uses: actions/setup-node@v4
  with:
    node-version: 20
- run: npx --yes aislop@latest ci .
```

`aislop ci` outputs JSON and exits with code 1 if the score is below the configured threshold or any error-severity diagnostic is present.

## GitLab CI

```yaml
# .gitlab-ci.yml
aislop:
  image: node:20
  script:
    - npx --yes aislop@latest ci .
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
      - run: npx --yes aislop@latest ci .
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
  "cliVersion": "0.10.2",
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
