import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Megaphone,
  Lightbulb,
  Search,
  Send,
  Loader2,
  AlertCircle,
  Tag,
  TrendingUp,
  Hash,
  Save,
  Share2,
  Eye,
  CheckCircle2,
  Package,
  Sparkles,
  Pencil,
  X,
  Users,
  ExternalLink,
} from 'lucide-react';
import { createLogger } from '@/lib/logger';
import { useAppStore } from '@/store/useAppStore';
import {
  callMarketingAgent,
  saveDraft,
  loadBrandVoice,
  saveBrandVoice,
  type MarketingMode,
  type MarketingResult,
  type Recommendation,
  type MarketingDraft,
  type Source,
} from '@/lib/marketingAgent';

const log = createLogger('MarketingAssistantPage');

type Tab = MarketingMode;

const TABS: { id: Tab; icon: typeof Megaphone; labelKey: string; descKey: string; placeholderKey: string; samplePrompts: string[] }[] = [
  {
    id: 'recommendations',
    icon: Lightbulb,
    labelKey: 'marketing.tab.recommendations',
    descKey: 'marketing.recommendations.description',
    placeholderKey: 'marketing.placeholder.recommendations',
    samplePrompts: [
      'marketing.prompt.recommendSlow',
      'marketing.prompt.recommendGrow',
      'marketing.prompt.recommendBundle',
    ],
  },
  {
    id: 'research',
    icon: Search,
    labelKey: 'marketing.tab.research',
    descKey: 'marketing.research.description',
    placeholderKey: 'marketing.placeholder.research',
    samplePrompts: ['marketing.prompt.researchFocus', 'marketing.prompt.researchReach'],
  },
  {
    id: 'publish',
    icon: Share2,
    labelKey: 'marketing.tab.publish',
    descKey: 'marketing.publish.description',
    placeholderKey: 'marketing.placeholder.publish',
    samplePrompts: ['marketing.prompt.publishBestseller', 'marketing.prompt.publishRestock', 'marketing.prompt.publishOffer'],
  },
];

// ── Sample result, clearly labelled, so the UI is explorable locally even
//    before the edge function is deployed. Never shown as real output.
const SAMPLE_RESULT: Record<Tab, MarketingResult> = {
  recommendations: {
    mode: 'recommendations',
    summary: 'Sample output — based on your products and recent sales, two quick wins stand out.',
    escalate: false,
    research: null,
    drafts: [],
    sources: [],
    recommendations: [
      {
        title: 'Run a bundle on slow-moving stock',
        rationale: 'A few product lines are sitting above their reorder level with little recent movement.',
        expectedImpact: 'Frees up cash tied in inventory.',
        suggestedAction: 'Bundle the slow movers with your best-seller at a small discount.',
        productRefs: ['Sample Product A', 'Sample Product B'],
      },
    ],
  },
  research: {
    mode: 'research',
    summary: 'Sample output — general guidance tailored to your business.',
    escalate: false,
    research: {
      themes: ['Build trust with customer reviews', 'Post consistently about real products'],
      opportunities: ['Re-engage your top customers with a thank-you offer'],
      note: 'Live web & social trend search arrives in a later phase — this is general guidance, not live data.',
    },
    recommendations: [],
    drafts: [],
    sources: [
      { title: 'Sample Source — SME Marketing (Malawi)', url: 'https://example.com/sme-marketing-malawi', snippet: 'Sample snippet: practical, low-budget marketing ideas for small businesses.' },
    ],
  },
  publish: {
    mode: 'publish',
    summary: 'Sample output — a draft post grounded in your product data.',
    escalate: false,
    research: null,
    recommendations: [],
    drafts: [
      {
        channel: 'facebook',
        text: 'Just restocked one of your favourites! 🎉 Come grab Sample Product A — quality you trust, at a fair price.',
        hashtags: ['#MadeInMalawi', '#SmallBusiness'],
        cta: 'Visit us today or message to order.',
      },
    ],
    sources: [],
  },
};

