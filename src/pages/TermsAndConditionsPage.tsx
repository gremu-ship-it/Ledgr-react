import { Link } from 'react-router-dom';

const effectiveDate = '29 July 2026';
const termsVersion = 'Version 1.1';

export function TermsAndConditionsPage() {
  return (
    <main className="min-h-screen bg-gray-50 px-4 py-10 sm:py-16">
      <article className="mx-auto max-w-3xl rounded-2xl border border-gray-200 bg-white p-6 shadow-soft sm:p-10">
        <Link to="/login" className="text-sm font-medium text-brand-600 hover:text-brand-700">
          ← Back to Ledgr
        </Link>
        <h1 className="mt-6 text-3xl font-bold tracking-tight text-gray-900">Terms and Conditions</h1>
        <p className="mt-2 text-sm text-gray-500">{termsVersion} · Effective date: {effectiveDate}</p>

        <div className="mt-8 space-y-7 text-sm leading-6 text-gray-700">
          <section>
            <h2 className="text-lg font-semibold text-gray-900">1. Acceptance of these terms</h2>
            <p className="mt-2">These Terms and Conditions govern your use of Ledgr and the business account you create. By ticking the acceptance box when creating a business, you confirm that you have read, understood and agree to be bound by these terms on your own behalf and, where applicable, on behalf of that business. You also confirm that you have authority to accept these terms for that business.</p>
          </section>
          <section>
            <h2 className="text-lg font-semibold text-gray-900">2. Your account and business information</h2>
            <p className="mt-2">You must provide accurate, current and complete information, keep your credentials secure, and promptly update information that changes. You are responsible for activity carried out through your account and for ensuring that people you authorise to access your business use Ledgr appropriately. You must notify us promptly if you suspect unauthorised access to your account.</p>
          </section>
          <section>
            <h2 className="text-lg font-semibold text-gray-900">3. Use of the service</h2>
            <p className="mt-2">You may use Ledgr only for lawful business purposes and in accordance with these terms. You must not misuse the service, interfere with its operation, attempt unauthorised access, introduce malicious code, scrape or copy the service, resell access without our permission, or use the service in a way that infringes another person&apos;s rights.</p>
            <p className="mt-2">You must not use Ledgr to facilitate fraud, money laundering, terrorist financing, tax evasion, or any other unlawful activity. We may investigate suspected misuse and suspend access as necessary to protect users, the service, or comply with law.</p>
          </section>
          <section>
            <h2 className="text-lg font-semibold text-gray-900">4. Financial records and compliance</h2>
            <p className="mt-2">Ledgr provides tools to help organise financial information; it does not provide legal, tax, accounting, investment or financial advice. You remain responsible for reviewing your records, filing returns, paying taxes, and meeting all legal and regulatory obligations that apply to your business.</p>
          </section>
          <section>
            <h2 className="text-lg font-semibold text-gray-900">5. Your data, privacy and confidentiality</h2>
            <p className="mt-2">You retain your rights in the data that you enter into Ledgr. You grant us the limited rights needed to host, process, back up and display that data in order to provide, secure and improve the service. You confirm that you have the right to provide that data and to invite users to your business.</p>
            <p className="mt-2">We will use reasonable technical and organisational measures designed to protect your data and will handle personal information in accordance with applicable law and our privacy practices. You acknowledge that no internet-based service can guarantee absolute security. Each party must protect the other party&apos;s confidential information and use it only as needed to use or provide Ledgr, except where disclosure is required by law.</p>
            <p className="mt-2">You may export data using the features available in Ledgr while your account is active. Following cancellation or termination, data may be retained for a limited period for backup, legal, security, tax or compliance purposes before deletion or anonymisation, subject to applicable law.</p>
          </section>
          <section>
            <h2 className="text-lg font-semibold text-gray-900">6. Subscriptions, payment and refunds</h2>
            <p className="mt-2">Paid plans, fees, billing intervals and included features are presented when you select a plan. You authorise us and our payment providers to collect applicable charges and taxes using your chosen payment method. Subscriptions renew at the end of each billing period unless cancelled before renewal.</p>
            <p className="mt-2">We may change fees or plans on reasonable prior notice. If a payment fails, we may restrict paid features or suspend the account until payment is received. Except where required by law or expressly stated otherwise, fees already paid are non-refundable. You may cancel a subscription at any time; cancellation takes effect at the end of the current paid billing period.</p>
          </section>
          <section>
            <h2 className="text-lg font-semibold text-gray-900">7. Third-party services</h2>
            <p className="mt-2">Ledgr may work with third-party services, including payment providers, banks, email providers, cloud infrastructure providers and integrations. Their services may be subject to separate terms and privacy policies. We are not responsible for third-party services, their availability, their acts or omissions, or information you choose to share with them.</p>
          </section>
          <section>
            <h2 className="text-lg font-semibold text-gray-900">8. Availability and changes</h2>
            <p className="mt-2">We aim to keep Ledgr available and secure, but the service may occasionally be unavailable for maintenance, updates or events outside our control. We may update, modify or discontinue features where reasonably necessary. We do not guarantee that the service will be uninterrupted, error-free or suitable for every purpose.</p>
          </section>
          <section>
            <h2 className="text-lg font-semibold text-gray-900">9. Service provider liability</h2>
            <p className="mt-2">To the fullest extent permitted by applicable law, Ledgr and its service providers are not liable for indirect, incidental, special, consequential or punitive losses, including lost profits, revenue, data, goodwill or business opportunities, arising from your use of, or inability to use, the service.</p>
            <p className="mt-2">Ledgr is not responsible for losses caused by inaccurate information entered by you or your users, unauthorised access resulting from a failure to protect your account credentials, decisions you make using information in the service, or services, systems or networks operated by third parties. Nothing in these terms excludes or limits liability that cannot legally be excluded or limited, including liability for fraud or fraudulent misrepresentation.</p>
            <p className="mt-2">Where Ledgr is found liable for a claim relating to the service, its total liability will be limited to the amount you paid to Ledgr for the service during the 12 months immediately before the event giving rise to that claim, unless applicable law requires a higher amount.</p>
          </section>
          <section>
            <h2 className="text-lg font-semibold text-gray-900">10. Indemnity</h2>
            <p className="mt-2">To the extent permitted by law, you will indemnify and hold Ledgr, its service providers and their personnel harmless from claims, losses, liabilities, costs and expenses arising from your data, your unlawful use of Ledgr, or your breach of these terms. This does not apply to the extent a claim is caused by Ledgr&apos;s own breach, negligence or wilful misconduct.</p>
          </section>
          <section>
            <h2 className="text-lg font-semibold text-gray-900">11. Suspension or termination</h2>
            <p className="mt-2">We may suspend or terminate access where reasonably necessary to protect the service, comply with law, address a breach of these terms, or where fees remain unpaid. You may stop using Ledgr at any time, subject to any applicable subscription, billing or data-retention obligations. Sections that should reasonably continue after termination, including those on data, liability, indemnity and governing law, will survive termination.</p>
          </section>
          <section>
            <h2 className="text-lg font-semibold text-gray-900">12. Events outside reasonable control</h2>
            <p className="mt-2">Neither party is responsible for a delay or failure to perform obligations caused by events beyond its reasonable control, including natural disasters, acts of government, war, civil unrest, labour disputes, power or telecommunications failures, or widespread internet outages. This does not remove your obligation to pay charges already due.</p>
          </section>
          <section>
            <h2 className="text-lg font-semibold text-gray-900">13. Changes to these terms</h2>
            <p className="mt-2">We may update these terms from time to time. For material changes, we will provide reasonable notice through Ledgr, by email, or by another appropriate method. The updated terms will state a new effective date. Continued use after that date constitutes acceptance where permitted by law; if you do not agree, you must stop using the service and may cancel your account before the changes take effect.</p>
          </section>
          <section>
            <h2 className="text-lg font-semibold text-gray-900">14. Governing law and disputes</h2>
            <p className="mt-2">These terms are governed by the laws of Malawi. Before starting formal proceedings, each party will try in good faith to resolve a dispute by giving the other party written notice and allowing a reasonable opportunity to respond. If the dispute is not resolved, the courts of Malawi will have jurisdiction, except where applicable law requires otherwise.</p>
          </section>
          <section>
            <h2 className="text-lg font-semibold text-gray-900">15. Contact</h2>
            <p className="mt-2">If you have a question about these terms, please contact Ledgr support before creating your business account.</p>
          </section>
        </div>
      </article>
    </main>
  );
}
