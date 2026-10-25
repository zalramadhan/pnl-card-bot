import fs from 'node:fs';
import path from 'node:path';
import { buildCalendar } from '../src/calendar/aggregate.js';
import { renderCalendarPng } from '../src/calendar/render.js';
import { config } from '../src/config.js';
import type { PositionSnapshot } from '../src/card/types.js';
import { sampleSnapshot } from '../src/sample.js';

const entries: Array<{ day: string; pnl: number; pair: string; reason: string; minutes: number }> = [
  { day: '01', pnl: 12.5, pair: 'FTR/SOL', reason: 'Auto TP', minutes: 12 },
  { day: '03', pnl: -8.4, pair: 'BONK/SOL', reason: 'Stop Loss', minutes: 48 },
  { day: '05', pnl: 6.3, pair: 'WIF/SOL', reason: 'Manual', minutes: 130 },
  { day: '06', pnl: -14.2, pair: 'JUP/SOL', reason: 'Cut Loss', minutes: 22 },
  { day: '07', pnl: 31.8, pair: 'PYTH/SOL', reason: 'Auto TP', minutes: 95 },
  { day: '09', pnl: 9.7, pair: 'RAY/SOL', reason: 'OOR TP', minutes: 210 },
  { day: '10', pnl: 18.4, pair: 'ORCA/SOL', reason: 'Manual', minutes: 35 },
  { day: '11', pnl: -5.1, pair: 'FTR/SOL', reason: 'OOR LEFT', minutes: 60 },
  { day: '13', pnl: 22.6, pair: 'BONK/SOL', reason: 'Auto TP', minutes: 18 },
  { day: '14', pnl: -9.8, pair: 'WIF/SOL', reason: 'Stop Loss', minutes: 140 },
  { day: '15', pnl: 41.3, pair: 'JUP/SOL', reason: 'Auto TP', minutes: 75 },
  { day: '16', pnl: 15.2, pair: 'PYTH/SOL', reason: 'Manual', minutes: 33 },
  { day: '17', pnl: 16.25, pair: 'FTR/SOL', reason: 'Auto TP', minutes: 12 },
  { day: '17', pnl: -3.75, pair: 'BONER/SOL', reason: 'Manual', minutes: 135 },
  { day: '20', pnl: 3.4, pair: 'ORCA/SOL', reason: 'OOR TP', minutes: 88 },
  { day: '22', pnl: -12.6, pair: 'RAY/SOL', reason: 'Cut Loss', minutes: 26 },
];

const positions: PositionSnapshot[] = entries.map((entry, index) =>
  sampleSnapshot({
    id: `demo-${index}`,
    pair: entry.pair,
    closeReason: entry.reason,
    dex: index % 2 === 0 ? 'Meteora' : 'Robinhood',
    initialUsd: 100,
    receivedUsd: 100 + entry.pnl,
    durationSeconds: entry.minutes * 60,
    closedAt: `2026-10-${entry.day}T0${index % 9}:12:00.000Z`,
    createdAt: `2026-10-${entry.day}T0${index % 9}:12:00.000Z`,
    openedAt: `2026-10-${entry.day}T00:00:00.000Z`,
    range: entry.pnl > 0 ? '+10%' : '-20%',
    side: entry.pnl > 0 ? 'Token' : 'SOL',
    strategy: entry.pair === 'BONER/SOL' ? 'Curve' : 'Spot',
    telegramUserId: '42',
  }),
);

const today = '2026-10-25';
const outDir = path.join(config.root, 'out');
fs.mkdirSync(outDir, { recursive: true });

const views = [
  { name: 'calendar-month', view: 'month' as const, period: '2026-10' },
  { name: 'calendar-week', view: 'week' as const, period: '2026-10-12' },
  { name: 'calendar-day', view: 'day' as const, period: '2026-10-17' },
];

for (const item of views) {
  const result = buildCalendar({
    view: item.view,
    period: item.period,
    timeZone: 'Asia/Jakarta',
    currency: 'IDR',
    brand: '0XGAROU',
    positions,
    today,
  });
  const png = await renderCalendarPng(result.model, 'IDR');
  const file = path.join(outDir, `${item.name}.png`);
  fs.writeFileSync(file, png);
  console.log(`${path.relative(config.root, file)}  ${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`);
  console.log(`  ${result.caption}`);
}
