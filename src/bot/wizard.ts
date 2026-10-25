import { randomUUID } from 'node:crypto';
import { InlineKeyboard, InputFile, type Context } from 'grammy';
import { derivePnl } from '../card/derive.js';
import { NA, formatDuration, formatMcap, formatMoney, formatRoi } from '../card/format.js';
import { renderCardPng } from '../card/render.js';
import type { Currency, PositionSnapshot, PositionStatus, Strategy, TokenSide } from '../card/types.js';
import type { PositionStore } from '../store.js';
import { defaultBrand } from './brand.js';
import { normalizePair, normalizeRange, optionalText, parseAmount, parseDuration } from './parse.js';

type Step =
  | 'pair'
  | 'reason'
  | 'dex'
  | 'status'
  | 'entryMcap'
  | 'exitMcap'
  | 'initial'
  | 'received'
  | 'duration'
  | 'side'
  | 'strategy'
  | 'range'
  | 'rangeCustom'
  | 'confirm';

const REASONS = ['Manual', 'Auto TP', 'OOR TP', 'Cut Loss', 'Stop Loss', 'OOR LEFT'] as const;
const REASON_LABEL: Record<(typeof REASONS)[number], string> = {
  Manual: '✍️ Manual',
  'Auto TP': '🤖 Auto TP',
  'OOR TP': '🚪 OOR TP',
  'Cut Loss': '🩸 Cut Loss',
  'Stop Loss': '🛑 Stop Loss',
  'OOR LEFT': '↩️ OOR LEFT',
};

const DEXES = ['Meteora', 'Robinhood'] as const;
const DEX_LABEL: Record<(typeof DEXES)[number], string> = {
  Meteora: '🌊 Meteora',
  Robinhood: '🏹 Robinhood',
};

const SIDES = ['Token', 'Dual', 'USDG', 'SOL'] as const;
const SIDE_LABEL: Record<TokenSide, string> = {
  Token: '🪙 Token Side',
  Dual: '⚖️ Dual Side',
  USDG: '💵 USDG Side',
  SOL: '◎ SOL Side',
};

const STRATEGIES = ['Spot', 'Curve', 'Bid/Ask'] as const;
const STRATEGY_LABEL: Record<Strategy, string> = {
  Spot: '⚡ Spot',
  'Bid/Ask': '📊 Bid/Ask',
  Curve: '🌈 Curve',
};

const PERCENTS = [10, 20, 30, 40, 50, 60, 70, 80, 90];

interface RangeOption {
  label: string;
  value: string;
}

/** Range buttons follow the position side; Token up, SOL/USDG down, Dual both. */
export function rangeOptions(side: TokenSide | undefined): RangeOption[] {
  if (side === 'Token') return PERCENTS.map((p) => ({ label: `📈 +${p}%`, value: `+${p}%` }));
  if (side === 'Dual') return PERCENTS.map((p) => ({ label: `↕️ ±${p}%`, value: `+${p}% to -${p}%` }));
  return PERCENTS.map((p) => ({ label: `📉 -${p}%`, value: `-${p}%` }));
}

interface Draft {
  pair?: string;
  closeReason?: string | null;
  dex?: string | null;
  status?: PositionStatus;
  entryMcapUsd?: number | null;
  exitMcapUsd?: number | null;
  initialUsd?: number | null;
  receivedUsd?: number | null;
  durationSeconds?: number | null;
  side?: TokenSide;
  strategy?: Strategy;
  range?: string;
}

interface Session {
  step: Step;
  draft: Draft;
  updatedAt: number;
}

export interface WizardDeps {
  store: PositionStore;
  getUsdIdrRate: () => Promise<number | null>;
  timeZone: string;
  currency: Currency;
}

const sessions = new Map<number, Session>();
const sessionTtlMs = 30 * 60 * 1000;

function cleanSessions(): void {
  const now = Date.now();
  for (const [chatId, session] of sessions) {
    if (now - session.updatedAt > sessionTtlMs) sessions.delete(chatId);
  }
}

