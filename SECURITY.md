# Security policy

## Reporting a vulnerability

If you've found a vulnerability in IMTN, please report it
**privately** so we can fix it before public disclosure.

**Email**: `security@imtn.io`

**PGP**: not yet published; encrypt to the email address using
[age](https://github.com/FiloSottile/age) if you want at-rest
protection during transit.

Include in the report:

- A clear description of the issue
- Steps to reproduce, with a minimal example
- The affected version / commit SHA
- Any relevant logs or stack traces
- Your assessment of the severity

We will acknowledge receipt within **2 business days** and follow up
with a disposition (accepted / duplicate / not-a-vulnerability) within
**5 business days**.

## Disclosure timeline

We follow a 90-day coordinated disclosure model.

| Day | Milestone |
|---:|---|
| 0 | Report received; private acknowledgement sent |
| 5 | Triage complete; severity assigned (CVSS 3.1) |
| 30 | Fix landed on `main` for high/critical issues |
| 60 | Fix landed for medium/low |
| 90 | Public disclosure via [GHSA](https://github.com/stonyp90/motion/security/advisories), CVE if applicable, credit to the reporter unless they prefer anonymity |

We may publish earlier if a fix is already in users' hands and a
public CVE protects them.

## Safe harbor

We will not pursue legal action against good-faith security research
that:

- Avoids accessing, modifying, or destroying data that isn't yours
- Avoids degrading service for other users (no DoS testing on prod)
- Operates only against your own deployments or the public dev tier
  at `https://mf-dev-75mfz5z7mpzxk-bfbzcagzcffda4e4.z01.azurefd.net`
- Reports privately via the email above
- Gives us a reasonable chance to fix before public disclosure

## Bounty

No paid bug bounty programme yet. We will publicly credit reporters
in the GHSA advisory and release notes unless they prefer anonymity.

## Supported versions

IMTN is pre-1.0; only the latest `main` is supported. Once
we cut `1.0`, we'll support the current major + previous major for
security patches.

| Version | Supported |
|---|---|
| `main` | ✅ |
| `< 1.0` | ⚠ best effort |

## Scope

In scope:

- The `engine/` Rust workspace + Python sidecars
- The `web/` Next.js application
- The `engine/infra/` Bicep templates as deployed in your own Azure
  tenant
- The GitHub Actions workflows under `.github/workflows/`
- The published artefacts: container images on ACR/GHCR, the
  binaries on GitHub Releases (once we ship them), the SDKs on
  npm/PyPI/crates.io

Out of scope:

- Anything in `~/stonyp90-websites/` that isn't `motion/`
- Third-party services we depend on (Azure, GitHub, npm, etc.)
- Social engineering, phishing, physical attacks
- Issues that require root on a user's machine to exploit

## Known security posture

A current snapshot of the architecture's trust boundaries and
mitigations lives in [`THREAT_MODEL.md`](./THREAT_MODEL.md).
