import {useEffect, useState} from 'react';

type Plan = {hours: number; amount: number};
type Coupon = {id: string; code: string; hours: number; value: number; redeemed_at: string | null; order_id: string | null; cancelled_at: string | null};

const endpoint = '/api/payment-settings/coupons';
const duration = (hours: number) => hours === 0.5 ? '30 minutes' : hours === 168 ? '1 week' : hours === 720 ? '1 month' : `${hours} ${hours === 1 ? 'hour' : 'hours'}`;

export default function CouponPanel({token}: {token: string}) {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [hours, setHours] = useState<number>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [copied, setCopied] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    fetch(endpoint, {headers: {Authorization: `Bearer ${token}`}, signal: controller.signal})
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Could not load checkout coupons');
        setPlans(data.plans);
        setHours(data.plans[0]?.hours);
        setCoupons(data.coupons);
      })
      .catch(error => {
        if (!controller.signal.aborted) setError(error.message);
      });
    return () => controller.abort();
  }, [token]);

  async function generate(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'},
        body: JSON.stringify({hours}),
      });
      const coupon = await response.json();
      if (!response.ok) throw new Error(coupon.error || 'Could not generate a coupon');
      setCoupons(current => [coupon, ...current].slice(0, 200));
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not generate a coupon');
    } finally {
      setBusy(false);
    }
  }

  async function cancel(coupon: Coupon) {
    if (!window.confirm('Cancel this coupon? It will no longer work at checkout.')) return;
    setCancelling(coupon.id);
    setError('');
    try {
      const headers = {Authorization: `Bearer ${token}`};
      const response = await fetch(`${endpoint}/${coupon.id}/cancel`, {method: 'POST', headers});
      const updated = await response.json();
      if (response.status === 409) {
        const refreshed = await fetch(endpoint, {headers});
        if (refreshed.ok) setCoupons((await refreshed.json()).coupons);
      }
      if (!response.ok) throw new Error(updated.error || 'Could not cancel the coupon');
      setCoupons(current => current.map(item => item.id === updated.id ? updated : item));
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not cancel the coupon');
    } finally {
      setCancelling(null);
    }
  }

  async function copy(code: string) {
    setError('');
    try {
      await navigator.clipboard.writeText(code);
      setCopied(code);
    } catch {
      setError('Select and copy the code manually.');
    }
  }

  return <section className="admin-panel">
    <p className="mt-1 text-sm text-slate-500">Generate a single-use code and share it privately with your customer.</p>
    <form onSubmit={generate} className="mt-4 flex flex-wrap items-end gap-3">
      <label className="text-sm text-slate-700">
        Free slot
        <select className="mt-1 block rounded-lg border border-slate-300 px-3 py-2" value={hours ?? ''} onChange={event => setHours(Number(event.target.value))}>
          {plans.map(plan => <option key={plan.hours} value={plan.hours}>{duration(plan.hours)} · ₹{plan.amount} value</option>)}
        </select>
      </label>
      <button disabled={busy || hours === undefined} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
        {busy ? 'Generating…' : 'Generate code'}
      </button>
    </form>
    {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
    <ul className="mt-4 divide-y divide-slate-200">
      {coupons.map(coupon => <li key={coupon.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
        <div className="min-w-0">
          <code className="break-all text-sm text-slate-900">{coupon.code}</code>
          <p className="text-sm text-slate-600">
            {duration(coupon.hours)} · ₹{coupon.value} value · {coupon.order_id ? `Redeemed · ${coupon.order_id}` : coupon.cancelled_at ? 'Cancelled' : 'Unused'}
          </p>
        </div>
        {!coupon.redeemed_at && !coupon.cancelled_at && <div className="flex flex-wrap gap-2"><button type="button" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" onClick={() => void copy(coupon.code)}>
          {copied === coupon.code ? 'Copied' : 'Copy code'}
        </button>
        <button type="button" className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-red-700" disabled={cancelling !== null} onClick={() => void cancel(coupon)}>
          {cancelling === coupon.id ? 'Cancelling…' : 'Cancel code'}
        </button></div>}
      </li>)}
    </ul>
  </section>;
}
