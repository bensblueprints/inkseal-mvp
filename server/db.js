import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

export const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
export const DOCS_DIR = path.join(DATA_DIR, 'docs');
fs.mkdirSync(DOCS_DIR, { recursive: true });

// Under Electron the Node-ABI binding won't load; use the vendored Electron
// prebuild instead (see scripts/setup-native.js, which vendors both at
// `npm install` time and restores the Node binding afterward).
function nativeBindingPath() {
  if (!process.versions.electron) return null;
  const p = path.join(ROOT, 'vendor', 'better_sqlite3-electron.node')
    .replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep);
  return fs.existsSync(p) ? p : null;
}

const nativeBinding = nativeBindingPath();
const db = new Database(path.join(DATA_DIR, 'inkseal.db'), nativeBinding ? { nativeBinding } : {});
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  business_name TEXT DEFAULT '',
  base_url TEXT DEFAULT '',
  smtp_host TEXT DEFAULT '',
  smtp_port INTEGER DEFAULT 587,
  smtp_user TEXT DEFAULT '',
  smtp_pass TEXT DEFAULT '',
  smtp_from TEXT DEFAULT '',
  smtp_secure INTEGER DEFAULT 0
);
INSERT OR IGNORE INTO settings (id) VALUES (1);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS envelopes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL DEFAULT 'Untitled envelope',
  status TEXT NOT NULL DEFAULT 'draft',        -- draft|sent|completed|declined|voided
  routing TEXT NOT NULL DEFAULT 'sequential',  -- sequential|parallel
  original_pdf_path TEXT NOT NULL,
  original_sha256 TEXT NOT NULL,
  final_pdf_path TEXT,
  template_id INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  sent_at TEXT,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS signers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  envelope_id INTEGER NOT NULL REFERENCES envelopes(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  order_index INTEGER NOT NULL DEFAULT 0,
  color TEXT NOT NULL DEFAULT '#6366f1',
  token TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending',      -- pending|active|signed|declined
  signed_at TEXT,
  consent_at TEXT,
  decline_reason TEXT
);

CREATE TABLE IF NOT EXISTS fields (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  envelope_id INTEGER NOT NULL REFERENCES envelopes(id) ON DELETE CASCADE,
  signer_id INTEGER NOT NULL REFERENCES signers(id) ON DELETE CASCADE,
  type TEXT NOT NULL,                          -- signature|initials|date|text
  page INTEGER NOT NULL DEFAULT 0,
  x REAL NOT NULL, y REAL NOT NULL, w REAL NOT NULL, h REAL NOT NULL,
  rotation INTEGER NOT NULL DEFAULT 0,
  required INTEGER NOT NULL DEFAULT 1,
  value_text TEXT,
  signature_png_path TEXT,
  signed_at TEXT
);

CREATE TABLE IF NOT EXISTS audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  envelope_id INTEGER NOT NULL REFERENCES envelopes(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  type TEXT NOT NULL,
  actor TEXT NOT NULL DEFAULT '',
  ip TEXT NOT NULL DEFAULT '',
  ua TEXT NOT NULL DEFAULT '',
  at TEXT NOT NULL,
  data_json TEXT NOT NULL DEFAULT '{}',
  hash TEXT NOT NULL,
  prev_hash TEXT NOT NULL,
  UNIQUE(envelope_id, seq)
);

CREATE TABLE IF NOT EXISTS templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  pdf_path TEXT,
  fields_json TEXT NOT NULL DEFAULT '[]',
  roles_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS license (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  key TEXT,
  machine_id TEXT,
  activated_at TEXT,
  source TEXT,                                 -- 'whop' (API-verified) | 'unverified' (format-only)
  free_envelopes_used INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO license (id) VALUES (1);
`);

// Installs that predate the license table shouldn't get a fresh free document:
// count envelopes that already exist toward the free allowance.
db.prepare(`
  UPDATE license SET free_envelopes_used = (SELECT COUNT(*) FROM envelopes)
  WHERE id = 1 AND key IS NULL AND free_envelopes_used < (SELECT COUNT(*) FROM envelopes)
`).run();

export default db;

export function getSettings() {
  return db.prepare('SELECT * FROM settings WHERE id = 1').get();
}