export function hasSession(chatId: number): boolean {
  return sessions.has(chatId);
}

function stepsFor(draft: Draft): Step[] {
  const steps: Step[] = ['pair', 'reason', 'dex', 'status', 'entryMcap'];
  if (draft.status !== 'open') steps.push('exitMcap');
  steps.push('initial', 'received', 'duration', 'side', 'strategy', 'range');
  return steps;
}

function nextStep(session: Session): Step {
  const steps = stepsFor(session.draft);
  const current = session.step === 'rangeCustom' ? 'range' : session.step;
  const index = steps.indexOf(current);
  return steps[index + 1] ?? 'confirm';
}

function twoPerRow(entries: Array<{ label: string; data: string }>): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  entries.forEach((entry, index) => {
    keyboard.text(entry.label, entry.data);
    if (index % 2 === 1) keyboard.row();
  });
  return keyboard;
}

function threePerRow(entries: Array<{ label: string; data: string }>): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  entries.forEach((entry, index) => {
    keyboard.text(entry.label, entry.data);
    if (index % 3 === 2) keyboard.row();
  });
  return keyboard;
}

function progress(step: Step, draft: Draft): string {
  const steps = stepsFor(draft);
  const current = step === 'rangeCustom' ? 'range' : step;
  const position = steps.indexOf(current) + 1;
  return position > 0 ? `[${position}/${steps.length}] ` : '';
}

function promptFor(step: Step, draft: Draft): { text: string; keyboard?: InlineKeyboard } {
  const prefix = progress(step, draft);
  switch (step) {
    case 'pair':
      return { text: `${prefix}🪙 Pair yang ditutup?\nContoh: FTR/SOL` };
    case 'reason':
      return {
        text: `${prefix}🚪 Kenapa posisi ditutup?\nPilih tombol, atau ketik alasan lain.`,
        keyboard: twoPerRow(REASONS.map((reason) => ({ label: REASON_LABEL[reason], data: `wiz:reason:${reason}` }))),
      };
    case 'dex':
      return {
        text: `${prefix}🌊 DEX-nya?`,
        keyboard: twoPerRow(DEXES.map((dex) => ({ label: DEX_LABEL[dex], data: `wiz:dex:${dex}` }))),
      };
    case 'status':
      return {
        text: `${prefix}📌 Status posisinya?`,
        keyboard: twoPerRow([
          { label: '✅ Closed', data: 'wiz:status:closed' },
          { label: '⏳ Still Open', data: 'wiz:status:open' },
        ]),
      };
    case 'entryMcap':
      return { text: `${prefix}📊 Entry MCAP (USD)\nContoh: 150K atau 150000 (kirim - kalau kosong)` };
    case 'exitMcap':
      return { text: `${prefix}📊 Exit MCAP (USD)\nContoh: 162.5K atau 162500 (kirim - kalau kosong)` };
    case 'initial':
      return { text: `${prefix}💵 Modal awal dalam USD\nContoh: 150` };
    case 'received':
      return { text: `${prefix}💰 Total diterima dalam USD\nContoh: 162.50` };
    case 'duration':
      return { text: `${prefix}⏱️ Durasi posisi\nContoh: 12m 35s, 2h 15m, 1d 4h` };
    case 'side':
      return {
        text: `${prefix}🧭 Range-nya di sisi mana?`,
        keyboard: twoPerRow(SIDES.map((side) => ({ label: SIDE_LABEL[side], data: `wiz:side:${side}` }))),
      };
    case 'strategy':
      return {
        text: `${prefix}🎯 Strategy-nya?`,
        keyboard: threePerRow(
          STRATEGIES.map((strategy) => ({ label: STRATEGY_LABEL[strategy], data: `wiz:strategy:${strategy}` })),
        ),
      };
    case 'range': {
      const options = rangeOptions(draft.side);
      const keyboard = threePerRow(
        options.map((option, index) => ({ label: option.label, data: `wiz:range:${index}` })),
      );
      keyboard.row().text('✏️ Custom', 'wiz:range:custom');
      return {
        text: `${prefix}📐 Pilih range (${SIDE_LABEL[draft.side ?? 'Token']})\nAtau tekan ✏️ Custom untuk ketik sendiri.`,
        keyboard,
      };
    }
    case 'rangeCustom':
      return {
        text: `${prefix}✏️ Ketik range sendiri\nContoh: -10% to -20% atau +15%`,
      };
    case 'confirm':
      return { text: '✅ Konfirmasi' };
  }
}

