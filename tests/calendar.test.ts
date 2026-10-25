import { describe, expect, it } from 'vitest';
import { buildCalendar, compactMoney, type CalendarNav, type MonthBody } from '../src/calendar/aggregate.js';
import { calendarKeyboard, clampPeriod, defaultPeriod } from '../src/bot/calendar.js';
import { renderCalendarPng } from '../src/calendar/render.js';
import type { PositionSnapshot } from '../src/card/types.js';
import { sampleSnapshot } from '../src/sample.js';

const TZ = 'Asia/Jakarta';
const TODAY = '2026-10-25';

function pos(
  id: string,
  iso: string,
  pnlUsd: number,
  options: { rate?: number | null; overrides?: Partial<PositionSnapshot> } = {},
): PositionSnapshot {
  const rate = options.rate === undefined ? 16_400 : options.rate;
  return sampleSnapshot({
    id,
    status: 'closed',
    initialUsd: 100,
    receivedUsd: 100 + pnlUsd,
    closedAt: iso,
    createdAt: iso,
    usdIdrRate: rate,
    telegramUserId: '42',
    ...options.overrides,
  });
}

function build(
  view: 'month' | 'week' | 'day',
  period: string,
  positions: PositionSnapshot[],
  currency: 'USD' | 'IDR' = 'IDR',
  today: string = TODAY,
) {
  return buildCalendar({
    view,
    period,
    timeZone: TZ,
    currency,
    brand: 'TESTER',
    positions,
    today,
  });
}

const octoberPositions = [
  pos('a', '2026-10-01T03:00:00.000Z', 12.5),
  pos('b', '2026-10-02T03:00:00.000Z', -8.4),
  pos('c', '2026-10-17T03:00:00.000Z', 16.25),
  pos('d', '2026-10-17T05:00:00.000Z', -3.75),
  pos('e', '2026-10-20T03:00:00.000Z', 5),
];

describe('month view', () => {
  const result = build('month', '2026-10', octoberPositions);

  it('sums every position using its own stored rate', () => {
    // (12.5 - 8.4 + 16.25 - 3.75 + 5) * 16.400 = 354.240
    expect(result.model.netText).toBe('+Rp 354.240');
    expect(result.model.netTone).toBe('profit');
    expect(result.model.periodTitle).toBe('OKTOBER 2026');
  });

  it('reports trading days, wins and the best/worst day', () => {
    expect(result.model.statsText).toBe(
      'Hari trading 4 · Win 3/4 · Best +Rp 205rb · Worst -Rp 138rb',
    );
  });

  it('tints cells by sign and leaves empty and future days distinct', () => {
    const rows = (result.model.body as MonthBody).rows;
    const cells = rows.flatMap((row) => row.cells);
    const oct1 = cells.find((cell) => cell.key === '2026-10-01');
    expect(oct1?.tone).toBe('profit');
    expect(oct1?.display).toBe(205_000);

    const oct2 = cells.find((cell) => cell.key === '2026-10-02');
    expect(oct2?.tone).toBe('loss');

    const oct4 = cells.find((cell) => cell.key === '2026-10-04');
    expect(oct4?.tone).toBe('empty');
    expect(oct4?.display).toBeNull();

    const oct26 = cells.find((cell) => cell.key === '2026-10-26');
    expect(oct26?.future).toBe(true);

    expect(cells[0]?.key).toBeNull();
  });

  it('builds weekly totals inside the month only', () => {
    const rows = (result.model.body as MonthBody).rows;
    expect(rows.map((row) => row.week.label)).toEqual(['W1', 'W2', 'W3', 'W4', 'W5']);
    expect(rows[0]?.week.net).toBeCloseTo(67_240); // 12.5 - 8.4
    expect(rows[2]?.week.net).toBeCloseTo(205_000); // 16.25 - 3.75
    expect(rows[1]?.week.net).toBeNull();
    expect(rows[1]?.week.tone).toBe('empty');
  });

  it('pins the caption and navigation limits', () => {
    expect(result.caption).toBe('📅 OKTOBER 2026 · Net +Rp 354.240 · Win 3/4');
    expect(result.nav.prev).toBeNull();
    expect(result.nav.next).toBeNull();
    expect(result.nav.weeks).toHaveLength(5);
  });
});

describe('timezone bucketing', () => {
  it('uses the local close date, not UTC', () => {
    const evening = pos('tz', '2026-10-16T17:30:00.000Z', 10);
    const day = build('day', '2026-10-17', [evening]);
    expect(day.model.netText).toBe('+Rp 164.000');
    const previous = build('day', '2026-10-16', [evening]);
    expect(previous.model.netText).toBe('–');
  });
});

