import { derivePnl } from './card/derive.js';
import type { PositionSnapshot } from './card/types.js';

/** Illustrative closed position with profit, used for /demo and the demo script. */
export function sampleSnapshot(overrides: Partial<PositionSnapshot> = {}): PositionSnapshot {
  const base: PositionSnapshot = {
    id: 'sample',
    brand: '0XGAROU',
    pair: 'FTR/SOL',
    closeReason: 'Auto TP',
    dex: 'Meteora',
    status: 'closed',
    entryMcapUsd: 150_000,
    exitMcapUsd: 162_500,
    initialUsd: 150,
    receivedUsd: 162.5,
    durationSeconds: 755,
    range: '+10%',
    side: 'Token',
    strategy: 'Spot',
    openedAt: '2026-10-16T07:19:25.000Z',
    closedAt: '2026-10-16T07:32:00.000Z',
    currency: 'IDR',
    usdIdrRate: 16_400,
    netPnlUsd: null,
    roiPercent: null,
    createdAt: '2026-10-16T07:32:00.000Z',
    telegramUserId: null,
  };
  const merged = { ...base, ...overrides };
  return { ...merged, ...derivePnl(merged.initialUsd, merged.receivedUsd) };
}
