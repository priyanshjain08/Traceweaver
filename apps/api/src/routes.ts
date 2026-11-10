import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { ingestEventsBody, ingestLogsBody, ingestTracesBody, loginBody, parseLogQuery } from '@traceweaver/shared';
import { env } from './config/env';
import { prisma } from './lib/db';
import { HttpError } from './lib/errors';
import { hashKey, parse, requireAuth, requireIngestAuth, wrap } from './middleware';
import { defaultProject, ingestEvents, ingestLogs, ingestTraces, stats } from './modules/ingest';
import { simulator } from './modules/simulator';
import { runDetection } from './modules/anomaly';
import { buildReport } from './modules/report';

const RANGES: Record<string, number> = { '15m': 15, '1h': 60, '6h': 360, '24h': 1440, '7d': 10080 };
const since = (r?: string) => new Date(Date.now() - (RANGES[r ?? '1h'] ?? 60) * 60_000);
const bucketSecs = (r?: string) => Math.max(30, Math.round(((RANGES[r ?? '1h'] ?? 60) * 60) / 60));
const page = (q: Record<string, unknown>) => {
  const p = z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(200).default(25) }).parse(q);
  return { ...p, skip: (p.page - 1) * p.pageSize, take: p.pageSize };
};
const ok = (data: unknown, meta?: unknown) => ({ ok: true, data, meta });

export const router = Router();
router.get('/health', (_req, res) => res.json(ok({ status: 'up' })));

// ---------- auth ----------
router.post('/auth/login', wrap(async (req, res) => {
  const b = parse(loginBody, req.body);
  const u = await prisma.user.findUnique({ where: { email: b.email.toLowerCase() } });
  if (!u || !(await bcrypt.compare(b.password, u.passwordHash))) throw new HttpError(401, 'Invalid email or password');
  const token = jwt.sign({ sub: u.id }, env.JWT_SECRET, { expiresIn: '12h' });
  res.json(ok({ token, user: { id: u.id, email: u.email, name: u.name, role: u.role } }));
}));
router.get('/auth/me', requireAuth, wrap(async (req, res) => {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: req.userId } });
  res.json(ok({ id: u.id, email: u.email, name: u.name, role: u.role }));
}));

// ---------- ingestion ----------
router.post('/ingest/logs', requireIngestAuth, wrap(async (req, res) => { res.status(202).json(ok(await ingestLogs(parse(ingestLogsBody, req.body).logs))); }));
router.post('/ingest/traces', requireIngestAuth, wrap(async (req, res) => { res.status(202).json(ok(await ingestTraces(parse(ingestTracesBody, req.body).traces))); }));
router.post('/ingest/events', requireIngestAuth, wrap(async (req, res) => { res.status(202).json(ok(await ingestEvents(parse(ingestEventsBody, req.body).events))); }));
router.get('/ingest/stats', requireAuth, wrap(async (_req, res) => { res.json(ok(stats)); }));

router.use(requireAuth);

// ---------- traces ----------
router.get('/traces', wrap(async (req, res) => {
  const q = req.query as Record<string, string | undefined>; const pg = page(q);
  const where: Prisma.TraceWhereInput = {
    startTime: { gte: since(q.range) },
    ...(q.service ? { rootService: q.service } : {}),
    ...(q.status === 'ok' || q.status === 'error' ? { status: q.status } : {}),
    ...(q.minDuration ? { durationMs: { gte: Number(q.minDuration) } } : {}),
    ...(q.q ? { OR: [{ traceId: { contains: q.q } }, { operation: { contains: q.q, mode: 'insensitive' } }] } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.trace.findMany({ where, orderBy: { startTime: 'desc' }, skip: pg.skip, take: pg.take }),
    prisma.trace.count({ where }),
  ]);
  res.json(ok(rows, { total, page: pg.page, pageSize: pg.pageSize }));
}));

