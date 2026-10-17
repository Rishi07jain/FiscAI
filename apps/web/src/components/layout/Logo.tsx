import { Link } from 'react-router-dom';

export function Logo({ to = '/' }: { to?: string }) {
  return (
    <Link to={to} className="group inline-flex items-center gap-2">
      <svg viewBox="0 0 32 32" className="size-7" aria-hidden>
        <rect width="32" height="32" rx="7" className="fill-card-2 stroke-line-strong" strokeWidth="1" />
        <path d="M9 23V9h13" stroke="var(--primary)" strokeWidth="3.2" fill="none" strokeLinecap="square" />
        <path d="M9 16h9" stroke="var(--primary)" strokeWidth="3.2" strokeLinecap="square" />
        <circle cx="23" cy="22" r="2.6" fill="var(--chart-2)" className="origin-center transition-transform group-hover:scale-125" />
      </svg>
      <span className="text-[1.05rem] font-medium tracking-tight">Fisc<span className="text-lime">AI</span></span>
    </Link>
  );
}
