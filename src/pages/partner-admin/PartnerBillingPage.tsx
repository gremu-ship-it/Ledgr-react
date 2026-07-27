import React, { useState, useEffect } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { PartnerBillingRepository } from '../../dal/repositories/PartnerBillingRepository';

export default function PartnerBillingPage() {
  const { currentUser } = useAppStore();
  const [invoices, setInvoices] = useState<any[]>([]);

  useEffect(() => {
    (async () => {
      const list = await PartnerBillingRepository.getInvoicesForPartner('partner-1');
      setInvoices(list);
    })();
  }, []);

  return (
    <div className="max-w-4xl mx-auto px-6 py-10">
      <h1 className="text-3xl font-extrabold text-slate-900 mb-2">Partner Billing</h1>
      <p className="text-slate-500 mb-8">Billing is at the partner level — Ledgr invoices the bank; the bank offers it to SME clients. Partners manage pricing for their clients.</p>

      <div className="bg-white rounded-2xl border border-slate-100 p-8 shadow-sm">
        <div className="grid md:grid-cols-2 gap-6">
          <div>
            <h3 className="font-bold text-slate-900 mb-4">Billing Model</h3>
            <ul className="space-y-3 text-sm text-slate-600">
              <li>• <strong>Partner-level invoicing</strong> — Ledgr invoices the bank/MFI directly.</li>
              <li>• <strong>Client pricing</strong> is managed by the partner for their SME clients.</li>
              <li>• <strong>Usage-based tiers</strong> can be configured per partner.</li>
              <li>• <strong>Feature flags</strong> control which modules clients can access.</li>
            </ul>
          </div>
          <div>
            <h3 className="font-bold text-slate-900 mb-4">Partner Details</h3>
            <div className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600 space-y-2">
              <div><span className="font-semibold text-slate-700">Billing Email:</span> billing@nbs.mw</div>
              <div><span className="font-semibold text-slate-700">Plan:</span> Enterprise Bank Partner</div>
              <div><span className="font-semibold text-slate-700">Status:</span> Active</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
