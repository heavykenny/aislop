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
They are also multiplied by the rule's impact tier. Run `aislop rules` to see the
impact tier and rationale for each rule.

By default, aislop uses a balanced weighting profile:

```yaml
scoring:
  weights:
    format: 0.3
    lint: 0.6
    code-quality: 0.8
    ai-slop: 1.0
    architecture: 1.0
    security: 1.5
  smoothing: 20
  maxPerRule: 40
```

This keeps AI-slop findings visible without letting a single warning make an otherwise
healthy repo look unhealthy. Security still carries stronger impact.

## Rule impact tiers

Each native rule has an explicit impact tier so scoring is strict only where the signal justifies it:

| Tier | Multiplier | Typical use |
|---|---:|---|
| `strict` | 1.0 | High-confidence defects, security issues, missing imports, swallowed failures |
| `standard` | 1.0 | Real quality issues that may still need human judgment |
| `maintainability` | 0.75 | Refactoring and design debt that should count, but not like a defect |
| `mechanical` | 0.5 | Cleanup that `aislop fix` or a simple edit can usually handle |
| `style` | 0.5 | Style/policy findings and size/readability pressure |
| `advisory` | 0.25 | Medium-confidence signals such as hardcoded config values |

Many forgiving tiers also have tighter per-rule caps so one noisy family cannot dominate a score.
JSON output includes the same metadata on each diagnostic as `scoreImpact`:

```json
{
  "rule": "ai-slop/hardcoded-url",
  "scoreImpact": {
    "tier": "advisory",
    "multiplier": 0.25,
    "cap": 4,
    "rationale": "Hardcoded URLs are medium-confidence config signals and can be intentional canonical URLs."
  }
}
```

## Style and cleanup findings score gently

Style and cleanup rules (`trivial-comment`, `narrative-comment`, `unused-import`, formatter
findings, and similar) still surface as findings, but contribute less than strict defects. This
keeps the number driven by genuine slop (swallowed errors, broken imports, risky security
constructs) rather than house style, without hiding the findings themselves.

## Advisory config signals score softly

Medium-confidence config signals (`hardcoded-url`, `hardcoded-id`) still surface as warnings, but
they contribute less to the score and saturate earlier when repeated. This preserves the finding
without turning ordinary hardcoded-value cleanup into a severe repo-health penalty.

## Repeated findings saturate by rule

Each rule contributes at most `scoring.maxPerRule` weighted penalty points by default. Repeated
findings still appear in the report, but one noisy rule family cannot dominate the whole score.
Different rule families continue to accumulate normally.

## Density normalization

The final score uses **logarithmic scaling with issue-density normalization**. Penalties are measured relative to the number of production and test files in the project, so:

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

- Increase `ai-slop` weight if you want stricter AI-output hygiene.
- Increase `security` weight if dependency/runtime risk should dominate your score.
- Increase `smoothing` for large legacy codebases so a few warnings are less punitive.
- Increase `maxPerRule` if repeated findings from one rule should punish the score more heavily.
- Lower `lint` and `code-quality` weights if you want scores to emphasize AI-specific findings.

## CI quality gate

Use `ci.failBelow` to fail CI when the score drops below a threshold:

```yaml
ci:
  failBelow: 70
```

`aislop ci` exits with code 1 when the score is below the threshold.
