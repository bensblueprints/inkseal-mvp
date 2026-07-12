import { useState } from 'react';
import { motion } from 'framer-motion';
import { X, KeyRound, Sparkles, ExternalLink } from 'lucide-react';
import { api } from '../api.js';

const CHECKOUT_URL = 'https://whop.com/checkout/plan_xRtPj9lTHiX0x';

/**
 * Shown when an unlicensed install has used its one free document and tries
 * to create another. Offers the $59 lifetime checkout + a license key field.
 */
export default function UpgradeModal({ onClose, onActivated, checkoutUrl = CHECKOUT_URL }) {
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const activate = async () => {
    if (!key.trim()) return;
    setBusy(true);
    setError('');
    try {
      await api.activateLicense(key.trim());
      onActivated?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-950 p-8"
      >
        <div className="mb-6 flex items-start justify-between">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-indigo-500/15 text-indigo-400">
            <Sparkles size={20} />
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300">
            <X size={16} />
          </button>
        </div>

        <h2 className="mb-2 text-xl font-semibold">Your free document is used</h2>
        <p className="mb-6 text-sm text-zinc-400">
          Inkseal includes one complete document free — upload, send, and collect signatures.
          Unlock everything with a single lifetime purchase.
        </p>

        <a
          href={checkoutUrl}
          target="_blank"
          rel="noreferrer"
          className="mb-6 flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-3 text-sm font-semibold hover:bg-indigo-500"
        >
          $59 once — unlimited documents forever <ExternalLink size={14} />
        </a>

        <div className="mb-2 flex items-center gap-2 text-xs font-medium text-zinc-500">
          <KeyRound size={12} /> Already purchased? Enter your license key
        </div>
        <div className="flex gap-2">
          <input
            value={key}
            onChange={(e) => setKey(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ''))}
            placeholder="W-XXXXXX-XXXXXXXX-XXXXXXXW"
            className="min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 font-mono text-sm outline-none focus:border-indigo-500"
          />
          <button
            onClick={activate}
            disabled={busy || !key.trim()}
            className="rounded-lg bg-zinc-800 px-4 py-2 text-sm font-medium hover:bg-zinc-700 disabled:opacity-50"
          >
            {busy ? 'Checking…' : 'Activate'}
          </button>
        </div>
        {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
        <p className="mt-4 text-xs text-zinc-600">
          Your key is in your Whop hub (whop.com/@me) after purchase. One license per person.
        </p>
      </motion.div>
    </div>
  );
}
