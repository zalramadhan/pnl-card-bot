import { Resvg } from '@resvg/resvg-js';
import satori from 'satori';
import { loadFonts } from '../card/fonts.js';
import { compactMoney, type CalendarCell, type CalendarModel, type CalendarTone, type WeekDayCell } from './aggregate.js';

export const CALENDAR_WIDTH = 1080;
export const CALENDAR_HEIGHT = 1350;
const PADDING = 56;
const BORDER = 2;
const CONTENT_WIDTH = CALENDAR_WIDTH - PADDING * 2 - BORDER * 2; // 964
const GRID_GAP = 9;
const DAY_COLUMN = Math.floor((CONTENT_WIDTH - 7 * GRID_GAP) / 8.25);
const WEEK_COLUMN = Math.floor(DAY_COLUMN * 1.25);
const BODY_HEIGHT = 856;
const HEADER_LABEL = 'ALL DEX · LP';
const FOOTER_TEXT = 'NET PNL · POSISI YANG SUDAH DITUTUP';

const COLORS = {
  background: '#FBFAF6',
  border: '#E5E2D8',
  ink: '#222222',
  muted: '#777777',
  light: '#888888',
  lighter: '#999999',
  divider: '#D5D1C2',
  neutralCell: '#F3F0E6',
  profit: '#2E7D32',
  loss: '#C62828',
};

type Style = Record<string, string | number>;

interface El {
  type: string;
  props: { style: Style; children?: unknown };
}

function el(type: string, style: Style, ...children: unknown[]): El {
  const flat = children.flat() as unknown[];
  if (flat.length === 0) return { type, props: { style } };
  return { type, props: { style, children: flat.length === 1 ? flat[0] : flat } };
}

function text(value: string, style: Style): El {
  return el('div', style, value);
}

function toneColor(tone: CalendarTone, neutral: string = COLORS.muted): string {
  if (tone === 'profit') return COLORS.profit;
  if (tone === 'loss') return COLORS.loss;
  if (tone === 'zero') return COLORS.ink;
  return neutral;
}

function tint(tone: CalendarTone, intensity: number): string | null {
  if (tone !== 'profit' && tone !== 'loss') return null;
  const alpha = (0.1 + 0.3 * Math.max(0, Math.min(1, intensity))).toFixed(3);
  const rgb = tone === 'profit' ? '46,125,50' : '198,40,40';
  return `rgba(${rgb},${alpha})`;
}

function dashedLine(color: string, marginTop: number, marginBottom: number): El {
  return el(
    'div',
    { display: 'flex', justifyContent: 'space-between', width: '100%', marginTop, marginBottom },
    Array.from({ length: 44 }, () => el('div', { width: 10, height: 3, background: color })),
  );
}

function cellBox(cell: CalendarCell, currency: 'USD' | 'IDR'): El {
  const base: Style = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    width: DAY_COLUMN,
    height: 128,
    borderRadius: 18,
    padding: 12,
  };

  if (!cell.key || cell.day == null) {
    return el('div', { ...base, height: 128, width: DAY_COLUMN });
  }

  const dayLabel = text(String(cell.day), { fontSize: 22, lineHeight: '26px', color: COLORS.light });

  if (cell.future) {
    return el('div', { ...base, opacity: 0.35 }, dayLabel);
  }

  if (cell.tone === 'empty') {
    return el(
      'div',
      { ...base, border: `1.5px dashed ${COLORS.border}` },
      dayLabel,
    );
  }

  if (cell.tone === 'missing' || cell.display == null) {
    return el('div', { ...base, background: COLORS.neutralCell }, dayLabel, text('N/A', {
      fontSize: 22,
      lineHeight: '28px',
      fontWeight: 700,
      color: COLORS.muted,
    }));
  }

  if (cell.tone === 'zero') {
    return el(
      'div',
      { ...base, background: COLORS.neutralCell },
      dayLabel,
      text('0', { fontSize: 24, lineHeight: '30px', fontWeight: 700, color: COLORS.muted }),
    );
  }

  return el(
    'div',
    { ...base, background: tint(cell.tone, cell.intensity) ?? COLORS.neutralCell },
    dayLabel,
    text(compactMoney(cell.display, currency, false), {
      fontSize: 24,
      lineHeight: '30px',
      fontWeight: 700,
      color: toneColor(cell.tone),
    }),
  );
}

function weekCellEl(week: { label: string; net: number | null; tone: CalendarTone }, currency: 'USD' | 'IDR'): El {
  const color = week.tone === 'empty' || week.tone === 'missing' ? COLORS.border : toneColor(week.tone);
  const value = week.net == null ? '–' : compactMoney(week.net, currency, false);
  return el(
    'div',
    {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      width: WEEK_COLUMN,
      height: 128,
      borderRadius: 18,
      border: `2px solid ${color}`,
      padding: 8,
    },
    text(week.label, { fontSize: 20, lineHeight: '24px', color: COLORS.light }),
    text(value, {
      fontSize: 24,
      lineHeight: '30px',
      fontWeight: 700,
      color: week.net == null ? COLORS.muted : toneColor(week.tone),
    }),
  );
}

