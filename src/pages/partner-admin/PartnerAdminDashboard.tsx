import React, { useState, useEffect } from 'react';
import { PartnerRepository } from '../../dal/repositories/PartnerRepository';
import type { Partner } from '../../types/partners';
import { useAppStore } from '../../store/useAppStore';

export default function PartnerAdminDashboard() {
  const [partners, setPartners] = useState<Partner[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<Record<string, number>>({});
  const { currentUser } = useAppStore();

  useEffect(() => {
    (async () => {
      try {
        const list = await PartnerRepository.getAll();
        setPartners(list);
        // Mock usage stats: count active clients per partner
        const s: Record<string, number> = {};
        for (const p of list) s[p.id] = Math.floor(Math.random() * 50) + 1;
        setStats(s);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <div className="max-w-6xl mx-auto px-6 py-10">
      <div className="mb-10">
        <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">Partner Admin Portal</h1>
        <p className="mt-2 text-slate-500">Manage bank and MFI partner accounts, theming, clients, and feature flags.</p>
      </div>

      {currentUser && (currentUser.role === 'platform_admin' || currentUser.role === 'partner_admin') ? (
        <>
          <section className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
            <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
              <div className="text-sm text-slate-500">Active Partners</div>
              <div className="text-3xl font-bold text-slate-900 mt-1">{partners.length}</div>
            </div>
            <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
              <div className="text-sm text-slate-500">Total Client Limit</div>
              <div className="text-3xl font-bold text-slate-900 mt-1">{partners.reduce((sum, p) => sum + p.client_limit, 0)}</div>
            </div>
            <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
              <div className="text-sm text-slate-500">Average Usage / Partner</div>
              <div className="text-3xl font-bold text-slate-900 mt-1">{partners.length ? Math.round(Object.values(stats).reduce((a, b) => a + b, 0) / partners.length) : 0}</div>
            </div>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-900 mb-4">Partners</h2>
            {loading ? (
              <div className="text-slate-400">Loading...</div>
            ) : (
              <div className="grid gap-4">
                {partners.map((p) => (
                  <a key={p.id} href={`/partner-admin/partners/${p.id}/settings`} className="block rounded-2xl bg-white p-6 shadow-sm border border-slate-100 hover:shadow-md transition">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        {p.logo_url ? (
                          <img src={p.logo_url} alt={p.name} className="w-12 h-12 rounded-xl object-cover" />
                        ) : (
                          <div className="w-12 h-12 rounded-xl bg-gradient-to-br" style={{ backgroundColor: p.primary_colour }} />
                        )}
                        <div>
                          <h3 className="font-bold text-slate-900">{p.name}</h3>
                          <p className="text-sm text-slate-500">{p.app_name} · {p.domain || 'No custom domain'}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-2xl font-extrabold text-slate-900">{stats[p.id] || 0}</div>
                        <div className="text-xs text-slate-400">Active clients / {p.client_limit}</div>
                      </div>
                    </div>
                  </a>
                ))}
              </div>
            )}
          </section>
        </>
      ) : (
        <div className="rounded-2xl bg-amber-50 border border-amber-200 p-6 text-amber-800">
          Access denied. You need partner admin or platform admin privileges.
        </div>
      )}
    </div>
  );
}
