import { Languages } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/lib/supabase';
import { useAppStore } from '@/store/useAppStore';
import { createLogger } from '@/lib/logger';

const log = createLogger('LanguageSwitcher');
import { LANGUAGE_OPTIONS, normalizeLanguage, type SupportedLanguage } from '@/i18n';

export function LanguageSwitcher() {
  const { t, i18n } = useTranslation();
  const currentUser = useAppStore((s) => s.currentUser);
  const setCurrentUser = useAppStore((s) => s.setCurrentUser);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const currentLanguage = normalizeLanguage(i18n.language);

  async function handleChange(language: SupportedLanguage) {
    setSaveError(null);
    await i18n.changeLanguage(language);

    if (!currentUser?.id) return;

    setIsSaving(true);
    try {
      const { error } = await supabase
        .from('user_profiles')
        .update({ preferred_language: language, updated_at: new Date().toISOString() } as never)
        .eq('id', currentUser.id);

      if (error) throw error;

      setCurrentUser({
        ...currentUser,
        profile: {
          ...(currentUser.profile ?? {}),
          preferred_language: language,
        },
      });
    } catch (err) {
      log.warn('Failed to save language preference', { error: err });
      setSaveError(t('language.saveError'));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <label className="sr-only" htmlFor="language-switcher">
        {t('language.switcherLabel')}
      </label>
      <div className="relative">
        <Languages className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400 rtl:left-auto rtl:right-2.5" />
        <select
          id="language-switcher"
          value={currentLanguage}
          disabled={isSaving}
          onChange={(event) => void handleChange(event.target.value as SupportedLanguage)}
          className="h-9 rounded-xl border border-gray-100 bg-white py-1.5 pl-8 pr-7 text-xs font-bold uppercase tracking-wider text-gray-600 shadow-sm outline-none transition-colors hover:border-gray-200 focus:border-brand-300 focus:ring-2 focus:ring-brand-100 disabled:opacity-60 rtl:pl-7 rtl:pr-8"
          aria-label={t('language.switcherLabel')}
          title={saveError ?? t('language.label')}
        >
          {LANGUAGE_OPTIONS.map((language) => (
            <option key={language.code} value={language.code}>
              {language.nativeLabel}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
