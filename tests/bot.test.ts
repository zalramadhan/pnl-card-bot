import { InputFile } from 'grammy';
import { describe, expect, it } from 'vitest';
import { createBot } from '../src/bot/bot.js';
import { sampleSnapshot } from '../src/sample.js';
import { PositionStore } from '../src/store.js';

interface Call {
  method: string;
  payload: Record<string, unknown>;
}

interface FilePayload {
  fileData: Buffer;
  filename: string;
}

const from = { id: 42, is_bot: false, first_name: 'Tester' } as const;
const chat = { id: 42, type: 'private' as const, first_name: 'Tester' };

function harness() {
  const store = new PositionStore(':memory:');
  const bot = createBot('123456:TEST', {
    store,
    timeZone: 'Asia/Jakarta',
    currency: 'IDR',
    getUsdIdrRate: async () => 16_400,
    now: () => new Date('2026-10-25T10:00:00.000Z'),
  });

  // grammY refuses updates until it knows the bot; no network call needed here.
  (bot as unknown as { botInfo: unknown }).botInfo = {
    id: 123456,
    is_bot: true,
    first_name: 'PnL Card',
    username: 'pnl_card_test_bot',
    can_join_groups: true,
    can_read_all_group_messages: false,
    supports_inline_queries: false,
  };

  const calls: Call[] = [];
  let messageId = 100;
  bot.api.config.use(async (_prev, method, payload) => {
    calls.push({ method, payload: payload as Record<string, unknown> });
    if (method === 'answerCallbackQuery') return { ok: true, result: true } as never;
    messageId += 1;
    return {
      ok: true,
      result: { message_id: messageId, date: 0, chat, text: '' },
    } as never;
  });

  let updateId = 1;
  const send = async (text: string) => {
    updateId += 1;
    // Telegram marks only the command token as a bot_command entity, not its arguments.
    const commandToken = text.split(/\s+/)[0] ?? text;
    const entities = text.startsWith('/')
      ? [{ type: 'bot_command', offset: 0, length: commandToken.length }]
      : undefined;
    await bot.handleUpdate({
      update_id: updateId,
      message: { message_id: updateId, date: 1_760_000_000, from, chat, text, entities },
    } as never);
  };
  const press = async (data: string) => {
    updateId += 1;
    await bot.handleUpdate({
      update_id: updateId,
      callback_query: {
        id: String(updateId),
        from,
        chat_instance: 'test',
        message: { message_id: updateId, date: 1_760_000_000, from, chat, text: 'x' },
        data,
      },
    } as never);
  };

  return { bot, store, calls, send, press };
}

type Harness = ReturnType<typeof harness>;

async function walkWizard(
  { send, press }: Pick<Harness, 'send' | 'press'>,
  options: { status?: 'closed' | 'open' } = {},
) {
  const status = options.status ?? 'closed';
  await send('/newpnl');
  await send('ftr / sol');
  await press('wiz:reason:Cut Loss');
  await press('wiz:dex:Meteora');
  await press(`wiz:status:${status}`);
  await send('150K');
  if (status === 'closed') await send('162.5K');
  await send('150');
  await send('162.50');
  await send('12m 35s');
  await press('wiz:side:Token');
  await press('wiz:strategy:Bid/Ask');
  await press('wiz:range:1');
  await press('wiz:confirm:create');
}

