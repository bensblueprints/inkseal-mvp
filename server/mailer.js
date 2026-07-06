import nodemailer from 'nodemailer';
import { getSettings } from './db.js';

export function smtpConfigured() {
  const s = getSettings();
  return Boolean(s.smtp_host && s.smtp_from);
}

function transporter(s) {
  return nodemailer.createTransport({
    host: s.smtp_host,
    port: Number(s.smtp_port) || 587,
    secure: Boolean(s.smtp_secure) || Number(s.smtp_port) === 465,
    auth: s.smtp_user ? { user: s.smtp_user, pass: s.smtp_pass } : undefined,
  });
}

/** Signing invitation for one signer. Returns true if sent, false if SMTP not configured. */
export async function sendSigningInvite({ envelope, signer, signUrl }) {
  const s = getSettings();
  if (!s.smtp_host || !s.smtp_from || !signer.email) return false;
  await transporter(s).sendMail({
    from: s.smtp_from,
    to: signer.email,
    subject: `Please sign: ${envelope.title}`,
    text:
      `Hi ${signer.name},\n\n` +
      `${s.business_name || 'Someone'} has sent you "${envelope.title}" to review and sign.\n\n` +
      `Sign it here: ${signUrl}\n\n` +
      `This is a legally binding electronic signature request. If you weren't expecting this, you can safely ignore it.\n`,
  });
  return true;
}

/** Completion email with the flattened final PDF attached, to owner + all signers. */
export async function sendCompletionEmail({ envelope, recipients, pdfBuffer }) {
  const s = getSettings();
  if (!s.smtp_host || !s.smtp_from) return false;
  const to = recipients.filter(Boolean);
  if (!to.length) return false;
  await transporter(s).sendMail({
    from: s.smtp_from,
    to,
    subject: `Completed: ${envelope.title}`,
    text:
      `"${envelope.title}" has been signed by all parties.\n\n` +
      `The fully executed document (with signatures and audit certificate) is attached.\n`,
    attachments: [{ filename: `${envelope.title.replace(/[^\w-]+/g, '_')}-signed.pdf`, content: pdfBuffer }],
  });
  return true;
}
