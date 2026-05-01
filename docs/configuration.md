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
    format: 0.3
    lint: 0.6
    code-quality: 0.8
    ai-slop: 2.5
    architecture: 1.0
    security: 1.5
  thresholds:
    good: 75
    ok: 50
  smoothing: 20

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
  code-quality: true  # complexity, dead code, unused deps
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
    format: 0.3       # formatting issues have lighter impact
    lint: 0.6
    code-quality: 0.8
    ai-slop: 2.5      # AI-slop signals carry stronger weight
    architecture: 1.0
    security: 1.5
  smoothing: 20        # increase to reduce penalty spikes on larger repos
```

## Extending a shared config

`extends:` lets a project inherit a parent config and override only the keys it cares about. Useful for org-wide baselines.

```yaml
# packages/payments/.aislop/config.yml
extends: ../../.aislop/base.yml

ci:
  failBelow: 80         # override one key, inherit everything else from the parent
```

Multiple parents are supported via an array; later entries win on conflict:

```yaml
extends:
  - ../../.aislop/base.yml
  - ./local-overrides.yml
```

**Resolution rules**

- Paths are relative to the config file declaring `extends:`. Absolute paths are accepted; package or URL forms are not yet supported and will fail with a clear error.
- Nested objects (`engines`, `scoring.weights`, `quality`) are deep-merged key-by-key. The child's keys win on conflict.
- Arrays (e.g. `exclude:`) are replaced wholesale, not concatenated. Append in the child if you want to extend rather than overwrite.
- Cycles and chains deeper than 5 levels are rejected at load time, not silently ignored.

## Architecture rules

Create `.aislop/rules.yml` to define custom import and path rules. Enable the architecture engine in your config:

```yaml
engines:
  architecture: true
```

See [examples/architecture-rules.yml](../examples/architecture-rules.yml) for a sample rules file.

## Example configs

See the [examples/](../examples/) directory for pre-built configs:

- [`typescript-strict.yml`](../examples/typescript-strict.yml): tight thresholds for zero-slop teams
- [`monorepo-relaxed.yml`](../examples/monorepo-relaxed.yml): loose thresholds for incremental adoption
- [`python-go.yml`](../examples/python-go.yml): backend-focused with higher security weight