async function sendPrompt(ctx: Context, session: Session): Promise<void> {
  const { text, keyboard } = promptFor(session.step, session.draft);
  await ctx.reply(text, keyboard ? { reply_markup: keyboard } : undefined);
}

export async function startWizard(ctx: Context): Promise<void> {
  cleanSessions();
  const chatId = ctx.chat?.id;
  if (!chatId) return;
  const session: Session = { step: 'pair', draft: {}, updatedAt: Date.now() };
  sessions.set(chatId, session);
  await sendPrompt(ctx, session);
}

/**
 * Asks before throwing away the draft. Returns false when no wizard is running,
 * so the caller can say so instead.
 */
export async function requestCancel(ctx: Context): Promise<boolean> {
  const chatId = ctx.chat?.id;
  if (!chatId || !sessions.has(chatId)) return false;
  const keyboard = new InlineKeyboard()
    .text('✅ Ya, batalkan', 'wiz:cancel:confirm')
    .text('↩️ Lanjutkan', 'wiz:cancel:keep');
  await ctx.reply('⚠️ Yakin batalkan? Data yang sudah diisi akan hilang.', { reply_markup: keyboard });
  return true;
}

function resolveBrand(ctx: Context, deps: WizardDeps): string {
  const userId = ctx.from ? String(ctx.from.id) : null;
  return (userId ? deps.store.getBrand(userId) : null) ?? defaultBrand(ctx.from);
}

function summaryText(draft: Draft, brand: string): string {
  const { netPnlUsd, roiPercent } = derivePnl(draft.initialUsd ?? null, draft.receivedUsd ?? null);
  const pnl = netPnlUsd == null ? NA : `${formatMoney(netPnlUsd, 'USD', 'always')} (${formatRoi(roiPercent)})`;
  const open = draft.status === 'open';
  const lines = [
    '🧾 Ringkasan PnL Card',
    '',
    `🏷️ Brand: ${brand}`,
    `🪙 Pair: ${draft.pair ?? NA}`,
    `🚪 Close: ${draft.closeReason ?? NA}`,
    `🌊 DEX: ${draft.dex ?? NA}`,
    `📌 Status: ${open ? '⏳ Still Open' : '✅ Closed'}`,
    `📊 Entry MCAP: ${formatMcap(draft.entryMcapUsd)}`,
  ];
  if (!open) lines.push(`📊 Exit MCAP: ${formatMcap(draft.exitMcapUsd)}`);
  lines.push(
    `💵 Initial: ${formatMoney(draft.initialUsd, 'USD')}`,
    `💰 Received: ${formatMoney(draft.receivedUsd, 'USD')}`,
    `📈 PnL: ${pnl}${open ? ' (unrealized)' : ''}`,
    `⏱️ Duration: ${formatDuration(draft.durationSeconds)}`,
    `🧭 Side: ${SIDE_LABEL[draft.side ?? 'Token']}`,
    `🎯 Strategy: ${draft.strategy ?? NA}`,
    `📐 Range: ${draft.range ?? NA}`,
    '',
    'Buat kartunya?',
  );
  return lines.join('\n');
}

async function sendSummary(ctx: Context, session: Session, deps: WizardDeps): Promise<void> {
  session.step = 'confirm';
  session.updatedAt = Date.now();
  const keyboard = new InlineKeyboard()
    .text('✅ Buat Kartu', 'wiz:confirm:create')
    .text('❌ Batal', 'wiz:confirm:cancel');
  await ctx.reply(summaryText(session.draft, resolveBrand(ctx, deps)), { reply_markup: keyboard });
}

