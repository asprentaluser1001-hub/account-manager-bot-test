// Calendar reporting follows Asia/Kolkata (UTC+05:30), regardless of VPS timezone.
const INDIA_OFFSET_MS = 330 * 60_000;
export function indiaMonthWindow(now = new Date()) {
  const local = new Date(now.getTime() + INDIA_OFFSET_MS);
  const year = local.getUTCFullYear(), month = local.getUTCMonth();
  const start = new Date(Date.UTC(year, month, 1) - INDIA_OFFSET_MS).toISOString();
  const end = new Date(Date.UTC(year, month + 1, 1) - INDIA_OFFSET_MS).toISOString();
  const recent = new Date(local);
  recent.setUTCHours(0, 0, 0, 0);
  recent.setUTCDate(recent.getUTCDate() - 6);
  const recentStart = new Date(recent.getTime() - INDIA_OFFSET_MS).toISOString();
  return {start, end, recentStart, cutoff: `${year}-${String(month + 1).padStart(2, '0')}-01`,
    until: new Date(Date.UTC(year, month + 1, 1)).toISOString().slice(0, 10)};
}
