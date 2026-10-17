import { generateDeadlines, reminderDates, type ScenarioDeadline } from '@fiscai/tax-engine';
import type { Types } from 'mongoose';
import { today } from '../lib/http';
import { DeadlineModel } from '../models';
import { getProfile } from './profile';

/** Regenerate profile-driven deadlines; keeps user status (done/dismissed) and sent reminders. */
export async function syncDeadlines(userId: Types.ObjectId, taxYear: string) {
  const { profile, version } = await getProfile(userId, taxYear);
  if (version === 0) return;
  const generated = generateDeadlines(profile, today());
  const keys = generated.map((d) => `${taxYear}:${d.type}:${d.dueDate}:${d.triggerEvent}`);
  await Promise.all(generated.map((d, i) =>
    DeadlineModel.updateOne(
      { userId, key: keys[i] },
      { $set: { taxYear, type: d.type, title: d.title, dueDate: d.dueDate, triggerEvent: d.triggerEvent, ruleId: d.ruleId, amount: d.amount, remindAt: d.remindAt, origin: 'generated' }, $setOnInsert: { status: 'open', remindersSent: [] } },
      { upsert: true },
    )));
  // Generated deadlines that no longer apply are removed (scenario/custom ones stay).
  await DeadlineModel.deleteMany({ userId, taxYear, origin: 'generated', key: { $nin: keys } });
}

export async function addScenarioDeadlines(userId: Types.ObjectId, taxYear: string, scenarioId: string, deadlines: ScenarioDeadline[]) {
  await Promise.all(deadlines.map((d) =>
    DeadlineModel.updateOne(
      { userId, key: `${taxYear}:scenario:${scenarioId}:${d.type}` },
      { $set: { taxYear, type: d.type, title: d.title, dueDate: d.dueDate, triggerEvent: `scenario:${scenarioId}`, ruleId: d.ruleId, origin: 'scenario', remindAt: reminderDates(d.dueDate) }, $setOnInsert: { status: 'open', remindersSent: [] } },
      { upsert: true },
    )));
}
