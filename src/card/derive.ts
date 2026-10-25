export interface DerivedPnl {
  netPnlUsd: number | null;
  roiPercent: number | null;
}

/**
 * Single source of truth for PnL: net = received - initial, ROI relative to
 * the invested capital. Called once when the snapshot is created; the card
 * never recalculates it.
 */
export function derivePnl(
  initialUsd: number | null | undefined,
  receivedUsd: number | null | undefined,
): DerivedPnl {
  if (
    initialUsd == null ||
    receivedUsd == null ||
    !Number.isFinite(initialUsd) ||
    !Number.isFinite(receivedUsd) ||
    initialUsd <= 0
  ) {
    return { netPnlUsd: null, roiPercent: null };
  }
  const netPnlUsd = receivedUsd - initialUsd;
  return { netPnlUsd, roiPercent: (netPnlUsd / initialUsd) * 100 };
}
