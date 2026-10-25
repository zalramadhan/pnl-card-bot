import { describe, expect, it } from 'vitest';
import { buildCardView, displayAmount } from '../src/card/card.js';
import { NA } from '../src/card/format.js';
import { sampleSnapshot } from '../src/sample.js';

const TZ = 'Asia/Jakarta';

describe('IDR card', () => {
  const view = buildCardView(sampleSnapshot(), TZ);

  it('shows the hero in Rupiah with a sign', () => {
    // $12.50 * 16.400 = Rp 205.000
    expect(view.pnlText).toBe('+Rp 205.000');
    expect(view.pnlState).toBe('profit');
    expect(view.showUnrealizedLabel).toBe(false);
  });

  it('puts ROI and the USD equivalent on one line', () => {
    expect(view.roiLine).toBe('+8.33% ROI · +$12.50');
  });

  it('lists closed trade rows without Exit Price or Fees & Gas', () => {
    expect(view.tradeRows.map((row) => row.label)).toEqual(['Entry MCAP', 'Exit MCAP', 'Initial', 'Received']);
    expect(view.tradeRows[2]?.value).toBe('Rp 2.460.000');
    expect(view.tradeRows[3]?.value).toBe('Rp 2.665.000');
  });

  it('does not expose fees, gas, prices, contracts or a chart', () => {
    const serialized = JSON.stringify(view).toLowerCase();
    expect(serialized).not.toContain('fee');
    expect(serialized).not.toContain('gas');
    expect(serialized).not.toContain('entry price');
    expect(serialized).not.toContain('exit price');
    expect(serialized).not.toContain('chart');
    expect(serialized).not.toContain('contract');
  });

  it('keeps the setup rows in order', () => {
    expect(view.setupRows.map((row) => row.label)).toEqual(['Duration', 'Range', 'Strategy']);
    expect(view.setupRows.map((row) => row.value)).toEqual(['12m 35s', '+10%', 'Spot']);
  });

  it('shows only the close date in the footer', () => {
    expect(view.footer).toBe('16 Oct 2026 · 14:32');
  });
});

describe('brand', () => {
  it('uses the name stored in the snapshot', () => {
    expect(buildCardView(sampleSnapshot({ brand: 'BUDI' }), TZ).brand).toBe('BUDI');
  });
});

describe('open position', () => {
  const view = buildCardView(
    sampleSnapshot({ status: 'open', entryMcapUsd: 150_000, exitMcapUsd: null }),
    TZ,
  );

  it('shows POSITION OPEN and an UNREALIZED label', () => {
    expect(view.subtitle).toBe('— POSITION OPEN —');
    expect(view.showUnrealizedLabel).toBe(true);
  });

  it('hides the Exit MCAP row but keeps the rest', () => {
    expect(view.tradeRows.map((row) => row.label)).toEqual(['Entry MCAP', 'Initial', 'Received']);
    expect(view.setupRows.map((row) => row.label)).toEqual(['Duration', 'Range', 'Strategy']);
  });
});

describe('USD card', () => {
  const view = buildCardView(sampleSnapshot({ currency: 'USD' }), TZ);

  it('shows the hero in USD and Rupiah beside the ROI', () => {
    expect(view.pnlText).toBe('+$12.50');
    expect(view.roiLine).toBe('+8.33% ROI · +Rp 205.000');
    expect(view.tradeRows[2]?.value).toBe('$150.00');
  });
});

describe('missing data', () => {
  it('shows N/A when the stored rate is missing', () => {
    const view = buildCardView(sampleSnapshot({ currency: 'IDR', usdIdrRate: null }), TZ);
    expect(view.pnlText).toBe(NA);
    expect(view.roiLine).toBe('+8.33% ROI · +$12.50');
  });

  it('shows N/A for missing MCAP, range and duration', () => {
    const view = buildCardView(
      sampleSnapshot({
        entryMcapUsd: null,
        exitMcapUsd: null,
        durationSeconds: null,
        range: null,
        dex: null,
      }),
      TZ,
    );
    expect(view.tradeRows[0]?.value).toBe(NA);
    expect(view.tradeRows[0]?.muted).toBe(true);
    expect(view.setupRows[0]?.value).toBe(NA);
    expect(view.setupRows[1]?.value).toBe(NA);
    expect(view.subline).toBe('Auto TP');
  });

  it('never converts with a missing rate', () => {
    expect(displayAmount(100, sampleSnapshot({ usdIdrRate: null }))).toBeNull();
    expect(displayAmount(100, sampleSnapshot({ currency: 'USD' }))).toBe(100);
  });
});

describe('loss state', () => {
  const view = buildCardView(
    sampleSnapshot({ initialUsd: 150, receivedUsd: 141.6, currency: 'IDR' }),
    TZ,
  );

  it('uses negative values and the same layout', () => {
    expect(view.pnlState).toBe('loss');
    expect(view.pnlText).toBe('-Rp 137.760');
    expect(view.roiLine).toBe('-5.60% ROI · -$8.40');
  });
});

describe('strategy variants', () => {
  it.each(['Spot', 'Bid/Ask', 'Curve'] as const)('renders %s', (strategy) => {
    const view = buildCardView(sampleSnapshot({ strategy }), TZ);
    expect(view.setupRows[2]?.value).toBe(strategy);
  });
});

describe('range variants', () => {
  it.each(['+10%', '-20%', '+20% to -20%'])('renders %s as stored', (range) => {
    const view = buildCardView(sampleSnapshot({ range }), TZ);
    expect(view.setupRows[1]?.value).toBe(range);
  });
});
