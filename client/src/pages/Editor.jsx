import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { PenTool, Type, CalendarDays, Asterisk, Plus, Trash2, Send, Save, ArrowLeft, Users } from 'lucide-react';
import { api, FIELD_TYPES, SIGNER_COLORS, uid } from '../api.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

const FIELD_ICON = { signature: PenTool, initials: Asterisk, date: CalendarDays, text: Type };
const DEFAULT_SIZE = { signature: [0.22, 0.06], initials: [0.08, 0.05], date: [0.14, 0.035], text: [0.2, 0.035] };

export default function Editor() {
  const { id } = useParams();
  const nav = useNavigate();
  const [envelope, setEnvelope] = useState(null);
  const [signers, setSigners] = useState([]); // { localId, name, email, color, order_index }
  const [fields, setFields] = useState([]);   // { localId, signerLocalId, type, page, x, y, w, h, rotation, required }
  const [routing, setRouting] = useState('sequential');
  const [activeSigner, setActiveSigner] = useState(null);
  const [activeTool, setActiveTool] = useState('signature');
  const [pages, setPages] = useState([]); // { canvasRef set via state update, width, height, rotation }
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const containerRefs = useRef([]);
  const dragState = useRef(null);

  useEffect(() => {
    api.getEnvelope(id).then((env) => {
      setEnvelope(env);
      setRouting(env.routing);
      if (env.signers.length) {
        const sig = env.signers.map((s) => ({ localId: String(s.id), name: s.name, email: s.email, color: s.color, order_index: s.order_index }));
        setSigners(sig);
        setActiveSigner(sig[0].localId);
        setFields(env.fields.map((f) => ({
          localId: uid(), signerLocalId: String(f.signer_id), type: f.type, page: f.page,
          x: f.x, y: f.y, w: f.w, h: f.h, rotation: f.rotation, required: !!f.required,
        })));
      } else {
        addSigner();
      }
    });
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const buf = await (await fetch(`/api/envelopes/${id}/original.pdf`, { credentials: 'same-origin' })).arrayBuffer();
      const doc = await pdfjsLib.getDocument({ data: buf }).promise;
      const built = [];
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const viewport1 = page.getViewport({ scale: 1 });
        const displayScale = Math.min(780 / viewport1.width, 2);
        const viewport = page.getViewport({ scale: displayScale });
        built.push({ page, viewport, rotation: viewport1.rotation });
      }
      if (!cancelled) setPages(built);
    })();
    return () => { cancelled = true; };
  }, [id]);

  useEffect(() => {
    pages.forEach(async ({ page, viewport }, i) => {
      const canvas = containerRefs.current[i]?.querySelector('canvas');
      if (!canvas) return;
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext('2d');
      await page.render({ canvasContext: ctx, viewport }).promise;
    });
  }, [pages]);

  function addSigner() {
    const localId = uid();
    setSigners((prev) => {
      const next = [...prev, { localId, name: `Signer ${prev.length + 1}`, email: '', color: SIGNER_COLORS[prev.length % SIGNER_COLORS.length], order_index: prev.length }];
      return next;
    });
    setActiveSigner(localId);
  }

  function updateSigner(localId, patch) {
    setSigners((prev) => prev.map((s) => (s.localId === localId ? { ...s, ...patch } : s)));
  }

  function removeSigner(localId) {
    setSigners((prev) => prev.filter((s) => s.localId !== localId).map((s, i) => ({ ...s, order_index: i })));
    setFields((prev) => prev.filter((f) => f.signerLocalId !== localId));
  }

  function placeField(pageIndex, clientX, clientY) {
    if (!activeSigner) return;
    const container = containerRefs.current[pageIndex];
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const [dw, dh] = DEFAULT_SIZE[activeTool];
    let x = (clientX - rect.left) / rect.width - dw / 2;
    let y = (clientY - rect.top) / rect.height - dh / 2;
    x = Math.min(Math.max(x, 0), 1 - dw);
    y = Math.min(Math.max(y, 0), 1 - dh);
    const rotation = pages[pageIndex]?.rotation || 0;
    setFields((prev) => [...prev, {
      localId: uid(), signerLocalId: activeSigner, type: activeTool, page: pageIndex,
      x, y, w: dw, h: dh, rotation, required: true,
    }]);
  }

  function startDrag(e, field, mode) {
    e.stopPropagation();
    e.preventDefault();
    const container = containerRefs.current[field.page];
    const rect = container.getBoundingClientRect();
    dragState.current = { localId: field.localId, mode, rect, startX: field.x, startY: field.y, startW: field.w, startH: field.h, originX: e.clientX, originY: e.clientY };
    window.addEventListener('mousemove', onDrag);
    window.addEventListener('mouseup', endDrag);
  }

  function onDrag(e) {
    const d = dragState.current;
    if (!d) return;
    const dx = (e.clientX - d.originX) / d.rect.width;
    const dy = (e.clientY - d.originY) / d.rect.height;
    setFields((prev) => prev.map((f) => {
      if (f.localId !== d.localId) return f;
      if (d.mode === 'move') {
        return { ...f, x: clamp(d.startX + dx, 0, 1 - f.w), y: clamp(d.startY + dy, 0, 1 - f.h) };
      }
      return { ...f, w: clamp(d.startW + dx, 0.03, 1 - f.x), h: clamp(d.startH + dy, 0.02, 1 - f.y) };
    }));
  }

  function endDrag() {
    dragState.current = null;
    window.removeEventListener('mousemove', onDrag);
    window.removeEventListener('mouseup', endDrag);
  }

  function removeField(localId) {
    setFields((prev) => prev.filter((f) => f.localId !== localId));
  }

  async function save({ andSend = false } = {}) {
    setSaving(true);
    setError('');
    try {
      await api.saveFields(id, {
        signers: signers.map((s) => ({ localId: s.localId, name: s.name, email: s.email, color: s.color, order_index: s.order_index })),
        fields: fields.map((f) => ({ signerLocalId: f.signerLocalId, type: f.type, page: f.page, x: f.x, y: f.y, w: f.w, h: f.h, rotation: f.rotation, required: f.required })),
      });
      await api.updateEnvelope(id, { routing });
      if (andSend) {
        const r = await api.sendEnvelope(id);
        nav(`/admin/envelopes/${id}`, { state: { justSent: true, emailed: r.emailed?.length, smtp: r.smtp_configured } });
      } else {
        nav('/admin');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (!envelope) return <div className="p-8 text-zinc-500">Loading…</div>;

  return (
    <div className="flex h-screen">
      <div className="flex-1 overflow-y-auto bg-zinc-950 p-6">
        <div className="mb-4 flex items-center justify-between">
          <button onClick={() => nav('/admin')} className="flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-300"><ArrowLeft size={14} /> Back</button>
          <h1 className="text-sm font-medium text-zinc-300">{envelope.title}</h1>
          <div className="w-16" />
        </div>
        <div className="mx-auto flex max-w-[800px] flex-col items-center gap-6">
          {pages.map((p, i) => (
            <div
              key={i}
              ref={(el) => (containerRefs.current[i] = el)}
              onClick={(e) => { if (e.target.tagName === 'CANVAS') placeField(i, e.clientX, e.clientY); }}
              className="relative shadow-xl"
              style={{ width: p.viewport.width, height: p.viewport.height, cursor: 'crosshair' }}
            >
              <canvas />
              {fields.filter((f) => f.page === i).map((f) => {
                const signer = signers.find((s) => s.localId === f.signerLocalId);
                const Icon = FIELD_ICON[f.type];
                return (
                  <div
                    key={f.localId}
                    onMouseDown={(e) => startDrag(e, f, 'move')}
                    className="group absolute flex items-center justify-center rounded border-2 text-[10px] font-medium"
                    style={{
                      left: `${f.x * 100}%`, top: `${f.y * 100}%`, width: `${f.w * 100}%`, height: `${f.h * 100}%`,
                      borderColor: signer?.color || '#888', background: `${signer?.color || '#888'}22`, color: signer?.color || '#888',
                    }}
                  >
                    <Icon size={12} className="mr-1" /> {f.type}
                    <button
                      onClick={(e) => { e.stopPropagation(); removeField(f.localId); }}
                      className="absolute -right-2 -top-2 hidden rounded-full bg-red-600 p-0.5 text-white group-hover:block"
                    >
                      <Trash2 size={10} />
                    </button>
                    <div
                      onMouseDown={(e) => startDrag(e, f, 'resize')}
                      className="absolute -right-1 -bottom-1 h-3 w-3 cursor-se-resize rounded-full"
                      style={{ background: signer?.color || '#888' }}
                    />
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <aside className="w-80 shrink-0 overflow-y-auto border-l border-zinc-800 bg-zinc-900/40 p-5">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-zinc-300"><Users size={14} /> Signers</h2>
        <div className="mb-4 space-y-2">
          {signers.map((s) => (
            <div key={s.localId} className={`rounded-lg border p-2.5 ${activeSigner === s.localId ? 'border-indigo-500' : 'border-zinc-800'}`} onClick={() => setActiveSigner(s.localId)}>
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: s.color }} />
                <input value={s.name} onChange={(e) => updateSigner(s.localId, { name: e.target.value })} className="min-w-0 flex-1 bg-transparent text-sm outline-none" />
                {signers.length > 1 && (
                  <button onClick={(e) => { e.stopPropagation(); removeSigner(s.localId); }} className="text-zinc-600 hover:text-red-400"><Trash2 size={13} /></button>
                )}
              </div>
              <input value={s.email} onChange={(e) => updateSigner(s.localId, { email: e.target.value })} placeholder="email@example.com" className="mt-1 w-full bg-transparent text-xs text-zinc-500 outline-none" />
            </div>
          ))}
        </div>
        <button onClick={addSigner} className="mb-6 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-zinc-700 py-1.5 text-xs text-zinc-400 hover:border-zinc-500">
          <Plus size={13} /> Add signer
        </button>

        <h2 className="mb-2 text-sm font-semibold text-zinc-300">Routing</h2>
        <div className="mb-6 flex gap-2">
          {['sequential', 'parallel'].map((r) => (
            <button key={r} onClick={() => setRouting(r)} className={`flex-1 rounded-lg border py-1.5 text-xs capitalize ${routing === r ? 'border-indigo-500 bg-indigo-500/10 text-indigo-300' : 'border-zinc-800 text-zinc-500'}`}>{r}</button>
          ))}
        </div>

        <h2 className="mb-2 text-sm font-semibold text-zinc-300">Field palette — click a page to place</h2>
        <div className="mb-6 grid grid-cols-2 gap-2">
          {FIELD_TYPES.map(({ type, label }) => {
            const Icon = FIELD_ICON[type];
            return (
              <button key={type} onClick={() => setActiveTool(type)} className={`flex items-center gap-1.5 rounded-lg border px-2 py-2 text-xs ${activeTool === type ? 'border-indigo-500 bg-indigo-500/10 text-indigo-300' : 'border-zinc-800 text-zinc-400'}`}>
                <Icon size={13} /> {label}
              </button>
            );
          })}
        </div>

        {error && <p className="mb-3 text-xs text-red-400">{error}</p>}

        <div className="space-y-2">
          <button onClick={() => save()} disabled={saving} className="flex w-full items-center justify-center gap-2 rounded-lg border border-zinc-700 py-2 text-sm hover:bg-zinc-800 disabled:opacity-50">
            <Save size={15} /> Save draft
          </button>
          <button onClick={() => save({ andSend: true })} disabled={saving || !fields.length} className="flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 py-2 text-sm font-medium hover:bg-indigo-500 disabled:opacity-50">
            <Send size={15} /> Save &amp; send
          </button>
        </div>
      </aside>
    </div>
  );
}

function clamp(v, min, max) { return Math.min(Math.max(v, min), max); }
