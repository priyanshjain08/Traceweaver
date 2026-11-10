import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { Badge, ErrorBox, Loading } from '../components/ui';

interface Sim { state: string; speed: number; incident: boolean; generated: number }
interface DS { id: string; name: string; description: string | null; credentials: { id: string; prefix: string; revokedAt: string | null; lastUsedAt: string | null }[] }

export default function DataSources() {
  const qc = useQueryClient(); const [newKey, setNewKey] = useState<string | null>(null); const [name, setName] = useState(''); const [msg, setMsg] = useState<string | null>(null);
  const sim = useQuery({ queryKey: ['sim'], queryFn: () => api<Sim>('/simulator').then((r) => r.data), refetchInterval: 2000 });
  const ds = useQuery({ queryKey: ['ds'], queryFn: () => api<DS[]>('/data-sources').then((r) => r.data) });
  const stats = useQuery({ queryKey: ['ingest-stats'], queryFn: () => api<{ logs: number; traces: number; events: number; since: string }>('/ingest/stats').then((r) => r.data), refetchInterval: 3000 });
  const act = useMutation({ mutationFn: (p: { path: string; body?: unknown }) => api(`/simulator/${p.path}`, { method: 'POST', body: JSON.stringify(p.body ?? {}) }), onSuccess: () => qc.invalidateQueries({ queryKey: ['sim'] }) });
  const mk = useMutation({ mutationFn: () => api('/data-sources', { method: 'POST', body: JSON.stringify({ name }) }), onSuccess: () => { setName(''); void qc.invalidateQueries({ queryKey: ['ds'] }); } });
  const key = useMutation({ mutationFn: (id: string) => api<{ key: string }>(`/data-sources/${id}/keys`, { method: 'POST' }), onSuccess: (r) => { setNewKey(r.data.key); void qc.invalidateQueries({ queryKey: ['ds'] }); } });
  const revoke = useMutation({ mutationFn: (id: string) => api(`/data-sources/keys/${id}`, { method: 'DELETE' }), onSuccess: () => qc.invalidateQueries({ queryKey: ['ds'] }) });
  async function upload(file: File) {
    setMsg(null);
    if (file.size > 2_000_000) return setMsg('File exceeds the 2 MB limit.');
    try {
      const json = JSON.parse(await file.text()) as Record<string, unknown>;
      const kind = 'logs' in json ? 'logs' : 'traces' in json ? 'traces' : 'events' in json ? 'events' : null;
      if (!kind) return setMsg('JSON must contain a "logs", "traces" or "events" array.');
      await api(`/ingest/${kind}`, { method: 'POST', body: JSON.stringify(json) }); setMsg(`Uploaded ${kind} successfully.`);
    } catch (e) { setMsg(e instanceof Error ? e.message : 'Upload failed'); }
  }
  if (sim.isLoading || ds.isLoading) return <Loading />; if (sim.error) return <ErrorBox error={sim.error} />;
  const s = sim.data!;
  return (
    <div className="space-y-4">
      <div className="card space-y-3 p-4"><div className="flex items-center gap-2"><h2 className="font-medium">Demo simulator</h2><Badge tone="info">demo data</Badge><Badge tone={s.state === 'running' ? 'ok' : 'warn'}>{s.state}</Badge>{s.incident && <Badge tone="error">incident active</Badge>}</div>
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn btn-primary" disabled={s.state === 'running'} onClick={() => act.mutate({ path: s.state === 'paused' ? 'resume' : 'start' })}>{s.state === 'paused' ? 'Resume' : 'Start'}</button>
          <button className="btn" disabled={s.state !== 'running'} onClick={() => act.mutate({ path: 'pause' })}>Pause</button>
          <button className="btn" disabled={s.state === 'stopped'} onClick={() => act.mutate({ path: 'stop' })}>Stop</button>
          <label className="flex items-center gap-2 text-sm">Speed {s.speed}/s<input type="range" min={1} max={20} value={s.speed} onChange={(e) => act.mutate({ path: 'speed', body: { speed: Number(e.target.value) } })} /></label>
          <button className="btn" onClick={() => act.mutate({ path: 'incident', body: { on: !s.incident } })}>{s.incident ? 'Clear incident' : 'Trigger incident'}</button>
          <span className="text-sm text-slate-500">{s.generated} traces generated this session</span></div></div>
      <div className="card space-y-2 p-4"><h2 className="font-medium">Ingestion</h2><p className="text-sm text-slate-500">Since server start: {stats.data?.traces ?? 0} traces, {stats.data?.logs ?? 0} logs, {stats.data?.events ?? 0} events.</p>
        <label className="btn w-fit cursor-pointer">Upload JSON<input type="file" accept="application/json" className="hidden" onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} /></label>{msg && <p className="text-sm" role="status">{msg}</p>}</div>
      <div className="card space-y-3 p-4"><h2 className="font-medium">Data sources & API keys</h2>
        {newKey && <div className="rounded border border-amber-500/40 p-2 text-sm"><b>New key (shown once):</b> <code className="break-all">{newKey}</code> <button className="btn ml-2" onClick={() => setNewKey(null)}>Dismiss</button></div>}
        {ds.data!.map((d) => <div key={d.id} className="border-t border-slate-200 pt-2 dark:border-ink-700"><div className="flex items-center justify-between"><div><b>{d.name}</b> <span className="text-sm text-slate-500">{d.description}</span></div><button className="btn" onClick={() => key.mutate(d.id)}>Generate API key</button></div>
          {d.credentials.map((c) => <div key={c.id} className="mt-1 flex items-center gap-3 text-xs"><code>{c.prefix}…</code>{c.revokedAt ? <Badge tone="error">revoked</Badge> : <Badge tone="ok">active</Badge>}<span className="text-slate-500">last used {c.lastUsedAt ? new Date(c.lastUsedAt).toLocaleString() : 'never'}</span>{!c.revokedAt && <button className="btn" onClick={() => { if (confirm('Revoke this key?')) revoke.mutate(c.id); }}>Revoke</button>}</div>)}</div>)}
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (name.trim()) mk.mutate(); }}><input className="input" placeholder="New data source name" value={name} onChange={(e) => setName(e.target.value)} aria-label="Data source name" /><button className="btn btn-primary" disabled={!name.trim()}>Create</button></form>
        {mk.error && <ErrorBox error={mk.error} />}</div>
    </div>
  );
}
