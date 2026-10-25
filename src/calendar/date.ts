export const WEEKDAY_SHORT = ['SEN', 'SEL', 'RAB', 'KAM', 'JUM', 'SAB', 'MIN'] as const;
export const WEEKDAY_FULL = ['SENIN', 'SELASA', 'RABU', 'KAMIS', 'JUMAT', 'SABTU', 'MINGGU'] as const;
export const MONTH_SHORT = ['JAN', 'FEB', 'MAR', 'APR', 'MEI', 'JUN', 'JUL', 'AGU', 'SEP', 'OKT', 'NOV', 'DES'] as const;
export const MONTH_FULL = [
  'JANUARI',
  'FEBRUARI',
  'MARET',
  'APRIL',
  'MEI',
  'JUNI',
  'JULI',
  'AGUSTUS',
  'SEPTEMBER',
  'OKTOBER',
  'NOVEMBER',
  'DESEMBER',
] as const;

const pad = (value: number) => String(value).padStart(2, '0');

function utc(key: string): Date {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1));
}

function keyOf(date: Date): string {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

/** Local calendar date (`YYYY-MM-DD`) of an ISO timestamp in the given timezone. */
export function localDateKey(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(iso));
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function todayKey(timeZone: string, now: Date = new Date()): string {
  return localDateKey(now.toISOString(), timeZone);
}

export function monthKey(dateKey: string): string {
  return dateKey.slice(0, 7);
}

export function addDays(dateKey: string, delta: number): string {
  const date = utc(dateKey);
  date.setUTCDate(date.getUTCDate() + delta);
  return keyOf(date);
}

export function addMonths(month: string, delta: number): string {
  const [year, monthNumber] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year ?? 1970, (monthNumber ?? 1) - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}`;
}

/** Monday of the week that contains the date. */
export function startOfWeek(dateKey: string): string {
  const date = utc(dateKey);
  const weekday = (date.getUTCDay() + 6) % 7; // Monday = 0
  return addDays(dateKey, -weekday);
}

export function weekDates(monday: string): string[] {
  return Array.from({ length: 7 }, (_, index) => addDays(monday, index));
}

export function daysInMonth(month: string): number {
  const [year, monthNumber] = month.split('-').map(Number);
  return new Date(Date.UTC(year ?? 1970, monthNumber ?? 1, 0)).getUTCDate();
}

export function firstWeekdayIndex(month: string): number {
  const date = utc(`${month}-01`);
  return (date.getUTCDay() + 6) % 7;
}

export function dayNumber(dateKey: string): number {
  return Number(dateKey.slice(8, 10));
}

export function weekdayOf(dateKey: string): number {
  return (utc(dateKey).getUTCDay() + 6) % 7;
}

/** Number of grid rows a month needs (5 or 6). */
export function monthRowCount(month: string): number {
  return Math.ceil((firstWeekdayIndex(month) + daysInMonth(month)) / 7);
}

/** First date of the given week row inside a month grid. */
export function weekRowStart(month: string, row: number): string {
  return addDays(`${month}-01`, -firstWeekdayIndex(month) + row * 7);
}

export function monthTitle(month: string): string {
  const [year, monthNumber] = month.split('-').map(Number);
  return `${MONTH_FULL[(monthNumber ?? 1) - 1]} ${year}`;
}

export function weekTitle(monday: string): string {
  const dates = weekDates(monday);
  const start = dates[0] ?? monday;
  const end = dates[6] ?? monday;
  const [startYear, startMonth, startDay] = start.split('-').map(Number);
  const [endYear, endMonth, endDay] = end.split('-').map(Number);
  const sameMonth = startYear === endYear && startMonth === endMonth;
  if (sameMonth) {
    return `MINGGU ${startDay}–${endDay} ${MONTH_SHORT[(startMonth ?? 1) - 1]}`;
  }
  return `MINGGU ${startDay} ${MONTH_SHORT[(startMonth ?? 1) - 1]}–${endDay} ${MONTH_SHORT[(endMonth ?? 1) - 1]}`;
}

export function dayTitle(dateKey: string): string {
  const [year, month, day] = dateKey.split('-').map(Number);
  return `${WEEKDAY_FULL[weekdayOf(dateKey)]}, ${day} ${MONTH_FULL[(month ?? 1) - 1]} ${year}`;
}

/** Short label used on the middle navigation button. */
export function periodLabel(view: 'month' | 'week' | 'day', period: string): string {
  const [year, month, day] = period.split('-').map(Number);
  if (view === 'month') return `${MONTH_SHORT[(month ?? 1) - 1]} ${year}`;
  if (view === 'week') {
    const dates = weekDates(period);
    const start = dates[0] ?? period;
    const end = dates[6] ?? period;
    return `${Number(start.slice(8, 10))}–${Number(end.slice(8, 10))} ${MONTH_SHORT[Number(end.slice(5, 7)) - 1]}`;
  }
  return `${day} ${MONTH_SHORT[(month ?? 1) - 1]}`;
}
