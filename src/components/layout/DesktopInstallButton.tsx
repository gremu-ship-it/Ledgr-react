import React from 'react';
import { useTranslation } from 'react-i18next';
import { Download, MonitorCheck } from 'lucide-react';
import { usePwaInstall } from '../../hooks/usePwaInstall';

export const DesktopInstallButton: React.FC = () => {
  const { t } = useTranslation();
  const { isInstallable, isInstalled, promptInstall } = usePwaInstall();

  if (isInstalled) {
    return (
      <div
        className="flex items-center gap-1.5 px-2.5 py-1 text-xs text-brand-700 bg-brand-50 rounded-lg border border-brand-200"
        title={t('pwa.installedTooltip')}
      >
        <MonitorCheck className="w-3.5 h-3.5" />
        <span className="font-medium">{t('pwa.desktopAppActive')}</span>
      </div>
    );
  }

  if (!isInstallable) return null;

  return (
    <button
      onClick={() => promptInstall()}
      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-brand-600 hover:bg-brand-700 rounded-lg shadow-sm transition-colors"
      title={t('pwa.installTooltip')}
    >
      <Download className="w-3.5 h-3.5" />
      <span>{t('pwa.installDesktop')}</span>
    </button>
  );
};
