import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { PenTool, Type, CalendarDays, Asterisk, CheckCircle2, XCircle, ArrowRight } from 'lucide-react';
import { api } from '../api.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

const FIELD_ICON = { signature: PenTool, initials: Asterisk, date: CalendarDays, text: Type };

export default function SignPage() {
  const { token } = useParams();
  const [session, setSession] = useState(null);
  const [error, setError] = useState('');
  const [pages, setPages] = useState([]);
  const [values, setValues] = useState({}); // fieldId -> { value_text? , png_base64? }
  const [consented, setConsented] = useState(false);
  const [modalField, setModalField] = useState(null);
  const [done, setDone] = useState(false);
  const [declined, setDeclined] = useState(false);
  const containerRefs = useRef([]);

  const load = () => api.getSignSession(token).then(setSession).catch((err) => setError(err.status === 410 ? 'This document is no longer available — the sender voided it.' : err.message));
  useEffect(() => { load(); }, [token]);

  useEffect(() => {
    if (!session) return;
    setConsented(!!session.signer.consent_at);
    const initial = {};
    for (const f of session.fields) {
      if (f.value_text) initial[f.id] = { value_text: f.value_text };
    }
    setValues(initial);
  }, [session]);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    (async () => {
      const buf = await (await fetch(`/api/sign/${token}/pdf`)).arrayBuffer();
      const doc = await pdfjsLib.getDocument({ data: buf }).promise;
      const built = [];
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const viewport1 = page.getViewport({ scale: 1 });
        const displayScale = Math.min(760 / viewport1.width, 2);
        const viewport = page.getViewport({ scale: displayScale });
        built.push({ page, viewport });
      }
      if (!cancelled) setPages(built);
    })();
    return () => { cancelled = true; };
  }, [session, token]);

  useEffect(() => {
    pages.forEach(async ({ page, viewport }, i) => {
      const canvas = containerRefs.current[i]?.querySelector('canvas');
      if (!canvas) return;
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    });
  }, [pages]);

  async function toggleConsent(checked) {
    setConsented(checked);
    if (checked) await api.consent(token).catch((err) => setError(err.message));
  }

  async function saveFieldValue(field, payload) {
    await api.submitField(token, field.id, payload);
    setValues((prev) => ({ ...prev, [field.id]: payload }));
    setModalField(null);
  }

  async function autofillDate(field) {
    const today = new Date().toISOString().slice(0, 10);
    await saveFieldValue(field, { value_text: today });
  }

  async function finish() {
    setError('');
    try {
      const r = await api.completeSigning(token);
      setDone(true);
      if (r.envelope_completed) setSession((s) => ({ ...s, envelope: { ...s.envelope, status: 'completed' } }));
    } catch (err) {
      setError(err.message);
    }
  }

  async function decline() {
    const reason = prompt('Optional reason for declining:') || '';
    try {
      await api.declineSigning(token, reason);
      setDeclined(true);
    } catch (err) {
      setError(err.message);
    }
  }

  if (error && !session) {
    return <div className="sign-light min-h-screen grid place-items-center p-6 text-center"><p>{error}</p></div>;
  }
  if (!session) return <div className="sign-light min-h-screen grid place-items-center text-zinc-500">Loading…</div>;

  if (declined) {
    return (
      <div className="sign-light min-h-screen grid place-items-center p-6 text-center">
        <div>
          <XCircle className="mx-auto mb-3 text-red-500" size={40} />
          <h1 className="text-xl font-semibold">You declined to sign</h1>
          <p className="mt-1 text-zinc-500">The sender has been notified.</p>
        </div>
      </div>
    );
  }

  if (done || session.envelope.status === 'completed' || session.signer.status === 'signed') {
    return (
      <div className="sign-light min-h-screen grid place-items-center p-6 text-center">
        <div>
          <CheckCircle2 className="mx-auto mb-3 text-emerald-500" size={40} />
          <h1 className="text-xl font-semibold">Thanks — you're all signed</h1>
          <p className="mt-1 text-zinc-500">{session.envelope.status === 'completed' ? 'Every party has signed. A copy is on its way to your inbox.' : "You'll get a copy by email once everyone else has signed."}</p>
        </div>
      </div>
    );
  }

  const myFields = session.fields;
  const remaining = myFields.filter((f) => f.required && !values[f.id]?.value_text && !values[f.id]?.png_base64 && !f.value_text);
  const allDone = remaining.length === 0;

  return (
    <div className="sign-light min-h-screen">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-zinc-200 bg-white/90 px-6 py-3 backdrop-blur">
        <div>
          <p className="font-medium">{session.envelope.title}</p>
          <p className="text-xs text-zinc-500">Signing as {session.signer.name}</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-zinc-500">{myFields.length - remaining.length}/{myFields.length} fields complete</span>
          <button onClick={decline} className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs text-zinc-600 hover:bg-zinc-100">Decline</button>
          <button
            onClick={finish}
            disabled={!consented || !allDone}
            className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-40"
          >
            Finish signing <ArrowRight size={13} />
          </button>
        </div>
      </header>

      {error && <div className="mx-auto mt-3 max-w-2xl rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}

      <main className="mx-auto flex max-w-[800px] flex-col items-center gap-6 p-6">
        {pages.map((p, i) => (
          <div key={i} ref={(el) => (containerRefs.current[i] = el)} className="relative shadow-lg" style={{ width: p.viewport.width, height: p.viewport.height }}>
            <canvas />
            {myFields.filter((f) => f.page === i).map((f) => {
              const val = values[f.id] || (f.value_text ? { value_text: f.value_text } : null);
              const Icon = FIELD_ICON[f.type];
              return (
                <button
                  key={f.id}
                  onClick={() => (f.type === 'date' ? autofillDate(f) : setModalField(f))}
                  className="absolute flex items-center justify-center overflow-hidden rounded border-2 text-[10px] font-medium"
                  style={{ left: `${f.x * 100}%`, top: `${f.y * 100}%`, width: `${f.w * 100}%`, height: `${f.h * 100}%`, borderColor: f.rotation !== undefined ? (val ? '#22c55e' : '#6366f1') : '#6366f1', background: val ? '#22c55e15' : '#6366f115', color: val ? '#16a34a' : '#4f46e5' }}
                >
                  {val?.png_base64 ? <img src={val.png_base64} alt="signature" className="h-full w-full object-contain" /> : val?.value_text ? val.value_text : (<><Icon size={12} className="mr-1" /> Click to {f.type === 'date' ? 'fill' : f.type}</>)}
                </button>
              );
            })}
          </div>
        ))}
      </main>

      <div className="sticky bottom-0 flex items-center justify-center gap-2 border-t border-zinc-200 bg-white/90 p-4 backdrop-blur">
        <input id="consent" type="checkbox" checked={consented} onChange={(e) => toggleConsent(e.target.checked)} />
        <label htmlFor="consent" className="text-sm text-zinc-600">I agree to sign this document electronically and understand it constitutes a legally binding signature.</label>
      </div>

      {modalField && (
        <SignatureModal
          field={modalField}
          onClose={() => setModalField(null)}
          onSave={(payload) => saveFieldValue(modalField, payload)}
        />
      )}
    </div>
  );
}

