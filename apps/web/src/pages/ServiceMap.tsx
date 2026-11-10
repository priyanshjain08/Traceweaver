import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import ReactFlow, { Background, Controls, MarkerType, useEdgesState, useNodesState, type Edge, type Node } from 'reactflow';
import 'reactflow/dist/style.css';
import { Link } from 'react-router-dom';
import { api, fmtMs, fmtPct } from '../lib/api';
import { useRange } from '../lib/range';
import { Badge, Empty, ErrorBox, Loading } from '../components/ui';

interface Topo { nodes: { service: string; requests: number; errors: number; avg: number; errorRate: number; health: string }[]; edges: { source: string; target: string; calls: number; errors: number; avg: number; errorRate: number }[] }
const COLOR: Record<string, string> = { healthy: '#34d399', degraded: '#fbbf24', unhealthy: '#f87171' };

/** Simple layered layout: depth = longest path from a root (a service nobody calls). */
export function layout(t: Topo) {
  const depth = new Map<string, number>(); t.nodes.forEach((n) => depth.set(n.service, 0));
  for (let i = 0; i < t.nodes.length; i++) for (const e of t.edges) depth.set(e.target, Math.max(depth.get(e.target) ?? 0, (depth.get(e.source) ?? 0) + 1));
  const cols = new Map<number, string[]>(); t.nodes.forEach((n) => { const d = Math.min(depth.get(n.service) ?? 0, t.nodes.length); cols.set(d, [...(cols.get(d) ?? []), n.service]); });
  const pos = new Map<string, { x: number; y: number }>();
  cols.forEach((names, d) => names.forEach((n, i) => pos.set(n, { x: d * 280, y: i * 130 })));
  return pos;
}

export default function ServiceMap() {
  const range = useRange((s) => s.range); const [selected, setSelected] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['topology', range], queryFn: () => api<Topo>(`/analytics/topology?range=${range}`).then((r) => r.data), refetchInterval: 15_000 });
  const [nodes, setNodes, onNodesChange] = useNodesState<Node['data']>([]); const [edges, setEdges, onEdgesChange] = useEdgesState<Edge['data']>([]);
  const maxCalls = useMemo(() => Math.max(1, ...(q.data?.edges.map((e) => e.calls) ?? [1])), [q.data]);
  useEffect(() => {
    if (!q.data) return; const pos = layout(q.data);
    setNodes((old) => q.data!.nodes.map((n) => ({
      id: n.service, position: old.find((o) => o.id === n.service)?.position ?? pos.get(n.service) ?? { x: 0, y: 0 },
      data: { label: (<div className="text-left text-xs"><div className="font-semibold">{n.service}</div><div>{n.requests} req · {fmtPct(n.errorRate)} err</div><div>{fmtMs(n.avg)} avg</div></div>) },
      style: { border: `2px solid ${COLOR[n.health]}`, borderRadius: 8, background: '#11151d', color: '#e2e8f0', width: 190, padding: 6 },
    })));
    setEdges(q.data.edges.map((e) => ({
      id: `${e.source}->${e.target}`, source: e.source, target: e.target, label: `${e.calls}`, animated: e.errorRate > 0.2, markerEnd: { type: MarkerType.ArrowClosed },
      style: { stroke: e.errorRate > 0.2 ? '#f87171' : '#38bdf8', strokeWidth: 1 + (e.calls / maxCalls) * 5 }, labelStyle: { fill: '#94a3b8', fontSize: 11 },
    })));
  }, [q.data, maxCalls, setNodes, setEdges]);
  const traces = useQuery({ queryKey: ['svc-traces', selected, range], enabled: !!selected, queryFn: () => api<{ traceId: string; operation: string; status: string }[]>(`/traces?service=${selected}&status=error&range=${range}&pageSize=5`).then((r) => r.data) });
  if (q.isLoading) return <Loading />; if (q.error) return <ErrorBox error={q.error} />;
  if (!q.data || q.data.nodes.length === 0) return <Empty>No span relationships in this range yet.</Empty>;
  const sel = q.data.nodes.find((n) => n.service === selected); const related = q.data.edges.filter((e) => e.source === selected || e.target === selected);
  return (
    <div className="grid h-full gap-4 lg:grid-cols-4">
      <div className="card h-[70vh] lg:col-span-3"><ReactFlow nodes={nodes} edges={edges} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onNodeClick={(_, n) => setSelected(n.id)} fitView><Background /><Controls /></ReactFlow></div>
      <div className="card p-3 text-sm">
        {!sel ? <p className="text-slate-500">Select a service to see details. Topology is derived from parent-child spans across services.</p> : (<div className="space-y-2">
          <div className="flex items-center justify-between"><h2 className="font-semibold">{sel.service}</h2><Badge tone={sel.health === 'healthy' ? 'ok' : sel.health === 'degraded' ? 'warn' : 'error'}>{sel.health}</Badge></div>
          <div>Requests: {sel.requests}</div><div>Error rate: {fmtPct(sel.errorRate)}</div><div>Avg latency: {fmtMs(sel.avg)}</div>
          <div><div className="text-xs text-slate-500">Related services</div>{related.map((e) => <div key={`${e.source}${e.target}`} className="text-xs">{e.source} → {e.target} · {e.calls} calls · {fmtPct(e.errorRate)} err</div>)}</div>
          <div><div className="text-xs text-slate-500">Recent failing traces</div>{traces.data?.length ? traces.data.map((t) => <Link key={t.traceId} className="block text-xs text-blue-500" to={`/traces/${t.traceId}`}>{t.operation} · {t.traceId.slice(0, 10)}…</Link>) : <span className="text-xs text-slate-500">None</span>}</div>
        </div>)}
      </div>
    </div>
  );
}
