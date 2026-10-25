import { describe, expect, it } from 'vitest';
import { normalizePair, normalizeRange, optionalText, parseAmount, parseDuration } from '../src/bot/parse.js';

describe('parseAmount', () => {
  it('accepts plain numbers, currency signs and suffixes', () => {
    expect(parseAmount('150')).toBe(150);
    expect(parseAmount('$162.50')).toBe(162.5);
    expect(parseAmount('150K')).toBe(150_000);
    expect(parseAmount('1.2m')).toBe(1_200_000);
    expect(parseAmount('2B')).toBe(2_000_000_000);
    expect(parseAmount(' 1,500 ')).toBe(1500);
  });

  it('rejects junk', () => {
    expect(parseAmount('abc')).toBeNull();
    expect(parseAmount('')).toBeNull();
    expect(parseAmount('12abc')).toBeNull();
  });
});

describe('parseDuration', () => {
  it('converts unit strings to seconds', () => {
    expect(parseDuration('12m 35s')).toBe(755);
    expect(parseDuration('2h 15m')).toBe(8_100);
    expect(parseDuration('1d 4h')).toBe(100_800);
    expect(parseDuration('1d 2h 3m 4s')).toBe(93_784);
  });

  it('treats a bare number as seconds', () => {
    expect(parseDuration('90')).toBe(90);
  });

  it('rejects junk', () => {
    expect(parseDuration('dua jam')).toBeNull();
  });
});

describe('normalizePair', () => {
  it('uppercases and strips spaces', () => {
    expect(normalizePair(' ftr / sol ')).toBe('FTR/SOL');
  });

  it('rejects non pairs', () => {
    expect(normalizePair('FTRSOL')).toBeNull();
    expect(normalizePair('A/B/C')).toBeNull();
  });
});

describe('normalizeRange', () => {
  it('accepts a single bound or a two-sided range', () => {
    expect(normalizeRange('+15%')).toBe('+15%');
    expect(normalizeRange('-5%')).toBe('-5%');
    expect(normalizeRange('-10% to -20%')).toBe('-10% to -20%');
    expect(normalizeRange('  -5%   to   -15%  ')).toBe('-5% to -15%');
    expect(normalizeRange('-20% – -30%')).toBe('-20% to -30%');
    expect(normalizeRange('-10%to-20%')).toBe('-10% to -20%');
  });

  it('adds missing percent signs', () => {
    expect(normalizeRange('-10 to -20')).toBe('-10% to -20%');
    expect(normalizeRange('25')).toBe('25%');
  });

  it('rejects junk and overly long input', () => {
    expect(normalizeRange('wide')).toBeNull();
    expect(normalizeRange('')).toBeNull();
    expect(normalizeRange('-10% to -20% to -30%')).toBeNull();
    expect(normalizeRange(`${'1'.repeat(40)}%`)).toBeNull();
  });
});

describe('optional values', () => {
  it('treats a dash as empty', () => {
    expect(optionalText('-')).toBeNull();
    expect(optionalText('  ')).toBeNull();
    expect(optionalText('Meteora  DLMM')).toBe('Meteora DLMM');
  });
});