async function advance(ctx: Context, session: Session, deps: WizardDeps): Promise<void> {
  session.step = nextStep(session);
  session.updatedAt = Date.now();
  if (session.step === 'confirm') await sendSummary(ctx, session, deps);
  else await sendPrompt(ctx, session);
}

async function finalize(ctx: Context, session: Session, deps: WizardDeps): Promise<void> {
  const draft = session.draft;
  if (!draft.pair) {
    await ctx.reply('⚠️ Data pair belum ada. Mulai lagi dengan /newpnl.');
    return;
  }

  const createdAt = new Date();
  const duration = draft.durationSeconds ?? null;
  const { netPnlUsd, roiPercent } = derivePnl(draft.initialUsd ?? null, draft.receivedUsd ?? null);
  const usdIdrRate = await deps.getUsdIdrRate();
  const status: PositionStatus = draft.status === 'open' ? 'open' : 'closed';

  const snapshot: PositionSnapshot = {
    id: randomUUID(),
    brand: resolveBrand(ctx, deps),
    pair: draft.pair,
    closeReason: draft.closeReason ?? null,
    dex: draft.dex ?? null,
    status,
    entryMcapUsd: draft.entryMcapUsd ?? null,
    exitMcapUsd: status === 'open' ? null : (draft.exitMcapUsd ?? null),
    initialUsd: draft.initialUsd ?? null,
    receivedUsd: draft.receivedUsd ?? null,
    durationSeconds: duration,
    range: draft.range ?? null,
    side: draft.side ?? null,
    strategy: draft.strategy ?? null,
    openedAt: new Date(createdAt.getTime() - (duration ?? 0) * 1000).toISOString(),
    closedAt: createdAt.toISOString(),
    currency: deps.currency,
    usdIdrRate,
    netPnlUsd,
    roiPercent,
    createdAt: createdAt.toISOString(),
    telegramUserId: ctx.from ? String(ctx.from.id) : null,
  };

  try {
    const png = await renderCardPng(snapshot, { timeZone: deps.timeZone });
    deps.store.save(snapshot, png, snapshot.telegramUserId);
    if (snapshot.telegramUserId) deps.store.clearCalendarCache(snapshot.telegramUserId);
    const chatId = ctx.chat?.id;
    if (chatId) sessions.delete(chatId);
    await ctx.replyWithPhoto(new InputFile(png, `pnl-${snapshot.id.slice(0, 8)}.png`));
  } catch (error) {
    console.error('Gagal membuat kartu:', error);
    await ctx.reply('⚠️ Gagal membuat kartu. Coba /newpnl lagi.');
  }
}

