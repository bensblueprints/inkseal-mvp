import express from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// tiny .env loader (no dependency): KEY=VALUE lines, existing env wins
try {
  const envFile = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env');
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch { /* no .env — use defaults */ }

import db, { DOCS_DIR, getSettings } from './db.js';
import { sha256Hex, appendAuditEvent, verifyChain } from './hash.js';
import { validatePdfUpload, flattenEnvelope, UploadRejected } from './pdf.js';
import { sendSigningInvite, sendCompletionEmail, smtpConfigured } from './mailer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 5334;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'changeme';
const DESKTOP_MODE = process.env.DESKTOP_MODE === '1';

const app = express();
app.set('trust proxy', true);
app.use(express.json({ limit: '3mb' })); // signature PNGs travel as base64 JSON, keep headroom

// ---------- auth (simple session tokens, in-memory) ----------
const sessions = new Set();

function parseCookies(req) {
  return Object.fromEntries(
    (req.headers.cookie || '').split(';').map((c) => {
      const i = c.indexOf('=');
      return i === -1 ? [c.trim(), ''] : [c.slice(0, i).trim(), decodeURIComponent(c.slice(i + 1).trim())];
    })
  );
}

function isAuthed(req) {
  if (DESKTOP_MODE) return true; // local desktop app: single trusted user
  return sessions.has(parseCookies(req).ink_session || '');
}

function requireAuth(req, res, next) {
  if (isAuthed(req)) return next();
  res.status(401).json({ error: 'unauthorized' });
}

function clientIp(req) {
  return (req.headers['x-forwarded-for'] || req.ip || req.socket?.remoteAddress || '').toString().split(',')[0].trim();
}

app.post('/api/login', (req, res) => {
  if ((req.body?.password || '') !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'wrong password' });
  }
  const token = crypto.randomBytes(24).toString('hex');
  sessions.add(token);
  res.setHeader('Set-Cookie', `ink_session=${token}; HttpOnly; Path=/; Max-Age=2592000; SameSite=Lax`);
  res.json({ ok: true });
});

app.post('/api/logout', (req, res) => {
  sessions.delete(parseCookies(req).ink_session || '');
  res.setHeader('Set-Cookie', 'ink_session=; HttpOnly; Path=/; Max-Age=0');
  res.json({ ok: true });
});

app.get('/api/me', (req, res) => res.json({ authed: isAuthed(req), desktop: DESKTOP_MODE }));
app.get('/api/health', (req, res) => res.json({ ok: true }));

// ---------- settings ----------
app.get('/api/settings', requireAuth, (req, res) => {
  const s = getSettings();
  res.json({ ...s, smtp_pass: s.smtp_pass ? '********' : '' });
});

app.put('/api/settings', requireAuth, (req, res) => {
  const b = req.body || {};
  const cur = getSettings();
  const smtpPass = b.smtp_pass === '********' ? cur.smtp_pass : (b.smtp_pass ?? cur.smtp_pass);
  db.prepare(`
    UPDATE settings SET business_name=?, base_url=?, smtp_host=?, smtp_port=?, smtp_user=?, smtp_pass=?, smtp_from=?, smtp_secure=?
    WHERE id = 1
  `).run(
    b.business_name ?? cur.business_name, b.base_url ?? cur.base_url,
    b.smtp_host ?? cur.smtp_host, Number(b.smtp_port) || cur.smtp_port,
    b.smtp_user ?? cur.smtp_user, smtpPass, b.smtp_from ?? cur.smtp_from,
    b.smtp_secure !== undefined ? (b.smtp_secure ? 1 : 0) : cur.smtp_secure
  );
  res.json({ ok: true });
});

app.get('/api/settings/smtp-status', requireAuth, (req, res) => res.json({ configured: smtpConfigured() }));

// ---------- helpers ----------
function baseUrl(req) {
  const s = getSettings();
  return s.base_url || `${req.protocol}://${req.get('host')}`;
}

function serializeEnvelope(row) {
  const signers = db.prepare('SELECT * FROM signers WHERE envelope_id = ? ORDER BY order_index ASC, id ASC').all(row.id);
  const fields = db.prepare('SELECT * FROM fields WHERE envelope_id = ?').all(row.id);
  return { ...row, signers, fields };
}

