import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { PartnerRepository } from '../../dal/repositories/PartnerRepository';
import type { Partner } from '../../types/partners';

export default function PartnerSettingsPage() {
  const { id } = useParams<{ id: string }>();
  const [partner, setPartner] = useState<Partner | null>(null);
  const [form, setForm] = useState({ name: '', domain: '', primary_colour: '#1a3a5c', app_name: 'Ledgr', support_email: '', client_limit: 100 });
  const [flags, setFlags] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!id) return;
    (async () => {
      const p = await PartnerRepository.getById(id);
      if (p) {
        setPartner(p);
        setForm({
          name: p.name,
          domain: p.domain || '',
          primary_colour: p.primary_colour,
          app_name: p.app_name,
          support_email: p.support_email || '',
          client_limit: p.client_limit,
        });
        const featureFlags = await PartnerRepository.getFeatureFlags(p.id);
        setFlags(featureFlags);
      }
    })();
  }, [id]);

  const handleSave = async () => {
    if (!id) return;
    setSaving(true);
    try {
      await PartnerRepository.update(id, form);
      // Update flags
      for (const [key, enabled] of Object.entries(flags)) {
        await PartnerRepository.setFeatureFlag(id, key, enabled);
      }
      alert('Partner settings saved.');
    } finally {
      setSaving(false);
    }
  };

  const toggleFlag = (key: string) => setFlags({ ...flags, [key]: !flags[key] });

  if (!partner) return <div className="p-8 text-slate-400">Loading partner...</div>;

  return (
    <div className="max-w-4xl mx-auto px-6 py-10">
      <h1 className="text-3xl font-extrabold text-slate-900 mb-2">Partner Settings</h1>
      <p className="text-slate-500 mb-8">Configure branding, limits, and feature flags for this partner.</p>

      <section className="bg-white rounded-2xl border border-slate-100 p-8 shadow-sm mb-8">
        <h2 className="text-lg font-bold text-slate-900 mb-4">Branding</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="block">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Partner Name</span>
            <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-slate-200" />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">App Name</span>
            <input value={form.app_name} onChange={e => setForm({ ...form, app_name: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-slate-200" />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Domain / Subdomain</span>
            <input value={form.domain} onChange={e => setForm({ ...form, domain: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-slate-200" placeholder="nbs.ledgr.com or accounting.nbsmw.com" />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Primary Colour</span>
            <input type="color" value={form.primary_colour} onChange={e => setForm({ ...form, primary_colour: e.target.value })} className="mt-1 w-full h-10 rounded-lg border border-slate-200 px-1" />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Support Email</span>
            <input value={form.support_email} onChange={e => setForm({ ...form, support_email: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-slate-200" />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Client Limit</span>
            <input type="number" value={form.client_limit} onChange={e => setForm({ ...form, client_limit: parseInt(e.target.value, 10) })} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-slate-200" />
          </label>
        </div>
      </section>

      <section className="bg-white rounded-2xl border border-slate-100 p-8 shadow-sm mb-8">
        <h2 className="text-lg font-bold text-slate-900 mb-4">Feature Flags</h2>
        <div className="grid gap-3 md:grid-cols-2">
          {[
            { key: 'ai_advisor', label: 'AI Advisor' },
            { key: 'payroll', label: 'Payroll' },
            { key: 'inventory', label: 'Inventory' },
            { key: 'multi_currency', label: 'Multi-Currency' },
            { key: 'bank_reconciliation', label: 'Bank Reconciliation' },
          ].map(({ key, label }) => (
            <button
              key={key}
              onClick={() => toggleFlag(key)}
              className={`flex items-center justify-between px-4 py-3 rounded-xl border transition text-sm font-medium ${flags[key] ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-slate-50 border-slate-200 text-slate-500 hover:text-slate-700'}`}
            >
              <span>{label}</span>
              <span>{flags[key] ? 'Enabled' : 'Disabled'}</span>
            </button>
          ))}
        </div>
      </section>

      <div className="flex justify-end">
        <button onClick={handleSave} disabled={saving} className="rounded-xl bg-slate-900 text-white px-6 py-2.5 font-semibold hover:bg-slate-800 transition disabled:opacity-40">
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
      </div>
    </div>
  );
}
