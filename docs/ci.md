# CI / CD

aislop runs the same gate everywhere. `aislop ci` scans, prints JSON, and exits non-zero when the score drops below your threshold or any error-severity diagnostic is present. The set-and-forget command is `npx --yes aislop@latest ci`: it always runs the latest published CLI, so there is no version to bump.

## Fastest path: `aislop init`

Run `npx aislop init` and answer "yes" to the GitHub Actions workflow prompt. It writes `.aislop/config.yml` and `.github/workflows/aislop.yml` for you. Commit both and your quality gate is live.

`.github/workflows/aislop.yml` is the workflow file (it must live under `.github/workflows/`). `.aislop/config.yml` is the policy file: thresholds, engines, scoring, and telemetry live there.

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
          node-version: 24
      - run: npx --yes aislop@latest ci
```

Prefer the Marketplace Action? It wraps `setup-node` and runs the same gate. `@v1` tracks the latest release and `version: latest` keeps the CLI current, so there is still nothing to bump:

```yaml
- uses: actions/checkout@v4
- uses: scanaislop/aislop@v1   # or pin a release, e.g. @v0.10.2, for reproducible builds
  with:
    version: latest            # CLI version; or pin one, e.g. "0.10.2"
```

## GitLab CI

```yaml
# .gitlab-ci.yml
aislop:
  image: node:24
  script:
    - npx --yes aislop@latest ci
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
      - image: cimg/node:24.0
    steps:
      - checkout
      - run: npx --yes aislop@latest ci
workflows:
  quality-gate:
    jobs:
      - aislop
```

## Bitbucket Pipelines

Bitbucket clones shallow by default and exposes the PR target branch as `$BITBUCKET_PR_DESTINATION_BRANCH`. Fetch the base, then gate on only the changed files (see [PR-scoped gating](#pr-scoped-gating)):

```yaml
# bitbucket-pipelines.yml
pipelines:
  pull-requests:
    "**":
      - step:
          name: aislop gate
          image: node:24
          clone:
            depth: full   # branch diffs need history
          script:
            - git fetch origin "$BITBUCKET_PR_DESTINATION_BRANCH"
            - npx --yes aislop@latest ci --changes --base FETCH_HEAD
```

Bitbucket's clone has only the source branch, so `git fetch origin <branch>` sets `FETCH_HEAD` without creating `origin/<branch>` — diff against `FETCH_HEAD` directly.

## Pre-commit hook

Scan only staged files to keep commits clean:

```bash
npx aislop scan --staged
```

## PR-scoped gating

A plain `--changes` diffs the working tree against `HEAD`, so in CI (where PR changes are already committed) it sees nothing. Pass `--base <ref>` to diff against the target branch instead. Both `scan` and `ci` accept `--changes` and `--base`, so you can gate a PR on only the files it touches:

```bash
npx aislop ci --changes --base origin/main
```

The base ref must exist in the checkout. With a full clone, `origin/<branch>` works directly; on a shallow or single-branch clone, run `git fetch origin <branch>` and pass `--base FETCH_HEAD` (the fetch sets `FETCH_HEAD` without creating `origin/<branch>`). If an explicit `--base` cannot be resolved, the run fails instead of silently passing an empty scan. The score gate and exit code behave exactly as a full `ci` run.

## Quality gate

Set a minimum score in `.aislop/config.yml`:

```yaml
ci:
  failBelow: 70
  format: json
```

The CI command exits 1 when the score drops below `failBelow`, or when any error-severity diagnostic is present.

## JSON output

Both `aislop ci` and `aislop scan --json` emit structured JSON for parsing in CI. Example shape (values illustrative):

```json
{
  "schemaVersion": "1",
  "cliVersion": "<version>",
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
