# Security Policy

## Supported versions

Security reports are accepted for the `main` branch of this repository.

## Reporting a vulnerability

Do **not** open a public issue for security problems.

Please use **GitHub Security Advisories** (private vulnerability reporting) on this repository:

https://github.com/sssaturX/mlaffon-tg-app/security/advisories/new

Include:

- a short description of the issue
- steps to reproduce
- affected paths or endpoints, if known
- impact (data leak, auth bypass, money/coins abuse, and so on)

We will acknowledge the report as soon as reasonably possible.

## Secrets

Never commit real credentials. Use `.env.example` as a template and keep secrets in `apps/api/.env` (local) or the server environment (production).

If you accidentally push a secret, rotate it immediately and treat it as compromised even after history rewrite.
