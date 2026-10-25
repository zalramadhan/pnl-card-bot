import { formatDuration, formatMoney, formatRoi } from '../card/format.js';
import type { Currency, PositionSnapshot } from '../card/types.js';
import {
  WEEKDAY_SHORT,
  addDays,
  addMonths,
  dayNumber,
  dayTitle,
  daysInMonth,
  localDateKey,
  monthKey,
  monthTitle,
  monthRowCount,
  startOfWeek,
  weekDates,
  weekRowStart,
  weekTitle,
  weekdayOf,
} from './date.js';

export type CalendarViewKind = 'month' | 'week' | 'day';
export type CalendarTone = 'profit' | 'loss' | 'zero' | 'empty' | 'missing';

export interface CalendarCell {
  key: string | null;
  day: number | null;
  display: number | null;
  tone: CalendarTone;
  /** 0..1 relative magnitude for the tint. */
  intensity: number;
  future: boolean;
}

export interface CalendarWeekCell {
  label: string;
  net: number | null;
  tone: CalendarTone;
}

export interface MonthBody {
  kind: 'month';
  rows: Array<{ cells: CalendarCell[]; week: CalendarWeekCell }>;
}

export interface WeekDayCell {
  key: string;
  weekday: string;
  day: number;
  display: number | null;
  tone: CalendarTone;
  future: boolean;
}

export interface WeekBody {
  kind: 'week';
  days: WeekDayCell[];
  max: number;
}

export interface DayRow {
  id: string;
  pair: string;
  meta: string;
  pnlText: string;
  roiText: string;
  tone: 'profit' | 'loss' | 'zero';
}

export interface DayBody {
  kind: 'day';
  rows: DayRow[];
  extra: number;
}

export interface CalendarModel {
  view: CalendarViewKind;
  brand: string;
  periodTitle: string;
  netText: string;
  netTone: CalendarTone;
  statsText: string;
  body: MonthBody | WeekBody | DayBody;
}

export interface CalendarNav {
  view: CalendarViewKind;
  period: string;
  prev: string | null;
  next: string | null;
  monthTab: string;
  weekTab: string;
  dayTab: string;
  weeks: Array<{ label: string; monday: string }>;
  days: Array<{ date: string; label: string; enabled: boolean }>;
  positions: Array<{ id: string; pair: string }>;
}

export interface CalendarResult {
  model: CalendarModel;
  nav: CalendarNav;
  caption: string;
}

export interface CalendarInput {
  view: CalendarViewKind;
  period: string;
  timeZone: string;
  currency: Currency;
  brand: string;
  positions: PositionSnapshot[];
  /** Local date key for "today" (injectable for tests). */
  today: string;
}

const MAX_DAY_ROWS = 8;
const MAX_POSITION_BUTTONS = 4;

interface DayStat {
  count: number;
  valid: number;
  net: number;
  wins: number;
}

/** Converts one position to the display currency using its own stored rate. */
export function displayValue(position: PositionSnapshot, currency: Currency): number | null {
  const usd = position.netPnlUsd;
  if (usd == null || !Number.isFinite(usd)) return null;
  if (currency === 'USD') return usd;
  const rate = position.usdIdrRate;
  if (rate == null || !Number.isFinite(rate) || rate <= 0) return null;
  return usd * rate;
}

/** Compact value for cells, stats and bar labels. */
export function compactMoney(value: number, currency: Currency, withSymbol = true): string {
  const prefix = withSymbol ? (currency === 'USD' ? '$' : 'Rp ') : '';
  if (value === 0) return `${prefix}0`;
  const sign = value > 0 ? '+' : '-';
  const abs = Math.abs(value);
  if (currency === 'USD') {
    const rounded = abs >= 100 ? abs.toFixed(0) : abs.toFixed(1).replace(/\.0$/, '');
    return `${sign}${prefix}${rounded}`;
  }
  if (abs >= 1_000_000) return `${sign}${prefix}${(abs / 1_000_000).toFixed(1).replace('.0', '').replace('.', ',')}jt`;
  if (abs >= 1_000) return `${sign}${prefix}${Math.round(abs / 1_000)}rb`;
  return `${sign}${prefix}${Math.round(abs)}`;
}

