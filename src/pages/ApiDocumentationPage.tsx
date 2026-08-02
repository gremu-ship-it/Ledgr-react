import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, Check, Download } from 'lucide-react';

const endpoints = [
  { method: 'GET', path: '/api/v1/invoices', desc: 'List all invoices' },
  { method: 'POST', path: '/api/v1/invoices', desc: 'Create a new invoice' },
  { method: 'GET', path: '/api/v1/expenses', desc: 'List all expenses' },
  { method: 'POST', path: '/api/v1/expenses', desc: 'Create a new expense' },
  { method: 'GET', path: '/api/v1/accounts', desc: 'List chart of accounts' },
  { method: 'GET', path: '/api/v1/journal-entries', desc: 'List journal entries' },
  { method: 'POST', path: '/api/v1/journal-entries', desc: 'Create journal entry' },
  { method: 'GET', path: '/api/v1/openapi.json', desc: 'OpenAPI 3.0 specification' },
];

function supabaseFunctionsBaseUrl(): string {
  const raw = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  if (raw) {
    try {
      return new URL('/functions/v1/api/api/v1', raw).toString().replace(/\/$/, '');
    } catch {
      // fall through to the production default below
    }
  }
  return 'https://hsuhuvuxfuufrlejsatw.supabase.co/functions/v1/api/api/v1';
}

function buildOpenApiSpec() {
  const paths: Record<string, unknown> = {};
  for (const endpoint of endpoints.filter((e) => !e.path.endsWith('openapi.json'))) {
    const path = endpoint.path.replace('/api/v1', '');
    paths[path] ??= {};
    (paths[path] as Record<string, unknown>)[endpoint.method.toLowerCase()] = {
      summary: endpoint.desc,
      security: [{ ApiKeyAuth: [] }],
      responses: {
        '200': { description: 'JSON:API success response' },
        '201': { description: 'JSON:API created response' },
        '401': { description: 'Unauthorized' },
        '429': { description: 'Rate limit exceeded' },
      },
    };
  }

  return {
    openapi: '3.0.0',
    info: {
      title: 'Ledgr Public API',
      version: '1.0.0',
      description: 'JSON:API REST API for integrating with Ledgr accounting platform (Malawi).',
    },
    servers: [{ url: supabaseFunctionsBaseUrl() }],
    components: {
      securitySchemes: {
        ApiKeyAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'ledgr_sk_*',
          description: 'Authorization: Bearer ledgr_sk_...',
        },
      },
    },
    paths,
  };
}

export function ApiDocumentationPage() {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const openApiSpec = buildOpenApiSpec();

  const copySpec = () => {
    navigator.clipboard.writeText(JSON.stringify(openApiSpec, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const downloadSpec = () => {
    const blob = new Blob([JSON.stringify(openApiSpec, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ledgr-openapi.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="mx-auto max-w-5xl p-8">
      <h1 className="mb-2 text-3xl font-bold">{t('api.publicApi')}</h1>
      <p className="mb-8 text-gray-600">{t('api.publicApiSubtitle')}</p>

      <div className="mb-8 rounded-2xl border bg-white p-6">
        <h2 className="mb-3 text-xl font-semibold">{t('api.authentication')}</h2>
        <div className="space-y-2 text-sm text-gray-600">
          <p>
            All requests require an <code className="bg-gray-100 px-1">Authorization: Bearer ledgr_sk_...</code> header.
            Generate API keys in <strong>Settings → API &amp; Webhooks</strong>.
          </p>
          <p>Responses follow JSON:API: resources are returned as <code className="bg-gray-100 px-1">data.type</code>, <code className="bg-gray-100 px-1">data.id</code>, and <code className="bg-gray-100 px-1">data.attributes</code>.</p>
          <p>Rate limit: <strong>100 requests per minute per API key</strong>.</p>
        </div>
      </div>

      <div className="mb-8">
        <h2 className="mb-4 text-xl font-semibold">{t('api.endpoints')}</h2>
        <div className="overflow-hidden rounded-2xl border bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th scope="col" className="px-4 py-3 text-left">Method</th>
                <th scope="col" className="px-4 py-3 text-left">Endpoint</th>
                <th scope="col" className="px-4 py-3 text-left">Description</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {endpoints.map((ep) => (
                <tr key={`${ep.method}-${ep.path}`}>
                  <td className="px-4 py-3">
                    <span className={`rounded px-2 py-0.5 font-mono text-xs ${ep.method === 'GET' ? 'bg-blue-100 text-blue-700' : 'bg-emerald-100 text-emerald-700'}`}>
                      {ep.method}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-sm">{ep.path}</td>
                  <td className="px-4 py-3 text-gray-600">{ep.desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xl font-semibold">{t('api.openApiSpec')}</h2>
          <div className="flex gap-2">
            <button onClick={copySpec} className="flex items-center gap-2 rounded border px-3 py-1.5 text-sm hover:bg-gray-50">
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copied ? t('api.copied') : t('api.copySwagger')}
            </button>
            <button onClick={downloadSpec} className="flex items-center gap-2 rounded bg-brand-600 px-3 py-1.5 text-sm text-white">
              <Download className="h-4 w-4" /> Download JSON
            </button>
          </div>
        </div>
        <p className="mb-4 text-sm text-gray-500">{t('api.openApiAvailable')}</p>

        <pre className="max-h-[400px] overflow-auto rounded-xl border bg-gray-900 p-4 text-xs text-emerald-400">
          {JSON.stringify(openApiSpec, null, 2)}
        </pre>
      </div>
    </div>
  );
}
