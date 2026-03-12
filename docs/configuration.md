# Configuration

Run `aislop init` to generate `.aislop/config.yml` with default values.

## Default config

```yaml
version: 1

engines:
  format: true
  lint: true
  code-quality: true
  ai-slop: true
  architecture: false    # opt-in, needs rules.yml
  security: true

quality:
  maxFunctionLoc: 80
  maxFileLoc: 400
  maxNesting: 5
  maxParams: 6

security:
  audit: true
  auditTimeout: 25000

scoring:
  weights:
    format: 0.5
    lint: 1.0
    code-quality: 1.5
    ai-slop: 1.0
    architecture: 1.0
    security: 2.0
  thresholds:
    good: 75
    ok: 50

ci:
  failBelow: 0           # set to e.g. 70 to fail CI below that score
  format: json

telemetry:
  enabled: true          # set to false to opt out
```

## Engines

Each engine can be enabled or disabled individually:

```yaml
engines:
  format: true        # formatting checks
  lint: true          # linting checks
  code-quality: true  # complexity, duplication, dead code
  ai-slop: true       # AI pattern detection
  architecture: false  # custom import/path rules (requires rules.yml)
  security: true       # secrets, risky constructs, dependency audits
```

## Quality thresholds

Control what triggers code quality warnings:

| Setting | Default | Description |
|---|---|---|
| `maxFunctionLoc` | 80 | Max lines per function |
| `maxFileLoc` | 400 | Max lines per file |
| `maxNesting` | 5 | Max control-flow nesting depth |
| `maxParams` | 6 | Max function parameters |

## Engine weights

Control how much each engine contributes to the final score:

```yaml
scoring:
  weights:
    format: 0.5       # formatting issues matter less
    lint: 1.0
    code-quality: 1.5
    ai-slop: 1.0
    architecture: 1.0
    security: 2.0      # security issues matter most
```

## Architecture rules

Create `.aislop/rules.yml` to define custom import and path rules. Enable the architecture engine in your config:

```yaml
engines:
  architecture: true
```

See [examples/architecture-rules.yml](../examples/architecture-rules.yml) for a sample rules file.

## Example configs

See the [examples/](../examples/) directory for pre-built configs:

- [`typescript-strict.yml`](../examples/typescript-strict.yml) — tight thresholds for zero-slop teams
- [`monorepo-relaxed.yml`](../examples/monorepo-relaxed.yml) — loose thresholds for incremental adoption
- [`python-go.yml`](../examples/python-go.yml) — backend-focused with higher security weight