export function MarketingAssistantPage() {
  const { t } = useTranslation();
  const currentBusiness = useAppStore((s) => s.currentBusiness);
  const businessId = currentBusiness?.business?.id ?? '';
  const businessName = currentBusiness?.business?.name ?? t('marketing.yourBusiness');

  const [tab, setTab] = useState<Tab>('recommendations');
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<MarketingResult | null>(null);
  const [savingDraftId, setSavingDraftId] = useState<number>(-1);
  const [savedDraftIds, setSavedDraftIds] = useState<Set<number>>(new Set());

  // Brand voice (Phase 1) — loaded per business, passed into every generation.
  const [brandVoice, setBrandVoice] = useState('');
  const [editingVoice, setEditingVoice] = useState(false);
  const [draftVoice, setDraftVoice] = useState('');
  const [savingVoice, setSavingVoice] = useState(false);

  useEffect(() => {
    if (!businessId) return;
    let cancelled = false;
    loadBrandVoice(businessId)
      .then((v) => {
        if (!cancelled) setBrandVoice(v);
      })
      .catch((err) => log.warn('Could not load brand voice', { error: err as Error }));
    return () => {
      cancelled = true;
    };
  }, [businessId]);

  function switchTab(next: Tab) {
    setTab(next);
    setInput('');
    setError(null);
    setResult(null);
  }

  async function generate(prompt?: string) {
    const text = (prompt ?? input).trim();
    if (!businessId) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const messages = text ? [{ role: 'user' as const, content: text }] : undefined;
      const res = await callMarketingAgent({ mode: tab, businessId, messages, brandVoice: brandVoice || undefined });
      setResult(res);
    } catch (err) {
      log.error('Marketing agent request failed', err as Error);
      setError(t('marketing.error'));
    } finally {
      setLoading(false);
    }
  }

  function loadSample() {
    setError(null);
    setResult(SAMPLE_RESULT[tab]);
  }

  function startEditVoice() {
    setDraftVoice(brandVoice);
    setEditingVoice(true);
  }

  async function saveVoice() {
    try {
      setSavingVoice(true);
      await saveBrandVoice(businessId, draftVoice);
      setBrandVoice(draftVoice);
      setEditingVoice(false);
    } catch (err) {
      log.error('Could not save brand voice', err as Error);
      setError(t('marketing.voiceSaveFailed'));
    } finally {
      setSavingVoice(false);
    }
  }

  async function handleSaveDraft(draft: MarketingDraft, index: number) {
    try {
      setSavingDraftId(index);
      await saveDraft({ businessId, channel: draft.channel, text: draft.text });
      setSavedDraftIds((prev) => new Set(prev).add(index));
    } catch (err) {
      log.error('Could not save draft', err as Error);
      setError(t('marketing.draftSaveFailed'));
    } finally {
      setSavingDraftId(-1);
    }
  }

  if (!businessId) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-sm text-gray-500">{t('marketing.noBusiness')}</p>
      </div>
    );
  }

  const activeTab = TABS.find((tb) => tb.id === tab)!;
  const ActiveIcon = activeTab.icon;

  return (
    <div className="flex flex-col">
      {/* Header */}
      <div className="mb-5 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-500">
          <Megaphone className="h-5 w-5 text-white" />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-gray-900">{t('marketing.title')}</h1>
          <p className="text-xs text-gray-500">{t('marketing.liveDataFrom', { business: businessName })}</p>
        </div>
        <span className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700 ring-1 ring-amber-200">
          <Eye className="h-3.5 w-3.5" /> {t('marketing.draftOnly')}
        </span>
      </div>

      {/* Tabs */}
      <div className="mb-5 grid grid-cols-3 gap-2 rounded-2xl bg-gray-100 p-1">
        {TABS.map((tb) => {
          const Icon = tb.icon;
          const active = tb.id === tab;
          return (
            <button
              key={tb.id}
              onClick={() => switchTab(tb.id)}
              className={`flex items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                active ? 'bg-white text-brand-700 shadow-sm' : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              <Icon className="h-4 w-4" />
              {t(tb.labelKey)}
            </button>
          );
        })}
      </div>

      {/* Active tab description */}
      <div className="mb-4 flex items-start gap-3 rounded-xl border border-gray-200 bg-white p-4">
        <ActiveIcon className="mt-0.5 h-5 w-5 shrink-0 text-brand-500" />
        <p className="text-sm text-gray-600">{t(activeTab.descKey)}</p>
      </div>

      {/* Brand voice & tone (Phase 1) */}
      <div className="mb-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-brand-500" />
          <h2 className="text-sm font-semibold text-gray-900">{t('marketing.voice.title')}</h2>
          {!editingVoice && (
            <button
              onClick={startEditVoice}
              className="ml-auto inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
            >
              <Pencil className="h-3 w-3" /> {brandVoice ? t('marketing.voice.edit') : t('marketing.voice.set')}
            </button>
          )}
        </div>

        {editingVoice ? (
          <div className="mt-3">
            <textarea
              rows={4}
              value={draftVoice}
              onChange={(e) => setDraftVoice(e.target.value)}
              placeholder={t('marketing.voice.placeholder')}
              className="w-full resize-y rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
            <div className="mt-2 flex items-center gap-2">
              <button
                onClick={saveVoice}
                disabled={savingVoice}
                className="inline-flex items-center gap-1.5 rounded-lg bg-brand-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-600 disabled:opacity-40"
              >
                {savingVoice ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                {t('marketing.voice.save')}
              </button>
              <button
                onClick={() => setEditingVoice(false)}
                disabled={savingVoice}
                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
              >
                <X className="h-3.5 w-3.5" /> {t('marketing.voice.cancel')}
              </button>
            </div>
          </div>
        ) : (
          <p className={`mt-2 text-sm ${brandVoice ? 'text-gray-700' : 'text-gray-400'}`}>
            {brandVoice || t('marketing.voice.empty')}
          </p>
        )}
      </div>

      {/* Prompt input */}
      <div className="mb-3 flex gap-2 items-end">
        <div className="flex-1 rounded-xl border border-gray-200 bg-white shadow-sm focus-within:border-brand-500 focus-within:ring-1 focus-within:ring-brand-500">
          <textarea
            rows={2}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) generate();
            }}
            placeholder={t(activeTab.placeholderKey)}
            className="w-full resize-none rounded-xl px-4 py-3 text-sm text-gray-900 placeholder-gray-400 focus:outline-none"
            disabled={loading}
          />
        </div>
        <button
          onClick={() => generate()}
          disabled={loading}
          className="flex h-11 items-center gap-2 rounded-xl bg-brand-500 px-4 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-40 transition-colors"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          {loading ? t('marketing.generating') : t('marketing.generate')}
        </button>
      </div>

      {/* Suggested prompts + sample */}
      {!result && !loading && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {activeTab.samplePrompts.map((key) => (
            <button
              key={key}
              onClick={() => generate(t(key))}
              disabled={loading}
              className="rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700 transition-colors"
            >
              {t(key)}
            </button>
          ))}
          <button
            onClick={loadSample}
            className="ml-auto rounded-full px-3 py-1.5 text-xs font-medium text-gray-400 underline-offset-2 hover:text-gray-600 hover:underline"
          >
            {t('marketing.loadSample')}
          </button>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-4 text-sm text-gray-500 shadow-sm">
          <Loader2 className="h-4 w-4 animate-spin text-brand-500" />
          {t('marketing.generating')}
        </div>
      )}

      {/* Results */}
      {result && !loading && (
        <ResultsView
          result={result}
          t={t}
          savingDraftId={savingDraftId}
          savedDraftIds={savedDraftIds}
          onSaveDraft={handleSaveDraft}
        />
      )}

      <p className="mt-6 text-center text-xs text-gray-600">{t('marketing.disclaimer')}</p>
    </div>
  );
}

// ── Results renderer ────────────────────────────────────────────────────────

type TFunc = ReturnType<typeof useTranslation>['t'];

function ResultsView({
  result,
  t,
  savingDraftId,
  savedDraftIds,
  onSaveDraft,
}: {
  result: MarketingResult;
  t: TFunc;
  savingDraftId: number;
  savedDraftIds: Set<number>;
  onSaveDraft: (draft: MarketingDraft, index: number) => void;
}) {
  return (
    <div className="space-y-4">
      {/* Summary */}
      {result.summary && (
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2 text-sm font-semibold text-gray-900">
            <SparklesSmall /> {t('marketing.summary')}
          </div>
          <p className="mt-2 text-sm text-gray-700">{result.summary}</p>
        </div>
      )}

      {/* Recommendations */}
      {result.recommendations.length > 0 && (
        <div className="space-y-3">
          {result.recommendations.map((rec, i) => (
            <RecommendationCard key={i} rec={rec} t={t} />
          ))}
        </div>
      )}

      {/* Research */}
      {result.research && <ResearchView research={result.research} t={t} />}

      {/* Sources (Research + live web search) */}
      {result.sources.length > 0 && <SourcesView sources={result.sources} t={t} />}

      {/* Drafts (Publish) */}
      {result.drafts.length > 0 && (
        <div className="space-y-3">
          {result.drafts.map((draft, i) => (
            <DraftCard
              key={i}
              draft={draft}
              t={t}
              saving={savingDraftId === i}
              saved={savedDraftIds.has(i)}
              onSave={() => onSaveDraft(draft, i)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SparklesSmall() {
  return <TrendingUp className="h-4 w-4 text-brand-500" />;
}

function RecommendationCard({ rec, t }: { rec: Recommendation; t: TFunc }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-start gap-2">
        <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
        <h3 className="text-sm font-semibold text-gray-900">{rec.title}</h3>
      </div>
      <p className="mt-2 text-sm text-gray-700">{rec.rationale}</p>
      {rec.expectedImpact && (
        <p className="mt-2 text-xs text-gray-500">
          <span className="font-medium text-gray-600">{t('marketing.expectedImpact')}:</span>{' '}
          {rec.expectedImpact}
        </p>
      )}
      <p className="mt-1 text-xs text-gray-500">
        <span className="font-medium text-gray-600">{t('marketing.suggestedAction')}:</span>{' '}
        {rec.suggestedAction}
      </p>
      {rec.targetSegment && (
        <p className="mt-1 inline-flex items-center gap-1 text-xs text-brand-700">
          <Users className="h-3.5 w-3.5" />
          <span className="font-medium text-gray-600">{t('marketing.targetSegment')}:</span>{' '}
          {rec.targetSegment}
        </p>
      )}
      {rec.productRefs && rec.productRefs.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Tag className="h-3.5 w-3.5 text-gray-400" />
          {rec.productRefs.map((p, i) => (
            <span key={i} className="rounded-md bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
              {p}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function ResearchView({
  research,
  t,
}: {
  research: NonNullable<MarketingResult['research']>;
  t: TFunc;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      {research.themes.length > 0 && (
        <div className="mb-3">
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">{t('marketing.themes')}</p>
          <ul className="space-y-1 text-sm text-gray-700">
            {research.themes.map((th, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-brand-500">•</span> {th}
              </li>
            ))}
          </ul>
        </div>
      )}
      {research.opportunities.length > 0 && (
        <div className="mb-3">
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">{t('marketing.opportunities')}</p>
          <ul className="space-y-1 text-sm text-gray-700">
            {research.opportunities.map((op, i) => (
              <li key={i} className="flex gap-2">
                <TrendingUp className="h-4 w-4 shrink-0 text-emerald-500" /> {op}
              </li>
            ))}
          </ul>
        </div>
      )}
      {research.note && (
        <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">{research.note}</p>
      )}
    </div>
  );
}

function SourcesView({ sources, t }: { sources: Source[]; t: TFunc }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-gray-900">
        <ExternalLink className="h-4 w-4 text-brand-500" />
        {t('marketing.sources')}
        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-700">
          {t('marketing.liveSearch')}
        </span>
      </div>
      <ul className="space-y-2">
        {sources.map((s, i) => (
          <li key={i} className="text-sm">
            <a
              href={s.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-medium text-brand-600 hover:underline"
            >
              {s.title || s.url}
              <ExternalLink className="h-3 w-3" />
            </a>
            {s.snippet && <p className="mt-0.5 text-xs text-gray-500">{s.snippet}</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function DraftCard({
  draft,
  t,
  saving,
  saved,
  onSave,
}: {
  draft: MarketingDraft;
  t: TFunc;
  saving: boolean;
  saved: boolean;
  onSave: () => void;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="flex items-center justify-between bg-gradient-to-r from-blue-50 to-white px-4 py-2">
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-700">
          <Share2 className="h-3.5 w-3.5" /> {draft.channel}
        </span>
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-700">
          <Eye className="h-3 w-3" /> {t('marketing.previewOnly')}
        </span>
      </div>

      <div className="p-4">
        <div className="flex items-center gap-3 pb-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-600 text-sm font-semibold text-white">
            <Package className="h-5 w-5" />
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-900">Your Business Page</p>
            <p className="text-xs text-gray-500">Sponsored · just now</p>
          </div>
        </div>

        <p className="whitespace-pre-line text-sm leading-relaxed text-gray-800">{draft.text}</p>

        {draft.hashtags && draft.hashtags.length > 0 && (
          <p className="mt-2 text-sm font-medium text-blue-600">
            {draft.hashtags.map((h) => (h.startsWith('#') ? h : `#${h}`)).join(' ')}
          </p>
        )}
        {draft.cta && (
          <p className="mt-2 inline-flex items-center gap-1 text-xs text-gray-500">
            <Hash className="h-3 w-3" /> {t('marketing.cta')}: {draft.cta}
          </p>
        )}

        {/* Phase 0: draft-only actions. Live publishing arrives in Phase 3. */}
        <div className="mt-4 flex items-center gap-2 border-t border-gray-100 pt-3">
          <button
            onClick={onSave}
            disabled={saving || saved}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {saved ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> : <Save className="h-3.5 w-3.5" />}
            {saved ? t('marketing.draftSaved') : saving ? t('marketing.saving') : t('marketing.saveDraft')}
          </button>
          <button
            disabled
            title={t('marketing.publishDisabled')}
            className="cursor-not-allowed rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-400"
          >
            {t('marketing.publish')} · {t('marketing.soon')}
          </button>
        </div>
      </div>
    </div>
  );
}
