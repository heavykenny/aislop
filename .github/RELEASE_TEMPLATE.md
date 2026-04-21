<!--
Release-note skeleton for aislop. Copy this into GitHub's "Create release" notes
box, fill in the placeholders, delete sections you don't need.

Style rules:
- Lead with one sentence the reader could tweet.
- No em-dashes. Use commas, parens, or periods.
- Show commands, not paragraphs about commands.
- Keep "Numbers" honest: real test count, real package size, real score.
- If a section has nothing to say, delete it rather than pad.
-->

{{ one-sentence pitch — what this release does for the user }}

## Install

```bash
npx aislop@{{ version }} scan .
# or globally:
npm i -g aislop@{{ version }}
```

## What shipped

{{ Main feature(s). Lead each bullet with the user-visible noun,
   not the internal module. Use sub-bullets sparingly. }}

**{{ feature name }}.** {{ one line on what it does and why. }}
- `{{ flag / subcommand }}` — {{ what it's for }}
- `{{ flag / subcommand }}` — {{ what it's for }}

## Bug fix

{{ Only if there's a notable fix a user should know about.
   Describe the symptom first, then the fix. Numbers where they exist
   (rows affected, files deleted, perf delta). Skip if all fixes are
   minor; they belong in the Also section. }}

**{{ symptom }}.** {{ What happened before, what happens now, proof
   (test coverage, live-repo verification). }}

## Also

{{ Secondary fixes and refactors. One short line each. Skip if empty. }}

- {{ short description of fix }}
- {{ short description of fix }}

## Numbers

- {{ N }} tests passing ({{ baseline }} baseline + {{ new }} new)
- Self-scan: {{ score }}/100 {{ Healthy | Needs Work | Critical }}
- Packaged size: {{ KB }} kB ({{ N }} files)
- {{ "No CLI contract changes. The `<subcommand>` is additive." | "Breaking changes: <summary>" }}

## Manage

{{ Include only if the release adds a multi-subcommand surface users
   will want to discover (e.g. `hook install / uninstall / status`).
   Otherwise delete. }}

```bash
npx aislop {{ subcommand }} {{ verb }}   # {{ what it does }}
npx aislop {{ subcommand }} {{ verb }}   # {{ what it does }}
```

Docs: https://scanaislop.com/docs/{{ page }}
