import { TaxProfileSchema, type HouseholdMember, type TaxProfile, type TaxProfileInput } from '@fiscai/shared-types';
import { compareRegimes } from './compare';
import { getPack } from './packs';

export interface HouseholdMemberView {
  name: string;
  relation: string;
  tax: { new: number; old: number; best: 'new' | 'old' };
  totalIncome: number;
}

export interface HouseholdView {
  user: { tax: { new: number; old: number; best: 'new' | 'old' } };
  members: HouseholdMemberView[];
  familyTax: number;
  healthInsurance: { who: string; premium: number; deductibleBy: string; saving: number; note: string }[];
  clubbingWarnings: { member: string; message: string; ruleId: string }[];
}

/** F16: each member's tax, parents' health-insurance planning, clubbing warnings on gifts. */
export function householdView(userInput: TaxProfile | TaxProfileInput, members: HouseholdMember[]): HouseholdView {
  const user = TaxProfileSchema.parse(userInput);
  const uc = compareRegimes(user);
  const views: HouseholdMemberView[] = [];
  const health: HouseholdView['healthInsurance'] = [];
  const clubbing: HouseholdView['clubbingWarnings'] = [];
  const oldPack = getPack(user.taxYear, 'old');
  for (const m of members) {
    const prof = TaxProfileSchema.parse({ ...m.profile, taxYear: user.taxYear, personal: { ...(m.profile.personal ?? {}), ageBand: m.ageBand } });
    const c = compareRegimes(prof);
    views.push({ name: m.name, relation: m.relation, tax: { new: c.new.totalTax, old: c.old.totalTax, best: c.recommended }, totalIncome: c[c.recommended].totalIncome });
    if ((m.relation === 'father' || m.relation === 'mother') && m.healthPremiumPaidByUser > 0) {
      const senior = m.ageBand !== 'below60';
      const cap = (senior ? oldPack.deductions.sec80D.parentsSenior : oldPack.deductions.sec80D.parents) / 100;
      const amt = Math.min(cap, m.healthPremiumPaidByUser);
      const withIt = structuredClone(user);
      withIt.deductions.healthParents += amt;
      withIt.personal.parentsSenior = withIt.personal.parentsSenior || senior;
      const userSaving = uc.old.totalTax - compareRegimes(withIt).old.totalTax;
      health.push({
        who: m.name, premium: m.healthPremiumPaidByUser, deductibleBy: 'you (old regime only)', saving: user.regime === 'old' ? userSaving : 0,
        note: user.regime === 'old'
          ? `You can claim up to Rs ${cap.toLocaleString('en-IN')} for ${m.name}'s premium under 80D, saving Rs ${userSaving.toLocaleString('en-IN')}.`
          : `On the new regime you get no 80D benefit. In the old regime this would save Rs ${userSaving.toLocaleString('en-IN')}. If ${m.name} pays tax under the old regime, they can claim it themselves instead.`,
      });
    }
    if (m.giftsFromUser > 0) {
      if (m.relation === 'spouse') clubbing.push({ member: m.name, ruleId: 'CLUBBING', message: `Income earned on the Rs ${m.giftsFromUser.toLocaleString('en-IN')} you gifted ${m.name} is added to your income (clubbing). The gift itself is not taxed.` });
      else if (m.relation === 'child') clubbing.push({ member: m.name, ruleId: 'CLUBBING', message: `A minor child's income from gifted money is clubbed with the parent who earns more (Rs 1,500 exemption per child).` });
      else if (m.relation === 'father' || m.relation === 'mother') clubbing.push({ member: m.name, ruleId: 'CLUBBING', message: `Gifts to parents are not clubbed: income on Rs ${m.giftsFromUser.toLocaleString('en-IN')} is taxed in ${m.name}'s hands at their slab rate.` });
    }
  }
  return {
    user: { tax: { new: uc.new.totalTax, old: uc.old.totalTax, best: uc.recommended } },
    members: views,
    familyTax: uc[uc.recommended].totalTax + views.reduce((s, v) => s + v.tax[v.tax.best], 0),
    healthInsurance: health,
    clubbingWarnings: clubbing,
  };
}
