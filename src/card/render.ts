import { Resvg } from '@resvg/resvg-js';
import satori from 'satori';
import { config } from '../config.js';
import { buildCardView, type CardRow, type CardView } from './card.js';
import { loadFonts } from './fonts.js';
import type { PositionSnapshot } from './types.js';

export const CARD_WIDTH = 1080;
const PADDING_X = 76;
const PADDING_Y = 54;
const BORDER = 2;
const CONTENT_WIDTH = CARD_WIDTH - PADDING_X * 2 - BORDER * 2;

const COLORS = {
  background: '#FBFAF6',
  border: '#E5E2D8',
  ink: '#222222',
  muted: '#777777',
  footer: '#888888',
  divider: '#BBBBBB',
  profit: '#2E7D32',
  loss: '#C62828',
};

type Style = Record<string, string | number>;

interface El {
  type: string;
  props: { style: Style; children?: unknown };
}

function el(type: string, style: Style, ...children: unknown[]): El {
  const flat = children.flat() as unknown[];
  // satori rejects even an empty child array, so omit the key entirely.
  if (flat.length === 0) return { type, props: { style } };
  return { type, props: { style, children: flat.length === 1 ? flat[0] : flat } };
}

function text(content: string, style: Style): El {
  return el('div', style, content);
}

/** Explicit line boxes keep the card height deterministic. */
const LINE = {
  brand: 40,
  subtitle: 30,
  pair: 60,
  subline: 30,
  label: 26,
  roi: 50,
  row: 45,
  footer: 28,
};

const GAP = {
  subtitle: 16,
  pair: 44,
  pairSub: 12,
  hero: 40,
  label: 10,
  roi: 18,
  divider: 26,
  footer: 46,
};

const DIVIDER_HEIGHT = 3;
const HERO_MAX = 124;
const HERO_MIN = 64;
/** JetBrains Mono advance (~0.6em) minus the -0.05em tracking. */
const HERO_GLYPH_RATIO = 0.55;

function heroLineHeight(fontSize: number): number {
  return Math.round(fontSize * 1.08);
}

/** Largest font size at which the hero stays on one line inside the content width. */
export function heroFontSize(heroText: string): number {
  // Small safety margin so glyph rounding cannot push the hero past the edges.
  const fit = Math.floor((CONTENT_WIDTH - 16) / (Math.max(heroText.length, 1) * HERO_GLYPH_RATIO));
  return Math.max(HERO_MIN, Math.min(HERO_MAX, fit));
}

/** Card height = border + padding + every line box and gap, top to bottom. */
export function cardHeight(view: CardView): number {
  const heroFont = heroFontSize(view.pnlText);
  const labelBlock = view.showUnrealizedLabel ? LINE.label + GAP.label : 0;
  const rows = view.tradeRows.length + view.setupRows.length;
  return (
    BORDER * 2 +
    PADDING_Y * 2 +
    (LINE.brand + GAP.subtitle + LINE.subtitle) +
    (GAP.pair + LINE.pair + GAP.pairSub + LINE.subline) +
    (GAP.hero + labelBlock + heroLineHeight(heroFont) + GAP.roi + LINE.roi) +
    2 * (GAP.divider * 2 + DIVIDER_HEIGHT) +
    rows * LINE.row +
    (GAP.footer + LINE.footer)
  );
}

function dashedDivider(): El {
  const dashWidth = 12;
  const count = 38;
  return el(
    'div',
    {
      display: 'flex',
      justifyContent: 'space-between',
      width: '100%',
      height: DIVIDER_HEIGHT,
      marginTop: GAP.divider,
      marginBottom: GAP.divider,
    },
    Array.from({ length: count }, () => el('div', { width: dashWidth, height: DIVIDER_HEIGHT, background: COLORS.divider })),
  );
}

function row(item: CardRow): El {
  return el(
    'div',
    {
      display: 'flex',
      justifyContent: 'space-between',
      width: '100%',
      fontSize: 27,
      lineHeight: `${LINE.row}px`,
    },
    text(item.label, { color: COLORS.muted }),
    text(item.value, { color: item.muted ? COLORS.muted : COLORS.ink, fontWeight: 500 }),
  );
}

