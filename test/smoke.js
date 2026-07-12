// Smoke test — exercises the real API end to end on port 5434 with a temp
// DB/DATA_DIR:
//   upload -> place fields (2 sequential signers) -> sequential enforcement
//   -> sign in order -> flatten to final PDF (embedded image XObject asserted)
//   -> audit chain verifies -> tamper detection -> license gate (first document
//   free, second blocked 402, key activation) -> decline path -> void 410.
//
// Coordinate-mapping unit tests (0/90/180/270 rotation) live in
// test/coords.test.js and are run first by `npm test`.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { PDFDocument, StandardFonts, PDFName, PDFDict } from 'pdf-lib';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, 'out');
fs.rmSync(OUT_DIR, { recursive: true, force: true });
fs.mkdirSync(OUT_DIR, { recursive: true });

process.env.NODE_ENV = 'test';
process.env.PORT = '5434';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'inkseal-test-'));
process.env.ADMIN_PASSWORD = 'test-password';
delete process.env.WHOP_API_KEY; // exercise the graceful (format-only) license path

const { default: app } = await import('../server/index.js');
const server = app.listen(5434, '127.0.0.1');
await new Promise((r) => server.once('listening', r));
const BASE = 'http://127.0.0.1:5434';

let cookie = '';
async function api(method, url, body, raw = false) {
  const opts = { method, headers: { cookie } };
  if (body instanceof FormData) opts.body = body;
  else if (body !== undefined) {
    opts.headers['content-type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(BASE + url, opts);
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  if (raw) return res;
  const isJson = res.headers.get('content-type')?.includes('json');
  const data = isJson ? await res.json().catch(() => ({})) : await res.text();
  return { status: res.status, data };
}

// ---- generate a real 2-page fixture PDF with known text (pdf-lib) ----
async function makeFixturePdf() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const p1 = doc.addPage([612, 792]);
  p1.drawText('INKSEAL TEST FIXTURE — PAGE 1', { x: 50, y: 740, size: 16, font });
  p1.drawText('Signer A signs here, Signer B initials here.', { x: 50, y: 700, size: 11, font });
  const p2 = doc.addPage([612, 792]);
  p2.drawText('PAGE 2 — free text field lives here', { x: 50, y: 740, size: 16, font });
  return Buffer.from(await doc.save());
}

// ---- a tiny red 200x80 PNG for the "signature" ----
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = (crc ^ buf[i]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function makeRedPNG(w, h) {
  const zlib = require_zlib();
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
  const raw = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y++) {
    const row = y * (1 + w * 3);
    raw[row] = 0;
    for (let x = 0; x < w; x++) {
      raw[row + 1 + x * 3] = 220; raw[row + 1 + x * 3 + 1] = 20; raw[row + 1 + x * 3 + 2] = 20;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
function require_zlib() { return require('node:zlib'); }
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

let failed = false;
async function step(name, fn) {
  try { await fn(); console.log(`  PASS  ${name}`); }
  catch (err) { failed = true; console.error(`  FAIL  ${name}\n        ${err.stack || err.message}`); }
}

console.log('Inkseal smoke test\n');

// ---- auth ----
await step('rejects wrong password / unauthorized access', async () => {
  assert.equal((await api('POST', '/api/login', { password: 'nope' })).status, 401);
  assert.equal((await api('GET', '/api/envelopes')).status, 401);
});
await step('logs in with ADMIN_PASSWORD', async () => {
  assert.equal((await api('POST', '/api/login', { password: 'test-password' })).status, 200);
  assert.equal((await api('GET', '/api/me')).data.authed, true);
});

// ---- upload + hash check ----
const fixtureBytes = await makeFixturePdf();
const expectedSha = require('node:crypto').createHash('sha256').update(fixtureBytes).digest('hex');
let envelope;
await step('uploads a PDF and computes original_sha256 correctly', async () => {
  const fd = new FormData();
  fd.append('pdf', new Blob([fixtureBytes], { type: 'application/pdf' }), 'fixture.pdf');
  fd.append('title', 'Test Lease Agreement');
  const res = await api('POST', '/api/envelopes', fd);
  assert.equal(res.status, 201);
  envelope = res.data;
  assert.equal(envelope.original_sha256, expectedSha);
  assert.equal(envelope.status, 'draft');
});

// ---- place fields for 2 sequential signers ----
let signerAId, signerBId;
await step('places fields via API for 2 sequential signers', async () => {
  const res = await api('PUT', `/api/envelopes/${envelope.id}/fields`, {
    signers: [
      { localId: 'A', name: 'Alice Signer', email: 'alice@example.test', order_index: 0, color: '#6366f1' },
      { localId: 'B', name: 'Bob Signer', email: 'bob@example.test', order_index: 1, color: '#22c55e' },
    ],
    fields: [
      { signerLocalId: 'A', type: 'signature', page: 0, x: 0.1, y: 0.3, w: 0.25, h: 0.06, rotation: 0, required: true },
      { signerLocalId: 'A', type: 'date', page: 0, x: 0.4, y: 0.3, w: 0.15, h: 0.04, rotation: 0, required: true },
      { signerLocalId: 'B', type: 'initials', page: 0, x: 0.6, y: 0.3, w: 0.08, h: 0.05, rotation: 0, required: true },
      { signerLocalId: 'B', type: 'text', page: 1, x: 0.1, y: 0.3, w: 0.3, h: 0.05, rotation: 0, required: true },
    ],
  });
  assert.equal(res.status, 200);
  signerAId = res.data.signers.find((s) => s.name === 'Alice Signer').id;
  signerBId = res.data.signers.find((s) => s.name === 'Bob Signer').id;
  assert.equal(res.data.fields.length, 4);
});

let tokenA, tokenB;
await step('send: signer tokens exist, sequential keeps signer 2 pending', async () => {
  const res = await api('POST', `/api/envelopes/${envelope.id}/send`, {});
  assert.equal(res.status, 200);
  const env = await api('GET', `/api/envelopes/${envelope.id}`);
  const a = env.data.signers.find((s) => s.id === signerAId);
  const b = env.data.signers.find((s) => s.id === signerBId);
  tokenA = a.token; tokenB = b.token;
  assert.ok(tokenA && tokenB);
  assert.equal(a.status, 'active');
  assert.equal(b.status, 'pending');
});

// ---- sequential enforcement: signer B cannot submit before signer A completes ----
await step('sequential enforcement: signer 2 field POST before signer 1 completes -> 403', async () => {
  const sessB = await fetch(`${BASE}/api/sign/${tokenB}`);
  const bData = await sessB.json();
  const bField = bData.fields[0];
  const res = await fetch(`${BASE}/api/sign/${tokenB}/fields/${bField.id}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ value_text: 'BB' }),
  });
  assert.equal(res.status, 403);
});

// ---- signer A: consent, sign, complete ----
let aFields;
await step('signer A: consent + fills fields', async () => {
  const sess = await (await fetch(`${BASE}/api/sign/${tokenA}`)).json();
  assert.equal(sess.envelope.title, 'Test Lease Agreement');
  aFields = sess.fields;
  assert.equal(aFields.length, 2);

  const consentRes = await fetch(`${BASE}/api/sign/${tokenA}/consent`, { method: 'POST' });
  assert.equal(consentRes.status, 200);

  const sigField = aFields.find((f) => f.type === 'signature');
  const dateField = aFields.find((f) => f.type === 'date');
  const png = makeRedPNG(200, 80);
  const pngRes = await fetch(`${BASE}/api/sign/${tokenA}/fields/${sigField.id}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ png_base64: `data:image/png;base64,${png.toString('base64')}` }),
  });
  assert.equal(pngRes.status, 200);
  const dateRes = await fetch(`${BASE}/api/sign/${tokenA}/fields/${dateField.id}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ value_text: '2026-01-15' }),
  });
  assert.equal(dateRes.status, 200);
});

await step('signer A completes -> signer B becomes active', async () => {
  const res = await fetch(`${BASE}/api/sign/${tokenA}/complete`, { method: 'POST' });
  const data = await res.json();
  assert.equal(res.status, 200);
  assert.equal(data.envelope_completed, false);
  const env = await api('GET', `/api/envelopes/${envelope.id}`);
  const b = env.data.signers.find((s) => s.id === signerBId);
  assert.equal(b.status, 'active');
});

let finalPdfSize;
await step('signer B signs remaining fields and completes -> envelope completed, final.pdf exists', async () => {
  const sess = await (await fetch(`${BASE}/api/sign/${tokenB}`)).json();
  await fetch(`${BASE}/api/sign/${tokenB}/consent`, { method: 'POST' });
  for (const f of sess.fields) {
    if (f.type === 'initials') {
      const png = makeRedPNG(80, 60);
      await fetch(`${BASE}/api/sign/${tokenB}/fields/${f.id}`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ png_base64: `data:image/png;base64,${png.toString('base64')}` }),
      });
    } else if (f.type === 'text') {
      await fetch(`${BASE}/api/sign/${tokenB}/fields/${f.id}`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ value_text: 'Approved on behalf of Bob Signer.' }),
      });
    }
  }
  const res = await fetch(`${BASE}/api/sign/${tokenB}/complete`, { method: 'POST' });
  const data = await res.json();
  assert.equal(res.status, 200);
  assert.equal(data.envelope_completed, true);

  const env = await api('GET', `/api/envelopes/${envelope.id}`);
  assert.equal(env.data.status, 'completed');

  const pdfRes = await api('GET', `/api/envelopes/${envelope.id}/final.pdf`, undefined, true);
  assert.equal(pdfRes.status, 200);
  const buf = Buffer.from(await pdfRes.arrayBuffer());
  fs.writeFileSync(path.join(OUT_DIR, 'final.pdf'), buf);
  finalPdfSize = buf.length;
  assert.equal(buf.subarray(0, 4).toString('ascii'), '%PDF');
});

// ---- flattened-PDF assertions: page count, size growth, embedded image XObject ----
await step('flattened PDF: page count = original + 1 (audit page), bytes differ, size grew', async () => {
  const finalBytes = fs.readFileSync(path.join(OUT_DIR, 'final.pdf'));
  const finalDoc = await PDFDocument.load(finalBytes);
  const origDoc = await PDFDocument.load(fixtureBytes);
  assert.equal(finalDoc.getPageCount(), origDoc.getPageCount() + 1, 'expected exactly one appended audit page');
  assert.notDeepEqual(finalBytes, fixtureBytes);
  assert.ok(finalBytes.length > fixtureBytes.length, 'final PDF should be larger than the original');
});

await step('flattened PDF: page 1 Resources/XObject contains a real embedded image', async () => {
  const finalBytes = fs.readFileSync(path.join(OUT_DIR, 'final.pdf'));
  const finalDoc = await PDFDocument.load(finalBytes);
  const page1 = finalDoc.getPage(0);
  const resources = page1.node.Resources();
  const xobjects = resources.lookup(PDFName.of('XObject'), PDFDict);
  assert.ok(xobjects, 'page should have an XObject dictionary');
  let foundImage = false;
  for (const key of xobjects.keys()) {
    const obj = xobjects.lookup(key);
    const subtype = obj.dict?.get(PDFName.of('Subtype'));
    if (subtype && subtype.toString() === '/Image') foundImage = true;
  }
  assert.ok(foundImage, 'expected at least one embedded /Image XObject on page 1 (the signature PNG)');
});

// ---- audit chain verifies, then tamper detection ----
await step('audit chain verifies valid after completion', async () => {
  const res = await api('GET', `/api/envelopes/${envelope.id}/verify`);
  assert.equal(res.status, 200);
  assert.equal(res.data.valid, true);
  assert.ok(res.data.events > 0);
});

await step('tampering a mid-row data_json breaks verification at that seq', async () => {
  const dbPath = path.join(process.env.DATA_DIR, 'inkseal.db');
  const rawDb = new Database(dbPath);
  const rows = rawDb.prepare('SELECT * FROM audit_events WHERE envelope_id = ? ORDER BY seq ASC').all(envelope.id);
  const midRow = rows[Math.floor(rows.length / 2)];
  rawDb.prepare('UPDATE audit_events SET data_json = ? WHERE envelope_id = ? AND seq = ?')
    .run(JSON.stringify({ tampered: true }), envelope.id, midRow.seq);
  rawDb.close();

  const res = await api('GET', `/api/envelopes/${envelope.id}/verify`);
  assert.equal(res.data.valid, false);
  assert.equal(res.data.brokenAt, midRow.seq);
});

// ================= license gate: first document free, then $59 lifetime =================
await step('license gate: unlicensed after one envelope, free allowance used', async () => {
  const res = await api('GET', '/api/license');
  assert.equal(res.status, 200);
  assert.equal(res.data.licensed, false);
  assert.equal(res.data.free_used, 1);
  assert.equal(res.data.free_limit, 1);
  assert.ok(res.data.checkout_url.includes('whop.com/checkout/'));
});

await step('license gate: second envelope creation blocked with 402 + checkout url', async () => {
  const fd = new FormData();
  fd.append('pdf', new Blob([await makeFixturePdf()], { type: 'application/pdf' }), 'blocked.pdf');
  fd.append('title', 'Should Be Blocked');
  const res = await api('POST', '/api/envelopes', fd);
  assert.equal(res.status, 402);
  assert.equal(res.data.upgrade, true);
  assert.ok(res.data.checkout_url.includes('whop.com/checkout/'));
});

await step('license gate: malformed key rejected with 400', async () => {
  const res = await api('POST', '/api/license/activate', { key: 'NOT-A-REAL-KEY' });
  assert.equal(res.status, 400);
});

await step('license gate: well-formed Whop key accepted without WHOP_API_KEY (normalized from dashless lowercase)', async () => {
  const res = await api('POST', '/api/license/activate', { key: 'watest100000001test01w' });
  assert.equal(res.status, 200);
  assert.equal(res.data.licensed, true);
  assert.equal(res.data.source, 'unverified');
});

// ================= second envelope: decline path + void 410 =================
let envelope2;
await step('second envelope: decline path -> envelope declined', async () => {
  const fixture2 = await makeFixturePdf();
  const fd = new FormData();
  fd.append('pdf', new Blob([fixture2], { type: 'application/pdf' }), 'fixture2.pdf');
  fd.append('title', 'Decline Test Envelope');
  envelope2 = (await api('POST', '/api/envelopes', fd)).data;

  await api('PUT', `/api/envelopes/${envelope2.id}/fields`, {
    signers: [{ localId: 'C', name: 'Carol Signer', email: 'carol@example.test', order_index: 0, color: '#f59e0b' }],
    fields: [{ signerLocalId: 'C', type: 'signature', page: 0, x: 0.1, y: 0.3, w: 0.25, h: 0.06, rotation: 0, required: true }],
  });
  await api('POST', `/api/envelopes/${envelope2.id}/send`, {});
  const env = await api('GET', `/api/envelopes/${envelope2.id}`);
  const tokenC = env.data.signers[0].token;

  const declineRes = await fetch(`${BASE}/api/sign/${tokenC}/decline`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reason: 'Terms not acceptable' }),
  });
  assert.equal(declineRes.status, 200);
  const after = await api('GET', `/api/envelopes/${envelope2.id}`);
  assert.equal(after.data.status, 'declined');
});

// ================= third envelope: void -> sign link 410 =================
await step('third envelope: voided envelope sign link -> 410', async () => {
  const fixture3 = await makeFixturePdf();
  const fd = new FormData();
  fd.append('pdf', new Blob([fixture3], { type: 'application/pdf' }), 'fixture3.pdf');
  fd.append('title', 'Void Test Envelope');
  const envelope3 = (await api('POST', '/api/envelopes', fd)).data;

  await api('PUT', `/api/envelopes/${envelope3.id}/fields`, {
    signers: [{ localId: 'D', name: 'Dave Signer', email: 'dave@example.test', order_index: 0, color: '#ec4899' }],
    fields: [{ signerLocalId: 'D', type: 'signature', page: 0, x: 0.1, y: 0.3, w: 0.25, h: 0.06, rotation: 0, required: true }],
  });
  await api('POST', `/api/envelopes/${envelope3.id}/send`, {});
  const env = await api('GET', `/api/envelopes/${envelope3.id}`);
  const tokenD = env.data.signers[0].token;

  await api('POST', `/api/envelopes/${envelope3.id}/void`, {});
  const res = await fetch(`${BASE}/api/sign/${tokenD}`);
  assert.equal(res.status, 410);
});

server.close();
try {
  (await import('../server/db.js')).default.close(); // release SQLite lock (Windows)
  fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
} catch { /* best-effort temp cleanup */ }

console.log('');
if (failed) { console.error('SMOKE TEST FAILED'); process.exit(1); }
console.log(`All smoke tests passed. Artifacts in ${OUT_DIR} (final PDF size: ${finalPdfSize} bytes)`);