function getEnvelopeOr404(res, id) {
  const row = db.prepare('SELECT * FROM envelopes WHERE id = ?').get(id);
  if (!row) { res.status(404).json({ error: 'envelope not found' }); return null; }
  return row;
}

const FIELD_TYPES = ['signature', 'initials', 'date', 'text'];

// ---------- envelopes: create (multipart PDF upload) ----------
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 26 * 1024 * 1024 } });

app.post('/api/envelopes', requireAuth, upload.single('pdf'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'a PDF file is required (field name "pdf")' });
  try {
    await validatePdfUpload(req.file.buffer);
  } catch (err) {
    if (err instanceof UploadRejected) return res.status(400).json({ error: err.message });
    throw err;
  }
  const sha256 = sha256Hex(req.file.buffer);
  const id36 = crypto.randomBytes(6).toString('hex');
  const pdfPath = path.join(DOCS_DIR, `orig-${id36}.pdf`);
  fs.writeFileSync(pdfPath, req.file.buffer);

  const title = (req.body?.title || req.file.originalname || 'Untitled envelope').replace(/\.pdf$/i, '');
  const routing = req.body?.routing === 'parallel' ? 'parallel' : 'sequential';

  const info = db.prepare(`
    INSERT INTO envelopes (title, status, routing, original_pdf_path, original_sha256)
    VALUES (?, 'draft', ?, ?, ?)
  `).run(title, routing, pdfPath, sha256);

  appendAuditEvent(info.lastInsertRowid, {
    type: 'created', actor: 'admin', ip: clientIp(req), ua: req.get('user-agent') || '',
    data: { title, original_sha256: sha256 },
  });

  res.status(201).json(serializeEnvelope(db.prepare('SELECT * FROM envelopes WHERE id = ?').get(info.lastInsertRowid)));
});

app.get('/api/envelopes', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM envelopes ORDER BY id DESC').all();
  res.json(rows.map(serializeEnvelope));
});

app.get('/api/envelopes/:id', requireAuth, (req, res) => {
  const row = getEnvelopeOr404(res, req.params.id);
  if (!row) return;
  res.json(serializeEnvelope(row));
});

app.put('/api/envelopes/:id', requireAuth, (req, res) => {
  const cur = getEnvelopeOr404(res, req.params.id);
  if (!cur) return;
  const b = req.body || {};
  db.prepare('UPDATE envelopes SET title = ?, routing = ? WHERE id = ?').run(
    b.title ?? cur.title,
    b.routing === 'parallel' || b.routing === 'sequential' ? b.routing : cur.routing,
    cur.id
  );
  res.json(serializeEnvelope(db.prepare('SELECT * FROM envelopes WHERE id = ?').get(cur.id)));
});

app.delete('/api/envelopes/:id', requireAuth, (req, res) => {
  const cur = getEnvelopeOr404(res, req.params.id);
  if (!cur) return;
  db.prepare('DELETE FROM envelopes WHERE id = ?').run(cur.id); // cascades signers/fields/audit
  res.json({ ok: true });
});

