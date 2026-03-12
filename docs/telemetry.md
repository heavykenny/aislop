# Telemetry

`aislop` collects anonymous usage analytics to help prioritize improvements. **No code, file paths, project names, or secrets are ever collected.**

## What we collect

- Command run (`scan`, `fix`, `ci`)
- Languages detected
- Score bucket (not the exact score)
- Issue counts per engine
- Engine timing
- OS, Node version, aislop version

## Opt out

Telemetry is **off in CI** by default (when `CI=true` is set).

To opt out anywhere:

```bash
# Environment variable (any of these)
AISLOP_NO_TELEMETRY=1 aislop scan
DO_NOT_TRACK=1 aislop scan
```

Or in `.aislop/config.yml`:

```yaml
telemetry:
  enabled: false
```
