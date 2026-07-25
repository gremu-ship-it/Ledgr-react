import { useTranslation } from 'react-i18next';

export function ZapierIntegrationPage() {
  const { t } = useTranslation();

  return (
    <div className="mx-auto max-w-3xl p-8">
      <h1 className="mb-4 text-3xl font-bold">{t('api.zapierIntegration')}</h1>
      <p className="mb-8 text-gray-600">
        {t('api.zapierSubtitle')}
      </p>

      <div className="rounded-2xl border bg-white p-8">
        <h3 className="mb-4 font-semibold">{t('api.availableTriggers')}</h3>
        <ul className="mb-8 list-disc space-y-1 ps-5 text-sm">
          <li>{t('api.newInvoice')}</li>
          <li>{t('api.newExpense')}</li>
          <li>{t('api.invoicePaid')}</li>
        </ul>

        <h3 className="mb-4 font-semibold">{t('api.availableActions')}</h3>
        <ul className="mb-8 list-disc space-y-1 ps-5 text-sm">
          <li>{t('api.createInvoice')}</li>
          <li>{t('api.recordExpense')}</li>
        </ul>

        <div className="text-center">
          <a
            href="https://zapier.com/developer"
            target="_blank"
            rel="noreferrer"
            className="inline-block rounded-lg bg-black px-6 py-3 text-sm font-medium text-white"
          >
            {t('api.submitToZapier')}
          </a>
          <p className="mt-4 text-xs text-gray-500">{t('api.zapierEarlyAccess')}</p>
        </div>
      </div>
    </div>
  );
}
