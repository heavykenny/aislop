# tools/jb

This directory holds aislop's bundled ReSharper/JetBrains settings for the
`jb inspectcode` pass. The settings file is passed via `--settings` when
`resolveBundledJbSettings()` finds it, allowing aislop to layer controlled
suppressions and patterns on top of the jb defaults.

## aislop.DotSettings

Currently ships one entry:

- **InconsistentNaming suppression** (`DO_NOT_SHOW`): The `InconsistentNaming`
  inspection binds to machine-global ReSharper configuration and ignores
  solution-level settings, making its output unreliable and noisy in CLI usage.
  aislop force-suppresses it via this settings file so the inspection count is
  deterministic across machines.