router.get('/traces/:traceId', wrap(async (req, res) => {
  const t = await prisma.trace.findFirst({ where: { traceId: req.params.traceId }, include: { spans: { include: { service: true }, orderBy: { startTime: 'asc' } } } });
  if (!t) throw new HttpError(404, 'Trace not found');
  const logs = await prisma.log.findMany({ where: { traceId: t.traceId }, include: { service: true }, orderBy: { timestamp: 'asc' }, take: 500 });
  res.json(ok({
    ...t, spans: t.spans.map(({ service, ...s }) => ({ ...s, service: service.name })),
    services: [...new Set(t.spans.map((s) => s.service.name))],
    logs: logs.map(({ service, ...l }) => ({ ...l, service: service.name })),
  }));
}));

// ---------- logs ----------
router.get('/logs', wrap(async (req, res) => {
  const q = req.query as Record<string, string | undefined>; const pg = page(q);
  const parsed = parseLogQuery(q.query ?? '');
  if (!parsed.ok) throw new HttpError(400, parsed.error);
  const where: Prisma.LogWhereInput = { timestamp: { gte: since(q.range) } };
  for (const c of parsed.conditions) {
    if (c.field === 'level') where.level = c.value;
    else if (c.field === 'service') where.service = { name: c.value };
    else if (c.field === 'trace_id') where.traceId = c.value;
    else if (c.field === 'message') where.message = { contains: c.value, mode: 'insensitive' };
    else if (c.field === 'env') where.environment = { name: c.value };
  }
  const dir = q.sort === 'asc' ? 'asc' : 'desc';
  const [rows, total] = await Promise.all([
    prisma.log.findMany({ where, orderBy: { timestamp: dir }, skip: pg.skip, take: pg.take, include: { service: true, environment: true } }),
    prisma.log.count({ where }),
  ]);
  res.json(ok(rows.map(({ service, environment, ...l }) => ({ ...l, service: service.name, environment: environment.name })), { total, page: pg.page, pageSize: pg.pageSize }));
}));

// ---------- events / services ----------
router.get('/events', wrap(async (req, res) => {
  const q = req.query as Record<string, string | undefined>; const pg = page(q);
  const where: Prisma.SystemEventWhereInput = { timestamp: { gte: since(q.range ?? '24h') }, ...(q.type ? { type: q.type } : {}), ...(q.service ? { service: { name: q.service } } : {}) };
  const rows = await prisma.systemEvent.findMany({ where, orderBy: { timestamp: 'desc' }, skip: pg.skip, take: pg.take, include: { service: true } });
  res.json(ok(rows.map(({ service, ...e }) => ({ ...e, service: service?.name ?? null }))));
}));
router.get('/services', wrap(async (_req, res) => { res.json(ok((await prisma.service.findMany({ orderBy: { name: 'asc' } })).map((s) => s.name))); }));

// ---------- analytics ----------
router.get('/analytics/overview', wrap(async (req, res) => {
  const range = String(req.query.range ?? '1h'); const from = since(range); const bs = bucketSecs(range);
  const [summary] = await prisma.$queryRaw<{ total: number; errors: number; avg: number | null; p95: number | null; p99: number | null }[]>(Prisma.sql`
    SELECT count(*)::int total, count(*) FILTER (WHERE status='error')::int errors, avg("durationMs") avg,
      percentile_cont(0.95) WITHIN GROUP (ORDER BY "durationMs") p95, percentile_cont(0.99) WITHIN GROUP (ORDER BY "durationMs") p99
    FROM "Trace" WHERE "startTime" >= ${from}`);
  const series = await prisma.$queryRaw<{ t: Date; requests: number; errors: number }[]>(Prisma.sql`
    SELECT to_timestamp(floor(extract(epoch from "startTime") / ${bs}::double precision) * ${bs}) t, count(*)::int requests, count(*) FILTER (WHERE status='error')::int errors
    FROM "Trace" WHERE "startTime" >= ${from} GROUP BY 1 ORDER BY 1`);
  const hist = await prisma.$queryRaw<{ bucket: number; n: number }[]>(Prisma.sql`
    SELECT width_bucket("durationMs", 0, 1000, 10) bucket, count(*)::int n FROM "Trace" WHERE "startTime" >= ${from} GROUP BY 1 ORDER BY 1`);
  const svc = await prisma.$queryRaw<{ service: string; requests: number; errors: number; avg: number }[]>(Prisma.sql`
    SELECT s.name service, count(*)::int requests, count(*) FILTER (WHERE sp.status='error')::int errors, avg(sp."durationMs") avg
    FROM "Span" sp JOIN "Service" s ON s.id = sp."serviceId" WHERE sp."startTime" >= ${from} GROUP BY 1 ORDER BY 2 DESC`);
  const incidents = await prisma.anomaly.findMany({ where: { detectedAt: { gte: from } }, orderBy: { detectedAt: 'desc' }, take: 5, include: { service: true } });
  const total = summary?.total ?? 0;
  res.json(ok({
    totals: { requests: total, failed: summary?.errors ?? 0, errorRate: total ? (summary!.errors / total) : 0, avgMs: Number(summary?.avg ?? 0), p95: Number(summary?.p95 ?? 0), p99: Number(summary?.p99 ?? 0), activeServices: svc.length },
    series: series.map((s) => ({ t: s.t, requests: s.requests, errorRate: s.requests ? s.errors / s.requests : 0 })),
    latencyHistogram: hist.map((h) => ({ bucketStartMs: (h.bucket - 1) * 100, count: h.n })),
    services: svc.map((s) => ({ ...s, avg: Number(s.avg), errorRate: s.requests ? s.errors / s.requests : 0, health: s.errors / s.requests > 0.2 ? 'unhealthy' : s.errors / s.requests > 0.05 ? 'degraded' : 'healthy' })),
    incidents: incidents.map(({ service, ...a }) => ({ ...a, service: service.name })),
  }));
}));

