import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { AlertTriangle, Check, ChevronDown, ChevronUp, Plus, Search, ShieldCheck, Star, Users, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { repos } from '@/lib/repositories';
import { subcontractRepository } from '@/dal/repositories/SubcontractRepository';
import type { Row } from '@/dal/types/database';
import type {
  SubcontractorProfileWithContact,
  SubcontractorSafetyRating,
  UpdateSubcontractorProfileInput,
} from '@/dal/types/subcontracts';
import { useAppStore } from '@/store/useAppStore';

const TRADE_OPTIONS = [
  ['Electrical', 'construction.subcontractor.tradeElectrical'],
  ['Plumbing', 'construction.subcontractor.tradePlumbing'],
  ['Structural', 'construction.subcontractor.tradeStructural'],
  ['Civil', 'construction.subcontractor.tradeCivil'],
  ['HVAC', 'construction.subcontractor.tradeHvac'],
  ['Roofing', 'construction.subcontractor.tradeRoofing'],
  ['Finishing', 'construction.subcontractor.tradeFinishing'],
  ['Other', 'construction.subcontractor.tradeOther'],
] as const;

const RATING_OPTIONS: SubcontractorSafetyRating[] = ['A', 'B', 'C', 'D', 'unrated'];
const FIELD_CLASS = 'mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-100';

type Contact = Row<'contacts'>;
interface ContactDraft {
  name: string;
  email: string;
  phone: string;
  tpin: string;
  vat_number: string;
  address_line1: string;
  city: string;
}
interface ProfileDraft {
  trade: string;
  customTrade: string;
  license_number: string;
  license_expiry: string;
  insurance_provider: string;
  insurance_policy_number: string;
  insurance_expiry: string;
  compliance_notes: string;
  safety_rating: SubcontractorSafetyRating | '';
  preferred: boolean;
  is_active: boolean;
}

const EMPTY_CONTACT: ContactDraft = {
  name: '', email: '', phone: '', tpin: '', vat_number: '', address_line1: '', city: '',
};
const EMPTY_PROFILE: ProfileDraft = {
  trade: '', customTrade: '', license_number: '', license_expiry: '',
  insurance_provider: '', insurance_policy_number: '', insurance_expiry: '',
  compliance_notes: '', safety_rating: '', preferred: false, is_active: true,
};

function isTradeOption(value: string): boolean {
  return TRADE_OPTIONS.some(([trade]) => trade === value && trade !== 'Other');
}

function daysUntilExpiry(date: string | null): number | null {
  if (!date) return null;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const expiry = new Date(`${date}T00:00:00`);
  if (Number.isNaN(expiry.getTime())) return null;
  return Math.ceil((expiry.getTime() - now.getTime()) / 86_400_000);
}

function expiryLabel(date: string | null, locale: string, missing: string): string {
  if (!date) return missing;
  const parsed = new Date(`${date}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? date : new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(parsed);
}

function profileDraft(profile: SubcontractorProfileWithContact): ProfileDraft {
  return {
    trade: isTradeOption(profile.trade) ? profile.trade : 'Other',
    customTrade: isTradeOption(profile.trade) ? '' : profile.trade,
    license_number: profile.license_number ?? '',
    license_expiry: profile.license_expiry ?? '',
    insurance_provider: profile.insurance_provider ?? '',
    insurance_policy_number: profile.insurance_policy_number ?? '',
    insurance_expiry: profile.insurance_expiry ?? '',
    compliance_notes: profile.compliance_notes ?? '',
    safety_rating: (profile.safety_rating as SubcontractorSafetyRating | null) ?? '',
    preferred: profile.preferred,
    is_active: profile.is_active,
  };
}

function toProfileInput(fields: ProfileDraft): Omit<UpdateSubcontractorProfileInput, 'contact_id'> {
  return {
    trade: fields.trade === 'Other' ? fields.customTrade.trim() : fields.trade,
    license_number: fields.license_number.trim() || null,
    license_expiry: fields.license_expiry || null,
    insurance_provider: fields.insurance_provider.trim() || null,
    insurance_policy_number: fields.insurance_policy_number.trim() || null,
    insurance_expiry: fields.insurance_expiry || null,
    compliance_notes: fields.compliance_notes.trim() || null,
    safety_rating: fields.safety_rating || null,
    preferred: fields.preferred,
    is_active: fields.is_active,
  };
}

export function SubcontractorsPage() {
  const business = useAppStore((state) => state.currentBusiness?.business ?? null);
  return <SubcontractorsWorkspace key={business?.id ?? 'no-business'} businessId={business?.id ?? ''} />;
}

function SubcontractorsWorkspace({ businessId }: { businessId: string }) {
  const { t, i18n } = useTranslation();
  const [profiles, setProfiles] = useState<SubcontractorProfileWithContact[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [agreements, setAgreements] = useState<Awaited<ReturnType<typeof subcontractRepository.listSubcontracts>>>([]);
  const [loading, setLoading] = useState(Boolean(businessId));
  const [loadError, setLoadError] = useState(false);
  const [search, setSearch] = useState('');
  const [tradeFilter, setTradeFilter] = useState('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingProfile, setEditingProfile] = useState<SubcontractorProfileWithContact | null>(null);
  const [selectedContactId, setSelectedContactId] = useState('');
  const [profileFields, setProfileFields] = useState<ProfileDraft>(EMPTY_PROFILE);
  const [profileError, setProfileError] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [contactFormOpen, setContactFormOpen] = useState(false);
  const [contactDraft, setContactDraft] = useState<ContactDraft>(EMPTY_CONTACT);
  const [contactError, setContactError] = useState(false);
  const [contactSaving, setContactSaving] = useState(false);

  const reload = useCallback(async () => {
    if (!businessId) return;
    try {
      const [loadedProfiles, allContacts, loadedAgreements] = await Promise.all([
        subcontractRepository.listSubcontractorProfiles(businessId),
        repos.contact.findByBusiness(businessId),
        subcontractRepository.listSubcontracts(businessId),
      ]);
      setProfiles(loadedProfiles);
      setContacts(allContacts.filter((contact) => contact.contact_type === 'supplier' || contact.contact_type === 'both'));
      setAgreements(loadedAgreements);
      setLoadError(false);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => {
    if (!businessId) return;
    let active = true;
    const request = async () => {
      try {
        const [loadedProfiles, allContacts, loadedAgreements] = await Promise.all([
          subcontractRepository.listSubcontractorProfiles(businessId),
          repos.contact.findByBusiness(businessId),
          subcontractRepository.listSubcontracts(businessId),
        ]);
        if (!active) return;
        setProfiles(loadedProfiles);
        setContacts(allContacts.filter((contact) => contact.contact_type === 'supplier' || contact.contact_type === 'both'));
        setAgreements(loadedAgreements);
        setLoadError(false);
      } catch {
        if (active) setLoadError(true);
      } finally {
        if (active) setLoading(false);
      }
    };
    void request();
    return () => { active = false; };
  }, [businessId]);

  const trades = useMemo(() => [...new Set(profiles.map((profile) => profile.trade))].sort((a, b) => a.localeCompare(b)), [profiles]);
  const filteredProfiles = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return profiles.filter((profile) => {
      const matchesTrade = tradeFilter === 'all' || profile.trade === tradeFilter;
      const matchesSearch = !query || `${profile.contact.name} ${profile.trade} ${profile.contact.email ?? ''} ${profile.contact.phone ?? ''}`.toLocaleLowerCase().includes(query);
      return matchesTrade && matchesSearch;
    });
  }, [profiles, search, tradeFilter]);
  const tradeCounts = useMemo(() => {
    const counts = new Map<string, number>();
    profiles.forEach((profile) => counts.set(profile.trade, (counts.get(profile.trade) ?? 0) + 1));
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 3);
  }, [profiles]);
  const expiringInsuranceCount = profiles.filter((profile) => {
    const days = daysUntilExpiry(profile.insurance_expiry);
    return days !== null && days <= 60;
  }).length;
  const agreementCount = useMemo(() => {
    const counts = new Map<string, number>();
    agreements.forEach((agreement) => counts.set(
      agreement.subcontractor_profile_id,
      (counts.get(agreement.subcontractor_profile_id) ?? 0) + 1,
    ));
    return counts;
  }, [agreements]);

  const openCreate = () => {
    setEditingProfile(null);
    setSelectedContactId('');
    setProfileFields(EMPTY_PROFILE);
    setContactDraft(EMPTY_CONTACT);
    setContactFormOpen(false);
    setProfileError(false);
    setContactError(false);
    setFormOpen(true);
  };

  const openEdit = (profile: SubcontractorProfileWithContact) => {
    setEditingProfile(profile);
    setSelectedContactId(profile.contact_id);
    setProfileFields(profileDraft(profile));
    setContactFormOpen(false);
    setProfileError(false);
    setFormOpen(true);
  };

  const setProfileField = <K extends keyof ProfileDraft>(key: K, value: ProfileDraft[K]) => {
    setProfileFields((current) => ({ ...current, [key]: value }));
  };

  const createContact = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!businessId || !contactDraft.name.trim()) return;
    setContactSaving(true);
    setContactError(false);
    try {
      const contact = await repos.contact.createContact({
        business_id: businessId,
        contact_type: 'supplier',
        name: contactDraft.name.trim(),
        email: contactDraft.email.trim() || null,
        phone: contactDraft.phone.trim() || null,
        tpin: contactDraft.tpin.trim() || null,
        vat_number: contactDraft.vat_number.trim() || null,
        address_line1: contactDraft.address_line1.trim() || null,
        city: contactDraft.city.trim() || null,
        wht_exempt: false,
        is_active: true,
      });
      setContacts((current) => [...current.filter((item) => item.id !== contact.id), contact].sort((a, b) => a.name.localeCompare(b.name)));
      setSelectedContactId(contact.id);
      setContactDraft(EMPTY_CONTACT);
      setContactFormOpen(false);
    } catch {
      setContactError(true);
    } finally {
      setContactSaving(false);
    }
  };

  const saveProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trade = profileFields.trade === 'Other' ? profileFields.customTrade.trim() : profileFields.trade.trim();
    if (!businessId || !selectedContactId || !trade) {
      setProfileError(true);
      return;
    }
    setProfileSaving(true);
    setProfileError(false);
    try {
      const payload = { ...toProfileInput({ ...profileFields, trade }), trade };
      if (editingProfile) {
        await subcontractRepository.updateSubcontractorProfile(businessId, editingProfile.id, payload);
      } else {
        await subcontractRepository.createSubcontractorProfile(businessId, { ...payload, contact_id: selectedContactId });
      }
      setFormOpen(false);
      await reload();
    } catch {
      setProfileError(true);
    } finally {
      setProfileSaving(false);
    }
  };

  const selectedContact = contacts.find((contact) => contact.id === selectedContactId) ?? editingProfile?.contact ?? null;
  const contactOptions = contacts.filter((contact) => contact.is_active);

  return (
    <main className="mx-auto w-full max-w-7xl space-y-7 px-4 py-6 sm:px-6 lg:px-8">
      <header className="flex flex-col gap-4 rounded-3xl bg-slate-950 px-6 py-7 text-white shadow-xl sm:flex-row sm:items-end sm:justify-between sm:px-8">
        <div><p className="text-xs font-bold uppercase tracking-[0.16em] text-sky-200">{t('construction.eyebrow')}</p><h1 className="mt-2 text-3xl font-extrabold tracking-tight">{t('construction.subcontractor.title')}</h1><p className="mt-2 max-w-2xl text-sm text-slate-300">{t('construction.subcontractor.subtitle')}</p></div>
        <button type="button" onClick={openCreate} className="inline-flex items-center justify-center gap-2 rounded-xl bg-white px-4 py-3 text-sm font-bold text-slate-950 hover:bg-sky-50"><Plus className="h-4 w-4" />{t('construction.subcontractor.addSubcontractor')}</button>
      </header>

      {loadError && <div role="alert" className="flex items-center justify-between rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800"><span>{t('construction.subcontractor.loadError')}</span><button type="button" onClick={() => { setLoading(true); void reload(); }} className="font-bold underline">{t('common.retry')}</button></div>}
      {!businessId && <div role="status" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{t('construction.selectBusiness')}</div>}

      <section aria-label={t('construction.subcontractor.summary')} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard icon={<Users className="h-4 w-4" />} label={t('construction.subcontractor.totalSubcontractors')} value={profiles.length} />
        <MetricCard icon={<ShieldCheck className="h-4 w-4" />} label={t('construction.subcontractor.activeSubcontractors')} value={profiles.filter((profile) => profile.is_active).length} />
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><p className="text-sm font-medium text-slate-500">{t('construction.subcontractor.topTrades')}</p>{tradeCounts.length ? <div className="mt-3 flex flex-wrap gap-2">{tradeCounts.map(([trade, count]) => <span key={trade} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700">{trade} · {count}</span>)}</div> : <p className="mt-3 text-sm font-bold text-slate-900">—</p>}</div>
        <MetricCard icon={<AlertTriangle className="h-4 w-4" />} label={t('construction.subcontractor.expiringInsurance')} value={expiringInsuranceCount} warning={expiringInsuranceCount > 0} />
      </section>

      {formOpen && <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
        <div className="mb-5 flex items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-[0.15em] text-brand-700">{editingProfile ? t('construction.subcontractor.editSubcontractor') : t('construction.subcontractor.addSubcontractor')}</p><h2 className="mt-1 text-xl font-extrabold text-slate-900">{t('construction.subcontractor.profileDetails')}</h2></div><button type="button" aria-label={t('common.close')} onClick={() => setFormOpen(false)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><X className="h-5 w-5" /></button></div>
        {!editingProfile && <div className="mb-6 rounded-2xl border border-sky-100 bg-sky-50/50 p-4 sm:p-5">
          <h3 className="font-bold text-slate-900">{t('construction.subcontractor.stepOne')}</h3>
          <label className="mt-3 block text-sm font-semibold text-slate-700">{t('construction.subcontractor.selectContact')}
            <select value={selectedContactId} onChange={(event) => setSelectedContactId(event.target.value)} className={FIELD_CLASS}>
              <option value="">{t('construction.subcontractor.chooseContact')}</option>
              {contactOptions.map((contact) => <option key={contact.id} value={contact.id}>{contact.name}{contact.email ? ` · ${contact.email}` : ''}</option>)}
            </select>
          </label>
          <button type="button" onClick={() => { setContactFormOpen((open) => !open); setContactError(false); }} className="mt-3 text-sm font-bold text-brand-700 hover:text-brand-900">{contactFormOpen ? t('construction.subcontractor.cancelNewContact') : t('construction.subcontractor.createNewContact')}</button>
          {contactFormOpen && <form onSubmit={createContact} className="mt-4 grid gap-3 border-t border-sky-100 pt-4 sm:grid-cols-2">
            <label className="text-sm font-semibold text-slate-700 sm:col-span-2">{t('construction.subcontractor.contactName')} *<input required className={FIELD_CLASS} value={contactDraft.name} onChange={(event) => setContactDraft((current) => ({ ...current, name: event.target.value }))} /></label>
            <label className="text-sm font-semibold text-slate-700">{t('construction.subcontractor.contactEmail')}<input type="email" className={FIELD_CLASS} value={contactDraft.email} onChange={(event) => setContactDraft((current) => ({ ...current, email: event.target.value }))} /></label>
            <label className="text-sm font-semibold text-slate-700">{t('construction.subcontractor.contactPhone')}<input className={FIELD_CLASS} value={contactDraft.phone} onChange={(event) => setContactDraft((current) => ({ ...current, phone: event.target.value }))} /></label>
            <label className="text-sm font-semibold text-slate-700">{t('construction.subcontractor.tpin')}<input className={FIELD_CLASS} value={contactDraft.tpin} onChange={(event) => setContactDraft((current) => ({ ...current, tpin: event.target.value }))} /></label>
            <label className="text-sm font-semibold text-slate-700">{t('construction.subcontractor.vatNumber')}<input className={FIELD_CLASS} value={contactDraft.vat_number} onChange={(event) => setContactDraft((current) => ({ ...current, vat_number: event.target.value }))} /></label>
            <label className="text-sm font-semibold text-slate-700">{t('construction.subcontractor.address')}<input className={FIELD_CLASS} value={contactDraft.address_line1} onChange={(event) => setContactDraft((current) => ({ ...current, address_line1: event.target.value }))} /></label>
            <label className="text-sm font-semibold text-slate-700">{t('construction.subcontractor.city')}<input className={FIELD_CLASS} value={contactDraft.city} onChange={(event) => setContactDraft((current) => ({ ...current, city: event.target.value }))} /></label>
            {contactError && <p role="alert" className="text-sm text-rose-700 sm:col-span-2">{t('construction.subcontractor.contactCreateError')}</p>}
            <div className="flex justify-end sm:col-span-2"><button disabled={contactSaving || !contactDraft.name.trim()} className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-brand-700 disabled:opacity-50">{contactSaving ? t('construction.subcontractor.savingContact') : t('construction.subcontractor.saveAndSelectContact')}</button></div>
          </form>}
        </div>}

        <form onSubmit={saveProfile} className="space-y-5" noValidate>
          <div className="mb-2 flex items-center justify-between gap-3"><div><h3 className="font-bold text-slate-900">{t('construction.subcontractor.stepTwo')}</h3>{selectedContact && <p className="mt-1 text-sm text-slate-500">{t('construction.subcontractor.profileFor', { name: selectedContact.name })}</p>}</div>{selectedContact && <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700"><Check className="mr-1 inline h-3.5 w-3.5" />{t('construction.subcontractor.contactLinked')}</span>}</div>
          <fieldset disabled={!selectedContactId || profileSaving} className="grid gap-4 sm:grid-cols-2 disabled:opacity-60">
            <label className="text-sm font-semibold text-slate-700">{t('construction.subcontractor.trade')} *<select required value={profileFields.trade} onChange={(event) => setProfileField('trade', event.target.value)} className={FIELD_CLASS}><option value="">{t('construction.subcontractor.chooseTrade')}</option>{TRADE_OPTIONS.map(([value, key]) => <option key={value} value={value}>{t(key)}</option>)}</select></label>
            {profileFields.trade === 'Other' && <label className="text-sm font-semibold text-slate-700">{t('construction.subcontractor.customTrade')} *<input required className={FIELD_CLASS} value={profileFields.customTrade} onChange={(event) => setProfileField('customTrade', event.target.value)} /></label>}
            <label className="text-sm font-semibold text-slate-700">{t('construction.subcontractor.licenseNumber')}<input className={FIELD_CLASS} value={profileFields.license_number} onChange={(event) => setProfileField('license_number', event.target.value)} /></label>
            <label className="text-sm font-semibold text-slate-700">{t('construction.subcontractor.licenseExpiry')}<input type="date" className={FIELD_CLASS} value={profileFields.license_expiry} onChange={(event) => setProfileField('license_expiry', event.target.value)} /></label>
            <label className="text-sm font-semibold text-slate-700">{t('construction.subcontractor.insuranceProvider')}<input className={FIELD_CLASS} value={profileFields.insurance_provider} onChange={(event) => setProfileField('insurance_provider', event.target.value)} /></label>
            <label className="text-sm font-semibold text-slate-700">{t('construction.subcontractor.insurancePolicy')}<input className={FIELD_CLASS} value={profileFields.insurance_policy_number} onChange={(event) => setProfileField('insurance_policy_number', event.target.value)} /></label>
            <label className="text-sm font-semibold text-slate-700">{t('construction.subcontractor.insuranceExpiry')}<input type="date" className={FIELD_CLASS} value={profileFields.insurance_expiry} onChange={(event) => setProfileField('insurance_expiry', event.target.value)} /></label>
            <label className="text-sm font-semibold text-slate-700">{t('construction.subcontractor.safetyRating')}<select value={profileFields.safety_rating} onChange={(event) => setProfileField('safety_rating', event.target.value as ProfileDraft['safety_rating'])} className={FIELD_CLASS}><option value="">{t('construction.subcontractor.noRating')}</option>{RATING_OPTIONS.map((rating) => <option key={rating} value={rating}>{rating === 'unrated' ? t('construction.subcontractor.unrated') : rating}</option>)}</select></label>
            <label className="text-sm font-semibold text-slate-700 sm:col-span-2">{t('construction.subcontractor.complianceNotes')}<textarea rows={3} className={FIELD_CLASS} value={profileFields.compliance_notes} onChange={(event) => setProfileField('compliance_notes', event.target.value)} /></label>
            <label className="flex items-center gap-2 text-sm font-semibold text-slate-700"><input type="checkbox" checked={profileFields.preferred} onChange={(event) => setProfileField('preferred', event.target.checked)} className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500" /><Star className="h-4 w-4 text-amber-500" />{t('construction.subcontractor.preferred')}</label>
            <label className="flex items-center gap-2 text-sm font-semibold text-slate-700"><input type="checkbox" checked={profileFields.is_active} onChange={(event) => setProfileField('is_active', event.target.checked)} className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500" />{t('construction.subcontractor.active')}</label>
          </fieldset>
          {profileError && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{t('construction.subcontractor.saveError')}</p>}
          <div className="flex justify-end gap-3 border-t border-slate-100 pt-4"><button type="button" onClick={() => setFormOpen(false)} className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">{t('common.cancel')}</button><button type="submit" disabled={!selectedContactId || profileSaving} className="rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-brand-700 disabled:opacity-50">{profileSaving ? t('construction.subcontractor.savingProfile') : editingProfile ? t('construction.subcontractor.saveChanges') : t('construction.subcontractor.saveProfile')}</button></div>
        </form>
      </section>}

      <section className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><h2 className="text-xl font-extrabold text-slate-900">{t('construction.subcontractor.directory')}</h2><p className="mt-1 text-sm text-slate-500">{t('construction.subcontractor.directoryCount', { count: profiles.length })}</p></div><div className="flex flex-col gap-2 sm:flex-row"><label className="relative"><span className="sr-only">{t('construction.subcontractor.search')}</span><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('construction.subcontractor.search')} className="w-full rounded-xl border border-slate-300 py-2.5 pl-9 pr-3 text-sm outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-100 sm:w-56" /></label><label><span className="sr-only">{t('construction.subcontractor.filterByTrade')}</span><select value={tradeFilter} onChange={(event) => setTradeFilter(event.target.value)} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-700 sm:w-48"><option value="all">{t('construction.subcontractor.allTrades')}</option>{trades.map((trade) => <option key={trade} value={trade}>{trade}</option>)}</select></label></div></div>
        {loading ? <div role="status" className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">{t('common.loading')}</div> : filteredProfiles.length === 0 ? <div className="rounded-3xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center"><span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-500"><Users className="h-7 w-7" /></span><h3 className="mt-4 text-lg font-bold text-slate-900">{t('construction.subcontractor.emptyTitle')}</h3><p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">{t('construction.subcontractor.emptyState')}</p><button type="button" onClick={openCreate} className="mt-5 inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-brand-700"><Plus className="h-4 w-4" />{t('construction.subcontractor.addSubcontractor')}</button></div> : <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm"><table className="min-w-[1040px] w-full text-left text-sm"><thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3">{t('construction.subcontractor.name')}</th><th className="px-4 py-3">{t('construction.subcontractor.trade')}</th><th className="px-4 py-3">{t('construction.subcontractor.contact')}</th><th className="px-4 py-3">{t('construction.subcontractor.licenseNumber')}</th><th className="px-4 py-3">{t('construction.subcontractor.insuranceExpiry')}</th><th className="px-4 py-3">{t('construction.subcontractor.safetyRating')}</th><th className="px-4 py-3">{t('construction.subcontractor.preferred')}</th><th className="px-4 py-3">{t('construction.subcontractor.agreements')}</th><th className="px-4 py-3">{t('common.actions')}</th></tr></thead><tbody className="divide-y divide-slate-100">{filteredProfiles.map((profile) => { const days = daysUntilExpiry(profile.insurance_expiry); const warning = days !== null && days <= 60; const expanded = expandedId === profile.id; return <FragmentRow key={profile.id} profile={profile} expanded={expanded} warning={warning} locale={i18n.language} expiry={expiryLabel(profile.insurance_expiry, i18n.language, t('common.none'))} agreements={agreementCount.get(profile.id) ?? 0} onToggle={() => setExpandedId(expanded ? null : profile.id)} onEdit={() => openEdit(profile)} t={t} />; })}</tbody></table></div>}
      </section>
    </main>
  );
}

function MetricCard({ icon, label, value, warning = false }: { icon: ReactNode; label: string; value: number; warning?: boolean }) {
  return <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex items-center justify-between"><span className="text-sm font-medium text-slate-500">{label}</span><span className={`flex h-9 w-9 items-center justify-center rounded-xl ${warning ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-700'}`}>{icon}</span></div><p className="mt-3 text-2xl font-extrabold text-slate-950">{value}</p></div>;
}

function FragmentRow({
  profile, expanded, warning, locale, expiry, agreements, onToggle, onEdit, t,
}: {
  profile: SubcontractorProfileWithContact;
  expanded: boolean;
  warning: boolean;
  locale: string;
  expiry: string;
  agreements: number;
  onToggle: () => void;
  onEdit: () => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  return <>
    <tr className="hover:bg-slate-50">
      <td className="px-4 py-3"><div className="flex items-center gap-2"><button type="button" aria-expanded={expanded} onClick={onToggle} className="inline-flex items-center gap-1 text-left font-bold text-slate-900 hover:text-brand-700">{profile.contact.name}{expanded ? <ChevronUp aria-hidden="true" className="h-3.5 w-3.5 text-slate-400" /> : <ChevronDown aria-hidden="true" className="h-3.5 w-3.5 text-slate-400" />}</button>{profile.preferred && <Star aria-label={t('construction.subcontractor.preferred')} className="h-3.5 w-3.5 fill-amber-400 text-amber-500" />}</div><span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-bold ${profile.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{profile.is_active ? t('construction.subcontractor.active') : t('construction.subcontractor.inactive')}</span></td>
      <td className="px-4 py-3 text-slate-700">{profile.trade}</td>
      <td className="px-4 py-3"><div className="text-slate-700">{profile.contact.email ?? t('common.none')}</div><div className="mt-0.5 text-xs text-slate-500">{profile.contact.phone ?? ''}</div></td>
      <td className="px-4 py-3 text-slate-700">{profile.license_number ?? t('common.none')}</td>
      <td className={`px-4 py-3 ${warning ? 'font-bold text-amber-700' : 'text-slate-700'}`}>{warning && <AlertTriangle className="mr-1 inline h-3.5 w-3.5" />}{expiry}</td>
      <td className="px-4 py-3 text-slate-700">{profile.safety_rating === 'unrated' ? t('construction.subcontractor.unrated') : profile.safety_rating ?? t('common.none')}</td>
      <td className="px-4 py-3">{profile.preferred ? <Check className="h-4 w-4 text-emerald-600" /> : '—'}</td>
      <td className="px-4 py-3 font-semibold text-slate-700">{agreements}</td>
      <td className="px-4 py-3"><button type="button" onClick={onEdit} className="rounded-lg px-2.5 py-1.5 text-xs font-bold text-brand-700 hover:bg-brand-50">{t('common.edit')}</button></td>
    </tr>
    {expanded && <tr className="bg-slate-50/70"><td colSpan={9} className="px-5 py-4"><div className="grid gap-3 text-sm sm:grid-cols-3"><p><span className="font-bold text-slate-600">{t('construction.subcontractor.licenseExpiry')}:</span> {expiryLabel(profile.license_expiry, locale, t('common.none'))}</p><p><span className="font-bold text-slate-600">{t('construction.subcontractor.insuranceProvider')}:</span> {profile.insurance_provider ?? t('common.none')}</p><p><span className="font-bold text-slate-600">{t('construction.subcontractor.insurancePolicy')}:</span> {profile.insurance_policy_number ?? t('common.none')}</p><p><span className="font-bold text-slate-600">{t('construction.subcontractor.tpin')}:</span> {profile.contact.tpin ?? t('common.none')}</p><p><span className="font-bold text-slate-600">{t('construction.subcontractor.vatNumber')}:</span> {profile.contact.vat_number ?? t('common.none')}</p><p><span className="font-bold text-slate-600">{t('construction.subcontractor.address')}:</span> {[profile.contact.address_line1, profile.contact.city, profile.contact.country].filter(Boolean).join(', ') || t('common.none')}</p>{profile.compliance_notes && <p className="sm:col-span-3"><span className="font-bold text-slate-600">{t('construction.subcontractor.complianceNotes')}:</span> {profile.compliance_notes}</p>}</div></td></tr>}
  </>;
}
