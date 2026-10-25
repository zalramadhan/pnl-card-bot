import { Bot, InlineKeyboard, InputFile, Keyboard, type Context } from 'grammy';
import { formatCloseDateTime } from '../card/format.js';
import { renderCardPng } from '../card/render.js';
import type { Currency } from '../card/types.js';
import { sampleSnapshot } from '../sample.js';
import type { PositionStore } from '../store.js';
import { defaultBrand, normalizeBrand } from './brand.js';
import { handleCalendarCallback, sendCalendar, type CalendarDeps } from './calendar.js';
import { handleWizardCallback, handleWizardText, hasSession, requestCancel, startWizard, type WizardDeps } from './wizard.js';

export interface BotDeps {
  store: PositionStore;
  timeZone: string;
  currency: Currency;
  getUsdIdrRate: () => Promise<number | null>;
  /** Injectable clock for deterministic tests. */
  now?: () => Date;
}

export const BOT_COMMANDS = [
  { command: 'newpnl', description: '🧾 Buat PnL card untuk posisi kamu' },
  { command: 'calendar', description: '📅 Profit calendar bulanan' },
  { command: 'setname', description: '🏷️ Ganti nama brand di kartu' },
  { command: 'history', description: '📜 Kirim ulang 5 kartu terakhir' },
  { command: 'demo', description: '🧪 Lihat contoh kartu' },
  { command: 'help', description: '❓ Panduan command & tombol' },
  { command: 'cancel', description: '❌ Batalkan wizard' },
];

/** Labels of the persistent reply keyboard, also matched as plain text. */
const MENU = {
  newCard: '🧾 Buat Kartu',
  calendar: '📅 Profit Calendar',
  history: '📜 History',
  name: '🏷️ Ganti Nama',
  demo: '🧪 Contoh Kartu',
  cancel: '❌ Batal',
} as const;

const MENU_LABELS = new Set<string>(Object.values(MENU));

function mainMenu(): Keyboard {
  return new Keyboard()
    .text(MENU.newCard)
    .text(MENU.calendar)
    .row()
    .text(MENU.history)
    .text(MENU.name)
    .row()
    .text(MENU.demo)
    .text(MENU.cancel)
    .resized()
    .persistent();
}

function helpText(): string {
  return [
    '❓ Bantuan — 0XGAROU PnL Card',
    '',
    '🧾 /newpnl — wizard bikin kartu',
    '📅 /calendar — profit calendar bulanan',
    'Urutannya: pair → close reason → DEX → status →',
    'entry MCAP → exit MCAP (kalau Closed) → initial →',
    'received → duration → side → strategy → range.',
    '',
    '🏷️ /setname Nama — ganti judul kartu',
    '🏷️ /setname reset — balik ke nama Telegram',
    '📜 /history — kirim ulang 5 kartu terakhir',
    '🧪 /demo — contoh kartu',
    '📅 /calendar — profit calendar bulanan',
    '❌ /cancel — batalkan wizard (pakai konfirmasi)',
    '',
    'Tombol menu di bawah layar:',
    '🧾 Buat Kartu — mulai wizard baru',
    '📜 History — daftar kartu terakhir',
    '🏷️ Ganti Nama — lihat atau ganti nama kartu',
    '📅 Profit Calendar — rekap profit bulanan',
    '🧪 Contoh Kartu — contoh tanpa isi data',
    '❌ Batal — hentikan wizard yang sedang jalan',
    '',
    'Pilihan di dalam wizard:',
    '🚪 Close reason — Manual, Auto TP, OOR TP, Cut Loss, Stop Loss, OOR LEFT',
    '🌊 DEX — Meteora atau Robinhood',
    '📌 Status — Closed atau Still Open',
    '🧭 Side — Token, Dual, USDG, SOL',
    '🎯 Strategy — Spot, Curve, Bid/Ask',
    '📐 Range — tombol sesuai side, atau ✏️ Custom untuk ketik sendiri',
  ].join('\n');
}

function welcomeText(): string {
  return [
    '🧾 0XGAROU — PnL Card',
    '',
    'Aku bikin kartu PnL gaya struk untuk posisi LP kamu.',
    'Semua angka disimpan sebagai snapshot, jadi kartu lama',
    'selalu identik saat dikirim ulang.',
    '',
    '🪙 /newpnl — mulai isi data posisi',
    '🏷️ /setname — ganti nama di judul kartu',
    '📜 /history — kirim ulang kartu terakhir',
    '🧪 /demo — lihat contoh kartu',
  ].join('\n');
}

