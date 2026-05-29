# Fix → Open PR

A design spec for the automated `fix → open PR` flow. This needs a GitHub App,
installation auth, and a server-side sandbox, so it is a specification rather than
shippable code today.

## Framing: the score is the gate

aislop produces a single deterministic score from a scan (see `docs/scoring.md`).
That determinism is the whole point of the flow: the LLM **proposes** edits, and the
engine **scores** them. This is the "AlphaGo for code quality" loop — a strong but
fallible generator paired with a cheap, deterministic evaluator. We only ever keep a
change if the deterministic score improves. The LLM is never the judge of its own work.

## User flow

1. **Trigger.** A user starts a fix run from one of:
   - the hosted dashboard ("Fix" button on a repo or a specific finding), or
   - the CLI (`aislop fix --open-pr`, which calls the hosted API).
2. The platform queues a job against a target repo + ref (default: the repo's
   default branch HEAD).
3. The job runs the loop (below) inside a sandbox.
4. On success it opens a PR via the GitHub App and links it back in the dashboard.
   On failure (no improvement, budget exceeded) it hands off with a summary and no PR.

## The loop

```
clone repo @ ref  →  scan (baseline score S0)
repeat up to N iterations:
    aislop fix                      # mechanical fixers (deterministic)
    if findings remain:
        LLM proposes edits          # bounded, allowlisted patch
    re-scan (score Si)
    if Si > S(i-1):  keep changes (commit)
    else:            revert this iteration's edits
stop when: no findings left, OR no score gain for K iterations, OR budget hit
if final score Sf > S0:  open PR
else:                    hand off (post summary, no PR)
```

- `aislop fix` runs first each iteration because it is deterministic and free; the
  LLM is only invoked for what the fixers cannot resolve.
- Every kept iteration is a commit, so the PR history shows incremental, attributable
  improvements.
- The gate is strictly `Si > S(i-1)`: a tie or regression is reverted. The run as a
  whole only opens a PR when `Sf > S0`.

## Branch naming

`aislop/fix/<id>` where `<id>` is the job id (short, URL-safe). One branch per run,
created from the target ref. Never commit to `main` / the default branch — all
output is a PR.

## Opening the PR (Octokit + GitHub App)

Using `@octokit/rest` authenticated as the installation (see auth model):

1. Create the branch ref from the base sha.
2. Push the iteration commits to `aislop/fix/<id>`.
3. `pulls.create({ base, head: "aislop/fix/<id>", title, body })`.

### PR body

- **Score delta:** `S0 → Sf` with the absolute and percentage change, plus a
  per-engine breakdown (format / lint / code-quality / ai-slop / architecture / security).
- **Findings table:** what was resolved, grouped by engine and rule:

  | File | Engine | Rule | Severity | Status |
  | ---- | ------ | ---- | -------- | ------ |
  | src/x.ts:42 | ai-slop | narrative-comment | warning | fixed |
  | src/y.ts:13 | security | swallowed-error | error | fixed |

- A short note listing anything left unresolved and why (handed off, not regressed).
- Footer: aislop version + config hash so the result is reproducible.

## Auth model

- A **GitHub App** is installed on the org/repo. The server mints a short-lived
  **installation access token** per job (via the App's JWT → installation token
  exchange). Tokens are scoped to the target repo with `contents:write` and
  `pull_requests:write`.
- Tokens live only for the job's duration and are never persisted to disk or logs.
- The App identity is the PR author, so changes are clearly attributable to aislop
  and subject to the repo's normal branch protection and review.
- **Never push to the default branch.** The App lacks (and is never granted) the
  ability to bypass branch protection; output is always a PR.

## Safety rails

- **Sandbox.** Each job runs in an ephemeral, network-restricted container. Only the
  cloned repo is writable; the GitHub token is injected as an env secret, not committed.
- **Command allowlist.** The loop may run only `git`, `aislop`, and the project's
  package-manager install/build/test commands resolved from the repo manifest. No
  arbitrary shell from LLM output; proposed edits are applied as patches, not executed.
- **Time + iteration budget.** Hard caps on wall-clock time, iteration count `N`, and
  total LLM token spend per job. Exceeding any cap stops the loop and triggers handoff.
- **Score-gated writes.** Nothing is committed unless the deterministic score improved;
  this prevents the LLM from "fixing" by deleting code or disabling rules (those would
  not improve the score, since rule config is read from the repo and not modifiable by
  the job).
- **No config tampering.** `.aislop/config.yaml` and `.aislop/rules.yaml` are treated
  as read-only inputs in the sandbox so the gate cannot be gamed.

## Where it slots into the hosted platform

- **Dashboard / API** owns triggers, job queue, and result display.
- **Worker** runs the sandboxed loop and shells out to the same `aislop` CLI used
  everywhere else (CI, the VS Code extension, local dev), so scoring is identical
  across surfaces.
- **GitHub App service** handles installation-token minting and Octokit calls.
- Results (score delta, PR link, handoff reasons) are written back to the dashboard
  and surfaced in the originating CLI/dashboard session.
