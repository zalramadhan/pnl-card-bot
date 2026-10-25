import { describe, expect, it } from 'vitest';
import { NA, formatCloseDateTime, formatDuration, formatMcap, formatMoney, formatRoi } from '../src/card/format.js';

describe('formatMoney', () => {
  it('formats each supported currency', () => {
    expect(formatMoney(150, 'USD')).toBe('$150.00');
    expect(formatMoney(2_400_000, 'IDR')).toBe('Rp 2.400.000');
  });

  it('puts the sign before the currency and never shows -0', () => {
    expect(formatMoney(12.5, 'USD', 'always')).toBe('+$12.50');
    expect(formatMoney(-137_760, 'IDR', 'always')).toBe('-Rp 137.760');
    expect(formatMoney(-0.001, 'USD')).toBe('$0.00');
    expect(formatMoney(0, 'IDR', 'always')).toBe('Rp 0');
  });

  it('returns N/A for missing values', () => {
    expect(formatMoney(null, 'USD')).toBe(NA);
    expect(formatMoney(Number.NaN, 'IDR')).toBe(NA);
  });
});

describe('formatMcap', () => {
  it('uses K, M and B suffixes', () => {
    expect(formatMcap(999)).toBe('$999');
    expect(formatMcap(150_000)).toBe('$150K');
    expect(formatMcap(162_500)).toBe('$162.5K');
    expect(formatMcap(1_200_000)).toBe('$1.2M');
    expect(formatMcap(1_500_000_000)).toBe('$1.5B');
  });

  it('returns N/A when the MCAP is missing', () => {
    expect(formatMcap(null)).toBe(NA);
  });
});

describe('formatRoi', () => {
  it('shows two decimals with a sign', () => {
    expect(formatRoi(8.3333)).toBe('+8.33%');
    expect(formatRoi(-5.6)).toBe('-5.60%');
    expect(formatRoi(0)).toBe('0.00%');
  });

  it('returns N/A when the ROI is missing', () => {
    expect(formatRoi(null)).toBe(NA);
  });
});

describe('formatDuration', () => {
  it('keeps the two largest units', () => {
    expect(formatDuration(755)).toBe('12m 35s');
    expect(formatDuration(8_100)).toBe('2h 15m');
    expect(formatDuration(100_800)).toBe('1d 4h');
    expect(formatDuration(59)).toBe('59s');
    expect(formatDuration(0)).toBe('0s');
  });

  it('returns N/A for missing durations', () => {
    expect(formatDuration(null)).toBe(NA);
    expect(formatDuration(-1)).toBe(NA);
  });
});

describe('formatCloseDateTime', () => {
  it('formats in the requested timezone', () => {
    expect(formatCloseDateTime('2026-10-16T07:32:00.000Z', 'Asia/Jakarta')).toBe('16 Oct 2026 · 14:32');
    expect(formatCloseDateTime('2026-10-16T07:32:00.000Z', 'UTC')).toBe('16 Oct 2026 · 07:32');
  });

  it('returns N/A for unusable dates', () => {
    expect(formatCloseDateTime('not-a-date', 'UTC')).toBe(NA);
    expect(formatCloseDateTime(null, 'UTC')).toBe(NA);
  });
});

