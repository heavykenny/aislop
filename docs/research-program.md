# aislop Research Program

aislop should learn in public.

The CLI is the distribution surface, but the moat is the corpus of repeatable AI-code-quality failures we can prove: real open-source repositories, pinned commits, raw JSON scan output, false-positive review, and detector changes that ship with regression tests.

This document is the protocol for public scans and benchmark writeups.

## Goals

- Turn repeated AI-agent failure modes into deterministic rules.
- Keep rule quality honest by scanning real projects, not only fixtures.
- Publish methods and limits so research posts are credible.
- Feed enterprise product strategy with evidence: which rules matter, where noise appears, and what teams need to govern AI-written code.

## Scan Protocol

For every public research run:

1. Define the cohort before scanning.
   - Examples: GitHub Trending by language, top npm packages, agent-generated benchmark tasks, framework repos, or a public customer-nominated list.
   - Record the selection rule. Do not swap repos after seeing results unless the reason is disclosed.
2. Pin every repository.
   - Capture `owner/repo`, default branch, commit SHA, primary language, package manager, and whether install/build was attempted.
3. Pin the scanner.
   - Capture aislop version, Node version, OS, config file, enabled engines, and command.
   - Preferred command: `npx aislop@<version> scan . --json`.
4. Store raw output.
   - Keep the JSON result for each repo before writing a summary.
   - Never publish private source. Public repos are okay to quote sparingly with links.
5. Classify findings.
   - Sample the top findings per rule.
   - Mark each sampled finding as true positive, false positive, needs-context, or toolchain/setup failure.
6. Convert learning into product.
   - False positive class -> tighten the detector and add regression tests.
   - Repeated true positive class -> consider a named rule.
   - Setup failure -> improve source filtering, language targeting, doctor output, or docs.
7. Publish the method and the limit.
   - Include cohort, command, version, high-level results, representative examples, and what changed in the CLI.
   - Say what the scan does not prove.

## Report Template

```md
# Title

## Cohort

- Selection rule:
- Repositories:
- Date scanned:
- aislop version:
- Command:

## Headline Findings

- Finding 1
- Finding 2
- Finding 3

## Rule-Level Results

| Rule | Findings | Sampled | True positives | False positives | Action |
|---|---:|---:|---:|---:|---|

## What Changed

- Detector change:
- Tests added:
- Docs updated:

## Limits

- What this scan does not measure:
- Known setup failures:
- Follow-up cohort:
```

## Current Research Tracks

### 1. GitHub Trending Quality Sweep

Monthly scan of trending open-source repositories by language. The purpose is precision: find noisy rules before users do.

Governance question it answers: which rule classes are noisy in real ecosystems before they reach a customer's CI gate?

Minimum output:

- cohort list and commit SHAs
- top finding classes
- false-positive fixes
- regression tests added

### 2. Agent Output Benchmark

Run the same tasks across AI coding agents, then score the produced repositories with aislop. The purpose is to answer a question developers already ask: which agents leave the least maintainability debt?

Governance question it answers: which agents are safe enough for which repositories?

Minimum output:

- task prompt
- agent/version
- clean-room run notes
- aislop score and rule distribution
- qualitative code review notes only after the deterministic score

### 3. Benchmark-to-Rule Translation

Read academic or industry benchmarks and translate repeatable structural signals into scanner-shaped rules.

Governance question it answers: which risks are backed by external evidence, not just our opinion?

The SlopCodeBench-derived Python rules are the model:

- identify deterministic pattern
- avoid judge-only scoring
- write positive and negative fixtures
- document rule provenance

### 4. Rule Provenance

Governance question it answers: why did this PR fail, and is the rule that failed it backed by public evidence?

Every first-party AI-slop rule should eventually link to:

- the motivating pattern
- one public source or benchmark signal
- the detector strategy
- examples of legitimate code that should not be flagged

## What Not To Do

- Do not publish leaderboards without pinned versions and a repeatable harness.
- Do not claim a repository is "bad" because of a single scan. Report rule distributions and examples instead.
- Do not tune rules only to make one public report look better.
- Do not use private customer code in public research.
- Do not mix LLM judgment into scanner output. If human review is used, label it separately.
