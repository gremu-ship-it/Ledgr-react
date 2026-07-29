import { Link } from 'react-router-dom';

const effectiveDate = '29 July 2026';

export function TermsAndConditionsPage() {
  return (
    <main className="min-h-screen bg-gray-50 px-4 py-10 sm:py-16">
      <article className="mx-auto max-w-3xl rounded-2xl border border-gray-200 bg-white p-6 shadow-soft sm:p-10">
        <Link to="/login" className="text-sm font-medium text-brand-600 hover:text-brand-700">
          ← Back to Ledgr
        </Link>
        <h1 className="mt-6 text-3xl font-bold tracking-tight text-gray-900">Terms and Conditions</h1>
        <p className="mt-2 text-sm text-gray-500">Effective date: {effectiveDate}</p>

        <div className="mt-8 space-y-7 text-sm leading-6 text-gray-700">
          <section>
            <h2 className="text-lg font-semibold text-gray-900">1. Acceptance of these terms</h2>
            <p className="mt-2">These Terms and Conditions govern your use of Ledgr and the business account you create. By ticking the acceptance box when creating a business, you confirm that you have read, understood and agree to be bound by these terms on your own behalf and, where applicable, on behalf of that business.</p>
          </section>
          <section>
            <h2 className="text-lg font-semibold text-gray-900">2. Your account and business information</h2>
            <p className="mt-2">You must provide accurate, current and complete information, keep your credentials secure, and promptly update information that changes. You are responsible for activity carried out through your account and for ensuring that people you authorise to access your business use Ledgr appropriately.</p>
          </section>
          <section>
            <h2 className="text-lg font-semibold text-gray-900">3. Use of the service</h2>
            <p className="mt-2">You may use Ledgr only for lawful business purposes and in accordance with these terms. You must not misuse the service, interfere with its operation, attempt unauthorised access, upload unlawful content, or use the service in a way that infringes another person&apos;s rights.</p>
          </section>
          <section>
            <h2 className="text-lg font-semibold text-gray-900">4. Financial records and compliance</h2>
            <p className="mt-2">Ledgr provides tools to help organise financial information; it does not provide legal, tax, accounting, investment or financial advice. You remain responsible for reviewing your records, filing returns, paying taxes, and meeting all legal and regulatory obligations that apply to your business.</p>
          </section>
          <section>
            <h2 className="text-lg font-semibold text-gray-900">5. Data and privacy</h2>
            <p className="mt-2">You retain responsibility for the data you enter into Ledgr. You confirm that you have the right to provide that data and to invite users to your business. We will handle personal information in accordance with applicable law and our privacy practices.</p>
          </section>
          <section>
            <h2 className="text-lg font-semibold text-gray-900">6. Availability and changes</h2>
            <p className="mt-2">We aim to keep Ledgr available and secure, but the service may occasionally be unavailable for maintenance, updates or events outside our control. We may update the service or these terms from time to time. Continued use after an updated effective date constitutes acceptance of the updated terms where permitted by law.</p>
          </section>
          <section>
            <h2 className="text-lg font-semibold text-gray-900">7. Suspension or termination</h2>
            <p className="mt-2">We may suspend or terminate access where reasonably necessary to protect the service, comply with law, or address a breach of these terms. You may stop using Ledgr at any time, subject to any applicable subscription or data-retention obligations.</p>
          </section>
          <section>
            <h2 className="text-lg font-semibold text-gray-900">8. Contact</h2>
            <p className="mt-2">If you have a question about these terms, please contact Ledgr support before creating your business account.</p>
          </section>
        </div>
      </article>
    </main>
  );
}
