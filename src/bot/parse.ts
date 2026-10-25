/** `150`, `$162.50`, `150K`, `1.2M` -> number. `null` when unparseable. */
export function parseAmount(raw: string): number | null {
  const clean = raw.trim().replace(/[$,_\s]/g, '').replace(/^\+/, '');
  const match = /^(-?\d+(?:\.\d+)?)([kmb])?$/i.exec(clean);
  if (!match) return null;
  const value = Number(match[1]);
  const suffix = (match[2] ?? '').toLowerCase();
  const multiplier = suffix === 'k' ? 1_000 : suffix === 'm' ? 1_000_000 : suffix === 'b' ? 1_000_000_000 : 1;
  const result = value * multiplier;
  return Number.isFinite(result) ? result : null;
}

/** `12m 35s`, `2h 15m`, `1d 4h`, or plain seconds. `null` when unparseable. */
export function parseDuration(raw: string): number | null {
  const text = raw.trim().toLowerCase();
  if (!text) return null;
  if (/^\d+$/.test(text)) return Number(text);
  const unitSeconds: Record<string, number> = { d: 86_400, h: 3_600, m: 60, s: 1 };
  const pattern = /(\d+)\s*(d|h|m|s)/g;
  let total = 0;
  let found = false;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    found = true;
    total += Number(match[1]) * unitSeconds[match[2] ?? 's'];
  }
  return found ? total : null;
}

/** `ftr / sol` -> `FTR/SOL`; null when it is not a pair. */
export function normalizePair(raw: string): string | null {
  const compact = raw.trim().replace(/\s+/g, '');
  if (!/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(compact)) return null;
  return compact.toUpperCase();
}

/**
 * Custom range typed by the user: `+15%`, `-10% to -20%`, `10 to 20`
 * (missing percent signs are added). Returns null when it is not a range.
 */
export function normalizeRange(raw: string): string | null {
  const text = raw
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\s*[–—]\s*/g, ' to ')
    .replace(/\s*to\s*/gi, ' to ')
    .trim();
  if (!text) return null;

  const withPercent = (part: string) => {
    const value = part.trim();
    return /^[+-]?\d+(?:\.\d+)?$/.test(value) ? `${value}%` : value;
  };
  const sides = text.split(/ to /i);
  if (sides.length > 2) return null;
  const normalized =
    sides.length === 2
      ? `${withPercent(sides[0] ?? '')} to ${withPercent(sides[1] ?? '')}`
      : withPercent(text);

  if (normalized.length > 32) return null;
  if (!/\d/.test(normalized) || !normalized.includes('%')) return null;
  return normalized;
}

/** `-` or empty means "not available"; otherwise the trimmed text. */
export function optionalText(raw: string): string | null {
  const value = raw.trim().replace(/\s+/g, ' ');
  if (!value || value === '-') return null;
  return value;
}