/** Returns true when the message was consumed by the wizard. */
export async function handleWizardText(ctx: Context, deps: WizardDeps): Promise<boolean> {
  const chatId = ctx.chat?.id;
  const raw = ctx.message?.text?.trim();
  if (!chatId || !raw || raw.startsWith('/')) return false;

  cleanSessions();
  const session = sessions.get(chatId);
  if (!session) return false;

  const step = session.step;
  const fail = async (message: string) => {
    await ctx.reply(message);
    await sendPrompt(ctx, session);
    return true;
  };

  switch (step) {
    case 'pair': {
      const pair = normalizePair(raw);
      if (!pair) return fail('⚠️ Format pair harus seperti FTR/SOL.');
      session.draft.pair = pair;
      break;
    }
    case 'reason': {
      const reason = optionalText(raw);
      if (!reason) return fail('👆 Pilih tombol di atas, atau ketik alasan close-nya.');
      if (reason.length > 40) return fail('⚠️ Alasan terlalu panjang (maks 40 karakter).');
      session.draft.closeReason = reason;
      break;
    }
    case 'entryMcap':
    case 'exitMcap': {
      if (raw === '-') {
        if (step === 'entryMcap') session.draft.entryMcapUsd = null;
        else session.draft.exitMcapUsd = null;
      } else {
        const amount = parseAmount(raw);
        if (amount == null || amount < 0) return fail('⚠️ MCAP tidak valid. Contoh: 150K atau 162500.');
        if (step === 'entryMcap') session.draft.entryMcapUsd = amount;
        else session.draft.exitMcapUsd = amount;
      }
      break;
    }
    case 'initial': {
      const amount = parseAmount(raw);
      if (amount == null || amount <= 0) return fail('⚠️ Modal awal harus angka lebih dari 0. Contoh: 150');
      session.draft.initialUsd = amount;
      break;
    }
    case 'received': {
      const amount = parseAmount(raw);
      if (amount == null || amount < 0) return fail('⚠️ Total diterima tidak valid. Contoh: 162.50');
      session.draft.receivedUsd = amount;
      break;
    }
    case 'duration': {
      const seconds = parseDuration(raw);
      if (seconds == null || seconds <= 0) return fail('⚠️ Durasi tidak valid. Contoh: 12m 35s');
      session.draft.durationSeconds = seconds;
      break;
    }
    case 'dex':
      return fail('👆 Pilih DEX lewat tombol: Meteora atau Robinhood.');
    case 'status':
      return fail('👆 Pilih status lewat tombol: Closed atau Still Open.');
    case 'side':
      return fail('👆 Pilih sisi range lewat tombol di atas.');
    case 'strategy':
      return fail('👆 Pilih strategy lewat tombol di atas.');
    case 'range':
      return fail('👆 Pilih range lewat tombol di atas, atau tekan ✏️ Custom.');
    case 'rangeCustom': {
      const range = normalizeRange(raw);
      if (!range) return fail('⚠️ Range tidak valid. Contoh: -10% to -20% atau +15%');
      session.draft.range = range;
      break;
    }
    case 'confirm':
      await ctx.reply('👆 Tekan tombol ✅ Buat Kartu atau ❌ Batal di atas.');
      return true;
  }

  await advance(ctx, session, deps);
  return true;
}

