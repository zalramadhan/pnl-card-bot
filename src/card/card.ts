import { NA, formatCloseDateTime, formatDuration, formatMcap, formatMoney, formatRoi } from './format.js';
import type { Currency, PositionSnapshot } from './types.js';

export interface CardRow {
  label: string;
  value: string;
  /** True when the value is a placeholder, rendered muted. */
  muted: boolean;
}

export interface CardView {
  brand: string;
  subtitle: string;
  pair: string;
  subline: string;
  /** Hero PnL, e.g. `+Rp 205.000`. */
  pnlText: string;
  pnlState: 'profit' | 'loss' | 'missing';
  /** Shows the UNREALIZED label above the hero for positions still open. */
  showUnrealizedLabel: boolean;
  /** `+8.33% ROI · +$12.50`. */
  roiLine: string;
  tradeRows: CardRow[];
  setupRows: CardRow[];
  footer: string;
}

function validRate(rate: number | null): rate is number {
  return rate != null && Number.isFinite(rate) && rate > 0;
}

/**
 * Converts a USD amount into the card currency using only the rate stored in
 * the snapshot. Returns null when that rate was never captured.
 */
export function displayAmount(usd: number | null, snapshot: PositionSnapshot): number | null {
  if (usd == null || !Number.isFinite(usd)) return null;
  if (snapshot.currency === 'USD') return usd;
  return validRate(snapshot.usdIdrRate) ? usd * snapshot.usdIdrRate : null;
}

/** The other currency shown next to ROI, so the same number never appears twice. */
function secondaryValue(snapshot: PositionSnapshot, displayCurrency: Currency): string {
  const pnl = snapshot.netPnlUsd;
  if (pnl == null) return NA;
  if (displayCurrency === 'IDR') return formatMoney(pnl, 'USD', 'always');
  if (!validRate(snapshot.usdIdrRate)) return NA;
  return formatMoney(pnl * snapshot.usdIdrRate, 'IDR', 'always');
}

function valueRow(label: string, value: string, missing: boolean): CardRow {
  const isMissing = missing || value === NA;
  return { label, value: isMissing ? NA : value, muted: isMissing };
}

export function buildCardView(snapshot: PositionSnapshot, timeZone: string): CardView {
  const currency = snapshot.currency;
  const isOpen = snapshot.status === 'open';
  const pnl = snapshot.netPnlUsd;
  const shownPnl = displayAmount(pnl, snapshot);
  const pnlState: CardView['pnlState'] =
    pnl == null || !Number.isFinite(pnl) ? 'missing' : pnl >= 0 ? 'profit' : 'loss';

  const heroValue = pnlState === 'missing' ? NA : formatMoney(shownPnl, currency, 'always');
  const roi = snapshot.roiPercent;
  const roiText = roi == null ? NA : `${formatRoi(roi)} ROI`;

  const sublineParts = [snapshot.closeReason, snapshot.dex].filter(
    (part): part is string => typeof part === 'string' && part.trim().length > 0,
  );

  const tradeRows: CardRow[] = [
    valueRow('Entry MCAP', formatMcap(snapshot.entryMcapUsd), snapshot.entryMcapUsd == null),
  ];
  if (!isOpen) {
    tradeRows.push(valueRow('Exit MCAP', formatMcap(snapshot.exitMcapUsd), snapshot.exitMcapUsd == null));
  }
  tradeRows.push(
    valueRow('Initial', formatMoney(displayAmount(snapshot.initialUsd, snapshot), currency), snapshot.initialUsd == null),
    valueRow(
      'Received',
      formatMoney(displayAmount(snapshot.receivedUsd, snapshot), currency),
      snapshot.receivedUsd == null,
    ),
  );

  return {
    brand: snapshot.brand || '0XGAROU',
    subtitle: isOpen ? '— POSITION OPEN —' : '— POSITION CLOSED —',
    pair: snapshot.pair,
    subline: sublineParts.length > 0 ? sublineParts.join(' · ') : NA,
    pnlText: heroValue,
    pnlState,
    showUnrealizedLabel: isOpen && pnlState !== 'missing',
    roiLine: `${roiText} · ${secondaryValue(snapshot, currency)}`,
    tradeRows,
    setupRows: [
      valueRow('Duration', formatDuration(snapshot.durationSeconds), snapshot.durationSeconds == null),
      valueRow('Range', snapshot.range?.trim() || NA, !snapshot.range?.trim()),
      valueRow('Strategy', snapshot.strategy ?? NA, snapshot.strategy == null),
    ],
    footer: formatCloseDateTime(snapshot.closedAt, timeZone),
  };
}
