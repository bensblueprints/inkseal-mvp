# Inkseal Compliance Guide

How Inkseal supports the requirements commonly associated with the **US ESIGN
Act**, **UETA**, and **eIDAS** (at the *simple electronic signature* level) —
and, just as importantly, what it does **not** do. Every claim below maps to
code you can read in this repository.

## What kind of signature Inkseal produces

Inkseal produces **simple electronic signatures (SES)**: a drawn or typed
signature image embedded into the PDF, backed by a tamper-evident audit trail.

It does **not** produce:

- **Advanced or Qualified Electronic Signatures (eIDAS AES/QES)** — no
  certificate-based digital signatures, no Qualified Trust Service Provider.
- **Knowledge-Based Authentication (KBA)** or government-ID verification —
  signer identity is established by control of the unique signing link
  (typically delivered to the signer's email address), not by identity proofing.
- Any certified compliance program. Inkseal holds **no SOC 2, ISO 27001, or
  GDPR certification** and claims none.

Under ESIGN/UETA, simple electronic signatures are broadly enforceable for
everyday agreements (NDAs, leases, contracts, internal approvals). Legal
sufficiency always depends on your jurisdiction and document type — some
documents (e.g. wills, certain notarized or court filings, some regulated
financial/healthcare documents) have special requirements. **Consult a lawyer
before relying on any e-signature tool for regulated documents.**

## How Inkseal maps to the core requirements

### 1. Intent to sign

Each signer performs explicit, deliberate actions: opening their unique
signing link, drawing or typing a signature into each field, and clicking a
final "complete" action. Every one of these is recorded as a distinct audit
event (`viewed`, `field_signed`, `signer_completed`). A signer can also
formally **decline**, which is recorded with their stated reason.

### 2. Consent to do business electronically

Before completing, every signer must check an explicit "I agree to sign
electronically" consent box. The server refuses completion without it
(`POST /api/sign/:token/complete` returns 400 if consent was never given) and
records the consent as its own timestamped audit event (`consented`) with the
signer's email, IP address, and browser user agent.

### 3. Association of signature with the record

Signatures are not stored "next to" the document — they are **flattened into
the PDF itself** (via pdf-lib) at the exact coordinates the sender placed,
producing a single final file. The audit trail is cryptographically rooted in
the document: the hash chain's genesis value is the SHA-256 of the original
uploaded PDF bytes, and the completion event records the SHA-256 of the final
signed PDF.

### 4. Tamper-evident audit trail

Every event in an envelope's life — created, sent, viewed, consented, each
field signed, signer completed, envelope completed, declined, voided — is
recorded with:

- **UTC timestamp** (ISO 8601)
- **Actor** (signer name) and **signer email**
- **IP address** and **browser user agent**
- **SHA-256 hash chain**: each event's hash is
  `sha256(prev_hash + canonical_event_json)`, with the chain rooted in the
  original document's own SHA-256

Any modification to any recorded event breaks the chain from that point
forward. `GET /api/envelopes/:id/verify` (the **Verify** button in the UI)
recomputes the entire chain and reports exactly where it breaks, if anywhere.

### 5. Certificate of completion

Every final PDF has an appended **Certificate of Completion** page listing the
envelope ID, original document SHA-256, completion time, every signer with
their email / consent time / signing time, and the full audit trail (every
event with its timestamp, actor, email, IP, and chain hash).

### 6. Record retention and copies

The final flattened PDF and complete audit trail are retained indefinitely in
your own SQLite database and data directory — you self-host, so retention is
under your control and not subject to a vendor subscription lapsing. With SMTP
configured, every signer with an email address automatically receives a copy
of the completed document.

## Honest limitations

- **Identity assurance is link-based.** Whoever controls the signing link (and
  typically the email inbox it was sent to) can sign. There is no 2FA, KBA, or
  ID verification.
- **The audit trail is tamper-evident, not tamper-proof.** A database
  administrator could rewrite the entire chain from genesis. The hash chain
  proves *internal consistency*; for stronger guarantees, export/archive the
  completed PDF (which embeds the certificate) somewhere the DB admin can't
  reach.
- **No qualified timestamps.** Event times come from your server's clock.
- **Not QES.** If a counterparty or regulation requires eIDAS Advanced or
  Qualified signatures, Inkseal is not sufficient.

When in doubt about whether a simple electronic signature is legally
sufficient for your document and jurisdiction, ask a lawyer.