/** Returns true when the callback belonged to the wizard. */
export async function handleWizardCallback(ctx: Context, data: string, deps: WizardDeps): Promise<boolean> {
  if (!data.startsWith('wiz:')) return false;
  const chatId = ctx.chat?.id;
  if (!chatId) return true;

  if (data === 'wiz:start') {
    await ctx.answerCallbackQuery();
    await startWizard(ctx);
    return true;
  }
  if (data === 'wiz:cancel' || data === 'wiz:confirm:cancel') {
    await ctx.answerCallbackQuery();
    const asked = await requestCancel(ctx);
    if (!asked) await ctx.reply('🤷 Tidak ada wizard yang sedang jalan.');
    return true;
  }

  if (data === 'wiz:cancel:confirm') {
    await ctx.answerCallbackQuery({ text: 'Dibatalkan' });
    if (sessions.delete(chatId)) await ctx.reply('❌ Dibatalkan. Kartu tidak dibuat.');
    else await ctx.reply('🤷 Sesi sudah tidak ada.');
    return true;
  }

  if (data === 'wiz:cancel:keep') {
    await ctx.answerCallbackQuery({ text: 'Dilanjutkan' });
    const kept = sessions.get(chatId);
    if (!kept) {
      await ctx.reply('🤷 Sesi sudah tidak ada. Mulai lagi dengan /newpnl.');
      return true;
    }
    await ctx.reply('👍 Oke, lanjut.');
    if (kept.step === 'confirm') await sendSummary(ctx, kept, deps);
    else await sendPrompt(ctx, kept);
    return true;
  }

  const session = sessions.get(chatId);
  if (!session) {
    await ctx.answerCallbackQuery({ text: 'Sesi sudah tidak ada. Mulai /newpnl.', show_alert: true });
    return true;
  }

  const stale = async () => {
    await ctx.answerCallbackQuery({ text: 'Pilihan ini sudah lewat.' });
    return true;
  };

  if (data.startsWith('wiz:reason:')) {
    if (session.step !== 'reason') return stale();
    const reason = data.slice('wiz:reason:'.length);
    if (!(REASONS as readonly string[]).includes(reason)) {
      await ctx.answerCallbackQuery({ text: 'Alasan tidak dikenal.' });
      return true;
    }
    session.draft.closeReason = reason;
    await ctx.answerCallbackQuery({ text: reason });
    await ctx.reply(`✅ Close reason: ${reason}`);
    await advance(ctx, session, deps);
    return true;
  }

  if (data.startsWith('wiz:dex:')) {
    if (session.step !== 'dex') return stale();
    const dex = data.slice('wiz:dex:'.length);
    if (!(DEXES as readonly string[]).includes(dex)) {
      await ctx.answerCallbackQuery({ text: 'DEX tidak dikenal.' });
      return true;
    }
    session.draft.dex = dex;
    await ctx.answerCallbackQuery({ text: dex });
    await ctx.reply(`✅ DEX: ${dex}`);
    await advance(ctx, session, deps);
    return true;
  }

  if (data.startsWith('wiz:status:')) {
    if (session.step !== 'status') return stale();
    const value = data.slice('wiz:status:'.length);
    if (value !== 'closed' && value !== 'open') {
      await ctx.answerCallbackQuery({ text: 'Status tidak dikenal.' });
      return true;
    }
    session.draft.status = value;
    await ctx.answerCallbackQuery({ text: value === 'open' ? 'Still Open' : 'Closed' });
    await ctx.reply(value === 'open' ? '⏳ Status: Still Open' : '✅ Status: Closed');
    await advance(ctx, session, deps);
    return true;
  }

  if (data.startsWith('wiz:side:')) {
    if (session.step !== 'side') return stale();
    const side = data.slice('wiz:side:'.length);
    if (!(SIDES as readonly string[]).includes(side)) {
      await ctx.answerCallbackQuery({ text: 'Side tidak dikenal.' });
      return true;
    }
    session.draft.side = side as TokenSide;
    await ctx.answerCallbackQuery({ text: side });
    await ctx.reply(`✅ Side: ${SIDE_LABEL[side as TokenSide]}`);
    await advance(ctx, session, deps);
    return true;
  }

  if (data.startsWith('wiz:strategy:')) {
    if (session.step !== 'strategy') return stale();
    const strategy = data.slice('wiz:strategy:'.length);
    if (!(STRATEGIES as readonly string[]).includes(strategy)) {
      await ctx.answerCallbackQuery({ text: 'Strategy tidak dikenal.' });
      return true;
    }
    session.draft.strategy = strategy as Strategy;
    await ctx.answerCallbackQuery({ text: strategy });
    await ctx.reply(`✅ Strategy: ${strategy}`);
    await advance(ctx, session, deps);
    return true;
  }

  if (data.startsWith('wiz:range:')) {
    if (session.step !== 'range') return stale();
    const raw = data.slice('wiz:range:'.length);
    if (raw === 'custom') {
      await ctx.answerCallbackQuery();
      session.step = 'rangeCustom';
      session.updatedAt = Date.now();
      await sendPrompt(ctx, session);
      return true;
    }
    const index = Number(raw);
    const options = rangeOptions(session.draft.side);
    const option = options[index];
    if (!option || !Number.isInteger(index)) {
      await ctx.answerCallbackQuery({ text: 'Range tidak dikenal.' });
      return true;
    }
    session.draft.range = option.value;
    await ctx.answerCallbackQuery({ text: option.label.replace(/^\S+\s/, '') });
    await ctx.reply(`✅ Range: ${option.value}`);
    await advance(ctx, session, deps);
    return true;
  }

  if (data === 'wiz:confirm:create') {
    if (session.step !== 'confirm') {
      await ctx.answerCallbackQuery({ text: 'Belum siap dibuat.' });
      return true;
    }
    await ctx.answerCallbackQuery({ text: 'Membuat kartu...' });
    await finalize(ctx, session, deps);
    return true;
  }

  await ctx.answerCallbackQuery();
  return true;
}
