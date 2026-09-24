import { useState, useEffect, useCallback } from 'react';
import OrdersPanel from './OrdersPanel';

interface Account {
  id: string;
  name: string;
  email: string;
  password: string;
  sold: boolean;
  soldUntil: string | null;
  last_reset_at: string | null;
  created_at: string;
  autoResetAt: string | null;
}

interface HistoryEntry {
  id: string;
  account_name: string;
  success: boolean;
  new_password: string | null;
  error: string | null;
  source: string;
  created_at: string;
}

const TOKEN_KEY = 'am_token';

export default function App() {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));

  if (!token) {
    return <Login onLogin={(t) => { localStorage.setItem(TOKEN_KEY, t); setToken(t); }} />;
  }
  return <Dashboard token={token} onLogout={() => { localStorage.removeItem(TOKEN_KEY); setToken(null); }} />;
}
// ─── Small inline icons (no external deps) ──────────────────────────────────

function Icon({ path, className = 'w-4 h-4', stroke = 1.7 }: { path: string; className?: string; stroke?: number }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke}
      strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d={path} />
    </svg>
  );
}
const ICONS = {
  shield: 'M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z',
  logout: 'M15 12H3m0 0l4-4m-4 4l4 4M13 4h6a1 1 0 011 1v14a1 1 0 01-1 1h-6',
  key: 'M15.5 7.5a3.5 3.5 0 11-4.9 3.2L4 17.3V20h2.7l.9-.9H9v-1.4h1.4l1-1a3.5 3.5 0 014.1-9.2z',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z M12 15a3 3 0 100-6 3 3 0 000 6z',
  eyeOff: 'M3 3l18 18M10.6 10.6a3 3 0 004.2 4.2M9.9 5.2A9.5 9.5 0 0112 5c6.5 0 10 7 10 7a15.8 15.8 0 01-3.3 3.9M6.1 6.1A15.9 15.9 0 002 12s3.5 7 10 7c1 0 2-.1 2.8-.4',
  copy: 'M9 9h9a1 1 0 011 1v9a1 1 0 01-1 1H9a1 1 0 01-1-1v-9a1 1 0 011-1z M5 15V5a1 1 0 011-1h9',
  pencil: 'M12 20h9 M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4L16.5 3.5z',
  trash: 'M4 7h16 M10 11v6 M14 11v6 M5 7l1 13a1 1 0 001 1h10a1 1 0 001-1l1-13 M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3',
  history: 'M3 12a9 9 0 109-9 9 9 0 00-7 3.3M3 4v4h4 M12 8v4l3 2',
  check: 'M20 6L9 17l-5-5',
  x: 'M18 6L6 18M6 6l12 12',
  plus: 'M12 5v14M5 12h14',
  clock: 'M12 7v5l3 2 M12 21a9 9 0 100-18 9 9 0 000 18z',
};

// ─── Login ────────────────────────────────────────────────────────────────

