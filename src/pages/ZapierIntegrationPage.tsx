export function ZapierIntegrationPage() {
  return (
    <div className="max-w-3xl mx-auto p-8">
      <h1 className="text-3xl font-bold mb-4">Zapier Integration</h1>
      <p className="text-gray-600 mb-8">
        Connect Ledgr to 7,000+ apps using Zapier. This integration is currently in beta.
      </p>

      <div className="bg-white border rounded-2xl p-8">
        <h3 className="font-semibold mb-4">Available Triggers</h3>
        <ul className="list-disc pl-5 space-y-1 text-sm mb-8">
          <li>New Invoice</li>
          <li>New Expense</li>
          <li>Invoice Paid</li>
        </ul>

        <h3 className="font-semibold mb-4">Available Actions</h3>
        <ul className="list-disc pl-5 space-y-1 text-sm mb-8">
          <li>Create Invoice</li>
          <li>Record Expense</li>
        </ul>

        <div className="text-center">
          <a
            href="https://zapier.com/developer"
            target="_blank"
            className="inline-block bg-black text-white px-6 py-3 rounded-lg text-sm font-medium"
          >
            Submit to Zapier Developer Platform →
          </a>
          <p className="mt-4 text-xs text-gray-500">Contact support@ledgr.app for early access</p>
        </div>
      </div>
    </div>
  );
}