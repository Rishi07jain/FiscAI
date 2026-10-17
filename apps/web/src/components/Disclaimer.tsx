import { ShieldAlert } from 'lucide-react';

export function Disclaimer({ compact }: { compact?: boolean }) {
  return (
    <div className={compact ? 'flex items-start gap-2 text-[0.7rem] text-muted-fg' : 'flex items-start gap-2.5 rounded-md border border-line bg-card px-4 py-3 text-xs text-muted-fg'}>
      <ShieldAlert className="mt-px size-3.5 shrink-0 text-muted-fg" />
      <span>FiscAI provides tax estimates and explanations for information only. It is not a chartered accountant and does not file returns. Verify important decisions with a qualified professional.</span>
    </div>
  );
}
