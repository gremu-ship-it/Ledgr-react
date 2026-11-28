import { useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import {
  BedDouble,
  FlaskConical,
  Pill,
  Plus,
  ScanLine,
  Syringe,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { HealthcareModal } from '@/components/healthcare/HealthcareModal';
import { createClinicalProcedureOrder } from '@/services/clinicalFlowService';
import { createRadiologyOrder, RADIOLOGY_MODALITIES } from '@/services/radiologyService';
import type { ClinicalProcedureOrder } from '@/types/healthcare';
import type { ClinicalFlowVisit } from '@/services/clinicalFlowService';

type OrderTab = 'lab' | 'radiology' | 'procedure' | 'pharmacy' | 'admission';

const TABS: ReadonlyArray<{ key: OrderTab; icon: typeof FlaskConical }> = [
  { key: 'lab', icon: FlaskConical },
  { key: 'radiology', icon: ScanLine },
  { key: 'procedure', icon: Syringe },
  { key: 'pharmacy', icon: Pill },
  { key: 'admission', icon: BedDouble },
];

type ScanDraft = {
  key: string;
  modality: string;
  procedureName: string;
  bodySite: string;
  unitPrice: string;
};

type ProcedureDraft = {
  procedureName: string;
  category: ClinicalProcedureOrder['category'];
  unitPrice: string;
  notes: string;
};

function newDraftKey(): string {
  return `scan-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function emptyScan(): ScanDraft {
  return { key: newDraftKey(), modality: 'xray', procedureName: '', bodySite: '', unitPrice: '' };
}

/**
 * Doctor's multi-track requisition pad. Diagnostics and treatment-room
 * procedures are created here; lab and pharmacy lines stay in the clinical
 * editor so their existing validation and pricing rules are reused.
 */
export function MultiOrderSheet({
  open,
  onClose,
  businessId,
  visit,
  doctorId,
  canWrite,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  businessId: string;
  visit: ClinicalFlowVisit;
  doctorId: string | null;
  canWrite: boolean;
  onSaved?: (message: string) => void;
}) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<OrderTab>('radiology');
  const [scans, setScans] = useState<ScanDraft[]>([emptyScan()]);
  const [indication, setIndication] = useState('');
  const [urgency, setUrgency] = useState<'routine' | 'urgent' | 'stat'>('routine');
  const [procedure, setProcedure] = useState<ProcedureDraft>({
    procedureName: '',
    category: 'other',
    unitPrice: '',
    notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const resetMessages = () => {
    setError(null);
    setSuccess(null);
  };

  const saveRadiology = async () => {
    resetMessages();
    const items = scans
      .filter((scan) => scan.procedureName.trim())
      .map((scan) => ({
        modality: scan.modality as (typeof RADIOLOGY_MODALITIES)[number],
        procedureName: scan.procedureName.trim(),
        bodySite: scan.bodySite.trim() || null,
        unitPrice: Number(scan.unitPrice) || 0,
      }));
    if (items.length === 0) {
      setError(t('healthcare.orders.noScans'));
      return;
    }
    if (!doctorId) {
      setError(t('healthcare.orders.saveError'));
      return;
    }

    setSaving(true);
    try {
      await createRadiologyOrder({
        businessId,
        visitId: visit.id as string,
        patientId: visit.patient_id,
        doctorId,
        items,
        clinicalIndication: indication.trim() || null,
        urgency,
      });
      setScans([emptyScan()]);
      setIndication('');
      setSuccess(t('healthcare.orders.savedRadiology'));
      onSaved?.(t('healthcare.orders.savedRadiology'));
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : t('healthcare.orders.saveError'));
    } finally {
      setSaving(false);
    }
  };

  const saveProcedure = async () => {
    resetMessages();
    if (!procedure.procedureName.trim()) {
      setError(t('healthcare.orders.saveError'));
      return;
    }
    if (!doctorId) {
      setError(t('healthcare.orders.saveError'));
      return;
    }

    setSaving(true);
    try {
      await createClinicalProcedureOrder({
        businessId,
        visitId: visit.id as string,
        patientId: visit.patient_id,
        doctorId,
        procedureName: procedure.procedureName.trim(),
        category: procedure.category,
        unitPrice: Number(procedure.unitPrice) || 0,
        notes: procedure.notes.trim() || null,
      });
      setProcedure({ procedureName: '', category: 'other', unitPrice: '', notes: '' });
      setSuccess(t('healthcare.orders.savedProcedure'));
      onSaved?.(t('healthcare.orders.savedProcedure'));
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : t('healthcare.orders.saveError'));
    } finally {
      setSaving(false);
    }
  };

  const updateScan = (key: string, patch: Partial<ScanDraft>) => {
    setScans((current) =>
      current.map((scan) => (scan.key === key ? { ...scan, ...patch } : scan)),
    );
  };

  return (
    <HealthcareModal
      open={open}
      titleId="multi-order-sheet-title"
      title={t('healthcare.orders.title')}
      subtitle={t('healthcare.orders.subtitle')}
      closeLabel={t('healthcare.orders.close')}
      onClose={onClose}
      width="max-w-3xl"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('healthcare.orders.close')}
          </Button>
          {tab === 'radiology' && (
            <Button
              onClick={() => void saveRadiology()}
              isLoading={saving}
              disabled={!canWrite}
            >
              <ScanLine className="h-4 w-4" aria-hidden />
              {t('healthcare.orders.saveRadiology')}
            </Button>
          )}
          {tab === 'procedure' && (
            <Button
              onClick={() => void saveProcedure()}
              isLoading={saving}
              disabled={!canWrite}
            >
              <Syringe className="h-4 w-4" aria-hidden />
              {t('healthcare.orders.saveProcedure')}
            </Button>
          )}
        </>
      }
    >
      <div role="tablist" className="flex flex-wrap gap-1 border-b border-gray-200 pb-2">
        {TABS.map(({ key, icon: Icon }) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => {
              setTab(key);
              resetMessages();
            }}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
              tab === key
                ? 'bg-brand-50 text-brand-700 ring-1 ring-brand-200'
                : 'text-gray-500 hover:bg-gray-50 hover:text-gray-800'
            }`}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden />
            {t(`healthcare.orders.tabs.${key}`)}
          </button>
        ))}
      </div>

      <div className="mt-3 space-y-3">
        {error && (
          <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </p>
        )}
        {success && (
          <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
            {success}
          </p>
        )}

        {tab === 'lab' && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-5 text-sm text-amber-900">
            {t('healthcare.orders.labHint')}
          </div>
        )}

        {tab === 'radiology' && (
          <div className="space-y-3">
            <p className="text-xs text-gray-500">{t('healthcare.orders.radiologyHint')}</p>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="text-xs font-medium text-gray-700">
                {t('healthcare.radiology.indication')}
                <textarea
                  value={indication}
                  onChange={(event) => setIndication(event.target.value)}
                  rows={2}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm font-normal focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                />
              </label>
              <label className="text-xs font-medium text-gray-700">
                {t('healthcare.radiology.urgency')}
                <select
                  value={urgency}
                  onChange={(event) =>
                    setUrgency(event.target.value as 'routine' | 'urgent' | 'stat')
                  }
                  className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-2.5 py-2 text-sm font-normal focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                >
                  <option value="routine">{t('healthcare.radiology.urgencies.routine')}</option>
                  <option value="urgent">{t('healthcare.radiology.urgencies.urgent')}</option>
                  <option value="stat">{t('healthcare.radiology.urgencies.stat')}</option>
                </select>
              </label>
            </div>

            <div className="space-y-2">
              {scans.map((scan, index) => (
                <div key={scan.key} className="rounded-xl border border-gray-200 bg-gray-50/60 p-2.5">
                  <div className="grid gap-2 sm:grid-cols-12">
                    <label className="text-[11px] font-medium text-gray-600 sm:col-span-3">
                      {t('healthcare.radiology.modality')}
                      <select
                        value={scan.modality}
                        onChange={(event) =>
                          updateScan(scan.key, { modality: event.target.value })
                        }
                        className="mt-0.5 w-full rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-xs font-normal"
                      >
                        {RADIOLOGY_MODALITIES.map((modality) => (
                          <option key={modality} value={modality}>
                            {t(`healthcare.radiology.modalities.${modality}`)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="text-[11px] font-medium text-gray-600 sm:col-span-4">
                      {t('healthcare.radiology.procedure')}
                      <input
                        value={scan.procedureName}
                        onChange={(event) =>
                          updateScan(scan.key, { procedureName: event.target.value })
                        }
                        placeholder={t('healthcare.orders.scanPlaceholder')}
                        className="mt-0.5 w-full rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-xs font-normal"
                      />
                    </label>
                    <label className="text-[11px] font-medium text-gray-600 sm:col-span-3">
                      {t('healthcare.radiology.bodySite')}
                      <input
                        value={scan.bodySite}
                        onChange={(event) =>
                          updateScan(scan.key, { bodySite: event.target.value })
                        }
                        className="mt-0.5 w-full rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-xs font-normal"
                      />
                    </label>
                    <label className="text-[11px] font-medium text-gray-600 sm:col-span-2">
                      {t('healthcare.orders.price')}
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={scan.unitPrice}
                        onChange={(event) =>
                          updateScan(scan.key, { unitPrice: event.target.value })
                        }
                        className="mt-0.5 w-full rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-xs font-normal"
                      />
                    </label>
                  </div>
                  {scans.length > 1 && (
                    <button
                      type="button"
                      onClick={() =>
                        setScans((current) => current.filter((item) => item.key !== scan.key))
                      }
                      className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-red-600 hover:underline"
                    >
                      <Trash2 className="h-3 w-3" aria-hidden />
                      {t('healthcare.orders.removeScan')}
                      <span className="sr-only">{index + 1}</span>
                    </button>
                  )}
                </div>
              ))}
            </div>

            <Button
              variant="secondary"
              size="sm"
              onClick={() => setScans((current) => [...current, emptyScan()])}
            >
              <Plus className="h-3.5 w-3.5" aria-hidden />
              {t('healthcare.orders.addScan')}
            </Button>
          </div>
        )}

        {tab === 'procedure' && (
          <div className="space-y-3">
            <p className="text-xs text-gray-500">{t('healthcare.orders.procedureHint')}</p>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="text-xs font-medium text-gray-700">
                {t('healthcare.orders.procedureName')}
                <input
                  value={procedure.procedureName}
                  onChange={(event) =>
                    setProcedure((current) => ({ ...current, procedureName: event.target.value }))
                  }
                  placeholder={t('healthcare.orders.procedurePlaceholder')}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-2.5 py-2 text-sm font-normal"
                />
              </label>
              <label className="text-xs font-medium text-gray-700">
                {t('healthcare.orders.procedureCategory')}
                <select
                  value={procedure.category}
                  onChange={(event) =>
                    setProcedure((current) => ({
                      ...current,
                      category: event.target.value as ClinicalProcedureOrder['category'],
                    }))
                  }
                  className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-2.5 py-2 text-sm font-normal"
                >
                  {(
                    [
                      'minor_surgery',
                      'wound_care',
                      'injection',
                      'dressing',
                      'diagnostic',
                      'other',
                    ] as const
                  ).map((category) => (
                    <option key={category} value={category}>
                      {t(`healthcare.orders.categories.${category}`)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs font-medium text-gray-700">
                {t('healthcare.orders.procedurePrice')}
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={procedure.unitPrice}
                  onChange={(event) =>
                    setProcedure((current) => ({ ...current, unitPrice: event.target.value }))
                  }
                  className="mt-1 w-full rounded-lg border border-gray-300 px-2.5 py-2 text-sm font-normal"
                />
              </label>
              <label className="text-xs font-medium text-gray-700">
                {t('healthcare.radiology.recommendations')}
                <input
                  value={procedure.notes}
                  onChange={(event) =>
                    setProcedure((current) => ({ ...current, notes: event.target.value }))
                  }
                  className="mt-1 w-full rounded-lg border border-gray-300 px-2.5 py-2 text-sm font-normal"
                />
              </label>
            </div>
          </div>
        )}

        {tab === 'pharmacy' && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-5 text-sm text-emerald-900">
            {t('healthcare.orders.pharmacyHint')}
          </div>
        )}

        {tab === 'admission' && (
          <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-5 text-sm text-indigo-900">
            <p>{t('healthcare.orders.admissionHint')}</p>
            <Link
              to={`/healthcare/admissions?patientId=${visit.patient_id}`}
              className="mt-3 inline-flex text-xs font-semibold text-indigo-800 underline"
            >
              {t('healthcare.orders.goToAdmissions')}
            </Link>
          </div>
        )}
      </div>
    </HealthcareModal>
  );
}
