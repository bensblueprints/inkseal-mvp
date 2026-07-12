// License gate: first document free, then a $59 lifetime Whop license.
//
// Whop generates keys in the format W-XXXXXX-XXXXXXXX-XXXXXXXW and shows them
// to the buyer in their Whop hub. We validate via Whop's validate_license API
// (which binds a machine_id on first call and rejects mismatches after that).
// If WHOP_API_KEY is not set, a well-formed key is accepted with a warning —
// graceful until the Software experience is attached in the Whop dashboard.
import crypto from 'node:crypto';
import os from 'node:os';
import db, { DATA_DIR } from './db.js';

export const CHECKOUT_URL = 'https://whop.com/checkout/plan_xRtPj9lTHiX0x';
export const FREE_ENVELOPE_LIMIT = 1;

const WHOP_KEY_RE = /^W-[A-Z0-9]{6}-[A-Z0-9]{8}-[A-Z0-9]{7}$/;

/** Users paste keys with or without dashes — normalize before validating. */
export function normalizeLicenseKey(raw) {
  const cleaned = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (cleaned.startsWith('W') && cleaned.endsWith('W') && cleaned.length === 22) {
    return `W-${cleaned.slice(1, 7)}-${cleaned.slice(7, 15)}-${cleaned.slice(15, 22)}`;
  }
  return String(raw || '').trim().toUpperCase();
}

/** Stable per-install machine id (hostname + user + data dir). */
export function machineId() {
  return crypto.createHash('sha256')
    .update(`${os.hostname()}|${os.userInfo().username}|${DATA_DIR}`)
    .digest('hex')
    .slice(0, 32);
}

export function getLicense() {
  return db.prepare('SELECT * FROM license WHERE id = 1').get();
}

export function isLicensed() {
  return !!getLicense().key;
}

export function licenseStatus() {
  const row = getLicense();
  return {
    licensed: !!row.key,
    source: row.source || null,
    activated_at: row.activated_at || null,
    free_used: row.free_envelopes_used,
    free_limit: FREE_ENVELOPE_LIMIT,
    checkout_url: CHECKOUT_URL,
  };
}

/** Count a free-plan envelope. Never decremented — deleting doesn't refund. */
export function noteFreeEnvelopeUsed() {
  db.prepare('UPDATE license SET free_envelopes_used = free_envelopes_used + 1 WHERE id = 1').run();
}

/**
 * Envelope-creation gate. Returns true if creation may proceed; otherwise
 * responds 402 with the upgrade payload and returns false.
 */
export function requireEnvelopeQuota(res) {
  if (isLicensed()) return true;
  if (getLicense().free_envelopes_used < FREE_ENVELOPE_LIMIT) return true;
  res.status(402).json({
    error: 'Free plan includes one document. Upgrade for $59 once — unlimited documents forever.',
    upgrade: true,
    checkout_url: CHECKOUT_URL,
  });
  return false;
}

/**
 * Activate a license key. Returns { ok: true, source } or
 * { ok: false, status, error } for the route to relay.
 */
export async function activateLicense(rawKey) {
  const key = normalizeLicenseKey(rawKey);
  if (!WHOP_KEY_RE.test(key)) {
    return { ok: false, status: 400, error: 'That does not look like a Whop license key (format: W-XXXXXX-XXXXXXXX-XXXXXXXW).' };
  }

  let source = 'unverified';
  if (process.env.WHOP_API_KEY) {
    let whopRes;
    try {
      whopRes = await fetch(`https://api.whop.com/api/v2/memberships/${encodeURIComponent(key)}/validate_license`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.WHOP_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ metadata: { machine_id: machineId() } }),
      });
    } catch {
      return { ok: false, status: 502, error: 'Could not reach Whop to validate the key. Check your connection and try again.' };
    }
    // Whop returns 200 (sometimes 201) on success; 400 when the key is bound to another machine.
    if (whopRes.status !== 200 && whopRes.status !== 201) {
      if (whopRes.status === 400) {
        return { ok: false, status: 409, error: 'This key is already active on another machine. Reset it at whop.com/@me, then try again.' };
      }
      return { ok: false, status: 401, error: 'Whop rejected this license key. Check it in your Whop hub (whop.com/@me).' };
    }
    source = 'whop';
  } else {
    console.warn('WHOP_API_KEY not set — accepting well-formed license key without Whop-side validation.');
  }

  db.prepare('UPDATE license SET key = ?, machine_id = ?, activated_at = ?, source = ? WHERE id = 1')
    .run(key, machineId(), new Date().toISOString(), source);
  return { ok: true, source };
}
