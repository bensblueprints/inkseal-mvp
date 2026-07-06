# Launch Strategy — Inkseal

## Legal note (verbatim — use in ads and any public-facing copy)

Inkseal implements the core requirements commonly associated with **ESIGN/UETA and basic eIDAS "simple electronic signature"** validity — demonstrated intent (click-to-sign actions), consumer consent capture, association of signature with the record, tamper-evident audit trail (hash chain + document hash), and retention/copies for all parties. It is **NOT** a Qualified Electronic Signature (eIDAS QES), does not use certificate-based digital signatures or a QTSP, and no compliance certification is claimed. Fine for everyday agreements; users needing QES or regulated-industry workflows should consult counsel.

Honesty is the trust play here, including in ads: "real audit trail, no compliance theater" lands better with the self-hosted/technical audience than vague "legally binding!" claims every competitor makes.

## Target communities (rules-aware angles)

| Community | Angle |
|---|---|
| r/selfhosted | "I built a self-hosted DocuSign alternative (Node + SQLite + pdf-lib, single container)" — lead with the Docker one-liner and the coordinate-mapping technical detail; this sub loves implementation specifics over pricing talk. |
| r/smallbusiness | Value-first comment/post: cost breakdown of e-signature SaaS for a business sending ~10 docs/month; mention the tool only if asked or in a dedicated self-promo thread (check sub rules — most require flair or a specific day). |
| r/realestateinvesting | Landlords/agents sign leases constantly and feel the DocuSign envelope cap directly. Rules-aware: post value ("here's what actually counts as a valid e-signature under ESIGN/UETA for leases") in a discussion thread, link in comments if asked, never a bare product post. |
| r/webdev / r/node | Build showcase: "pdf.js in the browser + pdf-lib on the server — the coordinate math that makes signature placement actually line up" with the rotation-transform code snippet. Portfolio angle. |
| r/Entrepreneur | Subscription-fatigue story post: DocuSign's $120–300/yr vs a $49 one-time tool. Check the weekly self-promo thread. |
| Indie Hackers | Build-in-public post with the audit-trail hash-chain design as the technical hook; IH allows direct product links. |
| Hacker News | Show HN (draft below). |

## Show HN draft

**Title:** Show HN: Self-hosted e-signatures with a verifiable, hash-chained audit trail

**Body:**
I got tired of paying DocuSign $10–25/mo (and hitting their envelope caps) to send maybe a dozen contracts and leases a month, so I built the subset I actually needed: upload a PDF, drag signature/initials/date/text fields onto it, route to signers sequentially or in parallel, they sign in the browser, I get back a flattened final PDF.

A few things that might be interesting to HN:

- **Coordinate mapping**: pdf.js renders in browser CSS pixels at an arbitrary zoom; pdf-lib places content in PDF points in the page's *unrotated* coordinate space. Every field is stored as fractions (0–1) of the pdf.js viewport at scale 1, which bakes out zoom and `/Rotate` on the display side. A dedicated `toPdfSpace()` function (with unit tests for all four rotations) transforms those fractions back for pdf-lib at flatten time. Get this wrong and every signature on a rotated page lands in the wrong spot — it was worth writing and testing before touching any UI.
- **Audit trail**: every event (created, sent, viewed, consented, field signed, completed, declined) is stored with `hash = sha256(prev_hash + canonical_json(event))`, and the genesis event's prev_hash is the SHA-256 of the *original uploaded PDF* — so the whole chain is cryptographically rooted in the actual document bytes, not an arbitrary constant. A `/verify` endpoint recomputes the entire chain and reports exactly which event was tampered with, if any.
- **Flattening**: pdf-lib embeds the actual signature PNGs and typed text into the original PDF at the recorded coordinates (not an overlay) — I assert in the test suite that the resulting page's `/Resources/XObject` actually contains an embedded `/Image`, not just that a file got written.
- Ships as both a web app (Docker, single Node process, better-sqlite3) and a thin Electron wrapper around the same server for a fully offline desktop mode.

Not a Qualified Electronic Signature product — no QTSP, no eIDAS QES — but covers ESIGN/UETA-style validity, which is what most everyday agreements need. MIT source. Feedback on the audit trail design and the signing UX very welcome.

## SEO keywords (10)

1. docusign alternative self hosted
2. e-signature one time purchase
3. open source esignature software
4. sign pdf online self hosted
5. unlimited envelopes esignature
6. self hosted document signing
7. electronic signature no subscription
8. docusign alternative for small business
9. pdf signature software self hosted
10. e-signature audit trail verification

## AppSumo / PitchGround pitch

Inkseal is the anti-subscription e-signature tool for freelancers, agencies, and small landlords who are tired of DocuSign's per-envelope caps and $10–25/mo tiers. Upload any PDF, drag signature/initials/date/text fields onto it, route to signers sequentially or in parallel, and get back a genuinely flattened final PDF — not an overlay — backed by a hash-chained audit trail your buyer can verify with one click instead of trusting a vendor's word for it. It runs entirely on their own machine or a $5 VPS (Docker one-liner included), ships as a desktop app too, and the MIT source means technical buyers can read exactly what it does before they trust it with contracts. Your audience already hates recurring SaaS fees for tools this simple — a lifetime deal on "pay once, sign unlimited, own the code" sells itself.

## Pricing

**Suggested: $49 one-time** (installer + updates), vs:
- DocuSign Personal: $10/mo, capped at 5 envelopes → **pays for itself in ~5 months** ($120/yr saved thereafter), plus removes the cap entirely
- DocuSign Standard: $25/mo → pays for itself in ~2 months ($300/yr saved thereafter)
- PandaDoc: $19/mo → pays for itself in ~2.6 months
- SignWell: $8/mo → pays for itself in ~6 months
- Dropbox Sign: $15/mo → pays for itself in ~3.3 months
- Launch promo: $35 first week (PH/HN traffic), then $49 list.
