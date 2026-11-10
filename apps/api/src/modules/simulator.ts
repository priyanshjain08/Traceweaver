import crypto from 'node:crypto';
import type { LogInput, SpanInput, TraceInput, EventInput } from '@traceweaver/shared';
import { SOCKET_EVENTS } from '@traceweaver/shared';
import { bus } from '../lib/bus';
import { ingestEvents, ingestLogs, ingestTraces } from './ingest';
import { runDetection } from './anomaly';

interface Node { service: string; op: string; base: number; children?: Node[] }
const db = (op: string, base = 12): Node => ({ service: 'database-service', op, base });
const FLOWS: { weight: number; root: Node }[] = [
  { weight: 5, root: { service: 'api-gateway', op: 'GET /api/profile', base: 4, children: [{ service: 'authentication-service', op: 'validate_token', base: 8 }, { service: 'user-service', op: 'get_user', base: 10, children: [db('SELECT users')] }] } },
  { weight: 3, root: { service: 'api-gateway', op: 'GET /api/products', base: 4, children: [{ service: 'authentication-service', op: 'validate_token', base: 8 }, { service: 'inventory-service', op: 'list_stock', base: 14, children: [db('SELECT inventory', 18)] }] } },
  { weight: 3, root: { service: 'api-gateway', op: 'POST /api/checkout', base: 6, children: [
    { service: 'authentication-service', op: 'validate_token', base: 8 },
    { service: 'inventory-service', op: 'reserve_stock', base: 12, children: [db('UPDATE inventory')] },
    { service: 'payment-service', op: 'charge_card', base: 60, children: [db('INSERT payments', 15)] },
    { service: 'notification-service', op: 'send_receipt', base: 20 } ] } },
];
const BASE_ERR: Record<string, number> = { 'payment-service': 0.02, 'database-service': 0.005 };
const rid = (n: number) => crypto.randomBytes(n).toString('hex');
const jitter = (b: number) => b * (0.6 + Math.random() * 0.9);

export function generateTrace(at: Date, incident: boolean): { trace: TraceInput; logs: LogInput[] } {
  const total = FLOWS.reduce((a, f) => a + f.weight, 0);
  let r = Math.random() * total;
  const flow = FLOWS.find((f) => (r -= f.weight) < 0) ?? FLOWS[0]!;
  const traceId = rid(16);
  const spans: SpanInput[] = []; const logs: LogInput[] = [];
  const errRate = (s: string) => incident && s === 'payment-service' ? 0.6 : BASE_ERR[s] ?? 0.01;
  const latMult = (s: string) => (incident && s === 'payment-service' ? 6 : incident && s === 'database-service' ? 2.5 : 1);

  const walk = (n: Node, start: number, parent?: string): { end: number; failed: boolean } => {
    const spanId = rid(8); let cursor = start + 1; let childFailed = false;
    for (const c of n.children ?? []) { const res = walk(c, cursor, spanId); cursor = res.end + 1; childFailed ||= res.failed; }
    const end = Math.round(cursor + jitter(n.base) * latMult(n.service));
    const failed = Math.random() < errRate(n.service) || childFailed;
    spans.push({ spanId, parentSpanId: parent, service: n.service, operation: n.op, startTime: new Date(start), endTime: new Date(end), status: failed ? 'error' : 'ok', attributes: { 'demo': true, ...(failed ? { 'error.type': 'upstream_failure' } : {}) } });
    logs.push({ timestamp: new Date(end), level: failed ? 'error' : 'info', service: n.service, traceId, spanId, environment: 'production',
      message: failed ? (n.service === 'payment-service' ? 'connection timeout to payment provider' : `${n.op} failed`) : `${n.op} completed`, attributes: { durationMs: end - start, demo: true } });
    return { end, failed };
  };
  walk(flow.root, at.getTime());
  return { trace: { traceId, environment: 'production', spans }, logs };
}

type State = 'stopped' | 'running' | 'paused';
let state: State = 'stopped'; let speed = 2; let incident = false; let timer: NodeJS.Timeout | null = null; let detector: NodeJS.Timeout | null = null; let generated = 0;
const status = () => ({ state, speed, incident, generated });
const emit = () => bus.emit(SOCKET_EVENTS.sim, status());

async function tick() {
  for (let i = 0; i < speed; i++) {
    const { trace, logs } = generateTrace(new Date(), incident);
    await ingestTraces([trace], true); await ingestLogs(logs, true); generated++;
  }
}
function schedule() { if (timer) clearInterval(timer); timer = setInterval(() => { tick().catch(() => undefined); }, 1000); }

export const simulator = {
  status,
  start() {
    state = 'running'; schedule();
    if (!detector) detector = setInterval(() => { runDetection().catch(() => undefined); }, 15_000);
    emit(); return status();
  },
  pause() { state = 'paused'; if (timer) clearInterval(timer); timer = null; emit(); return status(); },
  resume() { return simulator.start(); },
  stop() {
    state = 'stopped'; incident = false;
    if (timer) clearInterval(timer); if (detector) clearInterval(detector); timer = detector = null; emit(); return status();
  },
  setSpeed(n: number) { speed = Math.min(20, Math.max(1, Math.round(n))); emit(); return status(); },
  async triggerIncident(on = true) {
    incident = on;
    const e: EventInput = on
      ? { timestamp: new Date(), type: 'application_error', severity: 'error', service: 'payment-service', title: 'Payment provider degraded (simulated incident)', environment: 'production', metadata: { demo: true } }
      : { timestamp: new Date(), type: 'custom', severity: 'info', service: 'payment-service', title: 'Simulated incident cleared', environment: 'production', metadata: { demo: true } };
    await ingestEvents([e], true); emit(); return status();
  },
};

/** Backfill historical demo data, with an incident window, for first-run usefulness. */
export async function seedHistory(count = 600, hours = 3) {
  const now = Date.now();
  const incStart = now - 0.6 * 3600_000, incEnd = now - 0.4 * 3600_000;
  for (let i = 0; i < count; i++) {
    const at = new Date(now - Math.random() * hours * 3600_000);
    const { trace, logs } = generateTrace(at, at.getTime() > incStart && at.getTime() < incEnd);
    await ingestTraces([trace], true); await ingestLogs(logs, true);
  }
  await ingestEvents([
    { timestamp: new Date(now - 2.5 * 3600_000), type: 'deployment', severity: 'info', service: 'user-service', title: 'Deployed user-service v2.14.0', environment: 'production', metadata: { version: '2.14.0', demo: true } },
    { timestamp: new Date(incStart - 5 * 60_000), type: 'config_change', severity: 'warn', service: 'payment-service', title: 'Payment provider timeout lowered to 2s', environment: 'production', metadata: { demo: true } },
    { timestamp: new Date(incStart), type: 'application_error', severity: 'error', service: 'payment-service', title: 'Payment provider degraded', environment: 'production', metadata: { demo: true } },
    { timestamp: new Date(incEnd), type: 'service_restart', severity: 'info', service: 'payment-service', title: 'payment-service restarted', environment: 'production', metadata: { demo: true } },
  ], true);
}
