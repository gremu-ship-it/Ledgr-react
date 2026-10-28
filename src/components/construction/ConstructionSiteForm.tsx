import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { ConstructionLocationOption } from '@/dal/repositories/ConstructionRepository';
import type { ConstructionSite, ConstructionSiteInput } from '@/dal/types/construction';

const INPUT_CLASS = 'mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-brand-500 focus:ring-4 focus:ring-brand-100';

interface ConstructionSiteFormProps {
  site?: ConstructionSite | null;
  locations: ConstructionLocationOption[];
  saving: boolean;
  error?: string | null;
  onCancel: () => void;
  onSave: (input: ConstructionSiteInput) => Promise<void>;
}

export function ConstructionSiteForm({ site, locations, saving, error, onCancel, onSave }: ConstructionSiteFormProps) {
  const { t } = useTranslation();
  const [name, setName] = useState(site?.name ?? '');
  const [locationId, setLocationId] = useState(site?.location_id ?? '');
  const [address, setAddress] = useState(site?.address ?? '');
  const [showNameError, setShowNameError] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const cleanName = name.trim();
    if (!cleanName) {
      setShowNameError(true);
      return;
    }
    await onSave({ name: cleanName, location_id: locationId || null, address: address.trim() || null });
  };

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {error && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}
      <label className="block text-sm font-semibold text-slate-700">
        {t('construction.sites.siteName')} <span className="text-rose-600">*</span>
        <input autoFocus required className={INPUT_CLASS} value={name} onChange={(event) => { setName(event.target.value); setShowNameError(false); }} />
        {showNameError && <span className="mt-1 block text-xs font-medium text-rose-600">{t('construction.validation.siteNameRequired')}</span>}
      </label>
      <label className="block text-sm font-semibold text-slate-700">
        {t('construction.sites.inventoryLocation')}
        <select value={locationId} onChange={(event) => setLocationId(event.target.value)} className={INPUT_CLASS}>
          <option value="">{t('construction.sites.noLinkedLocation')}</option>
          {locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
        </select>
        <span className="mt-1 block text-xs font-normal text-slate-500">{t('construction.sites.locationHelp')}</span>
      </label>
      <label className="block text-sm font-semibold text-slate-700">
        {t('construction.sites.address')}
        <textarea rows={2} className={INPUT_CLASS} value={address} onChange={(event) => setAddress(event.target.value)} />
      </label>
      <div className="flex justify-end gap-3 border-t border-slate-100 pt-4">
        <button type="button" onClick={onCancel} className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">{t('common.cancel')}</button>
        <button type="submit" disabled={saving} className="rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-brand-700 disabled:opacity-60">{saving ? t('construction.saving') : site ? t('construction.sites.saveSite') : t('construction.sites.addSite')}</button>
      </div>
    </form>
  );
}
