import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Currency } from './card/types.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseCurrency(raw: string | undefined): Currency {
  const value = (raw ?? 'IDR').toUpperCase();
  if (value === 'USD' || value === 'IDR') return value;
  throw new Error(`DEFAULT_CURRENCY must be USD or IDR (got: ${raw})`);
}

// Loaded at import time so every module sees the same configuration.
loadEnv();

export const config = {
  root,
  /** Telegram bot token from @BotFather. */
  botToken: process.env.TELEGRAM_BOT_TOKEN ?? '',
  /** SQLite file holding immutable closed-position snapshots. */
  dbPath: process.env.DB_PATH ?? path.join(root, 'data', 'pnl.sqlite'),
  /** Directory with JetBrains Mono TTFs (Regular/Medium/Bold). */
  fontsDir: process.env.FONTS_DIR ?? path.join(root, 'assets', 'fonts'),
  /** Timezone used for the close date on the card. */
  timeZone: process.env.BOT_TIMEZONE ?? 'Asia/Jakarta',
  /** Card currency: USD or IDR. */
  currency: parseCurrency(process.env.DEFAULT_CURRENCY),
  /** Free, keyless FX endpoint returning { rates: { IDR } } for a USD base. */
  fxApiUrl: process.env.FX_API_URL ?? 'https://open.er-api.com/v6/latest/USD',
  fxTimeoutMs: 6_000,
};

export function loadEnv(): void {
  try {
    const load = (process as NodeJS.Process & { loadEnvFile?: (p?: string) => void }).loadEnvFile;
    if (load) load(path.join(root, '.env'));
  } catch {
    // .env is optional; environment variables may come from the shell.
  }
}
