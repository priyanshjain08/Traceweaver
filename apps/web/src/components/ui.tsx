import type { ReactNode } from 'react';
export const Loading = () => <div className="p-6 text-sm text-slate-500" role="status">Loading…</div>;
export const ErrorBox = ({ error }: { error: unknown }) => <div className="card border-red-500/40 p-4 text-sm text-red-400" role="alert">{error instanceof Error ? error.message : 'Something went wrong'}</div>;
export const Empty = ({ children }: { children: ReactNode }) => <div className="p-8 text-center text-sm text-slate-500">{children}</div>;
export const Stat = ({ label, value }: { label: string; value: string }) => <div className="card p-3"><div className="text-xs uppercase tracking-wide text-slate-500">{label}</div><div className="mt-1 text-xl font-semibold">{value}</div></div>;
export const Badge = ({ tone, children }: { tone: 'ok' | 'error' | 'warn' | 'info'; children: ReactNode }) => {
  const c = { ok: 'bg-emerald-500/15 text-emerald-400', error: 'bg-red-500/15 text-red-400', warn: 'bg-amber-500/15 text-amber-400', info: 'bg-blue-500/15 text-blue-400' }[tone];
  return <span className={`rounded px-1.5 py-0.5 text-xs ${c}`}>{children}</span>;
};
export const levelTone = (l: string) => (l === 'error' || l === 'fatal' ? 'error' : l === 'warn' ? 'warn' : l === 'debug' ? 'info' : 'ok') as 'ok' | 'error' | 'warn' | 'info';
export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const last = Math.max(1, Math.ceil(total / pageSize));
  return <div className="flex items-center justify-between p-3 text-sm text-slate-500"><span>{total} results</span><div className="flex items-center gap-2">
    <button className="btn" disabled={page <= 1} onClick={() => onPage(page - 1)}>Prev</button><span>{page} / {last}</span><button className="btn" disabled={page >= last} onClick={() => onPage(page + 1)}>Next</button></div></div>;
}
