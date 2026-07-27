import React, { useState, useEffect } from 'react';
import { useAppStore } from '../../store/useAppStore';

export default function PartnerClientsPage() {
  const { currentUser } = useAppStore();
  const [clients, setClients] = useState<any[]>([]);

  useEffect(() => {
    // Mock clients for demo; in real app this would query partner-scoped businesses
    setClients([
      { id: 'b1', name: 'NBS SME Client A', usage: 87, active: true },
      { id: 'b2', name: 'NBS SME Client B', usage: 42, active: true },
      { id: 'b3', name: 'NBS SME Client C', usage: 12, active: false },
    ]);
  }, []);

  return (
    <div className="max-w-5xl mx-auto px-6 py-10">
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-3xl font-extrabold text-slate-900">Partner Clients</h1>
        <span className="inline-flex items-center rounded-full bg-amber-50 px-3 py-1 text-xs font-bold text-amber-700 border border-amber-200">Read-only (partner admin)</span>
      </div>
      <p className="text-slate-500 mb-8">View clients under this partner. Data is isolated by default. Partner admins cannot edit client data.</p>

      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600 font-semibold">
            <tr>
              <th className="text-left px-6 py-3">Client</th>
              <th className="text-left px-6 py-3">Usage</th>
              <th className="text-left px-6 py-3">Status</th>
              <th className="text-left px-6 py-3">Isolation</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {clients.map((c) => (
              <tr key={c.id} className="hover:bg-slate-50">
                <td className="px-6 py-4 font-medium text-slate-900">{c.name}</td>
                <td className="px-6 py-4 text-slate-600">{c.usage}%</td>
                <td className="px-6 py-4">
                  <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${c.active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                    {c.active ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td className="px-6 py-4 text-slate-500">Isolated (default)</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
