import { useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import {
  BarChart3, Bitcoin, BookOpen, Calendar, CandlestickChart, FileCheck2, FileSearch, FileText, FlaskConical, Gauge, HandCoins, LogOut, Menu, MessageSquare,
  Moon, Scale, Settings, Sun, User, Users, Wallet, X,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { useApp } from '../../lib/context';
import { Disclaimer } from '../Disclaimer';
import { cn } from '../ui';
import { Logo } from './Logo';

const NAV: { group: string; items: { to: string; label: string; icon: ReactNode; tag?: string }[] }[] = [
  { group: 'Overview', items: [
    { to: '/dashboard', label: 'Tax summary', icon: <Gauge /> },
    { to: '/regime', label: 'Regime optimiser', icon: <Scale /> },
    { to: '/scenarios', label: 'What-if scenarios', icon: <FlaskConical /> },
    { to: '/assistant', label: 'Assistant', icon: <MessageSquare /> },
  ] },
  { group: 'Your data', items: [
    { to: '/documents', label: 'Documents', icon: <FileText /> },
    { to: '/profile', label: 'Tax profile', icon: <User /> },
    { to: '/portfolio', label: 'Portfolio', icon: <BarChart3 /> },
  ] },
  { group: 'Plan', items: [
    { to: '/planner', label: 'Advance tax & deadlines', icon: <Calendar /> },
    { to: '/deductions', label: 'Deductions & schemes', icon: <HandCoins /> },
  ] },
  { group: 'Advanced', items: [
    { to: '/traders', label: 'F&O & trading', icon: <CandlestickChart />, tag: 'P2' },
    { to: '/crypto', label: 'Crypto (VDA)', icon: <Bitcoin />, tag: 'P2' },
    { to: '/ais', label: 'AIS reconciliation', icon: <FileSearch />, tag: 'P2' },
    { to: '/itr', label: 'ITR readiness', icon: <FileCheck2 />, tag: 'P2' },
    { to: '/household', label: 'Household', icon: <Users />, tag: 'P2' },
  ] },
  { group: 'More', items: [
    { to: '/rules', label: 'Rule library', icon: <BookOpen /> },
    { to: '/settings', label: 'Settings & privacy', icon: <Settings /> },
  ] },
];

function Nav({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="flex-1 space-y-5 overflow-y-auto px-3 pb-6">
      {NAV.map((g) => (
        <div key={g.group}>
          <div className="label-mono mb-1.5 px-3 text-muted-fg/70">{g.group}</div>
          {g.items.map((i) => (
            <NavLink key={i.to} to={i.to} onClick={onNavigate} className={({ isActive }) => cn('group relative flex items-center gap-2.5 rounded-md px-3 py-2 text-[0.84rem] transition-colors [&_svg]:size-4', isActive ? 'bg-card-2 text-fg' : 'text-muted-fg hover:bg-card-2/60 hover:text-fg')}>
              {({ isActive }) => (
                <>
                  {isActive && <motion.span layoutId="nav-active" className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-lime" />}
                  <span className={cn(isActive ? 'text-lime' : 'text-muted-fg group-hover:text-fg')}>{i.icon}</span>
                  <span className="flex-1">{i.label}</span>
                  {i.tag && <span className="font-mono text-[0.55rem] text-muted-fg/60">{i.tag}</span>}
                </>
              )}
            </NavLink>
          ))}
        </div>
      ))}
    </nav>
  );
}

export function AppShell() {
  const { user, taxYear, setTaxYear, theme, toggleTheme } = useApp();
  const [open, setOpen] = useState(false);
  const nav = useNavigate();
  const qc = useQueryClient();
  const loc = useLocation();
  const logout = async () => {
    await api('/auth/logout', { method: 'POST' });
    qc.clear();
    nav('/');
  };
  const TopControls = (
    <div className="flex items-center gap-2">
      <div className="flex items-center rounded-md border border-line bg-card-2 p-0.5" title="Tax Year">
        {(['2026-27', '2025-26'] as const).map((y) => (
          <button key={y} onClick={() => setTaxYear(y)} className={cn('rounded-[5px] px-2.5 py-1 font-mono text-[0.64rem] tracking-wider transition', taxYear === y ? 'bg-lime text-black' : 'text-muted-fg hover:text-fg')}>TY {y}</button>
        ))}
      </div>
      <button onClick={toggleTheme} className="grid size-8 place-items-center rounded-md border border-line text-muted-fg hover:text-fg" aria-label="Toggle theme">{theme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}</button>
    </div>
  );
  return (
    <div className="flex min-h-full">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-line bg-bg lg:flex">
        <div className="px-6 py-5"><Logo to="/dashboard" /></div>
        <Nav />
        <div className="border-t border-line p-3">
          <div className="flex items-center gap-2.5 rounded-md px-2 py-2">
            <div className="grid size-8 place-items-center rounded-full bg-lime-soft font-mono text-xs text-lime">{(user?.name || user?.email || '?').slice(0, 1).toUpperCase()}</div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm">{user?.name || 'You'}</div>
              <div className="truncate text-xs text-muted-fg">{user?.email}</div>
            </div>
            <button onClick={logout} className="rounded p-1.5 text-muted-fg hover:bg-muted hover:text-fg" aria-label="Log out"><LogOut className="size-4" /></button>
          </div>
        </div>
      </aside>

      <AnimatePresence>
        {open && (
          <>
            <motion.div className="fixed inset-0 z-40 bg-black/60 lg:hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setOpen(false)} />
            <motion.aside className="fixed inset-y-0 left-0 z-50 flex w-72 flex-col border-r border-line bg-bg lg:hidden" initial={{ x: -300 }} animate={{ x: 0 }} exit={{ x: -300 }} transition={{ type: 'spring', stiffness: 400, damping: 40 }}>
              <div className="flex items-center justify-between px-5 py-4"><Logo to="/dashboard" /><button onClick={() => setOpen(false)} aria-label="Close menu"><X className="size-5" /></button></div>
              <Nav onNavigate={() => setOpen(false)} />
              <button onClick={logout} className="m-3 flex items-center gap-2 rounded-md border border-line px-3 py-2 text-sm text-muted-fg"><LogOut className="size-4" />Log out</button>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-line bg-bg/80 px-4 backdrop-blur-md sm:px-6">
          <div className="flex items-center gap-3">
            <button className="lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu"><Menu className="size-5" /></button>
            <div className="lg:hidden"><Logo to="/dashboard" /></div>
            <div className="hidden items-center gap-2 lg:flex">
              <Wallet className="size-4 text-muted-fg" />
              <span className="font-mono text-[0.68rem] uppercase tracking-[0.12em] text-muted-fg">Tax Year {taxYear} · {taxYear === '2026-27' ? 'Income-tax Act, 2025' : 'Income-tax Act, 1961'}</span>
            </div>
          </div>
          {TopControls}
        </header>
        <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <motion.div key={loc.pathname} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}>
            <Outlet />
          </motion.div>
          <div className="mt-12"><Disclaimer compact /></div>
        </main>
      </div>
    </div>
  );
}