describe('currency handling', () => {
  it('never mixes rates between positions', () => {
    const day = build('day', '2026-10-17', [
      pos('c', '2026-10-17T03:00:00.000Z', 16.25, { rate: 16_000 }),
      pos('d', '2026-10-17T05:00:00.000Z', -3.75, { rate: 17_000 }),
    ]);
    expect(day.model.netText).toBe('+Rp 196.250');
  });

  it('shows USD totals when the bot currency is USD', () => {
    const month = build('month', '2026-10', octoberPositions, 'USD');
    expect(month.model.netText).toBe('+$21.60');
    expect(month.model.statsText).toContain('Best +$12.5');
  });

  it('marks missing rates as N/A instead of estimating', () => {
    const month = build('month', '2026-10', [
      pos('missing', '2026-10-05T03:00:00.000Z', 10, { rate: null }),
    ]);
    const rows = (month.model.body as MonthBody).rows;
    const cell = rows.flatMap((row) => row.cells).find((entry) => entry.key === '2026-10-05');
    expect(cell?.tone).toBe('missing');
    expect(cell?.display).toBeNull();
    expect(month.model.netText).toBe('N/A');

    const day = build('day', '2026-10-05', [pos('missing', '2026-10-05T03:00:00.000Z', 10, { rate: null })]);
    expect(day.model.netText).toBe('N/A');
    expect(day.model.body.kind === 'day' && day.model.body.rows[0]?.pnlText).toBe('N/A');
  });
});

describe('position filtering', () => {
  it('ignores positions that are still open', () => {
    const open = pos('open', '2026-10-06T03:00:00.000Z', 40, { overrides: { status: 'open' } });
    const month = build('month', '2026-10', [...octoberPositions, open]);
    const cell = (month.model.body as MonthBody).rows
      .flatMap((row) => row.cells)
      .find((entry) => entry.key === '2026-10-06');
    expect(cell?.tone).toBe('empty');
    expect(month.model.netText).toBe('+Rp 354.240');
  });
});

describe('week view', () => {
  const result = build('week', '2026-10-12', octoberPositions);

  it('aligns Monday to Sunday and totals the week', () => {
    expect(result.model.periodTitle).toBe('MINGGU 12–18 OKT');
    expect(result.model.netText).toBe('+Rp 205.000');
    expect(result.model.statsText).toBe('Hari trading 1 · Win 1/1 · Best +Rp 205rb · Worst +Rp 205rb');
    const days = result.model.body.kind === 'week' ? result.model.body.days : [];
    expect(days.map((day) => day.weekday)).toEqual(['SEN', 'SEL', 'RAB', 'KAM', 'JUM', 'SAB', 'MIN']);
    expect(days[5]?.display).toBe(205_000);
    expect(days[0]?.display).toBeNull();
    expect(days[0]?.tone).toBe('empty');
  });

  it('keeps days from the next month empty in a boundary week', () => {
    const week = build('week', '2026-10-26', [pos('nov', '2026-11-01T03:00:00.000Z', 10)], 'IDR', '2026-11-05');
    const days = week.model.body.kind === 'week' ? week.model.body.days : [];
    expect(days[6]?.key).toBe('2026-11-01');
    expect(days[6]?.tone).toBe('empty');
    expect(days[6]?.display).toBeNull();
    expect(week.model.netText).toBe('–');
    expect(week.nav.days.filter((day) => day.enabled)).toHaveLength(6);
  });

  it('keeps day buttons only for days that already happened', () => {
    expect(result.nav.days.filter((day) => day.enabled)).toHaveLength(7);
    expect(result.nav.days.map((day) => day.label)).toEqual(['SEN', 'SEL', 'RAB', 'KAM', 'JUM', 'SAB', 'MIN']);
  });
});

