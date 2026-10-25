import type { Currency } from './types.js';

export const NA = 'N/A';

type SignMode = 'always' | 'auto' | 'none';

/** Rounded display of a magnitude, without sign or currency prefix. */
function moneyBody(abs: number, currency: Currency): string {
  switch (currency) {
    case 'USD':
      return '$' + abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    case 'IDR':
      return 'Rp ' + Math.round(abs).toLocaleString('id-ID', { maximumFractionDigits: 0 });
  }
}

/** True when the value rounds to zero in its display format. */
function rendersAsZero(abs: number, currency: Currency): boolean {
  if (currency === 'IDR') return abs < 0.5;
  return abs < 0.005;
}

/**
 * `150` USD -> `$150.00`, `2400000` IDR -> `Rp 2.400.000`.
 * Sign is placed before the currency for IDR (`-Rp 138.000`).
 */
export function formatMoney(amount: number | null | undefined, currency: Currency, sign: SignMode = 'none'): string {
  if (amount == null || !Number.isFinite(amount)) return NA;
  const abs = Math.abs(amount);
  const negative = amount < 0 && !rendersAsZero(abs, currency);
  const prefix = negative ? '-' : sign === 'always' && !rendersAsZero(abs, currency) ? '+' : '';
  return prefix + moneyBody(abs, currency);
}

/** `$150K`, `$162.5K`, `$1.2M`, `$1.5B`. */
export function formatMcap(usd: number | null | undefined): string {
  if (usd == null || !Number.isFinite(usd)) return NA;
  const sign = usd < 0 ? '-' : '';
  const abs = Math.abs(usd);
  const trim = (value: number, digits: number) => String(Number(value.toFixed(digits)));
  if (abs < 1_000) return `${sign}$${trim(abs, 0)}`;
  if (abs < 1_000_000) return `${sign}$${trim(abs / 1_000, 1)}K`;
  if (abs < 1_000_000_000) return `${sign}$${trim(abs / 1_000_000, 2)}M`;
  return `${sign}$${trim(abs / 1_000_000_000, 2)}B`;
}

/** `+8.25%`, `-5.60%`; `N/A` when the ROI is not available. */
export function formatRoi(roiPercent: number | null | undefined): string {
  if (roiPercent == null || !Number.isFinite(roiPercent)) return NA;
  const rounded = Number(roiPercent.toFixed(2));
  const sign = rounded > 0 ? '+' : rounded < 0 ? '-' : '';
  return `${sign}${Math.abs(rounded).toFixed(2)}%`;
}

/** Two largest units only: `12m 35s`, `2h 15m`, `1d 4h`. */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return NA;
  const total = Math.floor(seconds);
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  const secs = total % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${secs}s`;
  return `${secs}s`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `16 Oct 2026 · 14:32` in the configured timezone. */
export function formatCloseDateTime(iso: string | null | undefined, timeZone: string): string {
  if (!iso) return NA;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return NA;
  const parts = new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone,
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  const month = MONTHS.find((m) => m.toLowerCase() === get('month').toLowerCase()) ?? get('month');
  return `${get('day')} ${month} ${get('year')} · ${get('hour')}:${get('minute')}`;
}

