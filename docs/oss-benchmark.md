# OSS Benchmarking

`aislop`'s false-positive pass is easiest to keep disciplined when the cohort is frozen and every iteration re-runs the exact same repos.

The benchmark harness in `tools/oss-benchmark.mjs` does two separate jobs:

1. Capture the current GitHub Trending top repos for each language into a cohort manifest.
2. Clone or update those repos, then run `aislop` against each one with telemetry disabled and CI-style deterministic output.

## Default cohort

The default language set is the 7 supported Trending tracks we use for OSS validation:

- `typescript`
- `python`
- `go`
- `rust`
- `ruby`
- `php`
- `java`

Default limit is `10` repos per language.

## Scan command

Every benchmark scan uses this exact invocation:

```bash
AISLOP_NO_TELEMETRY=1 DO_NOT_TRACK=1 CI=1 NO_COLOR=1 node dist/cli.js scan "<repo>" --json
```

That keeps telemetry fully off, disables ANSI noise, and makes the output stable for overnight cohort runs.

## Workflow

Build first:

```bash
pnpm build
```

Capture a new frozen cohort:

```bash
pnpm bench:trending:capture
```

Run the latest frozen cohort as iteration 1:

```bash
pnpm bench:trending:run -- --iteration pass-1
```

Capture and run in one step:

```bash
pnpm bench:trending:cycle -- --iteration pass-1
```

Re-run the exact same cohort after rule fixes:

```bash
pnpm bench:trending:run -- --manifest tools/benchmark-data/cohorts/trending-daily-2026-05-29.json --iteration pass-2
pnpm bench:trending:run -- --manifest tools/benchmark-data/cohorts/trending-daily-2026-05-29.json --iteration pass-3
```

Run a smaller smoke test:

```bash
pnpm bench:trending:cycle -- --languages typescript,php --limit 1 --iteration smoke
```

## Output layout

Generated benchmark data is ignored by git and lands under `tools/benchmark-data/`:

- `cohorts/*.json`: frozen repo lists
- `repos/<language>/<owner>__<repo>/`: cached clones
- `runs/<run-id>/summary.json`: machine-readable aggregate report
- `runs/<run-id>/summary.md`: human review report
- `runs/<run-id>/repos/.../scan.json`: raw per-repo scan JSON
- `runs/<run-id>/repos/.../stdout.txt`, `stderr.txt`, `metadata.json`: reproduction details

## Review loop

Use the report in this order:

1. Check failures first so the cohort is complete.
2. Check the lowest-score repos.
3. Check the highest-volume rules across many repos.
4. Open the per-repo `scan.json` files for likely false positives.
5. Fix the rules.
6. Re-run the same manifest as the next iteration.

Only refresh the cohort when you want a new market snapshot. For iteration work, keep the manifest stable.
