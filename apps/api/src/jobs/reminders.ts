import { env } from '../env';
import { DeadlineModel, User } from '../models';
import { sendMail } from '../services/email';

/** Send reminder emails 30, 7 and 1 day before each open deadline. Idempotent per reminder date. */
export async function sendDueReminders(now = new Date()) {
  const todayStr = now.toISOString().slice(0, 10);
  const due = await DeadlineModel.find({ status: 'open', remindAt: { $lte: todayStr }, dueDate: { $gte: todayStr } }).lean();
  let sent = 0;
  for (const d of due) {
    const pending = (d.remindAt ?? []).filter((r) => r <= todayStr && !(d.remindersSent ?? []).includes(r));
    if (!pending.length) continue;
    const user = await User.findById(d.userId).lean();
    if (!user || user.consentFlags?.emailReminders === false) {
      await DeadlineModel.updateOne({ _id: d._id }, { $addToSet: { remindersSent: { $each: pending } } });
      continue;
    }
    const days = Math.round((Date.parse(d.dueDate!) - Date.parse(todayStr)) / 86400000);
    const amount = d.amount ? ` Amount: Rs ${d.amount.toLocaleString('en-IN')}.` : '';
    await sendMail(
      user.email,
      `FiscAI: ${d.title} — due in ${days} day${days === 1 ? '' : 's'}`,
      `${d.title} is due on ${d.dueDate}.${amount}\n\nOpen your planner: ${env.APP_URL}/planner\n\nFiscAI provides estimates for information only; verify with a qualified professional.`,
    );
    await DeadlineModel.updateOne({ _id: d._id }, { $addToSet: { remindersSent: { $each: pending } } });
    sent++;
  }
  return { checked: due.length, sent };
}
