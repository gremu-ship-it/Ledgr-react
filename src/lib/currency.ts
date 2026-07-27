import { supabase } from '@/lib/supabase';
import { ExchangeRateService, type RateResult } from '@/services/exchangeRateService';

export const PRIMARY_CURRENCIES = ['MWK', 'ZMW', 'TZS', 'MZN', 'USD', 'EUR', 'GBP', 'ZAR'] as const;

export const exchangeRateService = new ExchangeRateService(supabase);

export function normalizeCurrency(code: string | null | undefined, fallback = 'MWK'): string {
  return (code || fallback).trim().toUpperCase();
}

export function formatCurrencyAmount(amount: number, currency = 'MWK'): string {
  return new Intl.NumberFormat('en-MW', {
    style: 'currency',
    currency,
    currencyDisplay: currency === 'MWK' ? 'code' : 'symbol',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(amount) ? amount : 0);
}

export async function resolveTransactionRate(params: {
  businessId: string;
  originalCurrency: string;
  functionalCurrency: string;
  date: string;
  manualRate?: number | null;
  userId?: string | null;
}): Promise<RateResult> {
  const originalCurrency = normalizeCurrency(params.originalCurrency, params.functionalCurrency);
  const functionalCurrency = normalizeCurrency(params.functionalCurrency);

  if (originalCurrency === functionalCurrency) {
    return { rate: 1, rateDate: params.date, isStale: false, source: 'identity' };
  }

  if (params.manualRate && Number.isFinite(params.manualRate) && params.manualRate > 0) {
    const storedRate = await exchangeRateService.recordManualRate(
      params.businessId,
      originalCurrency,
      functionalCurrency,
      params.manualRate,
      params.date,
      params.userId ?? null,
    );
    return {
      rate: Number(storedRate.rate),
      rateDate: storedRate.rate_date,
      isStale: false,
      source: storedRate.source === 'frankfurter' ? 'frankfurter' : 'manual',
    };
  }

  return exchangeRateService.getRate(params.businessId, originalCurrency, functionalCurrency, params.date);
}