router.get('/analytics/topology', wrap(async (req, res) => {
  const from = since(String(req.query.range ?? '1h'));
  const edges = await prisma.$queryRaw<{ source: string; target: string; calls: number; errors: number; avg: number }[]>(Prisma.sql`
    SELECT ps.name source, cs.name target, count(*)::int calls, count(*) FILTER (WHERE c.status='error')::int errors, avg(c."durationMs") avg
    FROM "Span" c JOIN "Span" p ON p."traceRef" = c."traceRef" AND p."spanId" = c."parentSpanId"
    JOIN "Service" cs ON cs.id = c."serviceId" JOIN "Service" ps ON ps.id = p."serviceId"
    WHERE c."startTime" >= ${from} AND ps.id <> cs.id GROUP BY 1,2`);
  const nodes = await prisma.$queryRaw<{ service: string; requests: number; errors: number; avg: number }[]>(Prisma.sql`
    SELECT s.name service, count(*)::int requests, count(*) FILTER (WHERE sp.status='error')::int errors, avg(sp."durationMs") avg
    FROM "Span" sp JOIN "Service" s ON s.id = sp."serviceId" WHERE sp."startTime" >= ${from} GROUP BY 1`);
  res.json(ok({
    nodes: nodes.map((n) => { const er = n.requests ? n.errors / n.requests : 0; return { ...n, avg: Number(n.avg), errorRate: er, health: er > 0.2 ? 'unhealthy' : er > 0.05 ? 'degraded' : 'healthy' }; }),
    edges: edges.map((e) => ({ ...e, avg: Number(e.avg), errorRate: e.calls ? e.errors / e.calls : 0 })),
  }));
}));

// ---------- anomalies ----------
router.get('/anomalies', wrap(async (req, res) => {
  const status = req.query.status as string | undefined;
  const rows = await prisma.anomaly.findMany({ where: status ? { status } : {}, orderBy: { detectedAt: 'desc' }, take: 200, include: { service: true } });
  res.json(ok(rows.map(({ service, ...a }) => ({ ...a, service: service.name }))));
}));
router.patch('/anomalies/:id', wrap(async (req, res) => {
  const { status } = parse(z.object({ status: z.enum(['acknowledged', 'resolved']) }), req.body);
  res.json(ok(await prisma.anomaly.update({ where: { id: req.params.id }, data: { status, resolvedAt: status === 'resolved' ? new Date() : null } })));
}));
router.post('/anomalies/run', wrap(async (_req, res) => { res.json(ok(await runDetection())); }));

