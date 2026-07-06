// Hash-chained audit trail.
//
// Every event for an envelope is written with:
//   hash = sha256(prev_hash + canonicalJson(event))
// where `event` is { seq, type, actor, ip, ua, at, data } and the genesis
// event's prev_hash is sha256(original PDF bytes) — i.e. the chain is rooted
// in the document itself, not an arbitrary constant.
//
// canonicalJson() sorts object keys recursively so hashing is deterministic
// regardless of property insertion order (JS objects are usually stable, but
// we don't want that to be load-bearing).
import crypto from 'node:crypto';
import db from './db.js';

export function sha256Hex(bufferOrString) {
  return crypto.createHash('sha256').update(bufferOrString).digest('hex');
}

/** Deterministic JSON stringify: recursively sorts object keys. */
export function canonicalJson(value) {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') {
    return Object.keys(v).sort().reduce((acc, k) => {
      acc[k] = sortKeys(v[k]);
      return acc;
    }, {});
  }
  return v;
}

function eventPayload(row) {
  return {
    seq: row.seq,
    type: row.type,
    actor: row.actor,
    ip: row.ip,
    ua: row.ua,
    at: row.at,
    data: JSON.parse(row.data_json || '{}'),
  };
}

/**
 * Append one audit event to an envelope's hash chain. Must be called inside
 * a synchronous better-sqlite3 transaction by the caller when it needs to be
 * atomic with other writes (e.g. marking a signer as signed).
 */
export function appendAuditEvent(envelopeId, { type, actor = '', ip = '', ua = '', data = {} }) {
  const last = db.prepare(
    'SELECT * FROM audit_events WHERE envelope_id = ? ORDER BY seq DESC LIMIT 1'
  ).get(envelopeId);

  let seq, prevHash;
  if (last) {
    seq = last.seq + 1;
    prevHash = last.hash;
  } else {
    // genesis: chain root is the original document's own hash, not a constant —
    // ties the audit trail to the exact bytes that were uploaded.
    const env = db.prepare('SELECT original_sha256 FROM envelopes WHERE id = ?').get(envelopeId);
    seq = 0;
    prevHash = env.original_sha256;
  }

  const at = new Date().toISOString();
  const hash = sha256Hex(prevHash + canonicalJson({ seq, type, actor, ip, ua, at, data }));

  db.prepare(`
    INSERT INTO audit_events (envelope_id, seq, type, actor, ip, ua, at, data_json, hash, prev_hash)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(envelopeId, seq, type, actor, ip, ua, at, JSON.stringify(data), hash, prevHash);

  return db.prepare('SELECT * FROM audit_events WHERE envelope_id = ? AND seq = ?').get(envelopeId, seq);
}

/** Recompute the chain from scratch and report where it breaks, if anywhere. */
export function verifyChain(envelopeId) {
  const env = db.prepare('SELECT original_sha256 FROM envelopes WHERE id = ?').get(envelopeId);
  if (!env) return { valid: false, error: 'envelope not found' };

  const rows = db.prepare(
    'SELECT * FROM audit_events WHERE envelope_id = ? ORDER BY seq ASC'
  ).all(envelopeId);

  let expectedPrev = env.original_sha256;
  for (const row of rows) {
    if (row.prev_hash !== expectedPrev) {
      return { valid: false, brokenAt: row.seq, reason: 'prev_hash mismatch' };
    }
    const recomputed = sha256Hex(row.prev_hash + canonicalJson(eventPayload(row)));
    if (recomputed !== row.hash) {
      return { valid: false, brokenAt: row.seq, reason: 'hash mismatch (event data tampered)' };
    }
    expectedPrev = row.hash;
  }
  return { valid: true, events: rows.length };
}