function fullMoney(value: number | null, currency: Currency): string {
  if (value == null) return 'N/A';
  return formatMoney(value, currency, 'always');
}

function toneOf(net: number, count: number, valid: number): CalendarTone {
  if (count === 0) return 'empty';
  if (valid === 0) return 'missing';
  if (net > 0) return 'profit';
  if (net < 0) return 'loss';
  return 'zero';
}

function statsText(
  label: 'Hari trading' | 'Posisi',
  total: number,
  wins: number,
  best: number | null,
  worst: number | null,
  currency: Currency,
): string {
  const bestText = best == null ? 'N/A' : compactMoney(best, currency);
  const worstText = worst == null ? 'N/A' : compactMoney(worst, currency);
  return `${label} ${total} · Win ${wins}/${total} · Best ${bestText} · Worst ${worstText}`;
}

function indexedPositions(input: CalendarInput): Map<string, PositionSnapshot[]> {
  const map = new Map<string, PositionSnapshot[]>();
  for (const position of input.positions) {
    if (position.status !== 'closed') continue;
    const day = localDateKey(position.closedAt, input.timeZone);
    const list = map.get(day) ?? [];
    list.push(position);
    map.set(day, list);
  }
  return map;
}

function dayStat(list: PositionSnapshot[] | undefined, currency: Currency): DayStat {
  if (!list || list.length === 0) return { count: 0, valid: 0, net: 0, wins: 0 };
  let valid = 0;
  let net = 0;
  let wins = 0;
  for (const position of list) {
    const value = displayValue(position, currency);
    if (value == null) continue;
    valid += 1;
    net += value;
    if (value > 0) wins += 1;
  }
  return { count: list.length, valid, net, wins };
}

function sumRange(
  map: Map<string, PositionSnapshot[]>,
  dates: string[],
  currency: Currency,
): { net: number; count: number; valid: number; days: number; wins: number; best: number | null; worst: number | null } {
  let net = 0;
  let count = 0;
  let valid = 0;
  let days = 0;
  let wins = 0;
  let best: number | null = null;
  let worst: number | null = null;
  for (const date of dates) {
    const stat = dayStat(map.get(date), currency);
    if (stat.count === 0) continue;
    days += 1;
    count += stat.count;
    valid += stat.valid;
    net += stat.net;
    if (stat.valid === 0) continue;
    if (stat.net > 0) wins += 1;
    if (best == null || stat.net > best) best = stat.net;
    if (worst == null || stat.net < worst) worst = stat.net;
  }
  return { net, count, valid, days, wins, best, worst };
}

function periodLimits(input: CalendarInput, map: Map<string, PositionSnapshot[]>): { earliest: string; today: string } {
  const dates = [...map.keys()].sort();
  return { earliest: dates[0] ?? input.today, today: input.today };
}

