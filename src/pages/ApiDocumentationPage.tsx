import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, Check } from 'lucide-react';

const endpoints = [
  { method: 'GET', path: '/api/v1/invoices', descKey: 'api.listInvoices' },
  { method: 'POST', path: '/api/v1/invoices', descKey: 'api.createInvoice' },
  { method: 'GET', path: '/api/v1/expenses', descKey: 'api.listExpenses' },
  { method: 'POST', path: '/api/v1/journal-entries', descKey: 'api.createJournalEntry' },
  { method: 'GET', path: '/api/v1/accounts', descKey: 'api.listChartOfAccounts' },
];

export function ApiDocumentationPage() {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const copySpec = () => {
    const spec = {
      openapi: '3.0.0',
      info: { title: 'Ledgr Public API', version: '1.0.0' },
      servers: [{ url: 'https://api.ledgr.app/v1' }],
      paths: {
        '/invoices': { get: {}, post: {} },
        '/expenses': { get: {}, post: {} },
        '/journal-entries': { post: {} },
      },
    };
    navigator.clipboard.writeText(JSON.stringify(spec, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="mx-auto max-w-4xl p-8">
      <h1 className="mb-2 text-3xl font-bold">{t('api.publicApi')}</h1>
      <p className="mb-8 text-gray-600">{t('api.publicApiSubtitle')}</p>

      <div className="mb-8">
        <h2 className="mb-4 text-xl font-semibold">{t('api.authentication')}</h2>
        <div className="rounded-lg bg-gray-50 p-4 text-sm">
          {t('api.authRequired')}
        </div>
      </div>

      <div className="mb-8">
        <h2 className="mb-4 text-xl font-semibold">{t('api.endpoints')}</h2>
        <div className="space-y-2">
          {endpoints.map((ep) => (
            <div key={`${ep.method}-${ep.path}`} className="flex items-center gap-4 rounded border p-3">
              <span className="rounded bg-gray-200 px-2 py-0.5 font-mono text-xs">{ep.method}</span>
              <code className="flex-1">{ep.path}</code>
              <span className="text-sm text-gray-600">{t(ep.descKey)}</span>
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xl font-semibold">{t('api.openApiSpec')}</h2>
          <button
            onClick={copySpec}
            className="flex items-center gap-2 rounded border px-3 py-1.5 text-sm hover:bg-gray-50"
          >
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copied ? t('api.copied') : t('api.copySwagger')}
          </button>
        </div>
        <p className="text-sm text-gray-500">{t('api.openApiAvailable')}</p>
      </div>
    </div>
  );
}
