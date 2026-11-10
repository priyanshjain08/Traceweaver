import type { EventInput, LogInput, TraceInput } from '@traceweaver/shared';
import { prisma } from '../lib/db';
import { bus } from '../lib/bus';
import { SOCKET_EVENTS } from '@traceweaver/shared';

export const stats = { logs: 0, traces: 0, events: 0, rejected: 0, since: new Date() };

export async function defaultProject() {
  return prisma.project.upsert({ where: { name: 'default' }, update: {}, create: { name: 'default' } });
}
export async function envId(projectId: string, name: string) {
  const e = await prisma.environment.upsert({ where: { projectId_name: { projectId, name } }, update: {}, create: { projectId, name } });
  return e.id;
}
export async function serviceId(projectId: string, name: string) {
  const s = await prisma.service.upsert({ where: { projectId_name: { projectId, name } }, update: {}, create: { projectId, name } });
  return s.id;
}

export async function ingestLogs(logs: LogInput[], isDemo = false) {
  const p = await defaultProject();
  const rows = [];
  for (const l of logs) {
    rows.push({
      environmentId: await envId(p.id, l.environment), serviceId: await serviceId(p.id, l.service),
      timestamp: l.timestamp, level: l.level, message: l.message, traceId: l.traceId, spanId: l.spanId,
      attributes: l.attributes as object, isDemo,
    });
  }
  await prisma.log.createMany({ data: rows });
  stats.logs += rows.length;
  bus.emit(SOCKET_EVENTS.log, logs.slice(-20));
  return { accepted: rows.length };
}

export async function ingestTraces(traces: TraceInput[], isDemo = false) {
  const p = await defaultProject();
  let accepted = 0; const duplicates: string[] = [];
  for (const t of traces) {
    const environmentId = await envId(p.id, t.environment);
    const exists = await prisma.trace.findUnique({ where: { environmentId_traceId: { environmentId, traceId: t.traceId } }, select: { id: true } });
    if (exists) { duplicates.push(t.traceId); continue; }
    const ids = new Map<string, string>();
    for (const s of t.spans) if (!ids.has(s.service)) ids.set(s.service, await serviceId(p.id, s.service));
    const spanIds = new Set(t.spans.map((s) => s.spanId));
    const root = [...t.spans].sort((a, b) => a.startTime.getTime() - b.startTime.getTime())
      .find((s) => !s.parentSpanId || !spanIds.has(s.parentSpanId)) ?? t.spans[0]!;
    const start = Math.min(...t.spans.map((s) => s.startTime.getTime()));
    const end = Math.max(...t.spans.map((s) => s.endTime.getTime()));
    const failed = t.spans.some((s) => s.status === 'error');
    const trace = await prisma.trace.create({
      data: {
        traceId: t.traceId, environmentId, rootService: root.service, operation: root.operation,
        startTime: new Date(start), durationMs: end - start, status: failed ? 'error' : 'ok', spanCount: t.spans.length, isDemo,
        spans: { create: t.spans.map((s) => ({
          spanId: s.spanId, parentSpanId: s.parentSpanId, serviceId: ids.get(s.service)!, operation: s.operation,
          startTime: s.startTime, endTime: s.endTime, durationMs: s.endTime.getTime() - s.startTime.getTime(),
          status: s.status, attributes: s.attributes as object,
        })) },
      },
    });
    accepted++;
    bus.emit(SOCKET_EVENTS.trace, { traceId: trace.traceId, rootService: trace.rootService, operation: trace.operation, durationMs: trace.durationMs, status: trace.status, startTime: trace.startTime, isDemo });
  }
  stats.traces += accepted;
  return { accepted, duplicates };
}

export async function ingestEvents(events: EventInput[], isDemo = false) {
  const p = await defaultProject();
  const rows = [];
  for (const e of events) {
    rows.push({
      environmentId: await envId(p.id, e.environment), serviceId: e.service ? await serviceId(p.id, e.service) : null,
      timestamp: e.timestamp, type: e.type, severity: e.severity, title: e.title, description: e.description,
      metadata: e.metadata as object, isDemo,
    });
  }
  await prisma.systemEvent.createMany({ data: rows });
  stats.events += rows.length;
  bus.emit(SOCKET_EVENTS.event, events.slice(-10));
  return { accepted: rows.length };
}
