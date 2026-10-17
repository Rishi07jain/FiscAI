import type { ItrPack } from '@fiscai/tax-engine';
import PDFDocument from 'pdfkit';

const inr = (n: number) => `Rs ${Math.round(n).toLocaleString('en-IN')}`;

/** F13: schedule-wise summary for the user or their CA. */
export function itrPdf(pack: ItrPack): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48, info: { Title: `FiscAI ITR readiness pack ${pack.taxYear}` } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const lime = '#5f9a00';
    doc.fontSize(20).fillColor('#111').text('FiscAI · ITR readiness pack');
    doc.moveDown(0.2).fontSize(10).fillColor('#555').text(`Tax Year ${pack.taxYear} · ${pack.regime} regime · generated ${pack.generatedAt.slice(0, 10)}`);
    doc.moveDown(0.8).fontSize(13).fillColor(lime).text(`Recommended form: ${pack.form.form}`);
    doc.fontSize(10).fillColor('#333');
    pack.form.reasons.forEach((r) => doc.text(`• ${r}`));

    const section = (title: string, rows: [string, number | string][]) => {
      doc.moveDown(0.8).fontSize(12).fillColor('#111').text(title);
      doc.moveTo(doc.x, doc.y + 2).lineTo(547, doc.y + 2).strokeColor('#ddd').stroke();
      doc.moveDown(0.3).fontSize(10).fillColor('#333');
      for (const [k, v] of rows) {
        const y = doc.y;
        doc.text(k, 48, y, { width: 330 });
        doc.text(typeof v === 'number' ? inr(v) : v, 380, y, { width: 167, align: 'right' });
      }
    };
    const s = pack.schedules;
    section('Schedule S — Salary', [['Employer', s.salary.employer ?? '—'], ['Gross salary', s.salary.gross], ['Exemptions (HRA)', s.salary.exemptions], ['Standard deduction', s.salary.standardDeduction], ['Professional tax', s.salary.professionalTax], ['Income from salary', s.salary.net]]);
    section('Schedule HP — House property', [['Self-occupied interest', s.houseProperty.selfOccupiedInterest], ['Let-out income', s.houseProperty.letOutIncome], ['Allowed against income', s.houseProperty.total]]);
    section('Schedule CG — Capital gains (after set-off)', [['STCG at slab rate', s.capitalGains.shortTermSlab], ['STCG u/s 111A (20%)', s.capitalGains.shortTerm111A], ['LTCG u/s 112A (12.5%)', s.capitalGains.longTerm112A], ['LTCG u/s 112 (12.5%)', s.capitalGains.longTerm112], ['LTCG with indexation (20%)', s.capitalGains.longTermIndexed], ['Exempt via 54/54F/54EC', s.capitalGains.exemptions54]]);
    if (s.capitalGains.txns.length) {
      doc.moveDown(0.3).fontSize(8).fillColor('#555');
      s.capitalGains.txns.slice(0, 40).forEach((t) => doc.text(`${t.label} · ${t.term}-term · ${t.bucket} · gain ${inr(t.gain)}`));
    }
    section('Schedule BP — Business (F&O / intraday)', [['F&O turnover', s.businessIncome.fnoTurnover], ['F&O profit / (loss)', s.businessIncome.fnoProfit], ['Speculative turnover', s.businessIncome.speculativeTurnover], ['Speculative profit / (loss)', s.businessIncome.speculativeProfit], ['Presumptive income', s.businessIncome.presumptive]]);
    section('Schedule OS — Other sources', [['Interest', s.otherSources.interest], ['Dividends', s.otherSources.dividends], ['Family pension (net)', s.otherSources.familyPension], ['Other', s.otherSources.other]]);
    if (s.vda.gains || s.vda.lossesIgnored) section('Schedule VDA', [['Gains taxed at 30%', s.vda.gains], ['Losses (not allowed)', s.vda.lossesIgnored]]);
    section('Schedule VI-A — Deductions', s.deductions.items.map((i) => [i.label, i.allowed] as [string, number]).concat([['Total', s.deductions.total]]));
    section('Schedule CFL — Losses to carry forward', [['Short-term capital loss', s.carriedForwardLosses.stcl], ['Long-term capital loss', s.carriedForwardLosses.ltcl], ['Business loss', s.carriedForwardLosses.business], ['Speculative loss', s.carriedForwardLosses.speculative], ['House property loss', s.carriedForwardLosses.houseProperty]]);
    const tc = s.taxComputation;
    section('Tax computation', [['Total income', tc.totalIncome], ['Tax at slab rates', tc.slabTax], ['Special-rate tax', tc.specialTax], ['Rebate / marginal relief', -tc.rebate], ['Surcharge', tc.surcharge], ['Cess', tc.cess], ['Total tax', tc.totalTax], ['TDS + TCS + advance + self-assessment', tc.prepaid.total], [tc.balance >= 0 ? 'Balance payable' : 'Refund due', Math.abs(tc.balance)]]);
    doc.moveDown(1.2).fontSize(8).fillColor('#777').text(pack.disclaimer);
    doc.end();
  });
}