function buildMonth(input: CalendarInput, map: Map<string, PositionSnapshot[]>): CalendarResult {
  const month = monthKey(input.period);
  const total = daysInMonth(month);
  const dates = Array.from({ length: total }, (_, index) => `${month}-${String(index + 1).padStart(2, '0')}`);
  const stats = sumRange(map, dates, input.currency);

  const maxAbs = Math.max(
    1,
    ...dates.map((date) => Math.abs(dayStat(map.get(date), input.currency).net)),
  );

  const rows: MonthBody['rows'] = [];
  const rowCount = monthRowCount(month);
  for (let row = 0; row < rowCount; row += 1) {
    const monday = weekRowStart(month, row);
    const cells: CalendarCell[] = [];
    const rowDates: string[] = [];
    for (let column = 0; column < 7; column += 1) {
      const key = addDays(monday, column);
      if (monthKey(key) !== month) {
        cells.push({ key: null, day: null, display: null, tone: 'empty', intensity: 0, future: false });
        continue;
      }
      const stat = dayStat(map.get(key), input.currency);
      const display = stat.valid === 0 ? null : stat.net;
      cells.push({
        key,
        day: dayNumber(key),
        display,
        tone: toneOf(stat.net, stat.count, stat.valid),
        intensity: display == null ? 0 : Math.abs(display) / maxAbs,
        future: key > input.today,
      });
      rowDates.push(key);
    }
    const weekStats = sumRange(map, rowDates, input.currency);
    rows.push({
      cells,
      week: {
        label: `W${row + 1}`,
        net: weekStats.valid === 0 ? null : weekStats.net,
        tone: toneOf(weekStats.net, weekStats.count, weekStats.valid),
      },
    });
  }

  const empty = stats.count === 0;
  const missingAll = stats.valid === 0 && !empty;
  const model: CalendarModel = {
    view: 'month',
    brand: input.brand,
    periodTitle: monthTitle(month),
    netText: empty ? '–' : missingAll ? 'N/A' : fullMoney(stats.net, input.currency),
    netTone: empty ? 'empty' : missingAll ? 'missing' : toneOf(stats.net, stats.count, stats.valid),
    statsText: empty
      ? 'Belum ada posisi ditutup'
      : statsText('Hari trading', stats.days, stats.wins, stats.best, stats.worst, input.currency),
    body: { kind: 'month', rows },
  };

  const limits = periodLimits(input, map);
  const earliestMonth = monthKey(limits.earliest);
  const currentMonth = monthKey(limits.today);
  const weekTab = startOfWeek(input.period);
  const dayTab =
    monthKey(limits.today) === month
      ? limits.today
      : `${month}-01`;

  return {
    model,
    caption: `📅 ${monthTitle(month)} · Net ${model.netText} · Win ${stats.wins}/${stats.days}`,
    nav: {
      view: 'month',
      period: month,
      prev: addMonths(month, -1) >= earliestMonth ? addMonths(month, -1) : null,
      next: addMonths(month, 1) <= currentMonth ? addMonths(month, 1) : null,
      monthTab: month,
      weekTab,
      dayTab,
      weeks: rows.map((row, index) => ({ label: row.week.label, monday: weekRowStart(month, index) })),
      days: [],
      positions: [],
    },
  };
}

function buildWeek(input: CalendarInput, map: Map<string, PositionSnapshot[]>): CalendarResult {
  const monday = startOfWeek(input.period);
  const dates = weekDates(monday);
  // Days in another month stay empty, so a week never leaks into its neighbour.
  const anchorMonth = monthKey(monday);
  const inMonth = (date: string) => monthKey(date) === anchorMonth;
  const countedDates = dates.filter(inMonth);
  const stats = sumRange(map, countedDates, input.currency);
  const maxAbs = Math.max(
    1,
    ...countedDates.map((date) => Math.abs(dayStat(map.get(date), input.currency).net)),
  );

  const days: WeekDayCell[] = dates.map((key, index) => {
    const stat = inMonth(key) ? dayStat(map.get(key), input.currency) : { count: 0, valid: 0, net: 0, wins: 0 };
    return {
      key,
      weekday: WEEKDAY_SHORT[index] ?? '',
      day: dayNumber(key),
      display: stat.valid === 0 ? null : stat.net,
      tone: toneOf(stat.net, stat.count, stat.valid),
      future: key > input.today,
    };
  });

  const empty = stats.count === 0;
  const missingAll = stats.valid === 0 && !empty;
  const model: CalendarModel = {
    view: 'week',
    brand: input.brand,
    periodTitle: weekTitle(monday),
    netText: empty ? '–' : missingAll ? 'N/A' : fullMoney(stats.net, input.currency),
    netTone: empty ? 'empty' : missingAll ? 'missing' : toneOf(stats.net, stats.count, stats.valid),
    statsText: empty
      ? 'Belum ada posisi ditutup'
      : statsText('Hari trading', stats.days, stats.wins, stats.best, stats.worst, input.currency),
    body: { kind: 'week', days, max: maxAbs },
  };

  const limits = periodLimits(input, map);
  const earliestWeek = startOfWeek(limits.earliest);
  const currentWeek = startOfWeek(limits.today);

  return {
    model,
    caption: `📅 ${weekTitle(monday)} · Net ${model.netText} · Win ${stats.wins}/${stats.days}`,
    nav: {
      view: 'week',
      period: monday,
      prev: addDays(monday, -7) >= earliestWeek ? addDays(monday, -7) : null,
      next: addDays(monday, 7) <= currentWeek ? addDays(monday, 7) : null,
      monthTab: monthKey(monday),
      weekTab: monday,
      dayTab: monday,
      weeks: [],
      days: dates.map((date) => ({
        date,
        label: WEEKDAY_SHORT[weekdayOf(date)] ?? '',
        enabled: inMonth(date) && date <= input.today,
      })),
      positions: [],
    },
  };
}

