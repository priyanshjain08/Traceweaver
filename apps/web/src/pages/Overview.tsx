import { useCallback, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { SOCKET_EVENTS } from '@traceweaver/shared';
import { api, fmtMs, fmtPct } from '../lib/api';
import { useRange } from '../lib/range';
import { useSocketEvent } from '../lib/socket';
import { Badge, ErrorBox, Loading, Stat, Empty } from '../components/ui';
import { Link } from 'react-router-dom';

interface Overview {
  totals: { requests: number; failed: number; errorRate: number; avgMs: number; p95: number; p99: number; activeServices: number };
  series: { t: string; requests: number; errorRate: number }[]; latencyHistogram: { bucketStartMs: number; count: number }[];
  services: { service: string; requests: number; errorRate: number; avg: number; health: string }[];
  incidents: { id: string; type: string; service: string; severity: string; explanation: string; detectedAt: string; status: string }[];
}
interface Live { traceId: string; rootService: string; operation: string; durationMs: number; status: string; isDemo: boolean }

export default function Overview() {
  const range = useRange((s) => s.range); const qc = useQueryClient();
  const q = useQuery({ queryKey: ['overview', range], queryFn: () => api<Overview>(`/analytics/overview?range=${range}`).then((r) => r.data), refetchInterval: 10_000 });
  const [feed, setFeed] = useState<Live[]>([]);
  const onTrace = useCallback((t: Live) => setFeed((f) => [t, ...f].slice(0, 12)), []);
  const onAnomaly = useCallback(() => { void qc.invalidateQueries({ queryKey: ['overview'] }); }, [qc]);
  useSocketEvent<Live>(SOCKET_EVENTS.trace, onTrace); useSocketEvent(SOCKET_EVENTS.anomaly, onAnomaly);
  if (q.isLoading) return <Loading />; if (q.error) return <ErrorBox error={q.error} />;
  const d = q.data!;
  if (d.totals.requests === 0) return <Empty>No data in this time range. Run <code>npm run db:seed</code> or start the simulator under Data Sources.</Empty>;
  const t = d.totals;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-7">
        <Stat label="Requests" value={t.requests.toLocaleString()} /><Stat label="Error rate" value={fmtPct(t.errorRate)} /><Stat label="Failed" value={t.failed.toLocaleString()} />
        <Stat label="Avg" value={fmtMs(t.avgMs)} /><Stat label="P95" value={fmtMs(t.p95)} /><Stat label="P99" value={fmtMs(t.p99)} /><Stat label="Services" value={String(t.activeServices)} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card p-3"><h2 className="mb-2 text-sm font-medium">Request volume</h2><div className="h-48"><ResponsiveContainer><AreaChart data={d.series}><CartesianGrid strokeOpacity={0.1} /><XAxis dataKey="t" tickFormatter={(v: string) => new Date(v).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} fontSize={11} /><YAxis fontSize={11} /><Tooltip /><Area dataKey="requests" stroke="#38bdf8" fill="#38bdf833" /></AreaChart></ResponsiveContainer></div></div>
        <div className="card p-3"><h2 className="mb-2 text-sm font-medium">Error rate</h2><div className="h-48"><ResponsiveContainer><AreaChart data={d.series}><CartesianGrid strokeOpacity={0.1} /><XAxis dataKey="t" tickFormatter={(v: string) => new Date(v).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} fontSize={11} /><YAxis fontSize={11} tickFormatter={(v: number) => fmtPct(v)} /><Tooltip formatter={(v: number) => fmtPct(v)} /><Area dataKey="errorRate" stroke="#f87171" fill="#f8717133" /></AreaChart></ResponsiveContainer></div></div>
        <div className="card p-3"><h2 className="mb-2 text-sm font-medium">Latency distribution (100 ms buckets)</h2><div className="h-48"><ResponsiveContainer><BarChart data={d.latencyHistogram}><CartesianGrid strokeOpacity={0.1} /><XAxis dataKey="bucketStartMs" fontSize={11} /><YAxis fontSize={11} /><Tooltip /><Bar dataKey="count" fill="#a78bfa" /></BarChart></ResponsiveContainer></div></div>
        <div className="card p-3"><h2 className="mb-2 text-sm font-medium">Services</h2>
          <table className="w-full"><thead><tr><th className="th">Service</th><th className="th">Spans</th><th className="th">Error rate</th><th className="th">Health</th></tr></thead><tbody>
            {d.services.map((s) => <tr key={s.service} className="border-t border-slate-200 dark:border-ink-700"><td className="td">{s.service}</td><td className="td">{s.requests}</td><td className="td">{fmtPct(s.errorRate)}</td><td className="td"><Badge tone={s.health === 'healthy' ? 'ok' : s.health === 'degraded' ? 'warn' : 'error'}>{s.health}</Badge></td></tr>)}
          </tbody></table></div>
        <div className="card p-3"><h2 className="mb-2 text-sm font-medium">Recent incidents (anomalies)</h2>
          {d.incidents.length === 0 ? <Empty>No anomalies detected in this range.</Empty> : d.incidents.map((a) => <div key={a.id} className="border-t border-slate-200 py-2 text-sm dark:border-ink-700"><Badge tone={a.severity === 'critical' || a.severity === 'high' ? 'error' : 'warn'}>{a.severity}</Badge> <b>{a.service}</b> · {a.type.replace(/_/g, ' ')}<div className="text-xs text-slate-500">{a.explanation}</div></div>)}</div>
        <div className="card p-3"><h2 className="mb-2 text-sm font-medium">Live traces</h2>
          {feed.length === 0 ? <Empty>Start the simulator (Data Sources) to see live traces.</Empty> : feed.map((f) => <Link key={f.traceId} to={`/traces/${f.traceId}`} className="flex items-center justify-between border-t border-slate-200 py-1.5 text-sm hover:bg-slate-100 dark:border-ink-700 dark:hover:bg-ink-800"><span>{f.operation} <span className="text-xs text-slate-500">{f.rootService}</span></span><span className="flex gap-2"><span>{fmtMs(f.durationMs)}</span><Badge tone={f.status === 'ok' ? 'ok' : 'error'}>{f.status}</Badge></span></Link>)}</div>
      </div>
    </div>
  );
}
