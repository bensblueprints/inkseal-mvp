# Product Hunt Launch Kit — Inkseal

## Name
Inkseal

## Tagline (60 chars max)
Self-hosted e-signatures. Pay once, sign forever. (54 chars)

## Description (260 chars max)
Upload a PDF, drop signature fields, send it for signing — sequential or parallel, hash-chained audit trail, flattened final PDF. Runs on your machine or a $5 VPS. No per-envelope fees, no monthly cap. One-time $49 vs DocuSign's $10–25/mo. (243 chars)

## Full description

Every e-signature tool I looked at charges *per envelope* or caps you at 5 a month unless you upgrade to their $25/mo tier. For a small business sending a handful of leases, NDAs, or contracts a week, that's real money for something that's fundamentally: render a PDF, let people click a few boxes, stitch the result back together.

Inkseal does exactly that, self-hosted:

- Upload any PDF, drag signature/initials/date/text fields onto it (pdf.js in the browser)
- Add signers, choose sequential (signer 2 only gets their link after signer 1 finishes) or parallel routing
- Each signer gets a unique link — draw or type their signature, check the "I agree to sign electronically" consent box, done
- The finished document is a *real* flattened PDF (pdf-lib embeds the actual signature images and text into the page — nothing is a screenshot or overlay), with an appended audit certificate page
- Every action (created, sent, viewed, consented, signed, completed) is hash-chained — `sha256(prev_hash + event)` — so you can verify the whole trail hasn't been tampered with, one click
- Templates, decline flow, void, reminders, BYO SMTP email

It's not a Qualified Electronic Signature product (no QTSP, no eIDAS QES) — but it covers ESIGN/UETA-style "simple electronic signature" validity, which is what 95% of everyday agreements actually need.

MIT-licensed source. Ships as a desktop app (Electron, zero setup) or a Docker container for your own VPS.

## Maker's first comment

Hey Product Hunt 👋

I built Inkseal because I was paying for DocuSign to send maybe 8–10 documents a month for a side business — leases and simple service contracts — and kept getting capped out or nudged toward the $25/mo plan. The actual functionality I needed (place a signature box, let someone sign it, get a clean final PDF) doesn't need to live behind a subscription.

The part I spent the most time getting right was the coordinate math — pdf.js renders in browser pixels at whatever zoom level, pdf-lib places content in PDF points in the page's *unrotated* space, and if you get that translation wrong your signatures land in slightly the wrong spot on any rotated or high-DPI PDF. There's a dedicated module (`coords.js`) with unit tests for all four page rotations before I touched a line of UI.

The other thing I cared about: an audit trail you can actually verify, not just a "log" that's really just a proprietary DB row. Every event in an envelope's history is hash-chained back to the original document's own SHA-256 — tamper with any row and the verify endpoint tells you exactly where the chain breaks.

Fully self-hosted, MIT source, runs as a desktop app or a $5 VPS container. Would love feedback on the signing flow and the audit trail design.

## Gallery shot list (5 shots)

1. **Envelope editor** — PDF rendered with color-coded signature/initials/date/text field boxes placed on the page, signer panel open on the right showing 2 signers and sequential routing toggle.
2. **Signing page** (light mode) — signer's view with their highlighted fields, the "draw or type your signature" modal open mid-draw.
3. **Envelope detail / audit trail** — signer progress list (pending/active/signed pills) plus the hash-chained audit log table with the "Verify chain" green success banner.
4. **Envelopes list** — dashboard showing several envelopes in different statuses (draft/sent/completed/declined) with the drag-and-drop upload zone.
5. **vs DocuSign comparison graphic** — side-by-side pricing table from the README, $49 once vs $120–300/yr, with "pays for itself in under 5 months" callout.
