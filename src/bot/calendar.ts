import { InlineKeyboard, InputFile, InputMediaBuilder, type Context } from 'grammy';
import { buildCalendar, type CalendarNav, type CalendarViewKind } from '../calendar/aggregate.js';
import { localDateKey, monthKey, periodLabel, startOfWeek, todayKey } from '../calendar/date.js';
import { renderCalendarPng } from '../calendar/render.js';
import type { Currency, PositionSnapshot } from '../card/types.js';
import type { PositionStore } from '../store.js';

export interface CalendarDeps {
  store: PositionStore;
  timeZone: string;
  currency: Currency;
  resolveBrand: (ctx: Context) => string;
  /** Injectable clock for deterministic tests. */
  now?: () => Date;
}

const inFlight = new Set<string>();
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_KEY = /^\d{4}-\d{2}$/;

function earliestDate(positions: PositionSnapshot[], timeZone: string, fallback: string): string {
  let earliest = fallback;
  for (const position of positions) {
    const key = localDateKey(position.closedAt, timeZone);
    if (key < earliest) earliest = key;
  }
  return earliest;
}

export function defaultPeriod(view: CalendarViewKind, today: string): string {
  if (view === 'month') return monthKey(today);
  if (view === 'week') return startOfWeek(today);
  return today;
}

export function clampPeriod(
  view: CalendarViewKind,
  period: string,
  earliest: string,
  today: string,
): string {
  if (view === 'month') {
    const wanted = MONTH_KEY.test(period) ? period : monthKey(today);
    const min = monthKey(earliest);
    const max = monthKey(today);
    return wanted < min ? min : wanted > max ? max : wanted;
  }
  if (view === 'week') {
    const base = DATE_KEY.test(period) ? startOfWeek(period) : startOfWeek(today);
    const min = startOfWeek(earliest);
    const max = startOfWeek(today);
    return base < min ? min : base > max ? max : base;
  }
  const base = DATE_KEY.test(period) ? period : today;
  return base < earliest ? earliest : base > today ? today : base;
}

const PREFIX: Record<CalendarViewKind, string> = { month: 'm', week: 'w', day: 'd' };

export function calendarKeyboard(view: CalendarViewKind, nav: CalendarNav): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  const tab = (label: string, target: string, targetView: CalendarViewKind) =>
    `${targetView === view ? '• ' : ''}${label}`;

  keyboard
    .text(tab('Bulan', nav.monthTab, 'month'), `cal:m:${nav.monthTab}`)
    .text(tab('Minggu', nav.weekTab, 'week'), `cal:w:${nav.weekTab}`)
    .text(tab('Hari', nav.dayTab, 'day'), `cal:d:${nav.dayTab}`)
    .row();

  if (nav.prev) keyboard.text('‹', `cal:${PREFIX[view]}:${nav.prev}`);
  else keyboard.text(' ', 'cal:noop');
  keyboard.text(periodLabel(view, nav.period), 'cal:noop');
  if (nav.next) keyboard.text('›', `cal:${PREFIX[view]}:${nav.next}`);
  else keyboard.text(' ', 'cal:noop');
  keyboard.row();

  if (view === 'month' && nav.weeks.length > 0) {
    for (const week of nav.weeks) keyboard.text(week.label, `cal:w:${week.monday}`);
    keyboard.row();
  }

  if (view === 'week') {
    const enabled = nav.days.filter((day) => day.enabled);
    for (const day of enabled) keyboard.text(day.label, `cal:d:${day.date}`);
    if (enabled.length > 0) keyboard.row();
  }

  if (view === 'day') {
    for (const position of nav.positions) keyboard.text(`📊 ${position.pair}`, `cal:pos:${position.id}`).row();
  }

  return keyboard;
}

export interface CalendarOpenOptions {
  view: CalendarViewKind;
  period: string;
}

export async function sendCalendar(
  ctx: Context,
  deps: CalendarDeps,
  options: CalendarOpenOptions | null = null,
  edit = false,
): Promise<void> {
  const userId = ctx.from ? String(ctx.from.id) : null;
  if (!userId) return;

  const today = todayKey(deps.timeZone, deps.now?.() ?? new Date());
  const positions = deps.store.listClosed(userId);
  const earliest = earliestDate(positions, deps.timeZone, today);
  const view = options?.view ?? 'month';
  const period = clampPeriod(view, options?.period ?? defaultPeriod(view, today), earliest, today);

  const result = buildCalendar({
    view,
    period,
    timeZone: deps.timeZone,
    currency: deps.currency,
    brand: deps.resolveBrand(ctx),
    positions,
    today,
  });

  const version = deps.store.calendarVersion(userId);
  const cacheKey = `${userId}|${view}|${result.nav.period}|${deps.currency}|${version}`;
  const cached = deps.store.getCalendarCache(cacheKey);
  if (inFlight.has(cacheKey)) return;
  inFlight.add(cacheKey);

  try {
    const png = cached ? null : await renderCalendarPng(result.model, deps.currency);
    const mediaInput = cached ? cached.fileId : new InputFile(png!, 'calendar.png');
    const keyboard = calendarKeyboard(view, result.nav);

    if (edit) {
      try {
        const edited = await ctx.editMessageMedia(InputMediaBuilder.photo(mediaInput, { caption: result.caption }), {
          reply_markup: keyboard,
        });
        const fileId = typeof edited === 'object' ? edited.photo?.at(-1)?.file_id : undefined;
        if (fileId && !cached) deps.store.setCalendarCache(cacheKey, fileId, result.caption);
        return;
      } catch {
        // Message too old or not editable: fall through and send a fresh one.
      }
    }

    const message = await ctx.replyWithPhoto(mediaInput, {
      caption: result.caption,
      reply_markup: keyboard,
    });
    const fileId = message.photo?.at(-1)?.file_id;
    if (fileId && !cached) deps.store.setCalendarCache(cacheKey, fileId, result.caption);
  } catch (error) {
    console.error('Gagal membuat profit calendar:', error);
    await ctx.reply('⚠️ Gagal membuat profit calendar. Coba lagi.');
  } finally {
    inFlight.delete(cacheKey);
  }
}

/** Handles `cal:*` callbacks; returns false for other callback data. */
export async function handleCalendarCallback(
  ctx: Context,
  data: string,
  deps: CalendarDeps,
): Promise<boolean> {
  if (!data.startsWith('cal:')) return false;

  const parts = data.split(':');
  const kind = parts[1];

  if (kind === 'noop') {
    await ctx.answerCallbackQuery();
    return true;
  }

  if (kind === 'pos') {
    const id = parts.slice(2).join(':');
    const userId = ctx.from ? String(ctx.from.id) : null;
    const stored = deps.store.get(id);
    if (!stored || stored.snapshot.telegramUserId !== userId) {
      await ctx.answerCallbackQuery({ text: '🔍 Kartu tidak ditemukan.', show_alert: true });
      return true;
    }
    await ctx.answerCallbackQuery();
    await ctx.replyWithPhoto(new InputFile(stored.png, `pnl-${id.slice(0, 8)}.png`));
    return true;
  }

  const view: CalendarViewKind | null =
    kind === 'm' ? 'month' : kind === 'w' ? 'week' : kind === 'd' ? 'day' : null;
  if (!view) {
    await ctx.answerCallbackQuery();
    return true;
  }

  await ctx.answerCallbackQuery();
  await sendCalendar(ctx, deps, { view, period: parts.slice(2).join(':') }, true);
  return true;
}
