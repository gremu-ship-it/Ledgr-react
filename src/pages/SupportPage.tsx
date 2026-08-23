import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import {
  LifeBuoy,
  Download,
  Trash2,
  ShieldCheck,
  FileText,
  Cookie,
  ArrowUpRight,
  type LucideIcon,
} from 'lucide-react';
import { Assistant } from '@/components/ai/Assistant';

interface QuickLink {
  icon: LucideIcon;
  labelKey: string;
  descKey: string;
  path: string;
}

const COMPLIANCE_LINKS: QuickLink[] = [
  { icon: Download, labelKey: 'support.quick.export', descKey: 'support.quick.exportDesc', path: '/settings' },
  { icon: Trash2, labelKey: 'support.quick.delete', descKey: 'support.quick.deleteDesc', path: '/settings' },
  { icon: ShieldCheck, labelKey: 'support.quick.audit', descKey: 'support.quick.auditDesc', path: '/audit' },
  { icon: FileText, labelKey: 'support.quick.terms', descKey: 'support.quick.termsDesc', path: '/terms-and-conditions' },
  { icon: Cookie, labelKey: 'support.quick.cookies', descKey: 'support.quick.cookiesDesc', path: '/settings' },
];

/**
 * Dedicated Support page (`/support`). Renders the same unified assistant
 * component as the floating drawer and `/ai` — starting on the Support tab —
 * plus a panel of compliance self-service shortcuts and an escalation card.
 */
export function SupportPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-500">
          <LifeBuoy className="h-6 w-6 text-white" />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-gray-900">{t('support.title')}</h1>
          <p className="text-sm text-gray-500">{t('support.subtitle')}</p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Chat — primary column (the unified assistant, Support tab) */}
        <div className="lg:col-span-2">
          <div className="flex h-[calc(100vh-13rem)] min-h-[480px] flex-col rounded-2xl border border-gray-200 bg-white shadow-sm">
            <Assistant variant="page" initialMode="support" showHeader={false} />
          </div>
        </div>

        {/* Side panel — compliance shortcuts + escalation */}
        <div className="space-y-6">
          <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold text-gray-900">
              {t('support.complianceQuickLinks')}
            </h2>
            <div className="space-y-2">
              {COMPLIANCE_LINKS.map((link) => {
                const Icon = link.icon;
                return (
                  <button
                    key={link.path + link.labelKey}
                    type="button"
                    onClick={() => navigate(link.path)}
                    className="flex w-full items-start gap-3 rounded-xl border border-gray-100 p-3 text-left transition-colors hover:border-brand-200 hover:bg-brand-50"
                  >
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50">
                      <Icon className="h-4 w-4 text-brand-600" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-gray-900">{t(link.labelKey)}</p>
                      <p className="text-xs text-gray-500">{t(link.descKey)}</p>
                    </div>
                    <ArrowUpRight className="h-4 w-4 shrink-0 text-gray-400" />
                  </button>
                );
              })}
            </div>
          </section>

          <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
            <h2 className="mb-1 text-sm font-semibold text-amber-900">
              {t('support.contactTitle')}
            </h2>
            <p className="text-xs text-amber-800">{t('support.contactBody')}</p>
            <a
              href="mailto:support@ledgr.app"
              className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-amber-900 underline"
            >
              support@ledgr.app
            </a>
          </section>

          <p className="px-1 text-xs text-gray-600">{t('support.disclaimer')}</p>
        </div>
      </div>
    </div>
  );
}
