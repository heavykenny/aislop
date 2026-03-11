## What does this PR do?

<!-- A clear, concise description of the change. -->

## Type of change

- [ ] Bug fix (fixes an issue without changing behavior)
- [ ] New rule (adds a new detection rule)
- [ ] New feature (adds functionality)
- [ ] Refactor (no behavior change)
- [ ] Documentation
- [ ] CI / tooling

## Checklist

- [ ] `pnpm typecheck` passes
- [ ] `pnpm test` passes (216+ tests)
- [ ] `pnpm build && node dist/cli.js scan .` scores Healthy
- [ ] New rules have positive AND negative test cases
- [ ] New rules are registered in `src/commands/rules.ts`
- [ ] Self-detection patterns use string concatenation (see CONTRIBUTING.md)

## Related issues

<!-- Link any related issues: Fixes #123, Closes #456 -->
