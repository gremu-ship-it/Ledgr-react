/**
 * Thin client for the Frankfurter API (https://api.frankfurter.dev).
 *
 * IMPORTANT: Frankfurter is ECB-sourced and supports exactly 31 currencies.
 * It has NO data for MWK, ZMW, TZS, MZN, KES, or UGX on either side of any
 * pair. Callers must check currencies.is_frankfurter_supported for BOTH
 * the from and to currency before calling this client — see
 * exchangeRateService.getRate() for the routing logic. Calling this with
 * an unsupported currency will return a 404/error from the API.
 */

const FRANKFURTER_BASE_URL = 'https://api.frankfurter.dev/v1';

export class FrankfurterApiError extends Error {
  public readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'FrankfurterApiError';
    this.status = status;
  }
}

interface FrankfurterLatestResponse {
  amount: number;
  base: string;
  date: string;
  rates: Record<string, number>;
}

/**
 * Fetch the latest available rate for a single currency pair.
 * Frankfurter returns the most recent working day's rate if called on a
 * weekend/holiday — the returned `date` field reflects the actual rate date,
 * which may differ from today.
 */
export async function fetchLatestRate(
  fromCurrency: string,
  toCurrency: string,
): Promise<{ rate: number; rateDate: string }> {
  const url = `${FRANKFURTER_BASE_URL}/latest?base=${fromCurrency}&symbols=${toCurrency}`;

  let response: Response;
  try {
    response = await fetch(url);
  } catch (err) {
    throw new FrankfurterApiError(
      `Network error fetching rate ${fromCurrency}->${toCurrency}: ${(err as Error).message}`,
    );
  }

  if (!response.ok) {
    throw new FrankfurterApiError(
      `Frankfurter API returned ${response.status} for ${fromCurrency}->${toCurrency}`,
      response.status,
    );
  }

  const data = (await response.json()) as FrankfurterLatestResponse;
  const rate = data.rates[toCurrency];

  if (rate === undefined) {
    throw new FrankfurterApiError(
      `Frankfurter response did not include rate for ${toCurrency} (base ${fromCurrency})`,
    );
  }

  return { rate, rateDate: data.date };
}

/**
 * Fetch a historical rate for a specific date. If the date falls on a
 * weekend/holiday, Frankfurter returns the nearest prior working day's
 * rate — the returned `rateDate` reflects the actual date used.
 */
export async function fetchHistoricalRate(
  fromCurrency: string,
  toCurrency: string,
  date: string, // YYYY-MM-DD
): Promise<{ rate: number; rateDate: string }> {
  const url = `${FRANKFURTER_BASE_URL}/${date}?base=${fromCurrency}&symbols=${toCurrency}`;

  let response: Response;
  try {
    response = await fetch(url);
  } catch (err) {
    throw new FrankfurterApiError(
      `Network error fetching historical rate ${fromCurrency}->${toCurrency} on ${date}: ${(err as Error).message}`,
    );
  }

  if (!response.ok) {
    throw new FrankfurterApiError(
      `Frankfurter API returned ${response.status} for ${fromCurrency}->${toCurrency} on ${date}`,
      response.status,
    );
  }

  const data = (await response.json()) as FrankfurterLatestResponse;
  const rate = data.rates[toCurrency];

  if (rate === undefined) {
    throw new FrankfurterApiError(
      `Frankfurter response did not include rate for ${toCurrency} (base ${fromCurrency}) on ${date}`,
    );
  }

  return { rate, rateDate: data.date };
}