export function createBot(token: string, deps: BotDeps): Bot {
  const bot = new Bot(token);
  const resolveBrand = (ctx: Context) => {
    const userId = ctx.from ? String(ctx.from.id) : null;
    return (userId ? deps.store.getBrand(userId) : null) ?? defaultBrand(ctx.from);
  };
  const calendarDeps: CalendarDeps = {
    store: deps.store,
    timeZone: deps.timeZone,
    currency: deps.currency,
    resolveBrand,
    now: deps.now,
  };
  const wizardDeps: WizardDeps = {
    store: deps.store,
    getUsdIdrRate: deps.getUsdIdrRate,
    timeZone: deps.timeZone,
    currency: deps.currency,
  };

  const sendDemo = async (ctx: Context) => {
    const png = await renderCardPng(sampleSnapshot({ currency: deps.currency }), { timeZone: deps.timeZone });
    await ctx.replyWithPhoto(new InputFile(png, 'pnl-demo.png'), { caption: '🧪 Contoh PnL card' });
  };

  const sendHistory = async (ctx: Context) => {
    const userId = ctx.from ? String(ctx.from.id) : null;
    if (!userId) return;
    const positions = deps.store.list(userId, 5);
    if (positions.length === 0) {
      await ctx.reply('📭 Belum ada kartu tersimpan.\nMulai dengan /newpnl.');
      return;
    }
    const keyboard = new InlineKeyboard();
    for (const position of positions) {
      const label = `🧾 ${position.pair} · ${formatCloseDateTime(position.closedAt, deps.timeZone)}`;
      keyboard.text(label, `hist:${position.id}`).row();
    }
    await ctx.reply('📜 Kartu terakhir (tekan untuk kirim ulang):', { reply_markup: keyboard });
  };

  const sendNameInfo = async (ctx: Context) => {
    const userId = ctx.from ? String(ctx.from.id) : null;
    if (!userId) return;
    const current = deps.store.getBrand(userId) ?? defaultBrand(ctx.from);
    await ctx.reply(
      `🏷️ Nama kartu kamu sekarang: ${current}\n\n` +
        'Ganti dengan:\n/setname NamaKamu\n\n' +
        'Balik ke nama Telegram: /setname reset',
    );
  };

  bot.command('start', async (ctx) => {
    await ctx.reply(welcomeText(), { reply_markup: mainMenu() });
  });

  bot.command('newpnl', async (ctx) => {
    await startWizard(ctx);
  });

  bot.command('help', async (ctx) => {
    await ctx.reply(helpText(), { reply_markup: mainMenu() });
  });

  bot.command('cancel', async (ctx) => {
    const asked = await requestCancel(ctx);
    if (!asked) await ctx.reply('🤷 Tidak ada wizard yang sedang jalan.');
  });

  bot.command('setname', async (ctx) => {
    const userId = ctx.from ? String(ctx.from.id) : null;
    if (!userId) return;
    const input = ctx.match.trim();

    if (!input) {
      await sendNameInfo(ctx);
      return;
    }

    if (input.toLowerCase() === 'reset') {
      deps.store.clearBrand(userId);
      await ctx.reply(
        `🔄 Nama kartu direset ke nama Telegram kamu: ${defaultBrand(ctx.from)}.\n` +
          'Kartu yang sudah dibuat tetap memakai nama lamanya.',
      );
      return;
    }

    const brand = normalizeBrand(input);
    if (!brand) {
      await ctx.reply('⚠️ Nama tidak valid. Pakai huruf/angka, maksimal 16 karakter.');
      return;
    }
    deps.store.setBrand(userId, brand);
    await ctx.reply(`✅ Nama kartu diset ke ${brand}.\nKartu berikutnya akan memakai nama ini.`);
  });

  bot.command('calendar', async (ctx) => {
    await sendCalendar(ctx, calendarDeps);
  });

  bot.command('history', async (ctx) => {
    await sendHistory(ctx);
  });

  bot.command('demo', async (ctx) => {
    await sendDemo(ctx);
  });

  bot.on('callback_query:data', async (ctx) => {
    const data = ctx.callbackQuery.data;
    if (data.startsWith('cal:')) {
      await handleCalendarCallback(ctx, data, calendarDeps);
      return;
    }
    if (data === 'demo:send') {
      await ctx.answerCallbackQuery();
      await sendDemo(ctx);
      return;
    }
    if (data.startsWith('hist:')) {
      const id = data.slice('hist:'.length);
      const stored = deps.store.get(id);
      const userId = ctx.from ? String(ctx.from.id) : null;
      if (!stored || stored.snapshot.telegramUserId !== userId) {
        await ctx.answerCallbackQuery({ text: '🔍 Kartu tidak ditemukan.', show_alert: true });
        return;
      }
      await ctx.answerCallbackQuery();
      await ctx.replyWithPhoto(new InputFile(stored.png, `pnl-${id.slice(0, 8)}.png`));
      return;
    }
    await handleWizardCallback(ctx, data, wizardDeps);
  });

  bot.on('message:text', async (ctx) => {
    const text = ctx.message.text;
    // Commands are handled above; don't answer them twice.
    if (text.startsWith('/')) return;

    if (MENU_LABELS.has(text)) {
      if (text === MENU.newCard) await startWizard(ctx);
      else if (text === MENU.calendar) await sendCalendar(ctx, calendarDeps);
      else if (text === MENU.history) await sendHistory(ctx);
      else if (text === MENU.name) await sendNameInfo(ctx);
      else if (text === MENU.cancel) {
        const asked = await requestCancel(ctx);
        if (!asked) await ctx.reply('🤷 Tidak ada wizard yang sedang jalan.');
      } else await sendDemo(ctx);
      return;
    }

    const handled = await handleWizardText(ctx, wizardDeps);
    if (handled) return;
    if (hasSession(ctx.chat.id)) return;
    await ctx.reply('🤔 Aku belum ngerti maksudnya.\nPakai menu di bawah, /newpnl, atau /demo.');
  });

  bot.catch((error) => {
    console.error('Bot error:', error.error);
  });

  return bot;
}
