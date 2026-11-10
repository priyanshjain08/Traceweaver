import { z } from 'zod';

/** Ingestion schema version. Bump on breaking changes. */
export const SCHEMA_VERSION = 'v1' as const;

export const SEVERITIES = ['debug', 'info', 'warn', 'error', 'fatal'] as const;
export const severitySchema = z.enum(SEVERITIES);
export type Severity = z.infer<typeof severitySchema>;

export const spanStatusSchema = z.enum(['ok', 'error']);
export type SpanStatus = z.infer<typeof spanStatusSchema>;

export const EVENT_TYPES = [
  'application_error', 'deployment', 'config_change', 'service_restart', 'performance_anomaly', 'custom',
] as const;
export const eventTypeSchema = z.enum(EVENT_TYPES);
export type EventType = z.infer<typeof eventTypeSchema>;

const attrs = z.record(z.unknown()).default({});
const envName = z.string().min(1).max(60).default('production');

export const logInputSchema = z.object({
  timestamp: z.coerce.date(),
  level: severitySchema,
  service: z.string().min(1).max(100),
  message: z.string().min(1).max(10_000),
  traceId: z.string().min(1).max(64).optional(),
  spanId: z.string().min(1).max(32).optional(),
  environment: envName,
  attributes: attrs,
});
export type LogInput = z.infer<typeof logInputSchema>;

export const spanInputSchema = z
  .object({
    spanId: z.string().min(1).max(32),
    parentSpanId: z.string().min(1).max(32).optional(),
    service: z.string().min(1).max(100),
    operation: z.string().min(1).max(200),
    startTime: z.coerce.date(),
    endTime: z.coerce.date(),
    status: spanStatusSchema.default('ok'),
    attributes: attrs,
  })
  .refine((s) => s.endTime.getTime() >= s.startTime.getTime(), { message: 'endTime must be >= startTime', path: ['endTime'] });
export type SpanInput = z.infer<typeof spanInputSchema>;

export const traceInputSchema = z.object({
  traceId: z.string().min(1).max(64),
  environment: envName,
  spans: z.array(spanInputSchema).min(1).max(1000),
});
export type TraceInput = z.infer<typeof traceInputSchema>;

export const eventInputSchema = z.object({
  timestamp: z.coerce.date(),
  type: eventTypeSchema,
  severity: severitySchema.default('info'),
  service: z.string().min(1).max(100).optional(),
  title: z.string().min(1).max(300),
  description: z.string().max(5000).optional(),
  environment: envName,
  metadata: attrs,
});
export type EventInput = z.infer<typeof eventInputSchema>;

export const ingestLogsBody = z.object({ logs: z.array(logInputSchema).min(1).max(1000) });
export const ingestTracesBody = z.object({ traces: z.array(traceInputSchema).min(1).max(200) });
export const ingestEventsBody = z.object({ events: z.array(eventInputSchema).min(1).max(500) });

export const loginBody = z.object({ email: z.string().email(), password: z.string().min(1).max(200) });

/** Socket.IO event names shared by server and client. */
export const SOCKET_EVENTS = { trace: 'trace:new', log: 'log:new', event: 'event:new', anomaly: 'anomaly:new', sim: 'sim:status' } as const;

// ---------- Log query language ----------
export const QUERY_FIELDS = ['level', 'service', 'trace_id', 'message', 'env'] as const;
export type QueryField = (typeof QUERY_FIELDS)[number];
export interface QueryCondition { field: QueryField; value: string }
export type ParseResult = { ok: true; conditions: QueryCondition[] } | { ok: false; error: string };

/**
 * Parses `field:value` tokens separated by whitespace. Values containing spaces must be quoted:
 *   level:error service:payment-service message:"connection timeout"
 * Multiple conditions are combined with AND. Repeating a field is rejected.
 */
export function parseLogQuery(input: string): ParseResult {
  const conditions: QueryCondition[] = [];
  const seen = new Set<string>();
  let i = 0;
  const s = input.trim();
  while (i < s.length) {
    while (i < s.length && /\s/.test(s[i]!)) i++;
    if (i >= s.length) break;
    const colon = s.indexOf(':', i);
    const wsAfter = s.slice(i).search(/\s/);
    if (colon === -1 || (wsAfter !== -1 && i + wsAfter < colon)) {
      return { ok: false, error: `Expected field:value near "${s.slice(i, i + 20)}". Example: level:error` };
    }
    const field = s.slice(i, colon);
    if (!(QUERY_FIELDS as readonly string[]).includes(field)) {
      return { ok: false, error: `Unknown field "${field}". Supported fields: ${QUERY_FIELDS.join(', ')}` };
    }
    if (seen.has(field)) return { ok: false, error: `Field "${field}" used more than once` };
    i = colon + 1;
    let value = '';
    if (s[i] === '"') {
      const end = s.indexOf('"', i + 1);
      if (end === -1) return { ok: false, error: `Unterminated quote for field "${field}"` };
      value = s.slice(i + 1, end);
      i = end + 1;
    } else {
      const m = /^\S*/.exec(s.slice(i));
      value = m ? m[0] : '';
      i += value.length;
    }
    if (!value) return { ok: false, error: `Missing value for field "${field}"` };
    if (field === 'level' && !(SEVERITIES as readonly string[]).includes(value)) {
      return { ok: false, error: `Invalid level "${value}". Use one of: ${SEVERITIES.join(', ')}` };
    }
    seen.add(field);
    conditions.push({ field: field as QueryField, value });
  }
  return { ok: true, conditions };
}