describe('Telegram flow', () => {
  it('runs the wizard and sends exactly one card', async () => {
    const { store, calls, send, press } = harness();
    // A stale calendar image must be invalidated by the new position.
    store.setCalendarCache('42|month|2026-10|IDR|0:-', 'file-old', 'old');
    await walkWizard({ send, press });
    expect(store.getCalendarCache('42|month|2026-10|IDR|0:-')).toBeNull();

    const photos = calls.filter((call) => call.method === 'sendPhoto');
    expect(photos).toHaveLength(1);

    const photo = photos[0]?.payload.photo;
    expect(photo).toBeInstanceOf(InputFile);
    const bytes = (photo as unknown as FilePayload).fileData;
    expect(bytes.subarray(0, 4).toString('hex')).toBe('89504e47');

    const stored = store.list('42');
    expect(stored).toHaveLength(1);
    const snapshot = stored[0]!;
    expect(snapshot.brand).toBe('TESTER');
    expect(snapshot.pair).toBe('FTR/SOL');
    expect(snapshot.closeReason).toBe('Cut Loss');
    expect(snapshot.dex).toBe('Meteora');
    expect(snapshot.status).toBe('closed');
    expect(snapshot.entryMcapUsd).toBe(150_000);
    expect(snapshot.exitMcapUsd).toBe(162_500);
    expect(snapshot.initialUsd).toBe(150);
    expect(snapshot.receivedUsd).toBe(162.5);
    expect(snapshot.netPnlUsd).toBeCloseTo(12.5);
    expect(snapshot.roiPercent).toBeCloseTo(8.3333, 3);
    expect(snapshot.durationSeconds).toBe(755);
    expect(snapshot.range).toBe('+20%');
    expect(snapshot.side).toBe('Token');
    expect(snapshot.strategy).toBe('Bid/Ask');
    expect(snapshot.usdIdrRate).toBe(16_400);
    expect(snapshot.currency).toBe('IDR');
    store.close();
  });

  it('skips Exit MCAP and marks the card open for Still Open positions', async () => {
    const { store, calls, send, press } = harness();
    await walkWizard({ send, press }, { status: 'open' });

    const stored = store.list('42')[0]!;
    expect(stored.status).toBe('open');
    expect(stored.exitMcapUsd).toBeNull();

    const replies = calls.filter((call) => call.method === 'sendMessage').map((call) => String(call.payload.text));
    const summary = replies.find((text) => text.includes('Ringkasan PnL Card'));
    expect(summary).toContain('Still Open');
    expect(summary).not.toContain('Exit MCAP');
    store.close();
  });

  it('does not double-answer the command that starts the wizard', async () => {
    const { calls, send, store } = harness();
    await send('/newpnl');
    const replies = calls.filter((call) => call.method === 'sendMessage');
    expect(replies).toHaveLength(1);
    expect(String(replies[0]?.payload.text)).toContain('Pair yang ditutup');
    store.close();
  });

  it('resends a stored card byte for byte from history', async () => {
    const { calls, send, press, store } = harness();
    await walkWizard({ send, press });
    const firstPhoto = calls.find((call) => call.method === 'sendPhoto')?.payload
      .photo as unknown as FilePayload;

    await send('/history');
    const historyCall = calls.filter((call) => call.method === 'sendMessage').at(-1);
    const keyboard = (historyCall?.payload.reply_markup as { inline_keyboard: Array<Array<{ callback_data: string }>> })
      .inline_keyboard;
    const cardId = keyboard[0]?.[0]?.callback_data.split(':')[1] ?? '';
    expect(cardId).not.toBe('');

    await press(`hist:${cardId}`);

    const photos = calls.filter((call) => call.method === 'sendPhoto');
    expect(photos).toHaveLength(2);
    const second = photos[1]?.payload.photo as unknown as FilePayload;
    expect(second.fileData.equals(firstPhoto.fileData)).toBe(true);
    store.close();
  });

  it('rejects values that do not parse without advancing', async () => {
    const { calls, send, store } = harness();
    await send('/newpnl');
    await send('invalid pair');
    const replies = calls.filter((call) => call.method === 'sendMessage').map((call) => String(call.payload.text));
    expect(replies).toContain('⚠️ Format pair harus seperti FTR/SOL.');
    expect(replies.at(-1)).toContain('Pair yang ditutup');
    expect(store.list('42')).toHaveLength(0);
    store.close();
  });

  it('accepts a typed close reason besides the buttons', async () => {
    const { calls, send, store } = harness();
    await send('/newpnl');
    await send('ABC/SOL');
    await send('Rug pull');
    const replies = calls.filter((call) => call.method === 'sendMessage').map((call) => String(call.payload.text));
    expect(replies.at(-1)).toContain('DEX-nya');
    store.close();
  });

  it('uses the /setname brand on the next card', async () => {
    const { store, send, press } = harness();
    await send('/setname budi');
    expect(store.getBrand('42')).toBe('BUDI');

    await walkWizard({ send, press });
    expect(store.list('42')[0]?.brand).toBe('BUDI');
    store.close();
  });

  it('accepts a custom range from the Custom button', async () => {
    const { store, send, press } = harness();
    await send('/newpnl');
    await send('ABC/SOL');
    await press('wiz:reason:Manual');
    await press('wiz:dex:Robinhood');
    await press('wiz:status:closed');
    await send('100K');
    await send('120K');
    await send('100');
    await send('130');
    await send('5m');
    await press('wiz:side:Dual');
    await press('wiz:strategy:Spot');
    await press('wiz:range:custom');
    await send('-5 to -15');
    await press('wiz:confirm:create');

    expect(store.list('42')[0]?.range).toBe('-5% to -15%');
    store.close();
  });

  it('shows the welcome copy and a persistent main menu on /start', async () => {
    const { calls, send, store } = harness();
    await send('/start');
    const startReply = calls.find((call) => call.method === 'sendMessage');
    expect(String(startReply?.payload.text)).toBe(
      [
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
      ].join('\n'),
    );
    const markup = startReply?.payload.reply_markup as {
      keyboard: Array<Array<{ text: string }>>;
      is_persistent?: boolean;
      resize_keyboard?: boolean;
    };
    expect(markup.is_persistent).toBe(true);
    expect(markup.resize_keyboard).toBe(true);
    expect(markup.keyboard.flat().map((button) => button.text)).toEqual([
      '🧾 Buat Kartu',
      '📅 Profit Calendar',
      '📜 History',
      '🏷️ Ganti Nama',
      '🧪 Contoh Kartu',
      '❌ Batal',
    ]);

    await send('🧾 Buat Kartu');
    const replies = calls.filter((call) => call.method === 'sendMessage').map((call) => String(call.payload.text));
    expect(replies.at(-1)).toContain('Pair yang ditutup');
    store.close();
  });

  it('asks before discarding the wizard from the Batal menu button', async () => {
    const { calls, send, press, store } = harness();
    const replies = () =>
      calls.filter((call) => call.method === 'sendMessage').map((call) => String(call.payload.text));

    await send('/newpnl');
    await send('❌ Batal');
    expect(replies().at(-1)).toContain('Yakin batalkan');

    // Keep the draft: the wizard resumes at the current step.
    await press('wiz:cancel:keep');
    expect(replies().at(-1)).toContain('Pair yang ditutup');
    await send('abc/sol');
    expect(replies().at(-1)).toContain('Kenapa posisi ditutup');

    // Now cancel for real.
    await send('❌ Batal');
    await press('wiz:cancel:confirm');
    expect(replies().at(-1)).toBe('❌ Dibatalkan. Kartu tidak dibuat.');

    // The session is gone, so plain text no longer feeds the wizard.
    await send('ABC/SOL');
    expect(replies().at(-1)).toContain('menu di bawah');
    expect(store.list('42')).toHaveLength(0);
    store.close();
  });

  it('says there is nothing to cancel when no wizard is running', async () => {
    const { calls, send, store } = harness();
    await send('/cancel');
    const replies = calls.filter((call) => call.method === 'sendMessage').map((call) => String(call.payload.text));
    expect(replies.at(-1)).toBe('🤷 Tidak ada wizard yang sedang jalan.');
    store.close();
  });

  it('resets the brand back to the Telegram name', async () => {
    const { store, send, press } = harness();
    await send('/setname budi');
    expect(store.getBrand('42')).toBe('BUDI');

    await send('/setname reset');
    expect(store.getBrand('42')).toBeNull();

    await walkWizard({ send, press });
    expect(store.list('42')[0]?.brand).toBe('TESTER');
    store.close();
  });

  it('explains commands and menu buttons in /help', async () => {
    const { calls, send, store } = harness();
    await send('/help');
    const reply = calls.filter((call) => call.method === 'sendMessage').at(-1);
    const text = String(reply?.payload.text);
    expect(text).toContain('❓ Bantuan');
    expect(text).toContain('🧾 /newpnl');
    expect(text).toContain('🏷️ /setname reset');
    expect(text).toContain('📜 /history');
    expect(text).toContain('📅 /calendar');
    expect(text).toContain('❌ Batal');
    expect(text).toContain('📐 Range');
    expect(reply?.payload.reply_markup).toBeDefined();
    store.close();
  });

  it('sends the profit calendar and edits it on navigation', async () => {
    const { store, calls, send, press } = harness();
    store.save(
      sampleSnapshot({
        id: 'cal-1',
        telegramUserId: '42',
        status: 'closed',
        closedAt: '2026-10-17T03:00:00.000Z',
        createdAt: '2026-10-17T03:00:00.000Z',
      }),
      Buffer.from([0x89, 0x50, 0x4e, 0x47]),
      '42',
    );

    await send('/calendar');

    const photo = calls.find((call) => call.method === 'sendPhoto');
    expect(photo).toBeDefined();
    expect(String(photo?.payload.caption)).toContain('OKTOBER 2026');
    const markup = photo?.payload.reply_markup as {
      inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
    };
    const flat = markup.inline_keyboard.flat();
    expect(flat.some((button) => button.callback_data === 'cal:m:2026-10')).toBe(true);

    const weekButton = flat.find((button) => button.callback_data.startsWith('cal:w:'));
    expect(weekButton).toBeDefined();
    await press(weekButton?.callback_data ?? '');
    expect(calls.some((call) => call.method === 'editMessageMedia')).toBe(true);
    store.close();
  });

  it('sends the demo card', async () => {
    const { calls, send, store } = harness();
    await send('/demo');
    expect(calls.filter((call) => call.method === 'sendPhoto')).toHaveLength(1);
    expect(sampleSnapshot().pair).toBe('FTR/SOL');
    store.close();
  });
});
