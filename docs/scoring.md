# Scoring

aislop produces a single score from 0 to 100 for every scan.

## How it works

Every diagnostic contributes a weighted penalty based on its severity:

| Severity | Base penalty |
|---|---|
| Error | 3.0 |
| Warning | 1.0 |
| Info | 0.25 |

Penalties are multiplied by the engine weight (configurable in `.aislop/config.yml`, security defaults to 2x).

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

## CI quality gate

Use `ci.failBelow` to fail CI when the score drops below a threshold:

```yaml
ci:
  failBelow: 70
```

`aislop ci` exits with code 1 when the score is below the threshold.
