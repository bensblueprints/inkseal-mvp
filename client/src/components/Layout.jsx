import { NavLink, useNavigate } from 'react-router-dom';
import { PenTool, FileStack, LayoutTemplate, Settings as SettingsIcon, LogOut } from 'lucide-react';
import { api } from '../api.js';

const NAV = [
  { to: '/admin', label: 'Envelopes', icon: FileStack, end: true },
  { to: '/admin/templates', label: 'Templates', icon: LayoutTemplate },
  { to: '/admin/settings', label: 'Settings', icon: SettingsIcon },
];

export default function Layout({ children }) {
  const nav = useNavigate();
  const logout = async () => { await api.logout(); nav('/login'); };

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-60 shrink-0 flex-col border-r border-zinc-800 bg-zinc-900/40 p-4">
        <div className="mb-8 flex items-center gap-2 px-2">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-indigo-500/15 text-indigo-400">
            <PenTool size={16} />
          </div>
          <span className="font-semibold">Inkseal</span>
        </div>
        <nav className="flex-1 space-y-1">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition ${
                  isActive ? 'bg-indigo-500/15 text-indigo-300' : 'text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-100'
                }`
              }
            >
              <Icon size={16} /> {label}
            </NavLink>
          ))}
        </nav>
        <button
          onClick={logout}
          className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-zinc-500 hover:bg-zinc-800/60 hover:text-zinc-100"
        >
          <LogOut size={16} /> Log out
        </button>
      </aside>
      <main className="flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}
