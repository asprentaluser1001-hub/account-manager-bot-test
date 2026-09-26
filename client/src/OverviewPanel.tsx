import { useCallback, useEffect, useMemo, useState } from 'react';

type AccountSummary = { sold: boolean };
type Order = { id: string; username: string; status: string; expires_at: string | null; created_at: string; account_id: string | null };
type Overview = { orders: Order[]; summary: { available: number; pending: { n: number } } };
type Destination = 'overview' | 'accounts' | 'approvals' | 'manual' | 'finance' | 'history' | 'settings';

function indiaDay(date: Date) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const value = (type: string) => parts.find(part => part.type === type)?.value || '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}

export default function OverviewPanel({ token, accounts, onNavigate }: { token: string; accounts: AccountSummary[]; onNavigate: (tab: Destination) => void }) {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState('');
  const [now, setNow] = useState(Date.now());
  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/test-orders', { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) throw new Error('Could not load booking overview');
      setData(await response.json());
      setError('');
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not load overview'); }
  }, [token]);
  useEffect(() => { load(); const interval = setInterval(load, 15000); return () => clearInterval(interval); }, [load]);
  useEffect(() => { const interval = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(interval); }, []);

  const orders = useMemo(() => data?.orders || [], [data]);
  const active = orders.filter(order => ['approved', 'delivered'].includes(order.status) && order.expires_at && new Date(order.expires_at).getTime() > now);
  const expiring = active.filter(order => new Date(order.expires_at!).getTime() - now <= 24 * 60 * 60 * 1000);
  const pending = orders.filter(order => ['awaiting_payment_claim', 'payment_claimed'].includes(order.status));
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(now - (6 - index) * 86400000);
    const key = indiaDay(date);
    return { key, label: date.toLocaleDateString('en-IN', { weekday: 'short', timeZone: 'Asia/Kolkata' }), count: orders.filter(order => indiaDay(new Date(order.created_at)) === key).length };
  });
  const max = Math.max(1, ...days.map(day => day.count));

  return <div className="v3-overview">
    <div className="v3-overview-heading"><div><p className="v3-eyebrow">Developer preview · test data</p><h2>Overview</h2><p>Account bookings and payments at a glance</p></div><span className="v3-today">Today</span></div>
    {error && <p role="alert" className="v3-error">{error} <button onClick={load}>Retry</button></p>}
    <div className="v3-metrics">
      <button onClick={() => onNavigate('history')} className="v3-glass v3-metric"><span className="v3-metric-icon">◷</span><span>Active bookings<strong>{active.length.toString().padStart(2, '0')}</strong></span><span aria-hidden="true">›</span></button>
      <button onClick={() => onNavigate('accounts')} className="v3-glass v3-metric"><span className="v3-metric-icon">◎</span><span>Available accounts<strong>{(accounts.length ? accounts.filter(a => !a.sold).length : data?.summary.available || 0).toString().padStart(2, '0')}</strong></span><span aria-hidden="true">›</span></button>
      <button onClick={() => onNavigate('approvals')} className="v3-glass v3-metric"><span className="v3-metric-icon">▤</span><span>Payments pending<strong>{pending.length.toString().padStart(2, '0')}</strong></span><span aria-hidden="true">›</span></button>
      <button onClick={() => onNavigate('history')} className="v3-glass v3-metric"><span className="v3-metric-icon">◴</span><span>Expiring soon<strong>{expiring.length.toString().padStart(2, '0')}</strong></span><span aria-hidden="true">›</span></button>
    </div>
    <section className="v3-glass v3-overview-card" aria-label="Weekly bookings"><div className="v3-section-head"><h3>Weekly bookings</h3><span>Last 7 days</span></div><div className="v3-chart">{days.map(day => <div className="v3-chart-day" key={day.key}><span>{day.count}</span><div className="v3-chart-track"><i style={{ height: `${Math.max(day.count ? day.count / max * 100 : 3, 3)}%` }} /></div><small>{day.label}</small></div>)}</div></section>
    <section className="v3-glass v3-overview-card"><div className="v3-section-head"><h3>Live bookings</h3><button onClick={() => onNavigate('history')}>View all ›</button></div>{active.length ? active.slice(0, 3).map(order => <div className="v3-booking-row" key={order.id}><div className="v3-booking-info"><strong>{order.username}</strong><small>{order.id}</small></div><span className="v3-active-pill">Active</span><span className="v3-remaining">{Math.max(0, Math.ceil((new Date(order.expires_at!).getTime() - now) / 60000))}m left</span><button onClick={() => onNavigate('history')} className="v3-manage">Manage</button></div>) : <p className="v3-empty">No active test bookings yet. New bookings will appear here.</p>}</section>
  </div>;
}
