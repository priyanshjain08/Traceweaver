# TraceWeaver

Distributed-system investigation platform: correlate **traces**, **logs** and **events**, explore service dependencies, detect anomalies with transparent rules, and ingest data over REST or from a built-in demo simulator.

> **Status: working vertical slice (v0.1).** See [Implemented](#implemented) and [Not yet implemented](#not-yet-implemented). This code was written without network access, so `npm install`, type checking, and tests have **not been run yet**. Run the verification steps below and report any errors.

## Implemented
- **Auth**: JWT login (bcrypt hashes), protected API, authenticated Socket.IO.
- **Ingestion** (`POST /api/ingest/{logs,traces,events}`): Zod-validated, batched (max 1000 logs / 200 traces / 500 events), 2 MB body limit, rate limited, API-key (SHA-256 hashed) or JWT auth, stats at `GET /api/ingest/stats`. Versioned schemas in `packages/shared`.
- **Traces**: list with search, service/status/duration/time filters, pagination; detail view with span waterfall (ok / slow / error), span panel, associated logs, jump to logs by `trace_id`.
- **Logs**: query language (`level:error service:x trace_id:abc message:"connection timeout" env:production`) with inline validation errors, sorting, pagination, Monaco JSON viewer, copy JSON/trace ID, open trace.
- **Service map**: React Flow topology computed from parent/child spans across services; node health, request/error/latency stats, edge traffic width, failing edges highlighted, service side panel with failing traces.
- **Overview**: totals, P95/P99, request volume, error rate, latency histogram, service health, anomalies, live trace feed (Socket.IO). All computed from the database via SQL.
- **Anomaly detection**: pure, unit-tested rules (error-rate spike, latency vs baseline, unusual volume, repeated failures, failed-span increase) with explanations, thresholds and related trace IDs; acknowledge/resolve API.
- **Simulator**: start/pause/resume/stop, speed, trigger/clear incident; all records flagged `isDemo`.
- **Investigations API**: create, update status/root cause, attach traces/logs/events/anomalies, notes, Markdown report download.
- **Data sources**: create, generate API key (shown once), revoke, JSON upload.

## Not yet implemented
Events timeline page, Anomalies/history page, Investigations UI, Alerts (rules/history/notification center), Settings page, PDF export, global search, Playwright E2E tests, React component tests beyond the span-ordering unit test, alert evaluation engine. The `AlertRule` table and the investigation/anomaly/event APIs exist; the UI and alert evaluation do not.

## Quick start (Windows / macOS / Linux)
Prerequisites: Node 20+, Docker Desktop.
```bash
npm install
copy .env.example .env        # Windows (cmd); use `cp` on macOS/Linux, then edit JWT_SECRET
npm run db:up                 # PostgreSQL via Docker
npm run db:generate
npm run db:migrate -- --name init
npm run db:seed               # demo user + ~600 traces, logs, events, anomalies
npm run dev                   # API :4000, web :5173
```
Login: `admin@traceweaver.dev` / `traceweaver` (change for any non-local use). Open http://localhost:5173, go to **Data Sources → Start** for live data.

`.env` must also be readable by the API: if Prisma cannot find `DATABASE_URL`, copy `.env` to `apps/api/.env`.

## Verification
```bash
npm run typecheck
npm test            # shared (query parser, schemas), api (anomaly rules, auth/validation), web (span ordering)
npm run build
```
`apps/api/tests/api.test.ts` only exercises routes that do not need data, but the app imports Prisma so `npm run db:generate` must run first.

## Ingestion example
```bash
curl -X POST http://localhost:4000/api/ingest/logs -H "x-api-key: tw_..." -H "Content-Type: application/json" \
  -d '{"logs":[{"timestamp":"2026-11-10T10:00:00Z","level":"error","service":"payment-service","message":"connection timeout","traceId":"abc123"}]}'
```
Trace payload: `{"traces":[{"traceId":"t1","spans":[{"spanId":"s1","service":"api-gateway","operation":"GET /","startTime":"...","endTime":"..."}]}]}`. Spans use `parentSpanId` to form the tree.

## Architecture
See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Security notes
Helmet, CORS allow-list, JWT auth, rate limiting, Zod validation everywhere, API keys stored only as SHA-256 hashes, no stack traces in error responses. The demo seed password is for local use only. JWT is kept in localStorage in this version; move to httpOnly cookies for production.

## License
MIT