function monthBody(model: CalendarModel, currency: 'USD' | 'IDR'): El {
  if (model.body.kind !== 'month') return el('div', {});
  const rows = model.body.rows;
  const cellHeight = Math.min(128, Math.floor((BODY_HEIGHT - 40 - (rows.length - 1) * GRID_GAP) / rows.length));

  const headerRow = el(
    'div',
    { display: 'flex', width: '100%', gap: GRID_GAP },
    ...['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'].map((label) =>
      text(label, {
        width: DAY_COLUMN,
        fontSize: 22,
        lineHeight: '26px',
        color: COLORS.lighter,
        textAlign: 'center',
      }),
    ),
    text('Mgg', {
      width: WEEK_COLUMN,
      fontSize: 22,
      lineHeight: '26px',
      color: COLORS.lighter,
      textAlign: 'center',
    }),
  );

  const gridRows = rows.map((row) =>
    el(
      'div',
      { display: 'flex', width: '100%', gap: GRID_GAP },
      ...row.cells.map((cell) => {
        const box = cellBox(cell, currency);
        return { ...box, props: { ...box.props, style: { ...box.props.style, height: cellHeight } } };
      }),
      (() => {
        const box = weekCellEl(row.week, currency);
        return { ...box, props: { ...box.props, style: { ...box.props.style, height: cellHeight } } };
      })(),
    ),
  );

  return el(
    'div',
    { display: 'flex', flexDirection: 'column', width: '100%' },
    headerRow,
    el('div', { display: 'flex', flexDirection: 'column', gap: GRID_GAP, marginTop: 10 }, ...gridRows),
  );
}

function weekBody(model: CalendarModel, currency: 'USD' | 'IDR'): El {
  if (model.body.kind !== 'week') return el('div', {});
  const { days, max } = model.body;
  const column = Math.floor((CONTENT_WIDTH - 6 * 10) / 7);
  const HALF = 150;
  const barWidth = Math.floor(column * 0.64);

  const barHeight = (value: number | null) => {
    if (value == null || max === 0) return 0;
    return Math.min(HALF, Math.max(6, Math.round((Math.abs(value) / max) * HALF)));
  };

  const row = (children: El[], extra: Style = {}) =>
    el('div', { display: 'flex', width: '100%', gap: 10, ...extra }, ...children);

  const labels = days.map((day) => {
    const color = day.tone === 'empty' || day.tone === 'missing' ? COLORS.muted : toneColor(day.tone);
    return el(
      'div',
      { display: 'flex', justifyContent: 'center', width: column, opacity: day.future ? 0.35 : 1 },
      text(day.display == null ? '–' : compactMoney(day.display, currency, false), {
        fontSize: 22,
        lineHeight: '28px',
        fontWeight: 700,
        color,
      }),
    );
  });

  const topBars = days.map((day) => {
    const value = day.display;
    return el(
      'div',
      {
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'flex-end',
        alignItems: 'center',
        width: column,
        height: HALF,
        opacity: day.future ? 0.35 : 1,
      },
      value != null && value > 0
        ? el('div', { width: barWidth, height: barHeight(value), borderRadius: 10, background: COLORS.profit })
        : el('div', { width: barWidth, height: 0 }),
    );
  });

  const bottomBars = days.map((day) => {
    const value = day.display;
    return el(
      'div',
      {
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'flex-start',
        alignItems: 'center',
        width: column,
        height: HALF,
        opacity: day.future ? 0.35 : 1,
      },
      value != null && value < 0
        ? el('div', { width: barWidth, height: barHeight(value), borderRadius: 10, background: COLORS.loss })
        : el('div', { width: barWidth, height: 0 }),
    );
  });

  const names = days.map((day) =>
    el(
      'div',
      { display: 'flex', flexDirection: 'column', alignItems: 'center', width: column, opacity: day.future ? 0.35 : 1 },
      text(day.weekday, { fontSize: 22, lineHeight: '28px', color: COLORS.muted }),
      text(String(day.day), { fontSize: 22, lineHeight: '26px', color: COLORS.lighter }),
    ),
  );

  return el(
    'div',
    { display: 'flex', flexDirection: 'column', width: '100%', marginTop: 32 },
    row(labels, { marginBottom: 8 }),
    row(topBars),
    dashedLine(COLORS.divider, 0, 0),
    row(bottomBars),
    row(names, { marginTop: 8 }),
  );
}

