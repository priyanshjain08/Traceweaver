import { prisma } from '../lib/db';
import { HttpError } from '../lib/errors';

export async function buildReport(id: string): Promise<string> {
  const inv = await prisma.investigation.findUnique({ where: { id }, include: { notes: { orderBy: { createdAt: 'asc' } }, createdBy: true } });
  if (!inv) throw new HttpError(404, 'Investigation not found');
  const [traces, logs, events, anomalies] = await Promise.all([
    prisma.trace.findMany({ where: { traceId: { in: inv.traceIds } }, include: { spans: { include: { service: true } } } }),
    prisma.log.findMany({ where: { id: { in: inv.logIds } }, include: { service: true }, orderBy: { timestamp: 'asc' } }),
    prisma.systemEvent.findMany({ where: { id: { in: inv.eventIds } }, include: { service: true }, orderBy: { timestamp: 'asc' } }),
    prisma.anomaly.findMany({ where: { id: { in: inv.anomalyIds } }, include: { service: true } }),
  ]);
  const services = new Set<string>();
  traces.forEach((t) => t.spans.forEach((s) => services.add(s.service.name)));
  logs.forEach((l) => services.add(l.service.name)); anomalies.forEach((a) => services.add(a.service.name));
  const L: string[] = [];
  L.push(`# Investigation Report: ${inv.title}`, '', `| Field | Value |`, `|---|---|`,
    `| ID | ${inv.id} |`, `| Severity | ${inv.severity} |`, `| Status | ${inv.status} |`, `| Created | ${inv.createdAt.toISOString()} |`,
    `| Closed | ${inv.closedAt?.toISOString() ?? '-'} |`, `| Owner | ${inv.createdBy.name} |`, '',
    '## Summary', '', inv.description || '_No description provided._', '',
    '## Affected services', '', ...(services.size ? [...services].sort().map((s) => `- ${s}`) : ['_None recorded._']), '',
    '## Important traces', '', ...(traces.length ? traces.map((t) => `- \`${t.traceId}\` ${t.rootService} ${t.operation}, ${t.durationMs.toFixed(0)} ms, ${t.status}, ${t.spanCount} spans`) : ['_None attached._']), '',
    '## Related logs', '', ...(logs.length ? logs.map((l) => `- ${l.timestamp.toISOString()} [${l.level}] ${l.service.name}: ${l.message}`) : ['_None attached._']), '',
    '## Relevant events', '', ...(events.length ? events.map((e) => `- ${e.timestamp.toISOString()} (${e.type}) ${e.service?.name ?? 'system'}: ${e.title}`) : ['_None attached._']), '',
    '## Detected anomalies', '', ...(anomalies.length ? anomalies.map((a) => `- ${a.detectedAt.toISOString()} ${a.type} on ${a.service.name} (${a.severity}): ${a.explanation}`) : ['_None attached._']), '',
    '## Investigation notes', '', ...(inv.notes.length ? inv.notes.map((n) => `- ${n.createdAt.toISOString()}: ${n.body}`) : ['_No notes._']), '',
    '## Root cause', '', inv.rootCause || '_Not yet determined._', '');
  return L.join('\n');
}
