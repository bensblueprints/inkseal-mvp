import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { PenTool, ArrowRight } from 'lucide-react';
import { api } from '../api.js';

export default function Login() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.login(password);
      nav('/admin');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen grid place-items-center px-4">
      <motion.form
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        onSubmit={submit}
        className="w-full max-w-sm rounded-2xl border border-zinc-800 bg-zinc-900/60 p-8 backdrop-blur"
      >
        <div className="mb-6 flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-indigo-500/15 text-indigo-400">
            <PenTool size={18} />
          </div>
          <div>
            <h1 className="text-lg font-semibold">Inkseal</h1>
            <p className="text-sm text-zinc-500">Admin sign in</p>
          </div>
        </div>
        <input
          type="password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Admin password"
          className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-sm outline-none focus:border-indigo-500"
        />
        {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
        <button
          disabled={busy || !password}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 py-2.5 text-sm font-medium hover:bg-indigo-500 disabled:opacity-50"
        >
          Sign in <ArrowRight size={16} />
        </button>
      </motion.form>
    </div>
  );
}