function Login({ onLogin }: { onLogin: (token: string) => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Login failed');
      onLogin(data.token);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-5 bg-slate-50">
      <form onSubmit={submit} className="w-full max-w-sm bg-white rounded-2xl border border-slate-200 shadow-sm p-7">
        <div className="flex items-center gap-2.5 mb-1">
          <span className="grid place-items-center w-9 h-9 rounded-xl bg-slate-900 text-white">
            <Icon path={ICONS.shield} className="w-5 h-5" />
          </span>
          <h1 className="font-heading text-xl font-bold text-slate-900">Account Manager</h1>
        </div>
        <p className="font-body text-sm text-slate-500 mt-1 mb-5">Enter admin password to continue</p>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Admin password"
          className="w-full px-3.5 py-2.5 border border-slate-300 rounded-xl text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-400"
          autoFocus
        />
        {error && <p className="text-red-500 text-sm mt-3">{error}</p>}
        <button
          type="submit"
          disabled={loading}
          className="w-full mt-4 px-4 py-2.5 text-sm font-semibold text-white bg-slate-900 rounded-xl hover:bg-slate-800 transition-colors disabled:opacity-50"
        >
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}

// Format a Date into the `YYYY-MM-DDTHH:mm` string used by the scheduler.
function toLocalInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

// Format the remaining time until `iso` as a short "2h 15m" / "45m 10s" string.
function formatRemaining(iso: string, now: number): string {
  let ms = new Date(iso).getTime() - now;
  if (ms <= 0) return 'ending…';
  const h = Math.floor(ms / 3_600_000); ms -= h * 3_600_000;
  const m = Math.floor(ms / 60_000); ms -= m * 60_000;
  const s = Math.floor(ms / 1000);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

// ─── Auto-reset time picker ─────────────────────────────────────────────────
// Fast, scroll-friendly picker: one-tap presets + separate date / hour / minute
// dropdowns (minutes in 5-min steps) instead of the fiddly datetime-local input.

function AutoResetPicker({
  value,
  onChange,
  onSet,
  onCancel,
}: {
  value: string;
  onChange: (v: string) => void;
  onSet: () => void;
  onCancel: () => void;
}) {
  // Parse current value (or default to now + 1 hour, rounded to 5 min).
  const base = (() => {
    if (value) {
      const d = new Date(value);
      if (!isNaN(d.getTime())) return d;
    }
    const d = new Date(Date.now() + 60 * 60 * 1000);
    d.setMinutes(Math.round(d.getMinutes() / 5) * 5, 0, 0);
    return d;
  })();

  // Ensure there's always a value once the picker opens.
  // (Initial value is set by the parent when it opens the picker — no
  // mount-time onChange call here, which would cause a re-render that
  // swallows the very click that opened the picker.)
  const dateStr = `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, '0')}-${String(base.getDate()).padStart(2, '0')}`;
  const hour = base.getHours();
  const minute = base.getMinutes();

  function setPreset(ms: number) {
    const d = new Date(Date.now() + ms);
    d.setSeconds(0, 0);
    onChange(toLocalInput(d));
  }
  function updateDate(newDate: string) {
    const [y, m, day] = newDate.split('-').map(Number);
    const d = new Date(base);
    d.setFullYear(y, m - 1, day);
    onChange(toLocalInput(d));
  }
  function updateHour(h: number) {
    const d = new Date(base);
    d.setHours(h);
    onChange(toLocalInput(d));
  }
  function updateMinute(mm: number) {
    const d = new Date(base);
    d.setMinutes(mm);
    onChange(toLocalInput(d));
  }

  // Build 14 upcoming days for the date dropdown.
  const dayOptions = Array.from({ length: 14 }, (_, i) => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + i);
    const val = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const label =
      i === 0 ? 'Today' : i === 1 ? 'Tomorrow' :
      d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
    return { val, label };
  });

  const selCls =
    'px-3 py-2 border border-slate-300 rounded-xl text-sm text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-400';

  const HOUR = 60 * 60 * 1000;
  const presets: { label: string; fn: () => void }[] = [
    { label: '1 hour', fn: () => setPreset(1 * HOUR) },
    { label: '2 hours', fn: () => setPreset(2 * HOUR) },
    { label: '4 hours', fn: () => setPreset(4 * HOUR) },
    { label: '24 hours', fn: () => setPreset(24 * HOUR) },
  ];

  return (
    <div className="mt-3 bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-3">
      {/* Quick presets */}
      <div className="flex flex-wrap gap-2">
        {presets.map((p) => (
          <button
            key={p.label}
            onClick={p.fn}
            className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-full hover:bg-slate-100 active:scale-[0.97] transition"
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Scrollable date / hour / minute dropdowns */}
      <div className="grid grid-cols-3 gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-medium text-slate-400">Date</span>
          <select value={dateStr} onChange={(e) => updateDate(e.target.value)} className={selCls}>
            {dayOptions.map((o) => <option key={o.val} value={o.val}>{o.label}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-medium text-slate-400">Hour</span>
          <select value={hour} onChange={(e) => updateHour(Number(e.target.value))} className={selCls}>
            {Array.from({ length: 24 }, (_, h) => (
              <option key={h} value={h}>
                {((h % 12) || 12)}:00 {h < 12 ? 'AM' : 'PM'}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-medium text-slate-400">Minute</span>
          <select value={minute} onChange={(e) => updateMinute(Number(e.target.value))} className={selCls}>
            {Array.from({ length: 12 }, (_, i) => i * 5).map((mm) => (
              <option key={mm} value={mm}>:{String(mm).padStart(2, '0')}</option>
            ))}
          </select>
        </label>
      </div>

      {/* Selected summary */}
      {value && (
        <p className="text-xs text-slate-500">
          Will reset on <span className="font-medium text-slate-700">{new Date(value).toLocaleString()}</span>
        </p>
      )}

      {/* Actions */}
      <div className="flex gap-2">
        <button onClick={onSet}
          className="px-4 py-2 text-sm font-semibold text-white bg-blue-600 rounded-xl hover:bg-blue-700">Schedule</button>
        <button onClick={onCancel}
          className="px-4 py-2 text-sm font-medium text-slate-600 bg-slate-100 rounded-xl hover:bg-slate-200">Cancel</button>
      </div>
    </div>
  );
}

// ─── Dashboard ──────────────────────────────────────────────────────────────

function Dashboard({ token, onLogout }: { token: string; onLogout: () => void }) {
  const [showSettings, setShowSettings] = useState(false);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedHistory, setExpandedHistory] = useState<Record<string, boolean>>({});
  const [historyShown, setHistoryShown] = useState(5);
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // add form
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState('');

  // edit form
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editPassword, setEditPassword] = useState('');
  const [saving, setSaving] = useState(false);

  // per-account states
  const [resettingId, setResettingId] = useState<string | null>(null);
  const [resetResult, setResetResult] = useState<Record<string, { ok: boolean; msg: string }>>({});
  const [autoOpenId, setAutoOpenId] = useState<string | null>(null);
  const [autoTime, setAutoTime] = useState('');
  const [soldOpenId, setSoldOpenId] = useState<string | null>(null);
  const [soldHours, setSoldHours] = useState(1);
  const [nowTick, setNowTick] = useState(Date.now());

  const authHeaders = useCallback(
    () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }),
    [token]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [accRes, histRes] = await Promise.all([
        fetch('/api/accounts', { headers: authHeaders() }),
        fetch('/api/history', { headers: authHeaders() }),
      ]);
      if (accRes.status === 401 || histRes.status === 401) { onLogout(); return; }
      const accData = await accRes.json();
      const histData = await histRes.json();
      if (!accRes.ok) throw new Error(accData.error || 'Failed to load');
      setAccounts(accData.accounts);
      setHistory(histData.history || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [authHeaders, onLogout]);

  useEffect(() => { load(); }, [load]);

  // Tick every second so "ends in ..." countdowns update live.
  useEffect(() => {
    const t = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // When any sold timer passes its end, reload so the server unsells it.
  useEffect(() => {
    const anyExpired = accounts.some(
      (a) => a.sold && a.soldUntil && new Date(a.soldUntil).getTime() <= nowTick
    );
    if (anyExpired) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nowTick]);

  async function addAccount() {
    if (!name.trim() || !email.trim() || !password.trim()) { setAddError('All fields are required'); return; }
    setAdding(true); setAddError('');
    try {
      const res = await fetch('/api/accounts', {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ name: name.trim(), email: email.trim(), password: password.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to add');
      setName(''); setEmail(''); setPassword(''); setShowAdd(false);
      await load();
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'Failed to add');
    } finally { setAdding(false); }
  }

  async function saveEdit(id: string) {
    setSaving(true);
    try {
      const res = await fetch(`/api/accounts/${id}`, {
        method: 'PATCH', headers: authHeaders(),
        body: JSON.stringify({ name: editName, email: editEmail, password: editPassword }),
      });
      if (res.status === 401) { onLogout(); return; }
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || 'Failed'); }
      setEditingId(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally { setSaving(false); }
  }

  async function markSold(id: string, hours: number) {
    setSoldOpenId(null);
    try {
      const res = await fetch(`/api/accounts/${id}/sold`, {
        method: 'PATCH', headers: authHeaders(),
        body: JSON.stringify({ sold: true, hours }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || 'Failed'); }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to mark sold');
    }
  }

  async function unsell(id: string) {
    setAccounts((prev) => prev.map((a) => (a.id === id ? { ...a, sold: false, soldUntil: null } : a)));
    try {
      await fetch(`/api/accounts/${id}/sold`, {
        method: 'PATCH', headers: authHeaders(),
        body: JSON.stringify({ sold: false }),
      });
      await load();
    } catch { /* ignore, will re-sync on next load */ }
  }

  async function deleteAccount(id: string) {
    if (!confirm('Delete this account?')) return;
    try {
      const res = await fetch(`/api/accounts/${id}`, { method: 'DELETE', headers: authHeaders() });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || 'Failed'); }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete');
    }
  }

  async function resetPassword(id: string) {
    setResettingId(id);
    setResetResult((r) => { const c = { ...r }; delete c[id]; return c; });
    try {
      const res = await fetch(`/api/accounts/${id}/reset-password`, { method: 'POST', headers: authHeaders() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Reset failed');
      setResetResult((r) => ({ ...r, [id]: { ok: true, msg: `New password: ${data.newPassword}` } }));
      await load();
    } catch (err) {
      setResetResult((r) => ({ ...r, [id]: { ok: false, msg: err instanceof Error ? err.message : 'Reset failed' } }));
    } finally { setResettingId(null); }
  }

  async function scheduleAutoReset(id: string) {
    if (!autoTime) { setError('Pick a time first'); return; }
    const runAt = new Date(autoTime).toISOString();
    try {
      const res = await fetch(`/api/accounts/${id}/auto-reset`, {
        method: 'POST', headers: authHeaders(), body: JSON.stringify({ runAt }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || 'Failed'); }
      setAutoOpenId(null); setAutoTime('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to schedule');
    }
  }

  async function cancelAutoReset(id: string) {
    try {
      await fetch(`/api/accounts/${id}/auto-reset`, { method: 'DELETE', headers: authHeaders() });
      await load();
    } catch { /* ignore */ }
  }

  function onToggleAuto(acc: Account) {
    if (acc.autoResetAt) {
      cancelAutoReset(acc.id);
      if (autoOpenId === acc.id) setAutoOpenId(null);
    } else {
      // Pre-fill with "now + 1 hour, rounded to 5 min" so presets work on
      // first tap without a mount-time onChange re-render.
      const d = new Date(Date.now() + 60 * 60 * 1000);
      d.setSeconds(0, 0);
      d.setMinutes(Math.round(d.getMinutes() / 5) * 5);
      setAutoTime(toLocalInput(d));
      setAutoOpenId(autoOpenId === acc.id ? null : acc.id);
    }
  }

  async function copyCredentials(acc: Account) {
    const text = `Email:- ${acc.email}\nPassword:- ${acc.password}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(acc.id);
      setTimeout(() => setCopiedId((c) => (c === acc.id ? null : c)), 1200);
    } catch { /* clipboard blocked */ }
  }

  const inputCls =
    'w-full px-3.5 py-2.5 border border-slate-300 rounded-xl text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-400';

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 sm:px-5 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="grid place-items-center w-9 h-9 rounded-xl bg-slate-900 text-white">
              <Icon path={ICONS.shield} className="w-5 h-5" />
            </span>
            <h1 className="font-heading text-lg font-bold text-slate-900">Account Manager</h1>
          </div>
          <button
            onClick={onLogout}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors"
          >
            <Icon path={ICONS.logout} className="w-4 h-4" />
            <span>Log out</span>
          </button>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-5 py-6">
        {showSettings ? (
          <SettingsPanel token={token} onLogout={onLogout} onBack={() => setShowSettings(false)} />
        ) : (
        <>
        <OrdersPanel token={token} />
        {/* Title + Add */}
        <div className="flex items-start justify-between gap-3 mb-5">
          <div className="min-w-0">
            <h2 className="font-heading text-2xl font-bold text-slate-900">Accounts</h2>
          </div>
          <button
            onClick={() => setShowAdd(!showAdd)}
            className="shrink-0 inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-semibold text-white bg-slate-900 rounded-xl hover:bg-slate-800 transition-colors whitespace-nowrap shadow-sm"
          >
            <Icon path={showAdd ? ICONS.x : ICONS.plus} className="w-4 h-4" />
            {showAdd ? 'Cancel' : 'Add account'}
          </button>
        </div>

        {error && (
          <div className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-3.5 py-2.5">
            {error}
          </div>
        )}

        {/* Add form */}
        {showAdd && (
          <div className="mb-5 p-4 bg-white rounded-2xl border border-slate-200 shadow-sm space-y-3">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Account name (e.g. Account 1)" className={inputCls} />
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email / Username" className={inputCls} />
            <input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" className={inputCls} />
            {addError && <p className="text-red-500 text-xs">{addError}</p>}
            <button onClick={addAccount} disabled={adding}
              className="w-full px-4 py-2.5 text-sm font-semibold text-white bg-slate-900 rounded-xl hover:bg-slate-800 disabled:opacity-50">
              {adding ? 'Adding…' : 'Save account'}
            </button>
          </div>
        )}

        {/* Accounts list */}
        {loading ? (
          <p className="text-slate-500 text-sm">Loading accounts…</p>
        ) : accounts.length === 0 ? (
          <p className="text-slate-400 text-sm text-center py-10">No accounts added yet.</p>
        ) : (
          <div className="space-y-3">
            {accounts.map((acc) => {
              const isRevealed = !!revealed[acc.id];
              const isEditing = editingId === acc.id;
              const autoOn = !!acc.autoResetAt;
              return (
                <div
                  key={acc.id}
                  className="relative bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden"
                >
                  {/* Accent bar */}
                  <span className={`absolute left-0 top-0 bottom-0 w-1 ${acc.sold ? 'bg-emerald-500' : 'bg-slate-900'}`} />

                  {isEditing ? (
                    <div className="p-4 pl-5 space-y-2">
                      <input value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="Account name" className={inputCls} />
                      <input value={editEmail} onChange={(e) => setEditEmail(e.target.value)} placeholder="Email" className={inputCls} />
                      <input value={editPassword} onChange={(e) => setEditPassword(e.target.value)} placeholder="Password" className={inputCls} />
                      <div className="flex gap-2 pt-1">
                        <button onClick={() => saveEdit(acc.id)} disabled={saving}
                          className="px-4 py-2 text-sm font-semibold text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 disabled:opacity-50">
                          {saving ? 'Saving…' : 'Save'}
                        </button>
                        <button onClick={() => setEditingId(null)}
                          className="px-4 py-2 text-sm font-medium text-slate-600 bg-slate-100 rounded-lg hover:bg-slate-200">Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <div className="p-4 pl-5">
                      {/* Badges row (full width, side by side) */}
                      {(autoOn || acc.sold) && (
                        <div className="flex items-center gap-2 flex-wrap mb-2">
                          {autoOn && (
                            <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                              <Icon path={ICONS.shield} className="w-3 h-3" /> Auto-reset on
                            </span>
                          )}
                          {acc.sold && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700 bg-emerald-100 border border-emerald-300 px-2 py-0.5 rounded-full">
                              <span className="uppercase tracking-wide">Sold</span>
                              {acc.soldUntil && (
                                <span className="normal-case font-medium">· ends in {formatRemaining(acc.soldUntil, nowTick)}</span>
                              )}
                            </span>
                          )}
                        </div>
                      )}

                      {/* Name (left) + edit/delete icons (right) on one row */}
                      <div className="flex items-center justify-between gap-3">
                        <h3 className="font-heading text-base font-bold text-slate-900 min-w-0 truncate">{acc.name}</h3>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            onClick={() => { setEditingId(acc.id); setEditName(acc.name); setEditEmail(acc.email); setEditPassword(acc.password); }}
                            title="Edit"
                            className="p-2 text-slate-400 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors"
                          >
                            <Icon path={ICONS.pencil} />
                          </button>
                          <button
                            onClick={() => deleteAccount(acc.id)}
                            title="Delete"
                            className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                          >
                            <Icon path={ICONS.trash} />
                          </button>
                        </div>
                      </div>

                      {/* Credentials box: email (always shown) + password (toggle) */}
                      <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 divide-y divide-slate-200">
                        {/* Email row */}
                        <div className="flex items-center gap-2 px-3 py-2">
                          <span className="text-xs font-medium text-slate-400 w-16 shrink-0">Email</span>
                          <span className="flex-1 font-mono text-sm text-slate-800 truncate">{acc.email}</span>
                        </div>
                        {/* Password row */}
                        <div className="flex items-center gap-2 px-3 py-2">
                          <span className="text-xs font-medium text-slate-400 w-16 shrink-0">Password</span>
                          <span className="flex-1 font-mono text-sm text-slate-800 tracking-wide truncate">
                            {isRevealed ? acc.password : '•'.repeat(Math.max(6, acc.password.length))}
                          </span>
                          <button
                            onClick={() => setRevealed((r) => ({ ...r, [acc.id]: !r[acc.id] }))}
                            title={isRevealed ? 'Hide password' : 'Show password'}
                            className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-200/70 transition-colors"
                          >
                            <Icon path={isRevealed ? ICONS.eyeOff : ICONS.eye} />
                          </button>
                          <button
                            onClick={() => copyCredentials(acc)}
                            title="Copy email & password"
                            className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-200/70 transition-colors"
                          >
                            {copiedId === acc.id
                              ? <Icon path={ICONS.check} className="w-4 h-4 text-emerald-600" />
                              : <Icon path={ICONS.copy} />}
                          </button>
                        </div>
                      </div>

                      {/* Meta chips: last reset + next scheduled reset */}
                      <div className="mt-2.5 flex flex-wrap gap-2">
                        <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-500 bg-slate-100 rounded-lg px-2 py-1">
                          <Icon path={ICONS.history} className="w-3.5 h-3.5 text-slate-400" />
                          {acc.last_reset_at ? (
                            <>Last reset <span className="font-medium text-slate-700">{new Date(acc.last_reset_at).toLocaleString()}</span></>
                          ) : (
                            <span className="text-slate-400">Never reset</span>
                          )}
                        </span>
                        {autoOn && (
                          <span className="inline-flex items-center gap-1.5 text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-2 py-1">
                            <Icon path={ICONS.clock} className="w-3.5 h-3.5" />
                            Next <span className="font-medium">{new Date(acc.autoResetAt as string).toLocaleString()}</span>
                          </span>
                        )}
                      </div>

                      {/* Reset result */}
                      {resetResult[acc.id] && (
                        <p className={`font-body text-xs mt-2 rounded-lg px-2.5 py-1.5 ${resetResult[acc.id].ok ? 'text-emerald-700 bg-emerald-50 border border-emerald-200' : 'text-red-600 bg-red-50 border border-red-200'}`}>
                          {resetResult[acc.id].ok ? '✓ ' : '✗ '}{resetResult[acc.id].msg}
                        </p>
                      )}

                      {/* Auto-reset time picker */}
                      {autoOpenId === acc.id && (
                        <AutoResetPicker
                          value={autoTime}
                          onChange={setAutoTime}
                          onSet={() => scheduleAutoReset(acc.id)}
                          onCancel={() => { setAutoOpenId(null); setAutoTime(''); }}
                        />
                      )}

                      {/* Divider */}
                      <div className="border-t border-slate-100 my-3.5" />

                      {/* Action row — both buttons stay side by side */}
                      <div className="flex items-center gap-2 flex-nowrap">
                        <button
                          onClick={() => resetPassword(acc.id)}
                          disabled={resettingId === acc.id}
                          className="inline-flex items-center justify-center gap-2 flex-1 px-3 py-2.5 text-sm font-semibold text-white bg-slate-900 rounded-xl hover:bg-slate-800 active:scale-[0.98] transition disabled:opacity-50 whitespace-nowrap"
                        >
                          <Icon path={ICONS.key} className="w-4 h-4 shrink-0" />
                          {resettingId === acc.id ? 'Resetting…' : 'Reset password'}
                        </button>

                        {/* Auto reset button */}
                        <button
                          onClick={() => onToggleAuto(acc)}
                          className={`inline-flex items-center justify-center gap-2 flex-1 px-3 py-2.5 text-sm font-semibold rounded-xl border transition active:scale-[0.98] whitespace-nowrap ${
                            autoOn
                              ? 'text-emerald-700 bg-emerald-50 border-emerald-300 hover:bg-emerald-100'
                              : 'text-slate-700 bg-white border-slate-300 hover:bg-slate-50'
                          }`}
                        >
                          <Icon path={ICONS.clock} className="w-4 h-4 shrink-0" />
                          {autoOn ? 'Auto reset: On' : 'Auto reset'}
                        </button>
                      </div>

                      {/* Sold controls (subtle, bottom) */}
                      <div className="mt-3">
                        {acc.sold ? (
                          <button
                            onClick={() => unsell(acc.id)}
                            className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-red-600 transition-colors"
                          >
                            <Icon path={ICONS.x} className="w-3.5 h-3.5" /> Unsell now
                          </button>
                        ) : (
                          <button
                            onClick={() => { setSoldOpenId(soldOpenId === acc.id ? null : acc.id); setSoldHours(1); }}
                            className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-800 transition-colors"
                          >
                            <Icon path={ICONS.clock} className="w-3.5 h-3.5" /> Mark as sold
                          </button>
                        )}

                        {/* Sold-hours picker */}
                        {soldOpenId === acc.id && !acc.sold && (
                          <div className="mt-2 bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-3">
                            <p className="text-xs text-slate-500">Mark sold for how long?</p>
                            <div className="flex flex-wrap gap-2">
                              {[1, 2, 4, 6, 12, 24].map((h) => (
                                <button
                                  key={h}
                                  onClick={() => setSoldHours(h)}
                                  className={`px-3 py-1.5 text-xs font-medium rounded-full border transition ${
                                    soldHours === h
                                      ? 'text-white bg-slate-900 border-slate-900'
                                      : 'text-slate-700 bg-white border-slate-300 hover:bg-slate-100'
                                  }`}
                                >
                                  {h}h
                                </button>
                              ))}
                            </div>
                            <div className="flex items-center gap-2">
                              <label className="text-xs text-slate-500">Custom:</label>
                              <input
                                type="range" min={1} max={24} value={soldHours}
                                onChange={(e) => setSoldHours(Number(e.target.value))}
                                className="flex-1 accent-slate-900"
                              />
                              <span className="text-xs font-semibold text-slate-700 w-10 text-right">{soldHours}h</span>
                            </div>
                            <div className="flex gap-2">
                              <button onClick={() => markSold(acc.id, soldHours)}
                                className="px-4 py-2 text-sm font-semibold text-white bg-emerald-600 rounded-xl hover:bg-emerald-700">
                                Mark sold for {soldHours}h
                              </button>
                              <button onClick={() => setSoldOpenId(null)}
                                className="px-4 py-2 text-sm font-medium text-slate-600 bg-slate-100 rounded-xl hover:bg-slate-200">Cancel</button>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* ─── Reset History ─────────────────────────────────── */}
        <div className="mt-9">
          <div className="flex items-center gap-2 mb-1">
            <Icon path={ICONS.history} className="w-5 h-5 text-slate-500" />
            <h2 className="font-heading text-xl font-bold text-slate-900">Password reset history</h2>
          </div>
          <p className="font-body text-sm text-slate-500 mb-4">Which account was reset, when, and the result.</p>

          {history.length === 0 ? (
            <p className="text-slate-400 text-sm">No resets yet.</p>
          ) : (
            <>
              {/* Fixed-height scroll container */}
              <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
                <div className="overflow-y-auto max-h-[340px] divide-y divide-slate-100">
                  {history.slice(0, historyShown).map((h) => (
                    <div key={h.id} className="px-4 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="font-body text-sm text-slate-900 flex items-center gap-2 flex-wrap">
                            <span className="font-semibold truncate">{h.account_name}</span>
                            <span className={`text-[10px] px-2 py-0.5 rounded-full shrink-0 ${h.source === 'auto' ? 'bg-blue-50 text-blue-600 border border-blue-200' : 'bg-slate-100 text-slate-500 border border-slate-200'}`}>
                              {h.source}
                            </span>
                          </p>
                          <p className="font-body text-xs text-slate-400 mt-0.5">
                            {new Date(h.created_at).toLocaleString()}
                            {h.success && h.new_password && (
                              <span className="ml-2 font-mono text-slate-600">→ {h.new_password}</span>
                            )}
                          </p>
                        </div>
                        <span className={`inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full shrink-0 ${h.success ? 'text-emerald-700 bg-emerald-50 border border-emerald-200' : 'text-red-600 bg-red-50 border border-red-200'}`}>
                          <Icon path={h.success ? ICONS.check : ICONS.x} className="w-3 h-3" />
                          {h.success ? 'Success' : 'Failed'}
                        </span>
                      </div>
                      {!h.success && h.error && (
                        <p
                          onClick={() => setExpandedHistory((prev) => ({ ...prev, [h.id]: !prev[h.id] }))}
                          title={expandedHistory[h.id] ? 'Tap to collapse' : 'Tap to see full error'}
                          className={`font-body text-xs text-red-500 mt-2 cursor-pointer bg-red-50/70 border border-red-100 rounded-lg px-2.5 py-1.5 ${
                            expandedHistory[h.id] ? 'whitespace-pre-wrap break-words' : 'truncate'
                          }`}
                        >
                          <span className="text-slate-400">{expandedHistory[h.id] ? '▾ ' : '▸ '}</span>
                          {h.error}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
                {/* Show more */}
                {historyShown < history.length && (
                  <button
                    onClick={() => setHistoryShown((n) => n + 5)}
                    className="w-full py-2.5 text-xs font-medium text-slate-500 hover:text-slate-800 hover:bg-slate-50 border-t border-slate-100 transition-colors"
                  >
                    Show {Math.min(5, history.length - historyShown)} more
                  </button>
                )}
              </div>
            </>
          )}

          {/* Admin Password Reset button */}
          <div className="mt-5">
            <button
              onClick={() => setShowSettings(true)}
              className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-slate-700 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 transition-colors shadow-sm"
            >
              <Icon path={ICONS.key} className="w-4 h-4" />
              Reset Admin Password
            </button>
          </div>
        </div>
        </>
        )}
      </main>
    </div>
  );
}

// ─── Settings Panel ──────────────────────────────────────────────────────────

function SettingsPanel({ token, onLogout, onBack }: { token: string; onLogout: () => void; onBack: () => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    setError(''); setSuccess('');
    if (next.length < 6) { setError('New password must be at least 6 characters'); return; }
    if (next !== confirm) { setError('Passwords do not match'); return; }
    setLoading(true);
    try {
      const res = await fetch('/api/change-admin-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      setSuccess('Password changed! Please log in again with the new password.');
      setCurrent(''); setNext(''); setConfirm('');
      // Log out after 2s so admin uses new password.
      setTimeout(() => onLogout(), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-sm">
      <button onClick={onBack} className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 mb-5 transition-colors">
        <Icon path="M15 19l-7-7 7-7" className="w-4 h-4" /> Back
      </button>
      <h2 className="font-heading text-2xl font-bold text-slate-900 mb-1">Settings</h2>
      <p className="text-sm text-slate-500 mb-6">Manage your admin account.</p>

      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5">
        <h3 className="font-heading text-base font-semibold text-slate-900 mb-4">Change admin password</h3>
        <form onSubmit={changePassword} className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Current password</label>
            <input
              type="password" value={current} onChange={(e) => setCurrent(e.target.value)}
              placeholder="Enter current password"
              className="w-full px-3.5 py-2.5 border border-slate-300 rounded-xl text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-400"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">New password</label>
            <input
              type="password" value={next} onChange={(e) => setNext(e.target.value)}
              placeholder="At least 6 characters"
              className="w-full px-3.5 py-2.5 border border-slate-300 rounded-xl text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-400"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Confirm new password</label>
            <input
              type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)}
              placeholder="Repeat new password"
              className="w-full px-3.5 py-2.5 border border-slate-300 rounded-xl text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-400"
            />
          </div>

          {error && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
          )}
          {success && (
            <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">{success}</p>
          )}

          <button
            type="submit" disabled={loading}
            className="w-full py-2.5 text-sm font-semibold text-white bg-slate-900 rounded-xl hover:bg-slate-800 disabled:opacity-50 transition-colors"
          >
            {loading ? 'Updating…' : 'Update password'}
          </button>
        </form>
      </div>
    </div>
  );
}