// ---------- editor: set signers + fields together (draft only) ----------
app.put('/api/envelopes/:id/fields', requireAuth, (req, res) => {
  const cur = getEnvelopeOr404(res, req.params.id);
  if (!cur) return;
  if (cur.status !== 'draft') return res.status(409).json({ error: 'only draft envelopes can be edited' });

  const b = req.body || {};
  const signersIn = Array.isArray(b.signers) ? b.signers : [];
  const fieldsIn = Array.isArray(b.fields) ? b.fields : [];
  if (!signersIn.length) return res.status(400).json({ error: 'at least one signer is required' });

  const tx = db.transaction(() => {
    db.prepare('DELETE FROM fields WHERE envelope_id = ?').run(cur.id);
    db.prepare('DELETE FROM signers WHERE envelope_id = ?').run(cur.id);

    // localId -> real signer id, so the client can reference signers by an
    // ephemeral local key when creating fields in the same request
    const idMap = new Map();
    signersIn.forEach((s, i) => {
      if (!s.name?.trim()) throw new Error('every signer needs a name');
      const token = crypto.randomBytes(12).toString('hex');
      const info = db.prepare(`
        INSERT INTO signers (envelope_id, name, email, order_index, color, token, status)
        VALUES (?, ?, ?, ?, ?, ?, 'pending')
      `).run(cur.id, s.name.trim(), s.email || '', Number.isInteger(s.order_index) ? s.order_index : i, s.color || '#6366f1', token);
      idMap.set(s.localId ?? String(i), info.lastInsertRowid);
    });

    for (const f of fieldsIn) {
      if (!FIELD_TYPES.includes(f.type)) throw new Error(`invalid field type: ${f.type}`);
      const signerId = idMap.get(f.signerLocalId ?? f.signer_id);
      if (!signerId) throw new Error('field references an unknown signer');
      db.prepare(`
        INSERT INTO fields (envelope_id, signer_id, type, page, x, y, w, h, rotation, required)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(cur.id, signerId, f.type, Number(f.page) || 0, Number(f.x), Number(f.y), Number(f.w), Number(f.h), Number(f.rotation) || 0, f.required === false ? 0 : 1);
    }
  });

  try { tx(); } catch (err) { return res.status(400).json({ error: err.message }); }

  appendAuditEvent(cur.id, { type: 'fields_updated', actor: 'admin', ip: clientIp(req), ua: req.get('user-agent') || '', data: { signers: signersIn.length, fields: fieldsIn.length } });
  res.json(serializeEnvelope(db.prepare('SELECT * FROM envelopes WHERE id = ?').get(cur.id)));
});

// ---------- send / remind / void ----------
app.post('/api/envelopes/:id/send', requireAuth, async (req, res) => {
  const cur = getEnvelopeOr404(res, req.params.id);
  if (!cur) return;
  if (cur.status !== 'draft') return res.status(409).json({ error: 'envelope already sent' });
  const signers = db.prepare('SELECT * FROM signers WHERE envelope_id = ? ORDER BY order_index ASC, id ASC').all(cur.id);
  if (!signers.length) return res.status(400).json({ error: 'add at least one signer first' });

  const now = new Date().toISOString();
  db.prepare(`UPDATE envelopes SET status = 'sent', sent_at = ? WHERE id = ?`).run(now, cur.id);

  const toActivate = cur.routing === 'parallel' ? signers : signers.slice(0, 1);
  for (const s of toActivate) {
    db.prepare(`UPDATE signers SET status = 'active' WHERE id = ?`).run(s.id);
  }

  appendAuditEvent(cur.id, { type: 'sent', actor: 'admin', ip: clientIp(req), ua: req.get('user-agent') || '', data: { routing: cur.routing, signers: signers.length } });

  const sent = [];
  for (const s of toActivate) {
    const signUrl = `${baseUrl(req)}/sign/${s.token}`;
    const ok = await sendSigningInvite({ envelope: cur, signer: s, signUrl }).catch(() => false);
    if (ok) sent.push(s.id);
    appendAuditEvent(cur.id, { type: 'invite_sent', actor: 'admin', ip: clientIp(req), ua: req.get('user-agent') || '', data: { signer_id: s.id, emailed: ok } });
  }

  res.json({ ok: true, emailed: sent, smtp_configured: smtpConfigured(), envelope: serializeEnvelope(db.prepare('SELECT * FROM envelopes WHERE id = ?').get(cur.id)) });
});

app.post('/api/envelopes/:id/remind', requireAuth, async (req, res) => {
  const cur = getEnvelopeOr404(res, req.params.id);
  if (!cur) return;
  if (cur.status !== 'sent') return res.status(409).json({ error: 'envelope is not currently pending signatures' });
  const active = db.prepare(`SELECT * FROM signers WHERE envelope_id = ? AND status = 'active'`).all(cur.id);
  const results = [];
  for (const s of active) {
    const signUrl = `${baseUrl(req)}/sign/${s.token}`;
    const ok = await sendSigningInvite({ envelope: cur, signer: s, signUrl }).catch(() => false);
    results.push({ signer_id: s.id, emailed: ok });
    appendAuditEvent(cur.id, { type: 'reminder_sent', actor: 'admin', ip: clientIp(req), ua: req.get('user-agent') || '', data: { signer_id: s.id, emailed: ok } });
  }
  res.json({ ok: true, results, smtp_configured: smtpConfigured() });
});

app.post('/api/envelopes/:id/void', requireAuth, (req, res) => {
  const cur = getEnvelopeOr404(res, req.params.id);
  if (!cur) return;
  if (['completed', 'voided'].includes(cur.status)) return res.status(409).json({ error: `cannot void a ${cur.status} envelope` });
  db.prepare(`UPDATE envelopes SET status = 'voided' WHERE id = ?`).run(cur.id);
  appendAuditEvent(cur.id, { type: 'voided', actor: 'admin', ip: clientIp(req), ua: req.get('user-agent') || '' });
  res.json({ ok: true });
});

// ---------- audit / verify ----------
app.get('/api/envelopes/:id/audit', requireAuth, (req, res) => {
  const cur = getEnvelopeOr404(res, req.params.id);
  if (!cur) return;
  res.json(db.prepare('SELECT * FROM audit_events WHERE envelope_id = ? ORDER BY seq ASC').all(cur.id));
});

app.get('/api/envelopes/:id/verify', requireAuth, (req, res) => {
  const cur = getEnvelopeOr404(res, req.params.id);
  if (!cur) return;
  res.json(verifyChain(cur.id));
});

// ---------- original PDF (admin) + final PDF ----------
app.get('/api/envelopes/:id/original.pdf', requireAuth, (req, res) => {
  const cur = getEnvelopeOr404(res, req.params.id);
  if (!cur) return;
  res.setHeader('Content-Type', 'application/pdf');
  res.sendFile(path.resolve(cur.original_pdf_path));
});

app.get('/api/envelopes/:id/final.pdf', requireAuth, (req, res) => {
  const cur = getEnvelopeOr404(res, req.params.id);
  if (!cur) return;
  if (!cur.final_pdf_path || !fs.existsSync(cur.final_pdf_path)) return res.status(404).json({ error: 'not completed yet' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${cur.title.replace(/[^\w-]+/g, '_')}-signed.pdf"`);
  res.sendFile(path.resolve(cur.final_pdf_path));
});

// ---------- templates ----------
app.get('/api/templates', requireAuth, (req, res) => {
  res.json(db.prepare('SELECT * FROM templates ORDER BY id DESC').all().map((t) => ({
    ...t, fields_json: JSON.parse(t.fields_json), roles_json: JSON.parse(t.roles_json),
  })));
});

app.post('/api/templates', requireAuth, (req, res) => {
  const b = req.body || {};
  if (!b.name?.trim()) return res.status(400).json({ error: 'name is required' });
  const info = db.prepare(`
    INSERT INTO templates (name, pdf_path, fields_json, roles_json) VALUES (?, ?, ?, ?)
  `).run(b.name.trim(), b.pdf_path || null, JSON.stringify(b.fields || []), JSON.stringify(b.roles || []));
  res.status(201).json(db.prepare('SELECT * FROM templates WHERE id = ?').get(info.lastInsertRowid));
});

// Save an envelope's current PDF + fields + signer roles as a reusable template.
app.post('/api/envelopes/:id/save-as-template', requireAuth, (req, res) => {
  const cur = getEnvelopeOr404(res, req.params.id);
  if (!cur) return;
  const name = req.body?.name?.trim() || `${cur.title} template`;
  const signers = db.prepare('SELECT * FROM signers WHERE envelope_id = ? ORDER BY order_index ASC').all(cur.id);
  const fields = db.prepare('SELECT * FROM fields WHERE envelope_id = ?').all(cur.id);
  const roleOf = new Map(signers.map((s, i) => [s.id, `role_${i}`]));
  const templatePdfPath = path.join(DOCS_DIR, `template-${crypto.randomBytes(6).toString('hex')}.pdf`);
  fs.copyFileSync(cur.original_pdf_path, templatePdfPath);
  const info = db.prepare(`
    INSERT INTO templates (name, pdf_path, fields_json, roles_json) VALUES (?, ?, ?, ?)
  `).run(
    name, templatePdfPath,
    JSON.stringify(fields.map((f) => ({ ...f, role: roleOf.get(f.signer_id) }))),
    JSON.stringify(signers.map((s, i) => ({ role: roleOf.get(s.id), order_index: s.order_index, color: s.color, name_hint: s.name })))
  );
  res.status(201).json(db.prepare('SELECT * FROM templates WHERE id = ?').get(info.lastInsertRowid));
});

app.delete('/api/templates/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM templates WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Create a fresh draft envelope from a template: same PDF, remapped signer roles -> real signers.
app.post('/api/envelopes/from-template/:id', requireAuth, async (req, res) => {
  const tpl = db.prepare('SELECT * FROM templates WHERE id = ?').get(req.params.id);
  if (!tpl) return res.status(404).json({ error: 'template not found' });
  if (!tpl.pdf_path || !fs.existsSync(tpl.pdf_path)) return res.status(400).json({ error: 'template has no stored PDF; recreate it' });

  const b = req.body || {};
  const roleAssignments = b.signers || {}; // { role_0: {name,email,color}, ... }
  const buffer = fs.readFileSync(tpl.pdf_path);
  const sha256 = sha256Hex(buffer);
  const pdfPath = path.join(DOCS_DIR, `orig-${crypto.randomBytes(6).toString('hex')}.pdf`);
  fs.copyFileSync(tpl.pdf_path, pdfPath);

  const info = db.prepare(`
    INSERT INTO envelopes (title, status, routing, original_pdf_path, original_sha256, template_id)
    VALUES (?, 'draft', 'sequential', ?, ?, ?)
  `).run(b.title || tpl.name, pdfPath, sha256, tpl.id);

  const roles = JSON.parse(tpl.roles_json);
  const fields = JSON.parse(tpl.fields_json);
  const roleToSignerId = new Map();
  roles.forEach((r) => {
    const assign = roleAssignments[r.role] || {};
    const sInfo = db.prepare(`
      INSERT INTO signers (envelope_id, name, email, order_index, color, token, status)
      VALUES (?, ?, ?, ?, ?, ?, 'pending')
    `).run(info.lastInsertRowid, assign.name || r.name_hint || r.role, assign.email || '', r.order_index || 0, r.color || '#6366f1', crypto.randomBytes(12).toString('hex'));
    roleToSignerId.set(r.role, sInfo.lastInsertRowid);
  });
  for (const f of fields) {
    const signerId = roleToSignerId.get(f.role);
    if (!signerId) continue;
    db.prepare(`
      INSERT INTO fields (envelope_id, signer_id, type, page, x, y, w, h, rotation, required)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(info.lastInsertRowid, signerId, f.type, f.page, f.x, f.y, f.w, f.h, f.rotation || 0, f.required ? 1 : 0);
  }

  appendAuditEvent(info.lastInsertRowid, { type: 'created', actor: 'admin', ip: clientIp(req), ua: req.get('user-agent') || '', data: { from_template: tpl.id } });
  res.status(201).json(serializeEnvelope(db.prepare('SELECT * FROM envelopes WHERE id = ?').get(info.lastInsertRowid)));
});

// ================= PUBLIC SIGNING API (token-scoped, no auth) =================

function signerByToken(token) {
  return db.prepare('SELECT * FROM signers WHERE token = ?').get(token);
}

app.get('/api/sign/:token', (req, res) => {
  const signer = signerByToken(req.params.token);
  if (!signer) return res.status(404).json({ error: 'signing link not found' });
  const envelope = db.prepare('SELECT * FROM envelopes WHERE id = ?').get(signer.envelope_id);
  if (envelope.status === 'voided') return res.status(410).json({ error: 'this envelope has been voided' });

  const myFields = db.prepare('SELECT * FROM fields WHERE signer_id = ?').all(signer.id);
  const allSigners = db.prepare('SELECT id, name, order_index, color, status FROM signers WHERE envelope_id = ? ORDER BY order_index ASC').all(envelope.id);

  // record a "viewed" event once per signer, best-effort, not blocking
  if (!signer.consent_at && signer.status !== 'signed') {
    appendAuditEvent(envelope.id, { type: 'viewed', actor: signer.name, ip: clientIp(req), ua: req.get('user-agent') || '', data: { signer_id: signer.id } });
  }

  res.json({
    envelope: { id: envelope.id, title: envelope.title, status: envelope.status, routing: envelope.routing },
    signer: { id: signer.id, name: signer.name, status: signer.status, consent_at: signer.consent_at, color: signer.color },
    signers: allSigners,
    fields: myFields,
  });
});

app.get('/api/sign/:token/pdf', (req, res) => {
  const signer = signerByToken(req.params.token);
  if (!signer) return res.status(404).end();
  const envelope = db.prepare('SELECT * FROM envelopes WHERE id = ?').get(signer.envelope_id);
  if (envelope.status === 'voided') return res.status(410).end();
  res.setHeader('Content-Type', 'application/pdf');
  res.sendFile(path.resolve(envelope.original_pdf_path));
});

function requireSignable(req, res) {
  const signer = signerByToken(req.params.token);
  if (!signer) { res.status(404).json({ error: 'signing link not found' }); return null; }
  const envelope = db.prepare('SELECT * FROM envelopes WHERE id = ?').get(signer.envelope_id);
  if (envelope.status === 'voided') { res.status(410).json({ error: 'this envelope has been voided' }); return null; }
  if (signer.status === 'signed' || signer.status === 'declined') { res.status(409).json({ error: 'you have already responded to this envelope' }); return null; }
  if (signer.status !== 'active') { res.status(403).json({ error: 'it is not your turn yet — other signers must complete first' }); return null; }
  return { signer, envelope };
}

app.post('/api/sign/:token/consent', (req, res) => {
  const ctx = requireSignable(req, res);
  if (!ctx) return;
  const now = new Date().toISOString();
  db.prepare('UPDATE signers SET consent_at = ? WHERE id = ?').run(now, ctx.signer.id);
  appendAuditEvent(ctx.envelope.id, { type: 'consented', actor: ctx.signer.name, ip: clientIp(req), ua: req.get('user-agent') || '', data: { signer_id: ctx.signer.id } });
  res.json({ ok: true, consent_at: now });
});

app.post('/api/sign/:token/fields/:fieldId', (req, res) => {
  const ctx = requireSignable(req, res);
  if (!ctx) return;
  const field = db.prepare('SELECT * FROM fields WHERE id = ? AND envelope_id = ?').get(req.params.fieldId, ctx.envelope.id);
  if (!field) return res.status(404).json({ error: 'field not found' });
  if (field.signer_id !== ctx.signer.id) return res.status(403).json({ error: 'this field belongs to another signer' });

  const b = req.body || {};
  const now = new Date().toISOString();

  if ((field.type === 'signature' || field.type === 'initials') && b.png_base64) {
    const base64 = b.png_base64.replace(/^data:image\/png;base64,/, '');
    const buf = Buffer.from(base64, 'base64');
    if (buf.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') return res.status(400).json({ error: 'not a valid PNG' });
    const pngPath = path.join(DOCS_DIR, `sig-${field.id}-${crypto.randomBytes(4).toString('hex')}.png`);
    fs.writeFileSync(pngPath, buf);
    db.prepare('UPDATE fields SET signature_png_path = ?, value_text = NULL, signed_at = ? WHERE id = ?').run(pngPath, now, field.id);
  } else if (typeof b.value_text === 'string') {
    db.prepare('UPDATE fields SET value_text = ?, signature_png_path = NULL, signed_at = ? WHERE id = ?').run(b.value_text, now, field.id);
  } else {
    return res.status(400).json({ error: 'provide png_base64 or value_text' });
  }

  appendAuditEvent(ctx.envelope.id, { type: 'field_signed', actor: ctx.signer.name, ip: clientIp(req), ua: req.get('user-agent') || '', data: { field_id: field.id, type: field.type } });
  res.json({ ok: true });
});

app.post('/api/sign/:token/complete', async (req, res) => {
  const ctx = requireSignable(req, res);
  if (!ctx) return;
  const { signer, envelope } = ctx;
  if (!signer.consent_at) return res.status(400).json({ error: 'you must agree to sign electronically before completing' });

  const myFields = db.prepare('SELECT * FROM fields WHERE signer_id = ?').all(signer.id);
  const missing = myFields.filter((f) => f.required && !f.value_text && !f.signature_png_path);
  if (missing.length) return res.status(400).json({ error: `please complete all required fields (${missing.length} remaining)` });

  const now = new Date().toISOString();
  db.prepare(`UPDATE signers SET status = 'signed', signed_at = ? WHERE id = ?`).run(now, signer.id);
  appendAuditEvent(envelope.id, { type: 'signer_completed', actor: signer.name, ip: clientIp(req), ua: req.get('user-agent') || '', data: { signer_id: signer.id } });

  const allSigners = db.prepare('SELECT * FROM signers WHERE envelope_id = ? ORDER BY order_index ASC, id ASC').all(envelope.id);
  const stillPending = allSigners.filter((s) => s.status !== 'signed');

  if (stillPending.length === 0) {
    // everyone's done — flatten + complete
    const result = await completeEnvelope(envelope, req);
    return res.json({ ok: true, envelope_completed: true, ...result });
  }

  if (envelope.routing === 'sequential') {
    const next = stillPending.find((s) => s.status === 'pending');
    if (next) {
      db.prepare(`UPDATE signers SET status = 'active' WHERE id = ?`).run(next.id);
      const signUrl = `${baseUrl(req)}/sign/${next.token}`;
      const ok = await sendSigningInvite({ envelope, signer: next, signUrl }).catch(() => false);
      appendAuditEvent(envelope.id, { type: 'invite_sent', actor: 'system', ip: clientIp(req), ua: req.get('user-agent') || '', data: { signer_id: next.id, emailed: ok } });
    }
  }

  res.json({ ok: true, envelope_completed: false });
});

async function completeEnvelope(envelope, req) {
  const fields = db.prepare('SELECT * FROM fields WHERE envelope_id = ?').all(envelope.id);
  const signers = db.prepare('SELECT * FROM signers WHERE envelope_id = ? ORDER BY order_index ASC').all(envelope.id);
  const originalBytes = fs.readFileSync(envelope.original_pdf_path);
  const auditEvents = db.prepare('SELECT * FROM audit_events WHERE envelope_id = ? ORDER BY seq ASC').all(envelope.id);

  const finalBytes = await flattenEnvelope({ envelope, fields, signers, originalBytes, auditEvents });
  const finalPath = path.join(DOCS_DIR, `final-${envelope.id}.pdf`);
  fs.writeFileSync(finalPath, finalBytes);

  const now = new Date().toISOString();
  db.prepare(`UPDATE envelopes SET status = 'completed', completed_at = ?, final_pdf_path = ? WHERE id = ?`).run(now, finalPath, envelope.id);
  appendAuditEvent(envelope.id, { type: 'completed', actor: 'system', ip: clientIp(req), ua: req.get('user-agent') || '', data: { final_sha256: sha256Hex(finalBytes) } });

  const recipients = signers.map((s) => s.email).filter(Boolean);
  const emailed = await sendCompletionEmail({ envelope, recipients, pdfBuffer: Buffer.from(finalBytes) }).catch(() => false);
  appendAuditEvent(envelope.id, { type: 'completion_emailed', actor: 'system', ip: clientIp(req), ua: req.get('user-agent') || '', data: { emailed, recipients: recipients.length } });

  return { final_pdf_size: finalBytes.length };
}

app.post('/api/sign/:token/decline', (req, res) => {
  const signer = signerByToken(req.params.token);
  if (!signer) return res.status(404).json({ error: 'signing link not found' });
  const envelope = db.prepare('SELECT * FROM envelopes WHERE id = ?').get(signer.envelope_id);
  if (envelope.status === 'voided') return res.status(410).json({ error: 'this envelope has been voided' });
  if (signer.status === 'signed' || signer.status === 'declined') return res.status(409).json({ error: 'already responded' });

  const now = new Date().toISOString();
  const reason = (req.body?.reason || '').slice(0, 500);
  db.prepare(`UPDATE signers SET status = 'declined', decline_reason = ? WHERE id = ?`).run(reason, signer.id);
  db.prepare(`UPDATE envelopes SET status = 'declined' WHERE id = ?`).run(envelope.id);
  appendAuditEvent(envelope.id, { type: 'declined', actor: signer.name, ip: clientIp(req), ua: req.get('user-agent') || '', data: { signer_id: signer.id, reason } });
  res.json({ ok: true });
});

// ---------- static frontend ----------
const distDir = path.join(__dirname, '..', 'dist');
app.use(express.static(distDir));
app.get(/^(?!\/api\/).*/, (req, res) => {
  const index = path.join(distDir, 'index.html');
  if (fs.existsSync(index)) return res.sendFile(index);
  res.status(503).send('Frontend not built. Run: npm run build');
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  res.status(400).json({ error: err.message });
});

// NO_LISTEN=1 lets an embedder (tests, Electron wrapper) import the app and listen itself.
if (process.env.NODE_ENV !== 'test' && process.env.NO_LISTEN !== '1') {
  app.listen(PORT, () => {
    console.log(`Inkseal running on http://localhost:${PORT}${DESKTOP_MODE ? ' (desktop mode)' : ''}`);
    if (ADMIN_PASSWORD === 'changeme' && !DESKTOP_MODE) {
      console.log('WARNING: using default admin password. Set ADMIN_PASSWORD in .env');
    }
  });
}

export default app;
