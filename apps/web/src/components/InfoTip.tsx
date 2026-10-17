import { AnimatePresence, motion } from 'motion/react';
import { Info } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

const W = 280;

/** Small "i" button with a short plain-language explanation and where to find the number. */
export function InfoTip({ what, where }: { what: ReactNode; where?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top?: number; bottom?: number; left: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open || !btn.current) return;
    const r = btn.current.getBoundingClientRect();
    const width = Math.min(W, window.innerWidth - 24);
    const left = Math.max(12, Math.min(r.left - 12, window.innerWidth - width - 12));
    const above = r.bottom + 180 > window.innerHeight && r.top > 200;
    setPos(above ? { bottom: window.innerHeight - r.top + 6, left } : { top: r.bottom + 6, left });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      const t = e.target as Node;
      if (btn.current?.contains(t) || pop.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', close);
    window.addEventListener('scroll', close, true);
    return () => { document.removeEventListener('mousedown', close); window.removeEventListener('scroll', close, true); };
  }, [open]);

  return (
    <>
      <button
        ref={btn}
        type="button"
        aria-label="What is this?"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen((o) => !o); }}
        className="ml-1 inline-grid size-4 place-items-center rounded-full align-[-2px] text-muted-fg transition hover:text-lime"
      >
        <Info className="size-3.5" />
      </button>
      {createPortal(
        <AnimatePresence>
          {open && pos && (
            <motion.div ref={pop} role="tooltip" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              style={{ position: 'fixed', left: pos.left, top: pos.top, bottom: pos.bottom, width: Math.min(W, window.innerWidth - 24) }}
              className="z-[70] rounded-lg border border-line-strong bg-card p-3 text-left text-[0.78rem] leading-relaxed text-fg/90 shadow-2xl">
              <p>{what}</p>
              {where && <p className="mt-1.5 text-muted-fg"><span className="font-mono text-[0.6rem] uppercase tracking-wider text-lime">Find it · </span>{where}</p>}
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}

/** Plain-language help for common fields, reused across onboarding and the profile editor. */
export const HELP: Record<string, { what: string; where?: string }> = {
  yearlySalary: { what: 'Your total pay for the year before any tax is cut.', where: 'Offer letter "fixed pay" (leave out PF and gratuity), or monthly "Gross earnings" on your salary slip × 12.' },
  basic: { what: 'The main fixed part of your salary. Many allowances and limits are worked out from it.', where: 'Salary slip, first line under Earnings ("Basic"). Add "DA" if you have one.' },
  da: { what: 'Dearness Allowance — extra pay mostly given in government/PSU jobs.', where: 'Salary slip, "DA". Leave 0 if you don\'t see it.' },
  hra: { what: 'House Rent Allowance — money your employer pays towards rent. Part of it can be tax-free if you pay rent (old regime).', where: 'Salary slip, "HRA" under Earnings, × 12.' },
  specialAllowance: { what: 'The flexible part of your salary that isn\'t basic or HRA. Fully taxable.', where: 'Salary slip, "Special allowance" or "Flexi pay", × 12.' },
  otherAllowances: { what: 'Any other taxable allowances (conveyance, medical, etc.).', where: 'Salary slip, remaining Earnings lines, × 12.' },
  bonus: { what: 'Yearly or performance bonus paid in this year.', where: 'Bonus slip or the month it was paid.' },
  perquisites: { what: 'Taxable perks like a company car, rent-free flat or ESOPs.', where: 'Form 16 Part B, "Value of perquisites u/s 17(2)".' },
  employerNps: { what: 'Money your employer puts into your NPS pension account. Saves tax in both regimes.', where: 'Salary slip, "Employer NPS" / "NPS (Er)", × 12.' },
  professionalTax: { what: 'A small state tax cut from salary (max ₹2,500 a year).', where: 'Salary slip, Deductions side, "Professional tax".' },
  rentPaid: { what: 'Total rent you pay in a year. Only matters for HRA in the old regime.', where: 'Your rent agreement or rent receipts × 12.' },
  tds: { what: 'Tax your employer or bank has already cut and paid for you. We subtract it from what you owe.', where: 'Salary slip, "Income tax" / "TDS" under Deductions (add up the months), or Form 16 Part A.' },
  sec80C: { what: 'Investments that cut tax in the old regime: PF, PPF, ELSS, life insurance, kids\' tuition. Limit ₹1.5 lakh.', where: 'Your investment proofs, or "80C" in Form 16 Part B.' },
  healthSelf: { what: 'Health insurance premium for you, spouse and children.', where: 'Your policy premium receipt.' },
  healthParents: { what: 'Health insurance premium you pay for your parents.', where: 'Their policy premium receipt.' },
  homeLoanInterest: { what: 'Interest part of your home-loan EMIs for the year.', where: 'Your bank\'s yearly "interest certificate".' },
};
HELP.selfOccupiedInterest = HELP.homeLoanInterest;