function rowGroup(items: CardRow[]): El {
  return el('div', { display: 'flex', flexDirection: 'column', width: '100%' }, items.map(row));
}

function pnlColor(view: CardView): string {
  if (view.pnlState === 'profit') return COLORS.profit;
  if (view.pnlState === 'loss') return COLORS.loss;
  return COLORS.muted;
}

export function cardTree(view: CardView): El {
  const accent = pnlColor(view);
  const heroFont = heroFontSize(view.pnlText);
  return el(
    'div',
    {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      width: CARD_WIDTH,
      height: cardHeight(view),
      background: COLORS.background,
      border: `${BORDER}px solid ${COLORS.border}`,
      borderRadius: 22,
      paddingTop: PADDING_Y,
      paddingBottom: PADDING_Y,
      paddingLeft: PADDING_X,
      paddingRight: PADDING_X,
      fontFamily: 'JetBrains Mono',
      color: COLORS.ink,
    },
    // ① Header
    el(
      'div',
      { display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%' },
      text(view.brand, {
        fontSize: 32,
        lineHeight: `${LINE.brand}px`,
        fontWeight: 700,
        letterSpacing: 9.6,
        color: COLORS.ink,
      }),
      text(view.subtitle, {
        fontSize: 22,
        lineHeight: `${LINE.subtitle}px`,
        letterSpacing: 3.08,
        color: COLORS.muted,
        marginTop: GAP.subtitle,
      }),
    ),
    // ② Pair block
    el(
      'div',
      { display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%', marginTop: GAP.pair },
      text(view.pair, {
        fontSize: 48,
        lineHeight: `${LINE.pair}px`,
        fontWeight: 700,
        color: COLORS.ink,
      }),
      text(view.subline, {
        fontSize: 22,
        lineHeight: `${LINE.subline}px`,
        color: COLORS.muted,
        marginTop: GAP.pairSub,
      }),
    ),
    // ③ Hero result
    el(
      'div',
      { display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%', marginTop: GAP.hero },
      ...(view.showUnrealizedLabel
        ? [
            text('UNREALIZED', {
              fontSize: 22,
              lineHeight: `${LINE.label}px`,
              letterSpacing: 4.4,
              color: COLORS.muted,
              marginBottom: GAP.label,
            }),
          ]
        : []),
      text(view.pnlText, {
        fontSize: heroFont,
        lineHeight: `${heroLineHeight(heroFont)}px`,
        fontWeight: 700,
        letterSpacing: -heroFont * 0.05,
        color: accent,
      }),
      text(view.roiLine, {
        fontSize: 39,
        lineHeight: `${LINE.roi}px`,
        fontWeight: 700,
        color: accent,
        marginTop: GAP.roi,
      }),
    ),
    // ④ Divider
    dashedDivider(),
    // ⑤ Trade rows
    rowGroup(view.tradeRows),
    // ⑥ Divider
    dashedDivider(),
    // ⑦ Setup rows
    rowGroup(view.setupRows),
    // ⑧ Footer (last element; there is no chart)
    text(view.footer, {
      fontSize: 20,
      lineHeight: `${LINE.footer}px`,
      color: COLORS.footer,
      marginTop: GAP.footer,
    }),
  );
}

export function renderCardSvg(snapshot: PositionSnapshot, options: { timeZone?: string } = {}): Promise<string> {
  const view = buildCardView(snapshot, options.timeZone ?? config.timeZone);
  return satori(cardTree(view) as never, {
    width: CARD_WIDTH,
    height: cardHeight(view),
    fonts: loadFonts(),
  });
}

/** Renders a snapshot into a PNG with transparent rounded corners. */
export async function renderCardPng(
  snapshot: PositionSnapshot,
  options: { timeZone?: string } = {},
): Promise<Buffer> {
  const svg = await renderCardSvg(snapshot, options);
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: CARD_WIDTH },
    background: 'rgba(0,0,0,0)',
  });
  return Buffer.from(resvg.render().asPng());
}

export { CONTENT_WIDTH, COLORS };
