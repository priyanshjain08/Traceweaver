import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import Editor from '@monaco-editor/react';
import { parseLogQuery } from '@traceweaver/shared';
import { api, qs } from '../lib/api';
import { useRange } from '../lib/range';
import { Badge, Empty, ErrorBox, Loading, Pager, levelTone } from '../components/ui';

interface LogRow { id: string; timestamp: string; level: string; service: string; message: string; traceId: string | null; spanId: string | null; environment: string; attributes: Record<string, unknown> }

export default function Logs() {
  const range = useRange((s) => s.range); const [params, setParams] = useSearchParams();
  const applied = params.get('query') ?? ''; const [draft, setDraft] = useState(applied);
  const [pg, setPg] = useState(1); const [sort, setSort] = useState<'asc' | 'desc'>('desc'); const [sel, setSel] = useState<LogRow | null>(null);
  const check = parseLogQuery(draft);
  const q = useQuery({ queryKey: ['logs', range, applied, pg, sort], queryFn: () => api<LogRow[]>(`/logs?${qs({ query: applied, range, page: pg, sort })}`) });
  const submit = () => { if (check.ok) { setParams(draft ? { query: draft } : {}); setPg(1); } };
  return (
    <div className="space-y-3">
      <div>
        <div className="flex gap-2"><input className="input flex-1 font-mono" aria-label="Log query" placeholder='level:error service:payment-service message:"connection timeout"' value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} /><button className="btn btn-primary" onClick={submit} disabled={!check.ok}>Search</button></div>
        {!check.ok ? <p className="mt-1 text-xs text-red-400" role="alert">{check.error}</p> : <p className="mt-1 text-xs text-slate-500">Fields: level, service, trace_id, message, env. Quote values with spaces. Conditions are ANDed.</p>}
      </div>
      <div className="grid gap-4 lg:grid-cols-5">
        <div className={`card overflow-x-auto ${sel ? 'lg:col-span-3' : 'lg:col-span-5'}`}>
          {q.isLoading ? <Loading /> : q.error ? <ErrorBox error={q.error} /> : q.data!.data.length === 0 ? <Empty>No logs match this query.</Empty> : (
            <table className="w-full"><thead><tr><th className="th cursor-pointer" onClick={() => setSort(sort === 'desc' ? 'asc' : 'desc')}>Timestamp {sort === 'desc' ? '↓' : '↑'}</th><th className="th">Severity</th><th className="th">Service</th><th className="th">Message</th><th className="th">Trace</th><th className="th">Env</th></tr></thead><tbody>
              {q.data!.data.map((l) => <tr key={l.id} onClick={() => setSel(l)} className={`cursor-pointer border-t border-slate-200 hover:bg-slate-100 dark:border-ink-700 dark:hover:bg-ink-800 ${sel?.id === l.id ? 'bg-blue-600/10' : ''}`}>
                <td className="td whitespace-nowrap text-xs text-slate-500">{new Date(l.timestamp).toLocaleTimeString()}</td><td className="td"><Badge tone={levelTone(l.level)}>{l.level}</Badge></td><td className="td">{l.service}</td><td className="td max-w-md truncate">{l.message}</td><td className="td font-mono text-xs">{l.traceId?.slice(0, 8) ?? '—'}</td><td className="td">{l.environment}</td></tr>)}
            </tbody></table>)}
          {q.data?.meta && <Pager page={q.data.meta.page} pageSize={q.data.meta.pageSize} total={q.data.meta.total} onPage={setPg} />}
        </div>
        {sel && (
          <div className="card p-3 lg:col-span-2">
            <div className="mb-2 flex flex-wrap gap-2">
              <button className="btn" onClick={() => void navigator.clipboard.writeText(JSON.stringify(sel, null, 2))}>Copy JSON</button>
              {sel.traceId && <><button className="btn" onClick={() => void navigator.clipboard.writeText(sel.traceId!)}>Copy trace ID</button><Link className="btn" to={`/traces/${sel.traceId}`}>Open trace</Link></>}
              <Link className="btn" to={`/map`}>Service: {sel.service}</Link><button className="btn" onClick={() => setSel(null)}>Close</button>
            </div>
            <Editor height="320px" language="json" theme="vs-dark" value={JSON.stringify(sel, null, 2)} options={{ readOnly: true, minimap: { enabled: false }, fontSize: 12 }} />
          </div>)}
      </div>
    </div>
  );
}