// ---------- simulator ----------
router.get('/simulator', (_req, res) => res.json(ok(simulator.status())));
router.post('/simulator/:action', wrap(async (req, res) => {
  const a = req.params.action;
  if (a === 'start') return res.json(ok(simulator.start()));
  if (a === 'pause') return res.json(ok(simulator.pause()));
  if (a === 'resume') return res.json(ok(simulator.resume()));
  if (a === 'stop') return res.json(ok(simulator.stop()));
  if (a === 'speed') return res.json(ok(simulator.setSpeed(parse(z.object({ speed: z.number() }), req.body).speed)));
  if (a === 'incident') return res.json(ok(await simulator.triggerIncident(parse(z.object({ on: z.boolean().default(true) }), req.body ?? {}).on)));
  throw new HttpError(404, 'Unknown simulator action');
}));

// ---------- investigations ----------
const invBody = z.object({
  title: z.string().min(1).max(200), description: z.string().max(5000).default(''), severity: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
  traceIds: z.array(z.string()).default([]), logIds: z.array(z.string()).default([]), eventIds: z.array(z.string()).default([]), anomalyIds: z.array(z.string()).default([]),
});
router.get('/investigations', wrap(async (_req, res) => { res.json(ok(await prisma.investigation.findMany({ orderBy: { createdAt: 'desc' } }))); }));
router.post('/investigations', wrap(async (req, res) => {
  const b = parse(invBody, req.body); const p = await defaultProject();
  res.status(201).json(ok(await prisma.investigation.create({ data: { ...b, projectId: p.id, createdById: req.userId! } })));
}));
router.get('/investigations/:id', wrap(async (req, res) => {
  const i = await prisma.investigation.findUnique({ where: { id: req.params.id }, include: { notes: { orderBy: { createdAt: 'asc' } } } });
  if (!i) throw new HttpError(404, 'Investigation not found'); res.json(ok(i));
}));
router.patch('/investigations/:id', wrap(async (req, res) => {
  const b = parse(invBody.partial().extend({ status: z.enum(['open', 'investigating', 'resolved', 'closed']).optional(), rootCause: z.string().max(5000).optional() }), req.body);
  res.json(ok(await prisma.investigation.update({ where: { id: req.params.id }, data: { ...b, ...(b.status === 'closed' ? { closedAt: new Date() } : {}) } })));
}));
router.post('/investigations/:id/notes', wrap(async (req, res) => {
  const b = parse(z.object({ body: z.string().min(1).max(5000) }), req.body);
  res.status(201).json(ok(await prisma.investigationNote.create({ data: { investigationId: req.params.id, body: b.body } })));
}));
router.get('/investigations/:id/report.md', wrap(async (req, res) => {
  const md = await buildReport(req.params.id);
  res.setHeader('Content-Type', 'text/markdown; charset=utf-8').setHeader('Content-Disposition', `attachment; filename="investigation-${req.params.id}.md"`).send(md);
}));

// ---------- data sources ----------
router.get('/data-sources', wrap(async (_req, res) => {
  const ds = await prisma.dataSource.findMany({ include: { credentials: { select: { id: true, prefix: true, createdAt: true, revokedAt: true, lastUsedAt: true } } }, orderBy: { createdAt: 'asc' } });
  res.json(ok(ds));
}));
router.post('/data-sources', wrap(async (req, res) => {
  const b = parse(z.object({ name: z.string().min(1).max(80), description: z.string().max(500).optional() }), req.body); const p = await defaultProject();
  res.status(201).json(ok(await prisma.dataSource.create({ data: { ...b, projectId: p.id } })));
}));
router.patch('/data-sources/:id', wrap(async (req, res) => {
  const b = parse(z.object({ name: z.string().min(1).max(80).optional(), description: z.string().max(500).optional() }), req.body);
  res.json(ok(await prisma.dataSource.update({ where: { id: req.params.id }, data: b })));
}));
router.post('/data-sources/:id/keys', wrap(async (req, res) => {
  const key = `tw_${crypto.randomBytes(24).toString('hex')}`;
  const c = await prisma.apiCredential.create({ data: { dataSourceId: req.params.id, prefix: key.slice(0, 8), keyHash: hashKey(key) } });
  res.status(201).json(ok({ id: c.id, key, note: 'Store this key now. It cannot be shown again.' }));
}));
router.delete('/data-sources/keys/:id', wrap(async (req, res) => {
  await prisma.apiCredential.update({ where: { id: req.params.id }, data: { revokedAt: new Date() } }); res.json(ok({ revoked: true }));
}));
