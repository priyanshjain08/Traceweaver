import { create } from 'zustand';

interface AuthState { token: string | null; user: { name: string; email: string } | null; set: (t: string | null, u: AuthState['user']) => void }
export const useAuth = create<AuthState>((set) => ({
  token: localStorage.getItem('tw_token'), user: JSON.parse(localStorage.getItem('tw_user') ?? 'null'),
  set: (token, user) => { token ? localStorage.setItem('tw_token', token) : localStorage.removeItem('tw_token'); localStorage.setItem('tw_user', JSON.stringify(user)); set({ token, user }); },
}));

export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }

export async function api<T>(path: string, init: RequestInit = {}): Promise<{ data: T; meta?: { total: number; page: number; pageSize: number } }> {
  const token = useAuth.getState().token;
  const res = await fetch(`/api${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...init.headers } });
  if (res.status === 401 && token) useAuth.getState().set(null, null);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, body?.error?.message ?? res.statusText);
  return body;
}
export const qs = (o: Record<string, string | number | undefined>) => new URLSearchParams(Object.entries(o).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v)])).toString();

export const fmtMs = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(2)} s` : `${n.toFixed(0)} ms`);
export const fmtPct = (n: number) => `${(n * 100).toFixed(1)}%`;