function SignatureModal({ field, onClose, onSave }) {
  const isDrawType = field.type === 'signature' || field.type === 'initials';
  const [mode, setMode] = useState('draw');
  const [typed, setTyped] = useState('');
  const [textValue, setTextValue] = useState('');
  const canvasRef = useRef(null);
  const drawing = useRef(false);

  useEffect(() => {
    if (!isDrawType || mode !== 'draw') return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#1e293b';
  }, [mode, isDrawType]);

  function pos(e) {
    const rect = canvasRef.current.getBoundingClientRect();
    const point = e.touches ? e.touches[0] : e;
    return { x: point.clientX - rect.left, y: point.clientY - rect.top };
  }
  function start(e) { drawing.current = true; const { x, y } = pos(e); const ctx = canvasRef.current.getContext('2d'); ctx.beginPath(); ctx.moveTo(x, y); }
  function move(e) { if (!drawing.current) return; const { x, y } = pos(e); const ctx = canvasRef.current.getContext('2d'); ctx.lineTo(x, y); ctx.stroke(); }
  function stop() { drawing.current = false; }
  function clearCanvas() { const c = canvasRef.current; c.getContext('2d').clearRect(0, 0, c.width, c.height); }

  async function saveDraw() {
    onSave({ png_base64: canvasRef.current.toDataURL('image/png') });
  }

  async function saveTyped() {
    await document.fonts.load('80px Signature').catch(() => {});
    const canvas = document.createElement('canvas');
    canvas.width = 600; canvas.height = 200;
    const ctx = canvas.getContext('2d');
    ctx.font = '80px "Signature", cursive';
    ctx.fillStyle = '#1e293b';
    ctx.textBaseline = 'middle';
    ctx.fillText(typed || 'Signature', 20, 100);
    onSave({ png_base64: canvas.toDataURL('image/png') });
  }

  if (!isDrawType) {
    return (
      <div className="fixed inset-0 z-20 grid place-items-center bg-black/40 p-4">
        <div className="w-full max-w-md rounded-xl bg-white p-6">
          <h3 className="mb-3 font-semibold">Enter text</h3>
          <input autoFocus value={textValue} onChange={(e) => setTextValue(e.target.value)} className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-indigo-500" />
          <div className="mt-4 flex justify-end gap-2">
            <button onClick={onClose} className="rounded-lg px-3 py-1.5 text-sm text-zinc-500">Cancel</button>
            <button onClick={() => onSave({ value_text: textValue })} disabled={!textValue} className="rounded-lg bg-indigo-600 px-4 py-1.5 text-sm text-white disabled:opacity-40">Save</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-20 grid place-items-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-xl bg-white p-6">
        <h3 className="mb-3 font-semibold capitalize">{field.type}</h3>
        <div className="mb-3 flex gap-2 text-xs">
          <button onClick={() => setMode('draw')} className={`rounded-lg px-3 py-1 ${mode === 'draw' ? 'bg-indigo-600 text-white' : 'bg-zinc-100 text-zinc-600'}`}>Draw</button>
          <button onClick={() => setMode('type')} className={`rounded-lg px-3 py-1 ${mode === 'type' ? 'bg-indigo-600 text-white' : 'bg-zinc-100 text-zinc-600'}`}>Type</button>
        </div>
        {mode === 'draw' ? (
          <>
            <canvas
              ref={canvasRef}
              width={500}
              height={180}
              className="w-full touch-none rounded-lg border border-zinc-300 bg-zinc-50"
              onMouseDown={start} onMouseMove={move} onMouseUp={stop} onMouseLeave={stop}
              onTouchStart={start} onTouchMove={move} onTouchEnd={stop}
            />
            <div className="mt-3 flex justify-between">
              <button onClick={clearCanvas} className="text-xs text-zinc-500 underline">Clear</button>
              <div className="flex gap-2">
                <button onClick={onClose} className="rounded-lg px-3 py-1.5 text-sm text-zinc-500">Cancel</button>
                <button onClick={saveDraw} className="rounded-lg bg-indigo-600 px-4 py-1.5 text-sm text-white">Save</button>
              </div>
            </div>
          </>
        ) : (
          <>
            <input autoFocus value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Type your name" className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-indigo-500" />
            <p className="mt-3 rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-3xl" style={{ fontFamily: 'Signature, cursive' }}>{typed || 'Signature preview'}</p>
            <div className="mt-3 flex justify-end gap-2">
              <button onClick={onClose} className="rounded-lg px-3 py-1.5 text-sm text-zinc-500">Cancel</button>
              <button onClick={saveTyped} disabled={!typed} className="rounded-lg bg-indigo-600 px-4 py-1.5 text-sm text-white disabled:opacity-40">Save</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
