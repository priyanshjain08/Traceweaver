import { Prisma } from '@prisma/client';
import { prisma } from '../lib/db';
import { bus } from '../lib/bus';
import { SOCKET_EVENTS } from '@traceweaver/shared';

export interface WindowStats { service: string; requests: number; errors: number; p95: number; failedSpans: number }
export interface Thresholds {
  errorRateAbs: number;       // current error rate (0-1) must exceed this ...
  errorRateRise: number;      // ... and exceed baseline by this absolute amount
  latencyFactor: number;      // p95 > baseline p95 * factor
  volumeFactor: number;       // requests (normalised) deviate by this factor from baseline
  repeatedFailures: number;   // >= N errors in the window
  minRequests: number;        // ignore windows with fewer requests
}
export const DEFAULT_THRESHOLDS: Thresholds = { errorRateAbs: 0.2, errorRateRise: 0.1, latencyFactor: 2, volumeFactor: 3, repeatedFailures: 10, minRequests: 8 };

export interface Finding {
  type: 'error_rate_spike' | 'latency_increase' | 'unusual_volume' | 'repeated_failures' | 'failed_span_increase';
  service: string; severity: 'low' | 'medium' | 'high' | 'critical'; measured: number; threshold: number; explanation: string;
}

/**
 * Pure rule evaluation: compares the current window with a baseline window.
 * `windowRatio` = current window length / baseline window length, used to normalise volume.
 */
export function detect(current: WindowStats[], baseline: WindowStats[], t: Thresholds = DEFAULT_THRESHOLDS, windowRatio = 1): Finding[] {
  const out: Finding[] = [];
  const base = new Map(baseline.map((b) => [b.service, b]));
  for (const c of current) {
    const b = base.get(c.service);
    const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
    if (c.requests >= t.minRequests) {
      const rate = c.errors / c.requests;
      const bRate = b && b.requests > 0 ? b.errors / b.requests : 0;
      if (rate > t.errorRateAbs && rate - bRate > t.errorRateRise) {
        out.push({ type: 'error_rate_spike', service: c.service, severity: rate > 0.5 ? 'critical' : 'high', measured: rate, threshold: t.errorRateAbs,
          explanation: `Error rate is ${pct(rate)} (baseline ${pct(bRate)}), above the ${pct(t.errorRateAbs)} threshold.` });
      }
      if (b && b.p95 > 0 && c.p95 > b.p95 * t.latencyFactor) {
        out.push({ type: 'latency_increase', service: c.service, severity: c.p95 > b.p95 * t.latencyFactor * 2 ? 'high' : 'medium', measured: c.p95, threshold: b.p95 * t.latencyFactor,
          explanation: `p95 latency is ${c.p95.toFixed(0)}ms vs baseline ${b.p95.toFixed(0)}ms (limit ${t.latencyFactor}x baseline).` });
      }
      if (b && b.requests >= t.minRequests) {
        const expected = b.requests * windowRatio;
        if (c.requests > expected * t.volumeFactor || c.requests < expected / t.volumeFactor) {
          out.push({ type: 'unusual_volume', service: c.service, severity: 'medium', measured: c.requests, threshold: expected,
            explanation: `Request volume is ${c.requests} vs ~${expected.toFixed(0)} expected for this window (deviation > ${t.volumeFactor}x).` });
        }
      }
    }
    if (c.errors >= t.repeatedFailures) {
      out.push({ type: 'repeated_failures', service: c.service, severity: 'high', measured: c.errors, threshold: t.repeatedFailures,
        explanation: `${c.errors} failed requests in the window (threshold ${t.repeatedFailures}).` });
    }
    const bFailed = (b?.failedSpans ?? 0) * windowRatio;
    if (c.failedSpans >= t.repeatedFailures && c.failedSpans > bFailed * 3) {
      out.push({ type: 'failed_span_increase', service: c.service, severity: 'medium', measured: c.failedSpans, threshold: Math.max(bFailed * 3, t.repeatedFailures),
        explanation: `${c.failedSpans} failed spans vs ~${bFailed.toFixed(0)} expected (baseline-adjusted).` });
    }
  }
  return out;
}

async function windowStats(from: Date, to: Date): Promise<WindowStats[]> {
  const rows = await prisma.$queryRaw<{ service: string; requests: number; errors: number; p95: number | null; failed: number }[]>(Prisma.sql`
    SELECT s.name AS service, count(*)::int AS requests,
      count(*) FILTER (WHERE sp.status = 'error')::int AS errors,
      percentile_cont(0.95) WITHIN GROUP (ORDER BY sp."durationMs") AS p95,
      count(*) FILTER (WHERE sp.status = 'error')::int AS failed
    FROM "Span" sp JOIN "Service" s ON s.id = sp."serviceId"
    WHERE sp."startTime" >= ${from} AND sp."startTime" < ${to}
    GROUP BY s.name`);
  return rows.map((r) => ({ service: r.service, requests: r.requests, errors: r.errors, p95: Number(r.p95 ?? 0), failedSpans: r.failed }));
}

export async function runDetection(now = new Date(), currentMins = 2, baselineMins = 20, t = DEFAULT_THRESHOLDS) {
  const curFrom = new Date(now.getTime() - currentMins * 60_000);
  const baseFrom = new Date(curFrom.getTime() - baselineMins * 60_000);
  const [cur, base] = await Promise.all([windowStats(curFrom, now), windowStats(baseFrom, curFrom)]);
  const findings = detect(cur, base, t, currentMins / baselineMins);
  const created = [];
  for (const f of findings) {
    const svc = await prisma.service.findFirst({ where: { name: f.service } });
    if (!svc) continue;
    const recent = await prisma.anomaly.findFirst({ where: { serviceId: svc.id, type: f.type, status: { not: 'resolved' }, detectedAt: { gte: new Date(now.getTime() - 5 * 60_000) } } });
    if (recent) continue;
    const bad = await prisma.trace.findMany({ where: { startTime: { gte: curFrom }, status: 'error', spans: { some: { serviceId: svc.id, status: 'error' } } }, select: { traceId: true }, take: 10, orderBy: { startTime: 'desc' } });
    const a = await prisma.anomaly.create({ data: { type: f.type, serviceId: svc.id, severity: f.severity, measured: f.measured, threshold: f.threshold, explanation: f.explanation, traceIds: bad.map((b) => b.traceId) } });
    created.push(a);
    bus.emit(SOCKET_EVENTS.anomaly, { ...a, service: f.service });
  }
  return created;
}
