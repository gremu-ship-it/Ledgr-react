import { useState } from 'react';
import { Copy, Check } from 'lucide-react';

const endpoints = [
  { method: 'GET', path: '/api/v1/invoices', desc: 'List invoices' },
  { method: 'POST', path: '/api/v1/invoices', desc: 'Create invoice' },
  { method: 'GET', path: '/api/v1/expenses', desc: 'List expenses' },
  { method: 'POST', path: '/api/v1/journal-entries', desc: 'Create journal entry' },
  { method: 'GET', path: '/api/v1/accounts', desc: 'List chart of accounts' },
];

export function ApiDocumentationPage() {
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
    <div className="max-w-4xl mx-auto p-8">
      <h1 className="text-3xl font-bold mb-2">Ledgr Public API</h1>
      <p className="text-gray-600 mb-8">REST API + Webhooks for third-party integrations</p>

      <div className="mb-8">
        <h2 className="text-xl font-semibold mb-4">Authentication</h2>
        <div className="bg-gray-50 p-4 rounded-lg text-sm">
          All requests require an <code>Authorization: Bearer ledgr_sk_...</code> header.
        </div>
      </div>

      <div className="mb-8">
        <h2 className="text-xl font-semibold mb-4">Endpoints</h2>
        <div className="space-y-2">
          {endpoints.map((ep, i) => (
            <div key={i} className="flex items-center gap-4 p-3 border rounded">
              <span className="font-mono text-xs px-2 py-0.5 bg-gray-200 rounded">{ep.method}</span>
              <code className="flex-1">{ep.path}</code>
              <span className="text-sm text-gray-600">{ep.desc}</span>
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xl font-semibold">OpenAPI Spec</h2>
          <button
            onClick={copySpec}
            className="flex items-center gap-2 text-sm px-3 py-1.5 border rounded hover:bg-gray-50"
          >
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copied ? 'Copied!' : 'Copy swagger.json'}
          </button>
        </div>
        <p className="text-sm text-gray-500">
          Full OpenAPI 3.0 specification is available at <code>/api/v1/openapi.json</code>
        </p>
      </div>
    </div>
  );
}