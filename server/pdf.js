// Server-side PDF handling: upload validation + final flattening.
//
// pdf.js (client, browser-only) renders pages for the editor/signing UI.
// pdf-lib (here, server-only) does the actual flattening: it embeds signature
// PNGs and typed text at the coordinates computed by toPdfSpace(), then
// appends a human-readable audit certificate page.
import fs from 'node:fs';
import path from 'node:path';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { fileURLToPath } from 'node:url';
import { toPdfSpace, normalizeRotation } from './coords.js';
import { sha256Hex } from './hash.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT_FONT_PATH = path.join(__dirname, '..', 'fonts', 'Signature.woff2');

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25 MB, per spec

export class UploadRejected extends Error {}

/**
 * Validate an uploaded PDF: size cap + reject encrypted/unparseable files
 * with a clear message (pdf-lib cannot flatten encrypted PDFs).
 */
export async function validatePdfUpload(buffer) {
  if (buffer.length > MAX_UPLOAD_BYTES) {
    throw new UploadRejected(`PDF is too large (${(buffer.length / 1024 / 1024).toFixed(1)} MB). Max is 25 MB.`);
  }
  if (buffer.subarray(0, 5).toString('ascii') !== '%PDF-') {
    throw new UploadRejected('That file does not look like a PDF.');
  }
  try {
    const doc = await PDFDocument.load(buffer, { ignoreEncryption: false });
    return doc.getPageCount();
  } catch (err) {
    if (/encrypt/i.test(err.message)) {
      throw new UploadRejected('This PDF is password-protected/encrypted. Please remove the password before uploading — Inkseal cannot flatten encrypted PDFs.');
    }
    throw new UploadRejected(`Could not read this PDF: ${err.message}`);
  }
}

function fitImageInBox(imgWidth, imgHeight, box) {
  const scale = Math.min(box.w / imgWidth, box.h / imgHeight);
  const w = imgWidth * scale;
  const h = imgHeight * scale;
  return { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h };
}

function fitFontSize(font, text, box) {
  let size = Math.max(6, box.h * 0.6);
  while (size > 6 && font.widthOfTextAtSize(text, size) > box.w - 4) size -= 1;
  return size;
}

/**
 * Flatten a completed envelope: embed every field's value into the original
 * PDF at its recorded coordinates, then append an audit certificate page.
 * Returns the final PDF bytes (caller writes them to disk).
 */
export async function flattenEnvelope({ envelope, fields, signers, originalBytes, auditEvents }) {
  const pdfDoc = await PDFDocument.load(originalBytes);
  pdfDoc.registerFontkit(fontkit);

  const scriptFontBytes = fs.readFileSync(SCRIPT_FONT_PATH);
  const scriptFont = await pdfDoc.embedFont(scriptFontBytes, { subset: true });
  const helv = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const helvBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const signerById = new Map(signers.map((s) => [s.id, s]));

  for (const field of fields) {
    const page = pdfDoc.getPage(field.page);
    const rotation = normalizeRotation(page.getRotation().angle);
    const pageSize = page.getSize();
    const box = toPdfSpace(field, rotation, pageSize);
    const signer = signerById.get(field.signer_id);
    const color = signer ? hexToRgb01(signer.color) : { r: 0, g: 0, b: 0 };

    if ((field.type === 'signature' || field.type === 'initials') && field.signature_png_path && fs.existsSync(field.signature_png_path)) {
      const pngBytes = fs.readFileSync(field.signature_png_path);
      const png = await pdfDoc.embedPng(pngBytes);
      const placed = fitImageInBox(png.width, png.height, box);
      page.drawImage(png, placed);
    } else if (field.value_text) {
      const text = String(field.value_text);
      const fontToUse = field.type === 'date' || field.type === 'text' ? helv : scriptFont;
      const size = fitFontSize(fontToUse, text, box);
      page.drawText(text, {
        x: box.x + 2,
        y: box.y + Math.max(2, (box.h - size) / 2),
        size,
        font: fontToUse,
        color: rgb(color.r, color.g, color.b),
      });
    }
  }

  appendCertificatePage(pdfDoc, { helv, helvBold, envelope, signers, auditEvents });

  return pdfDoc.save();
}

function hexToRgb01(hex) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || '');
  if (!m) return { r: 0, g: 0, b: 0 };
  return { r: parseInt(m[1], 16) / 255, g: parseInt(m[2], 16) / 255, b: parseInt(m[3], 16) / 255 };
}

function appendCertificatePage(pdfDoc, { helv, helvBold, envelope, signers, auditEvents }) {
  const PAGE_W = 612, PAGE_H = 792, MARGIN = 50; // US Letter
  let page = pdfDoc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;

  const ensureRoom = (needed) => {
    if (y - needed < MARGIN) {
      page = pdfDoc.addPage([PAGE_W, PAGE_H]);
      y = PAGE_H - MARGIN;
    }
  };
  const line = (text, { size = 10, font = helv, gap = 14, color = rgb(0.1, 0.1, 0.1), indent = 0 } = {}) => {
    ensureRoom(gap);
    page.drawText(text, { x: MARGIN + indent, y, size, font, color, maxWidth: PAGE_W - MARGIN * 2 - indent });
    y -= gap;
  };

  line('Certificate of Completion', { size: 20, font: helvBold, gap: 28 });
  line(`Envelope: ${envelope.title}`, { size: 12, font: helvBold, gap: 18 });
  line(`Envelope ID: ${envelope.id}    Status: ${envelope.status}`, { gap: 16 });
  line(`Document SHA-256 (original): ${envelope.original_sha256}`, { size: 8, gap: 14 });
  line(`Completed at: ${envelope.completed_at || new Date().toISOString()}`, { gap: 22 });

  line('Signers', { size: 13, font: helvBold, gap: 18 });
  for (const s of signers) {
    line(`${s.name} <${s.email || 'no email'}> — ${s.status}`, { indent: 10, gap: 14 });
    line(`consented: ${s.consent_at || '—'}    signed: ${s.signed_at || '—'}`, { size: 9, indent: 10, gap: 18 });
  }

  line('Audit Trail (hash-chained)', { size: 13, font: helvBold, gap: 18 });
  line('Each event\'s hash = sha256(prev_hash + event_json). Verify via GET /api/envelopes/:id/verify.', { size: 8, gap: 16 });
  for (const ev of auditEvents) {
    let email = '';
    try { email = JSON.parse(ev.data_json || '{}').email || ''; } catch { /* ignore */ }
    line(`#${ev.seq}  ${ev.at}  ${ev.type}  actor=${ev.actor || '-'}${email ? ` <${email}>` : ''} ip=${ev.ip || '-'}`, { size: 8, gap: 12 });
    line(`  hash: ${ev.hash}`, { size: 7, gap: 14, color: rgb(0.4, 0.4, 0.4) });
  }

  line('This is not a Qualified Electronic Signature (eIDAS QES). No compliance certification is claimed.', { size: 7, gap: 12, color: rgb(0.5, 0.5, 0.5) });
}