function dayBody(model: CalendarModel): El {
  if (model.body.kind !== 'day') return el('div', {});
  const { rows, extra } = model.body;
  if (rows.length === 0) {
    return el(
      'div',
      {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%',
        height: 300,
      },
      text('Tidak ada posisi yang ditutup di hari ini.', { fontSize: 24, color: COLORS.muted }),
    );
  }

  const rowHeight = Math.min(120, Math.floor((BODY_HEIGHT - (rows.length - 1) * 12) / rows.length));
  const items: El[] = [];
  rows.forEach((row, index) => {
    if (index > 0) items.push(dashedLine(COLORS.divider, 0, 0));
    const color = row.tone === 'profit' ? COLORS.profit : row.tone === 'loss' ? COLORS.loss : COLORS.ink;
    items.push(
      el(
        'div',
        {
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          width: '100%',
          height: rowHeight,
        },
        el(
          'div',
          { display: 'flex', flexDirection: 'column' },
          text(row.pair, { fontSize: 34, lineHeight: '40px', fontWeight: 700, color: COLORS.ink }),
          ...(row.meta
            ? [text(row.meta, { fontSize: 22, lineHeight: '28px', color: COLORS.light, marginTop: 4 })]
            : []),
        ),
        el(
          'div',
          { display: 'flex', flexDirection: 'column', alignItems: 'flex-end' },
          text(row.pnlText, { fontSize: 34, lineHeight: '40px', fontWeight: 700, color }),
          text(row.roiText, { fontSize: 22, lineHeight: '28px', color: COLORS.light, marginTop: 4 }),
        ),
      ),
    );
  });

  if (extra > 0) {
    items.push(
      text(`+${extra} posisi lainnya`, {
        fontSize: 22,
        color: COLORS.muted,
        textAlign: 'center',
        width: '100%',
        marginTop: 12,
      }),
    );
  }

  return el('div', { display: 'flex', flexDirection: 'column', width: '100%', marginTop: 24 }, ...items);
}

function body(model: CalendarModel, currency: 'USD' | 'IDR'): El {
  if (model.body.kind === 'month') return monthBody(model, currency);
  if (model.body.kind === 'week') return weekBody(model, currency);
  return dayBody(model);
}

export function calendarTree(model: CalendarModel, currency: 'USD' | 'IDR'): El {
  const netColor =
    model.netTone === 'profit'
      ? COLORS.profit
      : model.netTone === 'loss'
        ? COLORS.loss
        : model.netTone === 'zero'
          ? COLORS.ink
          : COLORS.muted;

  return el(
    'div',
    {
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'space-between',
      width: CALENDAR_WIDTH,
      height: CALENDAR_HEIGHT,
      background: COLORS.background,
      border: `${BORDER}px solid ${COLORS.border}`,
      borderRadius: 22,
      padding: PADDING,
      fontFamily: 'JetBrains Mono',
      color: COLORS.ink,
    },
    // Header
    el(
      'div',
      { display: 'flex', flexDirection: 'column', width: '100%' },
      el(
        'div',
        { display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' },
        text(model.brand, { fontSize: 34, lineHeight: '42px', fontWeight: 700, letterSpacing: 10.2 }),
        text('PROFIT CALENDAR', { fontSize: 22, lineHeight: '28px', letterSpacing: 2.64, color: COLORS.muted }),
      ),
      text(HEADER_LABEL, {
        fontSize: 22,
        lineHeight: '28px',
        letterSpacing: 3.08,
        color: COLORS.muted,
        marginTop: 8,
      }),
      text(model.periodTitle, {
        fontSize: 26,
        lineHeight: '32px',
        letterSpacing: 3.12,
        color: COLORS.muted,
        marginTop: 16,
      }),
      text(model.netText, {
        fontSize: 88,
        lineHeight: '96px',
        fontWeight: 700,
        letterSpacing: -3.5,
        color: netColor,
        marginTop: 8,
      }),
      text(model.statsText, { fontSize: 22, lineHeight: '30px', color: COLORS.muted, marginTop: 6 }),
      dashedLine(COLORS.divider, 20, 20),
    ),
    // Body
    el(
      'div',
      { display: 'flex', flexDirection: 'column', width: '100%', flexGrow: 1 },
      body(model, currency),
    ),
    // Footer
    el(
      'div',
      { display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%' },
      dashedLine(COLORS.divider, 0, 18),
      text(FOOTER_TEXT, {
        fontSize: 22,
        lineHeight: '28px',
        letterSpacing: 0.88,
        color: COLORS.lighter,
        textAlign: 'center',
      }),
    ),
  );
}

export async function renderCalendarPng(
  model: CalendarModel,
  currency: 'USD' | 'IDR',
): Promise<Buffer> {
  const svg = await satori(calendarTree(model, currency) as never, {
    width: CALENDAR_WIDTH,
    height: CALENDAR_HEIGHT,
    fonts: loadFonts(),
  });
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: CALENDAR_WIDTH },
    background: 'rgba(0,0,0,0)',
  });
  return Buffer.from(resvg.render().asPng());
}

export { HEADER_LABEL, CONTENT_WIDTH, COLORS as CALENDAR_COLORS };
