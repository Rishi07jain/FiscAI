import nodemailer from 'nodemailer';
import { env, flags } from '../env';

const transport = flags.smtp
  ? nodemailer.createTransport({ host: env.SMTP_HOST, port: env.SMTP_PORT, secure: env.SMTP_PORT === 465, auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined })
  : nodemailer.createTransport({ jsonTransport: true });

export async function sendMail(to: string, subject: string, text: string, html?: string) {
  const info = await transport.sendMail({ from: env.MAIL_FROM, to, subject, text, html });
  if (!flags.smtp) console.log(`[email:dev] to=${to} subject="${subject}"`);
  return info;
}
