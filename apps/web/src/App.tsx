import { Navigate, NavLink, Outlet, Route, Routes } from 'react-router-dom';
import { Activity, Boxes, Database, FileText, LayoutDashboard, LogOut, Moon, Network, Sun } from 'lucide-react';
import { useState } from 'react';
import { useAuth } from './lib/api';
import { RANGES, useRange } from './lib/range';
import Login from './pages/Login';
import Overview from './pages/Overview';
import Traces from './pages/Traces';
import TraceDetail from './pages/TraceDetail';
import Logs from './pages/Logs';
import ServiceMap from './pages/ServiceMap';
import DataSources from './pages/DataSources';

const NAV = [
  { to: '/', label: 'Overview', icon: LayoutDashboard }, { to: '/traces', label: 'Traces', icon: Activity }, { to: '/logs', label: 'Logs', icon: FileText },
  { to: '/map', label: 'Service Map', icon: Network }, { to: '/sources', label: 'Data Sources', icon: Database },
];

function Shell() {
  const { user, set } = useAuth(); const { range, setRange } = useRange();
  const [collapsed, setCollapsed] = useState(false);
  const [dark, setDark] = useState(true);
  const toggle = () => { document.documentElement.classList.toggle('dark', !dark); setDark(!dark); };
  return (
    <div className="flex h-screen">
      <aside className={`${collapsed ? 'w-14' : 'w-56'} flex shrink-0 flex-col border-r border-slate-200 bg-white transition-[width] dark:border-ink-700 dark:bg-ink-900`}>
        <button className="flex h-12 items-center gap-2 px-4 font-semibold" onClick={() => setCollapsed(!collapsed)} aria-label="Toggle sidebar"><Boxes size={18} className="text-cyan-400" />{!collapsed && 'TraceWeaver'}</button>
        <nav className="flex-1 space-y-1 p-2">
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => `flex items-center gap-2 rounded-md px-2.5 py-2 text-sm ${isActive ? 'bg-blue-600/15 text-blue-500' : 'hover:bg-slate-100 dark:hover:bg-ink-800'}`}>
              <Icon size={16} />{!collapsed && label}
            </NavLink>))}
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 items-center justify-between border-b border-slate-200 px-4 dark:border-ink-700">
          <div className="flex items-center gap-2 text-sm"><span className="text-slate-500">Environment</span><span className="rounded bg-slate-100 px-2 py-0.5 dark:bg-ink-800">production</span></div>
          <div className="flex items-center gap-3">
            <select className="input py-1" value={range} onChange={(e) => setRange(e.target.value)} aria-label="Time range">{RANGES.map((r) => <option key={r} value={r}>Last {r}</option>)}</select>
            <button className="btn" onClick={toggle} aria-label="Toggle theme">{dark ? <Sun size={14} /> : <Moon size={14} />}</button>
            <span className="text-sm text-slate-500">{user?.name}</span>
            <button className="btn" onClick={() => set(null, null)}><LogOut size={14} />Sign out</button>
          </div>
        </header>
        <main className="min-h-0 flex-1 overflow-auto p-4"><Outlet /></main>
      </div>
    </div>
  );
}

export default function App() {
  const token = useAuth((s) => s.token);
  if (!token) return <Routes><Route path="*" element={<Login />} /></Routes>;
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<Overview />} /><Route path="traces" element={<Traces />} /><Route path="traces/:traceId" element={<TraceDetail />} />
        <Route path="logs" element={<Logs />} /><Route path="map" element={<ServiceMap />} /><Route path="sources" element={<DataSources />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
