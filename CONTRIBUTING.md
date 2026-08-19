# Contributing

This project is **proprietary**. Publishing the source on GitHub does not grant a right to copy, run, or reuse the product. See [LICENSE](LICENSE).

## Before you open a PR

1. Read [LICENSE](LICENSE). A GitHub fork is allowed only to propose a change back to this repository.
2. Do not copy this codebase into another product, course, or public template.
3. Do not commit secrets, `.env` files, dumps, or production credentials.
4. Keep the change focused. Describe *what* and *why* in the pull request.

## Development

```bash
docker compose up -d
npm install
cp .env.example apps/api/.env
# fill placeholders in apps/api/.env
cd apps/api && npx drizzle-kit push && npm run db:seed && cd ../..
npm run worker -w api   # separate terminal
npm run dev
```

- API: http://localhost:3001
- Web: http://localhost:5173

## Code notes

- TypeScript, no drive-by refactors.
- User-facing copy in the apps is Russian.
- Do not weaken auth, CORS, or rate limits without an explicit reason.

## Issues

Use GitHub issues for bugs and questions that are **not** security-related. Security: [SECURITY.md](SECURITY.md).
