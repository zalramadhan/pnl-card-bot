import { BOT_COMMANDS, createBot } from './bot/bot.js';
import { config } from './config.js';
import { fetchUsdIdrRate } from './fx.js';
import { PositionStore } from './store.js';

if (!config.botToken) {
  console.error('TELEGRAM_BOT_TOKEN masih kosong. Salin .env.example ke .env lalu isi token dari @BotFather.');
  process.exit(1);
}

const store = new PositionStore(config.dbPath);
const bot = createBot(config.botToken, {
  store,
  timeZone: config.timeZone,
  currency: config.currency,
  getUsdIdrRate: () => fetchUsdIdrRate(),
});

await bot.api.setMyCommands(BOT_COMMANDS);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    console.log(`${signal} diterima, menghentikan bot...`);
    void bot.stop();
  });
}

await bot.start({
  onStart: (me) => {
    console.log(`@${me.username} siap · currency ${config.currency} · timezone ${config.timeZone}`);
  },
});

store.close();
