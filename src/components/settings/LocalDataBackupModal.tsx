import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, Upload, ShieldCheck, HardDrive, X } from 'lucide-react';
import { useSubscriptionLease } from '../../hooks/useSubscriptionLease';
import { exportLocalBackup, importLocalBackup } from '../../services/localBackupService';

interface LocalDataBackupModalProps {
  businessId: string;
  isOpen: boolean;
  onClose: () => void;
}

export const LocalDataBackupModal: React.FC<LocalDataBackupModalProps> = ({
  businessId,
  isOpen,
  onClose,
}) => {
  const { t } = useTranslation();
  const { evaluation } = useSubscriptionLease(businessId);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isPersistent, setIsPersistent] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  useEffect(() => {
    if (
      typeof navigator !== 'undefined' &&
      navigator.storage &&
      typeof navigator.storage.persisted === 'function'
    ) {
      navigator.storage
        .persisted()
        .then((persisted) => setIsPersistent(persisted))
        .catch(() => {});
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleExport = async () => {
    setIsBusy(true);
    setStatusMessage(null);
    setErrorMessage(null);
    try {
      await exportLocalBackup(businessId);
      setStatusMessage(t('offline.backupSuccess'));
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setIsBusy(false);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsBusy(true);
    setStatusMessage(null);
    setErrorMessage(null);
    try {
      const count = await importLocalBackup(businessId, file);
      setStatusMessage(t('offline.restoreSuccess', { count }));
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setIsBusy(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="local-data-modal-title"
    >
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="local-data-modal-title" className="text-lg font-semibold text-gray-900">
              {t('localData.title')}
            </h2>
            <p className="mt-1 text-sm text-gray-600">{t('localData.description')}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            aria-label={t('common.close')}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-5 space-y-4">
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-3.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-medium text-gray-800">
                <ShieldCheck className="h-4 w-4 text-brand-600" />
                <span>{t('localData.leaseStatus')}</span>
              </div>
              <span className="rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-medium text-brand-700">
                {evaluation.status}
              </span>
            </div>
            <p className="mt-1 text-xs text-gray-600">
              {t('localData.activeDays', { days: evaluation.daysRemaining })}
            </p>
          </div>

          {isPersistent && (
            <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800">
              <HardDrive className="h-4 w-4 text-emerald-600" />
              <span>{t('localData.storagePersistent')}</span>
            </div>
          )}

          {statusMessage && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
              {statusMessage}
            </div>
          )}

          {errorMessage && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
              {errorMessage}
            </div>
          )}

          <div className="flex flex-col gap-2.5 pt-2">
            <button
              type="button"
              onClick={handleExport}
              disabled={isBusy}
              className="flex items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
            >
              <Download className="h-4 w-4" />
              <span>{t('localData.exportButton')}</span>
            </button>

            <input
              ref={fileInputRef}
              type="file"
              accept=".ledgr,application/json"
              onChange={handleFileChange}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isBusy}
              className="flex items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              <Upload className="h-4 w-4" />
              <span>{t('localData.importButton')}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
