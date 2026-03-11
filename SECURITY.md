# Security Policy

## Supported versions

| Version | Supported |
|---|---|
| 0.1.x | Yes |

## Reporting a vulnerability

If you discover a security vulnerability in aislop, please report it responsibly.

**Do not open a public issue.**

Instead, email **security concerns** by opening a private advisory on GitHub:

1. Go to https://github.com/heavykenny/aislop/security/advisories
2. Click "New draft security advisory"
3. Fill in the details

Alternatively, you can email the maintainer directly via their GitHub profile.

We will acknowledge your report within 48 hours and aim to release a fix within 7 days for critical issues.

## What counts as a vulnerability

- aislop executing arbitrary code from scanned files (command injection)
- aislop leaking secrets it discovers during scanning
- Dependency vulnerabilities in aislop's own supply chain
- Bypass of security rules that would allow dangerous patterns to go undetected

## What does not count

- False positives or false negatives in detection rules (open a regular issue)
- Vulnerabilities in the projects aislop scans (that's for the project owner to fix)