describe('day view', () => {
  const result = build('day', '2026-10-17', octoberPositions);

  it('lists positions with meta and stored ROI', () => {
    expect(result.model.periodTitle).toBe('SABTU, 17 OKTOBER 2026');
    expect(result.model.netText).toBe('+Rp 205.000');
    expect(result.model.statsText).toBe('Posisi 2 · Win 1/2 · Best +Rp 267rb · Worst -Rp 62rb');
    const rows = result.model.body.kind === 'day' ? result.model.body.rows : [];
    expect(rows).toHaveLength(2);
    expect(rows[0]?.pair).toBe('FTR/SOL');
    expect(rows[0]?.meta).toContain('Auto TP');
    expect(rows[0]?.meta).toContain('+10%');
    expect(rows[0]?.meta).toContain('12m 35s');
    expect(rows[1]?.pnlText).toBe('-Rp 61.500');
  });

  it('offers at most four position buttons', () => {
    const many = Array.from({ length: 9 }, (_, index) =>
      pos(`p${index}`, `2026-10-17T0${index}:00:00.000Z`, index + 1),
    );
    const day = build('day', '2026-10-17', many);
    expect(day.model.body.kind === 'day' && day.model.body.rows).toHaveLength(8);
    expect(day.model.body.kind === 'day' && day.model.body.extra).toBe(1);
    expect(day.nav.positions).toHaveLength(4);
  });

  it('draws an empty message when nothing closed that day', () => {
    const day = build('day', '2026-10-19', octoberPositions);
    expect(day.model.netText).toBe('–');
    expect(day.model.statsText).toBe('Belum ada posisi ditutup');
    expect(day.model.body.kind === 'day' && day.model.body.rows).toHaveLength(0);
  });
});

describe('compactMoney', () => {
  it('formats USD and IDR cells', () => {
    expect(compactMoney(12.5, 'USD', false)).toBe('+12.5');
    expect(compactMoney(-3.75, 'USD', false)).toBe('-3.8');
    expect(compactMoney(150, 'USD', false)).toBe('+150');
    expect(compactMoney(0, 'USD', false)).toBe('0');
    expect(compactMoney(205_000, 'IDR', false)).toBe('+205rb');
    expect(compactMoney(2_100_000, 'IDR', false)).toBe('+2,1jt');
    expect(compactMoney(950, 'IDR', false)).toBe('+950');
    expect(compactMoney(205_000, 'IDR', true)).toBe('+Rp 205rb');
  });
});

describe('navigation', () => {
  it('clamps periods inside the allowed range', () => {
    expect(clampPeriod('month', '2026-08', '2026-10-01', TODAY)).toBe('2026-10');
    expect(clampPeriod('month', '2026-12', '2026-10-01', TODAY)).toBe('2026-10');
    expect(clampPeriod('week', '2026-09-01', '2026-10-01', TODAY)).toBe('2026-09-28');
    expect(clampPeriod('day', '2026-10-30', '2026-10-01', TODAY)).toBe(TODAY);
    expect(clampPeriod('day', '2026-09-01', '2026-10-01', TODAY)).toBe('2026-10-01');
  });

  it('defaults to the current month, week or day', () => {
    expect(defaultPeriod('month', TODAY)).toBe('2026-10');
    expect(defaultPeriod('week', TODAY)).toBe('2026-10-19');
    expect(defaultPeriod('day', TODAY)).toBe(TODAY);
  });

  it('encodes compact callback data and marks the active tab', () => {
    const result = build('month', '2026-10', octoberPositions);
    const keyboard = calendarKeyboard('month', result.nav);
    const buttons = keyboard.inline_keyboard.flat() as Array<{ text: string; callback_data: string }>;
    expect(buttons[0]?.text).toBe('• Bulan');
    expect(buttons[0]?.callback_data).toBe('cal:m:2026-10');
    expect(buttons.some((button) => button.callback_data.startsWith('cal:w:'))).toBe(true);
    for (const button of buttons) expect(button.callback_data.length).toBeLessThan(64);
  });

  it('hides arrows that would leave the allowed range', () => {
    const nav: CalendarNav = {
      view: 'month',
      period: '2026-10',
      prev: null,
      next: null,
      monthTab: '2026-10',
      weekTab: '2026-09-28',
      dayTab: '2026-10-25',
      weeks: [],
      days: [],
      positions: [],
    };
    const rows = calendarKeyboard('month', nav).inline_keyboard;
    expect(rows[1]?.map((button) => button.text)).toEqual([' ', 'OKT 2026', ' ']);
  });
});

describe('rendering', () => {
  it('renders an empty month without breaking the grid', async () => {
    const empty = build('month', '2026-10', []);
    expect(empty.model.netText).toBe('–');
    const png = await renderCalendarPng(empty.model, 'IDR');
    expect(png.readUInt32BE(20)).toBe(1350);
  });

  it('renders a 1080x1350 deterministic PNG', async () => {
    const result = build('month', '2026-10', octoberPositions);
    const first = await renderCalendarPng(result.model, 'IDR');
    const second = await renderCalendarPng(result.model, 'IDR');
    expect(first.readUInt32BE(16)).toBe(1080);
    expect(first.readUInt32BE(20)).toBe(1350);
    expect(first.equals(second)).toBe(true);
  });
});
