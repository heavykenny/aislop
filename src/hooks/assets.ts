export const AISLOP_MD_BODY = `# aislop — agent instructions

[aislop](https://github.com/heavykenny/aislop) is your guardrail for shipping clean, maintainable, production-grade code. It catches the patterns AI coding tools leave behind: dead imports, redundant code, duplicate logic, unsafe any-typed casts, narrative comments, swallowed errors, oversized functions, risky security constructs — and grades the project out of 100 so regressions are visible. Treat its findings as blocking, not advisory: the goal is code a human maintainer would happily inherit.

## On every edit

A PostToolUse hook runs \`aislop hook claude\` after every Edit, Write, or MultiEdit. It scans the touched files and returns findings as JSON \`additionalContext\` shaped like \`AislopFeedback\` (schema \`aislop.hook.v1\`). Act on them the same turn.

## Severity ladder

- \`error\` — MUST fix this turn.
- \`warning\` + \`fixable: true\` — MUST fix this turn.
- \`warning\` + \`fixable: false\` — fix if trivially mechanical, otherwise surface in your reply.

## Rules

- \`.aislop/config.yaml\` — thresholds and engine toggles. Treat as authoritative; don't edit without user consent.
- \`.aislop/rules.yaml\` — project-specific architecture rules (may be absent). When a finding cites \`architecture/*\`, open this file and follow it.
- Custom rules can change between sessions. Trust what the scan returns, not a cached understanding of what the rules are.

## Principles

- Do not disable rules to pass the scan. Fix the underlying issue.
- If a finding is a false positive, leave it and explain in your reply — do not delete the rule config.
- The findings payload includes \`nextSteps[]\` — treat those as your plan for the turn.
`;
