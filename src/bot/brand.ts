export const MAX_BRAND_LENGTH = 16;

/**
 * Card brand text: uppercase, no leading @, letters/digits/space/._- only,
 * capped at 16 characters. Returns null when nothing usable is left.
 */
export function normalizeBrand(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw
    .replace(/^@+/, '')
    .replace(/[^A-Za-z0-9._ -]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_BRAND_LENGTH)
    .trim()
    .toUpperCase();
  return cleaned.length > 0 ? cleaned : null;
}

/** Brand used when the user has not set one: their Telegram name. */
export function defaultBrand(from: { username?: string; first_name?: string } | undefined): string {
  return normalizeBrand(from?.username) ?? normalizeBrand(from?.first_name) ?? '0XGAROU';
}
