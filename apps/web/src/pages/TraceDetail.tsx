import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { api, fmtMs } from '../lib/api';
import { Badge, ErrorBox, Loading, levelTone } from '../components/ui';

interface Span { id: string; spanId: string; parentSpanId: string | null; service: string; operation: string; startTime: string; endTime: string; durationMs: number; status: string; attributes: Record<string, unknown> }
interface LogRow { id: string; timestamp: string; level: string; service: string; message: string; spanId: string | null }
interface Detail { traceId: string; rootService: string; operation: string; durationMs: number; status: string; spanCount: number; startTime: string; services: string[]; spans: Span[]; logs: LogRow[] }

/** Orders spans depth-first so children render under parents. */
export function orderSpans(spans: Span[]): (Span & { depth: number })[] {
  const ids = new Set(spans.map((s) => s.spanId)); const kids = new Map<string, Span[]>(); const roots: Span[] = [];
  for (const s of spans) { if (s.parentSpanId && ids.has(s.parentSpanId)) kids.set(s.parentSpanId, [...(kids.get(s.parentSpanId) ?? []), s]); else roots.push(s); }
  const out: (Span & { depth: number })[] = [];
  const walk = (s: Span, depth: number) => { out.push({ ...s, depth }); (kids.get(s.spanId) ?? []).sort((a, b) => +new Date(a.startTime) - +new Date(b.startTime)).forEach((c) => walk(c, depth + 1)); };
  roots.sort((a, b) => +new Date(a.startTime) - +new Date(b.startTime)).forEach((r) => walk(r, 0));
  return out;
}

export default function TraceDetail() {
  const { traceId = '' } = useParams(); const [sel, setSel] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['trace', traceId], queryFn: () => api<Detail>(`/traces/${traceId}`).then((r) => r.data) });
  const rows = useMemo(() => (q.data ? orderSpans(q.data.spans) : []), [q.data]);
  if (q.isLoading) return <Loading />; if (q.error) return <ErrorBox error={q.error} />;
  const t = q.data!; const t0 = new Date(t.startTime).getTime(); const total = Math.max(t.durationMs, 1);
  const span = rows.find((s) => s.spanId === sel); const slowCut = total * 0.4;
  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap items-center gap-x-6 gap-y-2 p-3 text-sm">
        <span className="font-mono">{t.traceId}</span><Badge tone={t.status === 'ok' ? 'ok' : 'error'}>{t.status}</Badge><span>{fmtMs(t.durationMs)}</span><span>{t.spanCount} spans</span><span className="text-slate-500">{t.services.join(', ')}</span>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="card overflow-x-auto p-3 lg:col-span-2">
          <h2 className="mb-2 text-sm font-medium">Span waterfall</h2>
          {rows.map((s) => {
            const left = ((new Date(s.startTime).getTime() - t0) / total) * 100; const width = Math.max((s.durationMs / total) * 100, 0.8);
            const color = s.status === 'error' ? 'bg-red-500' : s.durationMs > slowCut ? 'bg-amber-500' : 'bg-cyan-500';
            return (
              <button key={s.spanId} onClick={() => setSel(s.spanId)} className={`grid w-full grid-cols-[220px_1fr] items-center gap-2 rounded px-1 py-1 text-left text-xs hover:bg-slate-100 dark:hover:bg-ink-800 ${sel === s.spanId ? 'bg-blue-600/15' : ''}`}>
                <span className="truncate" style={{ paddingLeft: s.depth * 12 }}>{s.service} <span className="text-slate-500">{s.operation}</span></span>
                <span className="relative h-4 rounded bg-slate-100 dark:bg-ink-800"><span className={`absolute top-0 h-4 rounded ${color}`} style={{ left: `${left}%`, width: `${width}%` }} title={fmtMs(s.durationMs)} /></span>
              </button>);
          })}
          <div className="mt-2 flex gap-3 text-xs text-slate-500"><span><i className="mr-1 inline-block h-2 w-2 rounded bg-cyan-500" />ok</span><span><i className="mr-1 inline-block h-2 w-2 rounded bg-amber-500" />slow</span><span><i className="mr-1 inline-block h-2 w-2 rounded bg-red-500" />error</span></div>
        </div>
        <div className="card p-3 text-sm">
          <h2 className="mb-2 text-sm font-medium">Span details</h2>
          {!span ? <p className="text-slate-500">Select a span in the waterfall.</p> : (
            <dl className="space-y-1.5 break-all">
              {([['Span ID', span.spanId], ['Parent', span.parentSpanId ?? '—'], ['Trace ID', t.traceId], ['Service', span.service], ['Operation', span.operation], ['Start', span.startTime], ['End', span.endTime], ['Duration', fmtMs(span.durationMs)], ['Status', span.status]] as const).map(([k, v]) => <div key={k}><dt className="text-xs text-slate-500">{k}</dt><dd className="font-mono text-xs">{v}</dd></div>)}
              <div><dt className="text-xs text-slate-500">Attributes</dt><dd><pre className="overflow-auto rounded bg-slate-100 p-2 text-xs dark:bg-ink-800">{JSON.stringify(span.attributes, null, 2)}</pre></dd></div>
              <Link className="btn mt-2" to={`/logs?query=${encodeURIComponent(`trace_id:${t.traceId}`)}`}>View related logs</Link>
            </dl>)}
        </div>
      </div>
      <div className="card p-3"><h2 className="mb-2 text-sm font-medium">Associated logs {sel ? '(selected span highlighted)' : ''}</h2>
        {t.logs.length === 0 ? <p className="text-sm text-slate-500">No logs for this trace.</p> : t.logs.map((l) => <div key={l.id} className={`flex gap-3 border-t border-slate-200 py-1 text-xs dark:border-ink-700 ${sel && l.spanId === sel ? 'bg-blue-600/15' : ''}`}><span className="text-slate-500">{new Date(l.timestamp).toLocaleTimeString()}</span><Badge tone={levelTone(l.level)}>{l.level}</Badge><span>{l.service}</span><span>{l.message}</span></div>)}</div>
    </div>
  );
}
