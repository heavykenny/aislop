# Scoring

aislop produces a single score from 0 to 100 for every scan.

## How it works

Every diagnostic contributes a weighted penalty based on its severity:

| Severity | Base penalty |
|---|---|
| Error | 3.0 |
| Warning | 1.0 |
| Info | 0.25 |

Penalties are multiplied by the engine weight (configurable in `.aislop/config.yml`).

By default, aislop now uses an **AI-slop-first** weighting profile:

```yaml
scoring:
  weights:
    format: 0.3
    lint: 0.6
    code-quality: 0.8
    ai-slop: 2.5
    architecture: 1.0
    security: 1.5
  smoothing: 20
```

This means AI-slop findings are weighted more heavily than generic lint/format noise,
while security still carries significant impact.

## Density normalization

The final score uses **logarithmic scaling with issue-density normalization**. Penalties are measured relative to the number of source files in the project, so:

- A few issues in a large codebase don't tank the score unfairly
- A single issue in an otherwise clean project stays proportional
- The score remains meaningful regardless of project size

## Score labels

| Score | Label |
|---|---|
| 75 -- 100 | Healthy |
| 50 -- 74 | Needs Work |
| 0 -- 49 | Critical |

These thresholds are configurable:

```yaml
scoring:
  thresholds:
    good: 75    # scores above this are "Healthy"
    ok: 50      # scores above this are "Needs Work", below is "Critical"
```

## Tuning guidance

- Increase `ai-slop` weight if you want strict AI-output hygiene.
- Increase `security` weight if dependency/runtime risk should dominate your score.
- Increase `smoothing` for large legacy codebases so a few warnings are less punitive.
- Lower `lint` and `code-quality` weights if you want scores to emphasize AI-specific findings.

## CI quality gate

Use `ci.failBelow` to fail CI when the score drops below a threshold:

```yaml
ci:
  failBelow: 70
```

`aislop ci` exits with code 1 when the score is below the threshold.