function buildDay(input: CalendarInput, map: Map<string, PositionSnapshot[]>): CalendarResult {
  const date = input.period;
  const list = (map.get(date) ?? []).slice().sort((a, b) => a.closedAt.localeCompare(b.closedAt));
  const stat = dayStat(list, input.currency);
  const validValues = list
    .map((position) => displayValue(position, input.currency))
    .filter((value): value is number => value != null);
  const best = validValues.length ? Math.max(...validValues) : null;
  const worst = validValues.length ? Math.min(...validValues) : null;
  const wins = validValues.filter((value) => value > 0).length;

  const rows: DayRow[] = list.slice(0, MAX_DAY_ROWS).map((position) => {
    const value = displayValue(position, input.currency);
    const meta = [position.closeReason, position.range ?? position.strategy, formatDuration(position.durationSeconds)]
      .filter((part): part is string => typeof part === 'string' && part.trim().length > 0 && part !== 'N/A')
      .join(' · ');
    return {
      id: position.id,
      pair: position.pair,
      meta,
      pnlText: value == null ? 'N/A' : formatMoney(value, input.currency, 'always'),
      roiText: position.roiPercent == null ? 'N/A' : formatRoi(position.roiPercent),
      tone: value == null ? 'zero' : value > 0 ? 'profit' : value < 0 ? 'loss' : 'zero',
    };
  });

  const empty = list.length === 0;
  const model: CalendarModel = {
    view: 'day',
    brand: input.brand,
    periodTitle: dayTitle(date),
    netText: empty ? '–' : fullMoney(stat.valid === 0 ? null : stat.net, input.currency),
    netTone: empty ? 'empty' : toneOf(stat.net, stat.count, stat.valid),
    statsText: empty
      ? 'Belum ada posisi ditutup'
      : statsText('Posisi', list.length, wins, best, worst, input.currency),
    body: {
      kind: 'day',
      rows,
      extra: Math.max(0, list.length - MAX_DAY_ROWS),
    },
  };

  const limits = periodLimits(input, map);

  return {
    model,
    caption: `📅 ${dayTitle(date)} · Net ${model.netText} · Win ${wins}/${list.length}`,
    nav: {
      view: 'day',
      period: date,
      prev: addDays(date, -1) >= limits.earliest ? addDays(date, -1) : null,
      next: addDays(date, 1) <= limits.today ? addDays(date, 1) : null,
      monthTab: monthKey(date),
      weekTab: startOfWeek(date),
      dayTab: date,
      weeks: [],
      days: [],
      positions: rows.slice(0, MAX_POSITION_BUTTONS).map((row) => ({ id: row.id, pair: row.pair })),
    },
  };
}

export function buildCalendar(input: CalendarInput): CalendarResult {
  const map = indexedPositions(input);
  if (input.view === 'week') return buildWeek(input, map);
  if (input.view === 'day') return buildDay(input, map);
  return buildMonth(input, map);
}

