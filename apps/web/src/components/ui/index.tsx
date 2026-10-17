import clsx from 'clsx';
import { animate, AnimatePresence, motion, useInView } from 'motion/react';
import { Loader2, X } from 'lucide-react';
import { InfoTip } from '../InfoTip';
import { createContext, forwardRef, useCallback, useContext, useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';

export const cn = clsx;

// ---- Button ------------------------------------------------------------------
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline-lime';
const variants: Record<Variant, string> = {
  primary: 'bg-lime text-black hover:bg-lime-strong border border-lime',
  secondary: 'bg-card-2 text-fg border border-line-strong hover:border-fg/40',
  ghost: 'text-muted-fg hover:text-fg hover:bg-muted border border-transparent',
  danger: 'bg-danger/10 text-danger border border-danger/30 hover:bg-danger/20',
  'outline-lime': 'text-lime border border-lime/50 hover:bg-lime-soft',
};
const sizes = { sm: 'h-8 px-3 text-[0.68rem]', md: 'h-10 px-4 text-[0.72rem]', lg: 'h-12 px-6 text-[0.78rem]' };

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: keyof typeof sizes; loading?: boolean; icon?: ReactNode }>(
  ({ variant = 'primary', size = 'md', loading, icon, className, children, disabled, ...rest }, ref) => (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn('inline-flex select-none items-center justify-center gap-2 font-mono font-medium uppercase tracking-[0.12em] transition-all duration-150 active:translate-y-px disabled:pointer-events-none disabled:opacity-50', variants[variant], sizes[size], className)}
      {...rest}
    >
      {loading ? <Loader2 className="size-3.5 animate-spin" /> : icon}
      {children}
    </button>
  ),
);
Button.displayName = 'Button';

// ---- Card ----------------------------------------------------------------------
export function Card({ className, children, hover, ...rest }: { className?: string; children: ReactNode; hover?: boolean } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('rounded-[0.625rem] border border-line bg-card', hover && 'transition-colors hover:border-line-strong', className)} {...rest}>
      {children}
    </div>
  );
}

export function CardHeader({ label, title, action, className }: { label?: string; title?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex items-start justify-between gap-3 border-b border-line px-5 py-4', className)}>
      <div className="min-w-0">
        {label && <div className="label-mono text-muted-fg">{label}</div>}
        {title && <div className="mt-1 text-[0.95rem] font-medium text-fg">{title}</div>}
      </div>
      {action}
    </div>
  );
}

// ---- Chip / Badge --------------------------------------------------------------------
export function Chip({ children, tone = 'default', className }: { children: ReactNode; tone?: 'default' | 'lime' | 'orange' | 'danger' | 'muted'; className?: string }) {
  const tones = {
    default: 'border-line-strong text-fg/80',
    lime: 'border-lime/40 bg-lime-soft text-lime',
    orange: 'border-c2/40 bg-c2/10 text-c2',
    danger: 'border-danger/40 bg-danger/10 text-danger',
    muted: 'border-line text-muted-fg',
  };
  return <span className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-[4px] border px-2 py-0.5 font-mono text-[0.62rem] uppercase tracking-[0.1em]', tones[tone], className)}>{children}</span>;
}

// ---- Form controls ----------------------------------------------------------------------
const inputBase = 'h-10 w-full rounded-md border border-line bg-card-2 px-3 text-sm text-fg outline-none transition placeholder:text-muted-fg/70 focus:border-lime/70 focus:ring-2 focus:ring-lime/20 disabled:opacity-60';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...rest }, ref) => <input ref={ref} className={cn(inputBase, className)} {...rest} />);
Input.displayName = 'Input';

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(({ className, children, ...rest }, ref) => (
  <select ref={ref} className={cn(inputBase, 'appearance-none bg-[url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2712%27 height=%2712%27 fill=%27none%27 stroke=%27%23a1a1a1%27 stroke-width=%272%27%3E%3Cpath d=%27M3 4.5l3 3 3-3%27/%3E%3C/svg%3E")] bg-[right_0.75rem_center] bg-no-repeat pr-8', className)} {...rest}>
    {children}
  </select>
));
Select.displayName = 'Select';

export function Field({ label, hint, error, children, className, info }: { label: string; hint?: ReactNode; error?: string; children: ReactNode; className?: string; info?: { what: ReactNode; where?: ReactNode } }) {
  return (
    <label className={cn('block', className)}>
      <span className="mb-1.5 block text-[0.78rem] font-medium text-fg/85">{label}{info && <InfoTip what={info.what} where={info.where} />}</span>
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-muted-fg">{hint}</span>}
      {error && <span className="mt-1 block text-xs text-danger">{error}</span>}
    </label>
  );
}

/** Rupee input: shows Indian grouping, stores a number. */
export function MoneyInput({ value, onChange, className, placeholder = '0', ...rest }: { value: number | undefined; onChange: (n: number) => void; className?: string; placeholder?: string; disabled?: boolean; allowNegative?: boolean }) {
  const [text, setText] = useState(value ? value.toLocaleString('en-IN') : '');
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setText(value ? value.toLocaleString('en-IN') : ''); }, [value]);
  return (
    <div className={cn('relative', className)}>
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-fg">₹</span>
      <input
        inputMode="numeric"
        className={cn(inputBase, 'tabular pl-7')}
        value={text}
        placeholder={placeholder}
        disabled={rest.disabled}
        onFocus={() => { focused.current = true; }}
        onBlur={() => { focused.current = false; setText(value ? value.toLocaleString('en-IN') : ''); }}
        onChange={(e) => {
          const raw = e.target.value.replace(rest.allowNegative ? /[^\d-]/g : /[^\d]/g, '');
          setText(e.target.value);
          const n = Number(raw);
          onChange(Number.isFinite(n) ? n : 0);
        }}
      />
    </div>
  );
}

