export type Currency = 'USD' | 'IDR';

export type Strategy = 'Spot' | 'Bid/Ask' | 'Curve';

/** Which side of the entry price the LP range sits on. */
export type TokenSide = 'Token' | 'Dual' | 'USDG' | 'SOL';

export type PositionStatus = 'closed' | 'open';

/**
 * Immutable record of a position. Every field the card renders is captured
 * here once, when the card is created, and never recomputed.
 */
export interface PositionSnapshot {
  id: string;
  /** Text branding at the top of the card (user name or 0XGAROU). */
  brand: string;
  pair: string;
  closeReason: string | null;
  dex: string | null;
  status: PositionStatus;
  entryMcapUsd: number | null;
  exitMcapUsd: number | null;
  initialUsd: number | null;
  receivedUsd: number | null;
  durationSeconds: number | null;
  /** Shown exactly as stored: `+10%`, `-30%`, `+20% to -20%`. */
  range: string | null;
  side: TokenSide | null;
  strategy: Strategy | null;
  openedAt: string;
  closedAt: string;
  currency: Currency;
  /** USD/IDR rate captured when the card was created; null when unavailable. */
  usdIdrRate: number | null;
  /** Net PnL in USD: realized when closed, unrealized when still open. */
  netPnlUsd: number | null;
  roiPercent: number | null;
  createdAt: string;
  telegramUserId: string | null;
}
