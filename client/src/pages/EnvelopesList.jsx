import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Plus, FileText, Trash2, Upload } from 'lucide-react';
import { api } from '../api.js';

const STATUS_STYLE = {
  draft: 'bg-zinc-700/40 text-zinc-300',
  sent: 'bg-amber-500/15 text-amber-300',
  completed: 'bg-emerald-500/15 text-emerald-300',
  declined: 'bg-red-500/15 text-red-300',
  voided: 'bg-zinc-800 text-zinc-500 line-through',
};

export default function EnvelopesList() {
  const [envelopes, setEnvelopes] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef(null);
  const nav = useNavigate();

  const load = () => api.listEnvelopes().then(setEnvelopes);
  useEffect(() => { load(); }, []);

  const upload = async (file) => {
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      const fd = new FormData();
      fd.append('pdf', file);
      fd.append('title', file.name.replace(/\.pdf$/i, ''));
      const env = await api.createEnvelope(fd);
      nav(`/admin/envelopes/${env.id}/edit`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id) => {
    if (!confirm('Delete this envelope permanently?')) return;
    await api.deleteEnvelope(id);
    load();
  };

  return (
    <div className="mx-auto max-w-5xl p-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Envelopes</h1>
          <p className="text-sm text-zinc-500">Unlimited signatures. Pay once.</p>
        </div>
        <button
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium hover:bg-indigo-500 disabled:opacity-50"
        >
          <Plus size={16} /> New envelope
        </button>
        <input ref={fileRef} type="file" accept="application/pdf" className="hidden" onChange={(e) => upload(e.target.files[0])} />
      </div>

      {error && <div className="mb-4 rounded-lg border border-red-900 bg-red-950/40 px-4 py-2 text-sm text-red-300">{error}</div>}

      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); upload(e.dataTransfer.files[0]); }}
        className={`mb-8 grid place-items-center rounded-2xl border-2 border-dashed p-10 text-center transition ${
          dragOver ? 'border-indigo-500 bg-indigo-500/5' : 'border-zinc-800'
        }`}
      >
        <Upload className="mb-2 text-zinc-600" size={28} />
        <p className="text-sm text-zinc-400">Drag a PDF here, or click "New envelope" — {busy ? 'uploading…' : 'up to 25 MB'}</p>
      </div>

      {envelopes === null ? (
        <p className="text-zinc-500">Loading…</p>
      ) : envelopes.length === 0 ? (
        <p className="text-zinc-500">No envelopes yet. Upload a PDF to get started.</p>
      ) : (
        <div className="divide-y divide-zinc-800 rounded-xl border border-zinc-800">
          {envelopes.map((env, i) => (
            <motion.div
              key={env.id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: i * 0.02 }}
              onClick={() => nav(env.status === 'draft' ? `/admin/envelopes/${env.id}/edit` : `/admin/envelopes/${env.id}`)}
              className="flex cursor-pointer items-center gap-4 px-5 py-4 hover:bg-zinc-900/50"
            >
              <FileText className="shrink-0 text-zinc-500" size={20} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{env.title}</p>
                <p className="text-xs text-zinc-500">
                  {env.signers.length} signer{env.signers.length === 1 ? '' : 's'} · {env.routing} · created {new Date(env.created_at).toLocaleDateString()}
                </p>
              </div>
              <span className={`rounded-full px-2.5 py-1 text-xs font-medium capitalize ${STATUS_STYLE[env.status] || ''}`}>{env.status}</span>
              {env.status === 'draft' && (
                <button
                  onClick={(e) => { e.stopPropagation(); remove(env.id); }}
                  className="rounded-lg p-2 text-zinc-500 hover:bg-red-500/10 hover:text-red-400"
                >
                  <Trash2 size={16} />
                </button>
              )}
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