export function Switch({ checked, onChange, label, description }: { checked: boolean; onChange: (v: boolean) => void; label?: string; description?: string }) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4">
      {(label || description) && (
        <label htmlFor={id} className="cursor-pointer">
          {label && <div className="text-sm font-medium">{label}</div>}
          {description && <div className="mt-0.5 text-xs text-muted-fg">{description}</div>}
        </label>
      )}
      <button id={id} type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className={cn('relative h-6 w-11 shrink-0 rounded-full border transition-colors', checked ? 'border-lime bg-lime' : 'border-line-strong bg-muted')}>
        <motion.span layout transition={{ type: 'spring', stiffness: 500, damping: 32 }} className={cn('absolute top-0.5 size-[18px] rounded-full', checked ? 'right-0.5 bg-black' : 'left-0.5 bg-fg/70')} />
      </button>
    </div>
  );
}

// ---- Segmented tabs ------------------------------------------------------------------------
export function Tabs<T extends string>({ value, onChange, options, className }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[]; className?: string }) {
  const id = useId();
  return (
    <div className={cn('inline-flex rounded-md border border-line bg-card-2 p-1', className)} role="tablist">
      {options.map((o) => (
        <button key={o.value} role="tab" aria-selected={value === o.value} onClick={() => onChange(o.value)} className={cn('relative rounded-[5px] px-3 py-1.5 font-mono text-[0.66rem] uppercase tracking-[0.1em] transition-colors', value === o.value ? 'text-black' : 'text-muted-fg hover:text-fg')}>
          {value === o.value && <motion.span layoutId={`tab-${id}`} className="absolute inset-0 rounded-[5px] bg-lime" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />}
          <span className="relative">{o.label}</span>
        </button>
      ))}
    </div>
  );
}

// ---- Modal ------------------------------------------------------------------------------------
export function Modal({ open, onClose, title, children, width = 'max-w-lg' }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; width?: string }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
          <motion.div role="dialog" aria-modal className={cn('max-h-[90vh] w-full overflow-y-auto rounded-t-xl border border-line-strong bg-card shadow-2xl sm:rounded-xl', width)} initial={{ y: 24, opacity: 0, scale: 0.98 }} animate={{ y: 0, opacity: 1, scale: 1 }} exit={{ y: 16, opacity: 0 }} transition={{ type: 'spring', stiffness: 380, damping: 32 }}>
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-card px-5 py-4">
              <div className="font-medium">{title}</div>
              <button onClick={onClose} className="rounded p-1 text-muted-fg hover:bg-muted hover:text-fg" aria-label="Close"><X className="size-4" /></button>
            </div>
            <div className="p-5">{children}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ---- Feedback -------------------------------------------------------------------------------------
export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('size-4 animate-spin text-muted-fg', className)} />;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-muted', className)} />;
}

export function EmptyState({ icon, title, body, action }: { icon?: ReactNode; title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      {icon && <div className="mb-4 grid size-12 place-items-center rounded-lg border border-line bg-card-2 text-lime">{icon}</div>}
      <div className="font-medium">{title}</div>
      {body && <div className="mt-1.5 max-w-md text-sm text-muted-fg">{body}</div>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  return <div className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">{(error as Error).message ?? String(error)}</div>;
}

// ---- Animated number ---------------------------------------------------------------------------------
export function AnimatedNumber({ value, format = (n) => Math.round(n).toLocaleString('en-IN'), className }: { value: number; format?: (n: number) => string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const prev = useRef(0);
  const inView = useInView(ref, { once: true });
  useEffect(() => {
    if (!inView || !ref.current) return;
    const node = ref.current;
    const c = animate(prev.current, value, { duration: 0.9, ease: [0.16, 1, 0.3, 1], onUpdate: (v) => { node.textContent = format(v); } });
    prev.current = value;
    return () => c.stop();
  }, [value, inView, format]);
  return <span ref={ref} className={cn('tabular', className)}>{format(prev.current)}</span>;
}

export function PageHeader({ label, title, description, actions }: { label: string; title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
      <div>
        <div className="label-mono text-lime">{label}</div>
        <h1 className="mt-2 text-2xl font-normal tracking-tight sm:text-[1.9rem]">{title}</h1>
        {description && <p className="mt-1.5 max-w-2xl text-sm text-muted-fg">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'lime' | 'orange' | 'danger' }) {
  return (
    <div>
      <div className="label-mono text-muted-fg">{label}</div>
      <div className={cn('mt-1.5 text-2xl font-light tabular tracking-tight', tone === 'lime' && 'text-lime', tone === 'orange' && 'text-c2', tone === 'danger' && 'text-danger')}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted-fg">{sub}</div>}
    </div>
  );
}

// ---- Toasts -------------------------------------------------------------------------------------------
interface Toast { id: number; text: string; tone: 'ok' | 'error' }
const ToastCtx = createContext<(text: string, tone?: 'ok' | 'error') => void>(() => undefined);
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, tone: 'ok' | 'error' = 'ok') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(92vw,360px)] flex-col gap-2">
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div key={t.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: 40 }} className={cn('pointer-events-auto rounded-md border px-4 py-3 text-sm shadow-xl backdrop-blur', t.tone === 'ok' ? 'border-lime/40 bg-card/95' : 'border-danger/40 bg-card/95 text-danger')}>
              <span className={cn('mr-2 inline-block size-1.5 rounded-full align-middle', t.tone === 'ok' ? 'bg-lime' : 'bg-danger')} />
              {t.text}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastCtx.Provider>
  );
}

export const fadeUp = { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.45, ease: [0.16, 1, 0.3, 1] } } as const;
