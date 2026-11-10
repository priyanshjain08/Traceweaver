import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api, fmtMs, qs } from '../lib/api';
import { useRange } from '../lib/range';
import { Badge, Empty, ErrorBox, Loading, Pager } from '../components/ui';

export interface TraceRow { id: string; traceId: string; rootService: string; operation: string; durationMs: number; status: string; spanCount: number; startTime: string }

export default function Traces() {
  const range = useRange((s) => s.range);
  const [f, setF] = useState({ q: '', service: '', status: '', minDuration: '', page: 1 });
  const services = useQuery({ queryKey: ['services'], queryFn: () => api<string[]>('/services').then((r) => r.data) });
  const q = useQuery({ queryKey: ['traces', range, f], queryFn: () => api<TraceRow[]>(`/traces?${qs({ ...f, range })}`) });
  const set = (p: Partial<typeof f>) => setF((s) => ({ ...s, ...p, page: p.page ?? 1 }));
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <input className="input w-64" placeholder="Search trace ID or operation" aria-label="Search traces" value={f.q} onChange={(e) => set({ q: e.target.value })} />
        <select className="input" aria-label="Service" value={f.service} onChange={(e) => set({ service: e.target.value })}><option value="">All root services</option>{services.data?.map((s) => <option key={s}>{s}</option>)}</select>
        <select className="input" aria-label="Status" value={f.status} onChange={(e) => set({ status: e.target.value })}><option value="">Any status</option><option value="ok">ok</option><option value="error">error</option></select>
        <input className="input w-36" type="number" min={0} placeholder="Min duration ms" aria-label="Minimum duration" value={f.minDuration} onChange={(e) => set({ minDuration: e.target.value })} />
      </div>
      <div className="card overflow-x-auto">
        {q.isLoading ? <Loading /> : q.error ? <ErrorBox error={q.error} /> : q.data!.data.length === 0 ? <Empty>No traces match these filters.</Empty> : (
          <table className="w-full"><thead><tr>{['Trace ID', 'Root service', 'Operation', 'Duration', 'Status', 'Spans', 'Time'].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead><tbody>
            {q.data!.data.map((t) => <tr key={t.id} className="border-t border-slate-200 hover:bg-slate-100 dark:border-ink-700 dark:hover:bg-ink-800">
              <td className="td font-mono text-xs"><Link className="text-blue-500" to={`/traces/${t.traceId}`}>{t.traceId.slice(0, 12)}…</Link></td><td className="td">{t.rootService}</td><td className="td">{t.operation}</td>
              <td className="td">{fmtMs(t.durationMs)}</td><td className="td"><Badge tone={t.status === 'ok' ? 'ok' : 'error'}>{t.status}</Badge></td><td className="td">{t.spanCount}</td><td className="td text-slate-500">{new Date(t.startTime).toLocaleTimeString()}</td></tr>)}
          </tbody></table>)}
        {q.data?.meta && <Pager page={q.data.meta.page} pageSize={q.data.meta.pageSize} total={q.data.meta.total} onPage={(p) => set({ page: p })} />}
      </div>
    </div>
  );
}
