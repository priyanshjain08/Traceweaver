import { useState, type FormEvent } from 'react';
import { api, useAuth } from '../lib/api';

export default function Login() {
  const set = useAuth((s) => s.set);
  const [email, setEmail] = useState('admin@traceweaver.dev'); const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    try { const r = await api<{ token: string; user: { name: string; email: string } }>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }); set(r.data.token, r.data.user); }
    catch (err) { setError(err instanceof Error ? err.message : 'Sign in failed'); } finally { setBusy(false); }
  }
  return (
    <div className="flex h-screen items-center justify-center">
      <form onSubmit={submit} className="card w-80 space-y-3 p-6">
        <h1 className="text-lg font-semibold">Sign in to TraceWeaver</h1>
        <label className="block text-sm">Email<input className="input mt-1 w-full" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
        <label className="block text-sm">Password<input className="input mt-1 w-full" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
        {error && <p className="text-sm text-red-400" role="alert">{error}</p>}
        <button className="btn btn-primary w-full justify-center" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <p className="text-xs text-slate-500">Demo seed login: admin@traceweaver.dev / traceweaver</p>
      </form>
    </div>
  );
}
