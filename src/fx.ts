import { config } from './config.js';

interface RateResponse {
  rates?: Record<string, unknown>;
}

/**
 * Reads the USD/IDR rate from a keyless FX endpoint. Called once when the
 * snapshot is created; the value is stored and never fetched again.
 */
export async function fetchUsdIdrRate(
  url: string = config.fxApiUrl,
  timeoutMs: number = config.fxTimeoutMs,
): Promise<number | null> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) return null;
    const body = (await response.json()) as RateResponse;
    const rate = body?.rates?.IDR;
    return typeof rate === 'number' && Number.isFinite(rate) && rate > 0 ? rate : null;
  } catch {
    return null;
  }
}
