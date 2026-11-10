# Contributing
1. `npm install`, start Postgres with `npm run db:up`, migrate and seed (see README).
2. Keep TypeScript strict; avoid `any`. Validate input with Zod schemas in `packages/shared`.
3. Run `npm run typecheck && npm test` before opening a PR.
