import { useState, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Upload, Download, FileText, CheckCircle, AlertCircle,
  ArrowRight, ArrowLeft, X, Eye, AlertTriangle,
  Building2, Users, Package, Calculator, Landmark,
  CreditCard, FileSpreadsheet, Sparkles, Info
} from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { repos } from '@/lib/repositories';
import {
  IMPORT_TEMPLATES,
  parseCSVFile,
  validateRows,
  executeImport,
  downloadTemplate,
  type ImportEntityType,
  type ImportPreview,
  type ImportTemplate
} from '@/services/dataImportService';

// ── Constants ─────────────────────────────────────────────────────────────────

const ENTITY_ICONS: Record<ImportEntityType, any> = {
  chart_of_accounts: Building2,
  contacts: Users,
  products: Package,
  opening_balances: Calculator,
  trial_balance: FileSpreadsheet,
  invoices: FileText,
  bills: CreditCard,
  fixed_assets: Landmark,
  inventory_opening: Package,
  bank_transactions: CreditCard,
  employees: Users
};

const ENTITY_CATEGORIES = [
  {
    label: 'Foundation Data',
    description: 'Start here - essential for migration',
    entities: ['chart_of_accounts', 'opening_balances', 'trial_balance'] as ImportEntityType[]
  },
  {
    label: 'Master Data',
    description: 'Customers, suppliers, products',
    entities: ['contacts', 'products'] as ImportEntityType[]
  },
  {
    label: 'Operations',
    description: 'Historical transactions and assets',
    entities: ['fixed_assets', 'inventory_opening', 'invoices', 'bills'] as ImportEntityType[]
  },
  {
    label: 'Additional',
    description: 'Bank, employees and more',
    entities: ['bank_transactions', 'employees'] as ImportEntityType[]
  }
];

type ImportStep = 'select' | 'upload' | 'preview' | 'importing' | 'result';

// ── Components ────────────────────────────────────────────────────────────────

function TemplateCard({ template, onDownload, onSelect }: {
  template: ImportTemplate;
  onDownload: () => void;
  onSelect: () => void;
}) {
  const Icon = ENTITY_ICONS[template.entityType] || FileText;
  
  return (
    <div className="group rounded-2xl border border-gray-200 bg-white p-5 hover:border-brand-300 hover:shadow-sm transition-all">
      <div className="flex items-start justify-between">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-600 group-hover:bg-brand-100">
          <Icon className="h-5 w-5" />
        </div>
        <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-[10px] font-medium text-gray-600">
          {template.headers.length} columns
        </span>
      </div>
      
      <h3 className="mt-3 font-semibold text-gray-900">{template.label}</h3>
      <p className="mt-1 text-xs text-gray-500 line-clamp-2">{template.description}</p>
      
      <div className="mt-3 flex flex-wrap gap-1">
        {template.requiredHeaders.slice(0, 3).map(h => (
          <span key={h} className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
            {h}*
          </span>
        ))}
        {template.requiredHeaders.length > 3 && (
          <span className="text-[10px] text-gray-400">+{template.requiredHeaders.length - 3} more</span>
        )}
      </div>

      <div className="mt-4 flex gap-2">
        <button
          onClick={onDownload}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50"
        >
          <Download className="h-3.5 w-3.5" />
          Template
        </button>
        <button
          onClick={onSelect}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-brand-500 px-3 py-2 text-xs font-semibold text-white hover:bg-brand-600"
        >
          <Upload className="h-3.5 w-3.5" />
          Import
        </button>
      </div>
    </div>
  );
}

function FileDropZone({ onFile, accept = '.csv', isLoading }: {
  onFile: (file: File) => void;
  accept?: string;
  isLoading?: boolean;
}) {
  const [dragOver, setDragOver] = useState(false);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) onFile(file);
  }, [onFile]);

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      className={`relative flex flex-col items-center justify-center rounded-2xl border-2 border-dashed p-8 transition-colors ${
        dragOver ? 'border-brand-400 bg-brand-50' : 'border-gray-200 bg-gray-50 hover:border-gray-300 hover:bg-white'
      }`}
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white shadow-sm border border-gray-100">
        <Upload className="h-6 w-6 text-gray-400" />
      </div>
      
      <h3 className="mt-4 text-sm font-semibold text-gray-900">Drop your CSV file here</h3>
      <p className="mt-1 text-xs text-gray-500">or click to browse (max 10MB)</p>
      
      <input
        type="file"
        accept={accept}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFile(file);
          e.target.value = '';
        }}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        disabled={isLoading}
      />

      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center rounded-2xl bg-white/80 backdrop-blur">
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
            Parsing file...
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export function DataImportPage() {
  const currentBusiness = useAppStore(s => s.currentBusiness);
  const businessId = currentBusiness?.business?.id;
  const queryClient = useQueryClient();

  // Check if this is a new business onboarding flow
  const urlParams = new URLSearchParams(window.location.search);
  const isNewBusiness = urlParams.get('new') === 'true';

  const [selectedEntity, setSelectedEntity] = useState<ImportEntityType | null>(null);
  const [step, setStep] = useState<ImportStep>('select');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [importResult, setImportResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: categories = [] } = useQuery({
    queryKey: ['asset_categories', businessId],
    queryFn: () => repos.asset.findCategories(businessId!),
    enabled: Boolean(businessId)
  });

  const { data: existingAccounts = [] } = useQuery({
    queryKey: ['accounts', businessId],
    queryFn: () => repos.account.findByBusiness(businessId!),
    enabled: Boolean(businessId)
  });

  const handleEntitySelect = (entity: ImportEntityType) => {
    setSelectedEntity(entity);
    setStep('upload');
    setFile(null);
    setPreview(null);
    setError(null);
  };

  const handleFile = async (f: File) => {
    if (!selectedEntity) return;
    
    setFile(f);
    setIsParsing(true);
    setError(null);

    try {
      const parsed = await parseCSVFile(f);
      
      // Validate
      const existingCodes = selectedEntity === 'chart_of_accounts' 
        ? new Set(existingAccounts.map(a => a.code))
        : undefined;
      
      const validated = validateRows(parsed, selectedEntity, existingCodes);
      
      setPreview(validated);
      setStep('preview');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setIsParsing(false);
    }
  };

  const handleImport = async () => {
    if (!businessId || !selectedEntity || !preview) return;

    setStep('importing');
    
    const validRows = preview.rows.filter(r => r.isValid);
    
    try {
      const result = await executeImport(
        businessId,
        selectedEntity,
        validRows,
        { categories }
      );

      setImportResult(result);
      setStep('result');

      // Invalidate relevant queries
      queryClient.invalidateQueries({ queryKey: ['accounts', businessId] });
      queryClient.invalidateQueries({ queryKey: ['contacts', businessId] });
      queryClient.invalidateQueries({ queryKey: ['products', businessId] });
      queryClient.invalidateQueries({ queryKey: ['assets', businessId] });
      queryClient.invalidateQueries({ queryKey: ['sofp'] });
      queryClient.invalidateQueries({ queryKey: ['trial_balance'] });
    } catch (e) {
      setError((e as Error).message);
      setStep('preview');
    }
  };

  if (!businessId) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-sm text-gray-500">No business selected.</p>
      </div>
    );
  }

  const template = selectedEntity ? IMPORT_TEMPLATES[selectedEntity] : null;

  return (
    <div className="mx-auto max-w-6xl">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-500 text-white">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold text-gray-900">
                {isNewBusiness ? 'Welcome! Import your data' : 'Data Import'}
              </h1>
              <p className="text-sm text-gray-500">
                {isNewBusiness 
                  ? `Your business "${currentBusiness?.business?.name}" is ready. Import data from your previous system or start fresh.`
                  : 'Migrate from QuickBooks, Xero, Sage, Excel or any CSV export'}
              </p>
            </div>
          </div>
          
          {isNewBusiness && step === 'select' && (
            <button
              onClick={() => window.location.href = '/dashboard'}
              className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Skip for now → Dashboard
            </button>
          )}
        </div>

        {isNewBusiness && step === 'select' && (
          <div className="mt-4 rounded-2xl border border-green-200 bg-green-50 p-4">
            <div className="flex gap-3">
              <CheckCircle className="h-5 w-5 text-green-600 shrink-0 mt-0.5" />
              <div className="text-sm">
                <p className="font-semibold text-green-900">Business created successfully!</p>
                <p className="mt-1 text-green-700">
                  You can now import data from your previous accounting system (QuickBooks, Xero, Sage, Excel) 
                  to avoid manual entry. Or skip and start fresh - you can always import later from Tools → Data Import.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Progress */}
        {selectedEntity && (
          <div className="mt-6 flex items-center gap-2">
            {(['select', 'upload', 'preview', 'result'] as ImportStep[]).map((s, idx) => {
              const isActive = step === s || (step === 'importing' && s === 'preview');
              const isPast = ['select', 'upload', 'preview', 'importing', 'result'].indexOf(step) > idx;
              const isCurrent = step === s;
              
              return (
                <div key={s} className="flex items-center gap-2">
                  <div className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold transition-colors ${
                    isPast ? 'bg-brand-500 text-white' :
                    isCurrent ? 'bg-brand-500 text-white ring-4 ring-brand-100' :
                    'bg-gray-200 text-gray-500'
                  }`}>
                    {isPast ? '✓' : idx + 1}
                  </div>
                  <span className={`hidden sm:block text-xs font-medium capitalize ${isActive ? 'text-gray-900' : 'text-gray-400'}`}>
                    {s}
                  </span>
                  {idx < 3 && <div className={`h-0.5 w-8 sm:w-12 ${isPast ? 'bg-brand-500' : 'bg-gray-200'}`} />}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Step: Select Entity */}
      {step === 'select' && (
        <div className="space-y-8">
          {/* Info Banner */}
          <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4">
            <div className="flex gap-3">
              <Info className="h-5 w-5 text-blue-600 shrink-0 mt-0.5" />
              <div className="text-sm">
                <p className="font-semibold text-blue-900">New to Ledgr? Migrate in minutes</p>
                <p className="mt-1 text-blue-700">
                  Upload CSV files exported from your previous accounting system. We support QuickBooks, Xero, Sage, 
                  Excel and any CSV format. Start with Chart of Accounts and Opening Balances, then import contacts and products.
                </p>
                <div className="mt-2 flex flex-wrap gap-2 text-xs">
                  <span className="rounded-full bg-blue-100 px-2 py-0.5 text-blue-700">✓ QuickBooks</span>
                  <span className="rounded-full bg-blue-100 px-2 py-0.5 text-blue-700">✓ Xero</span>
                  <span className="rounded-full bg-blue-100 px-2 py-0.5 text-blue-700">✓ Sage</span>
                  <span className="rounded-full bg-blue-100 px-2 py-0.5 text-blue-700">✓ Excel</span>
                  <span className="rounded-full bg-blue-100 px-2 py-0.5 text-blue-700">✓ CSV</span>
                </div>
              </div>
            </div>
          </div>

          {ENTITY_CATEGORIES.map(category => (
            <div key={category.label}>
              <div className="mb-3">
                <h2 className="text-base font-semibold text-gray-900">{category.label}</h2>
                <p className="text-xs text-gray-500">{category.description}</p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {category.entities.map(entityType => {
                  const tmpl = IMPORT_TEMPLATES[entityType];
                  return (
                    <TemplateCard
                      key={entityType}
                      template={tmpl}
                      onDownload={() => downloadTemplate(entityType)}
                      onSelect={() => handleEntitySelect(entityType)}
                    />
                  );
                })}
              </div>
            </div>
          ))}

          {/* Quick Start Guide */}
          <div className="rounded-2xl border border-gray-200 bg-white p-6">
            <h3 className="font-semibold text-gray-900">Recommended migration order</h3>
            <div className="mt-4 grid gap-3 sm:grid-cols-4">
              {[
                { step: 1, title: 'Chart of Accounts', desc: 'Your account structure' },
                { step: 2, title: 'Opening Balances', desc: 'Trial balance as of cut-off' },
                { step: 3, title: 'Contacts', desc: 'Customers & suppliers' },
                { step: 4, title: 'Products & Assets', desc: 'Inventory and fixed assets' },
              ].map(item => (
                <div key={item.step} className="flex gap-3 rounded-xl bg-gray-50 p-3">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-500 text-xs font-bold text-white">
                    {item.step}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-900">{item.title}</p>
                    <p className="text-xs text-gray-500">{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Step: Upload */}
      {step === 'upload' && template && (
        <div className="mx-auto max-w-2xl">
          <button
            onClick={() => setStep('select')}
            className="mb-4 flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to templates
          </button>

          <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
                {(() => {
                  const Icon = ENTITY_ICONS[template.entityType];
                  return <Icon className="h-5 w-5" />;
                })()}
              </div>
              <div>
                <h2 className="font-semibold text-gray-900">{template.label}</h2>
                <p className="text-xs text-gray-500">{template.description}</p>
              </div>
            </div>

            <div className="mt-6 space-y-4">
              <div>
                <h3 className="text-sm font-medium text-gray-700">Required columns</h3>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {template.headers.map(h => {
                    const isRequired = template.requiredHeaders.map(r => r.toLowerCase()).includes(h.toLowerCase());
                    return (
                      <span key={h} className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                        isRequired ? 'bg-amber-50 text-amber-700 border border-amber-200' : 'bg-gray-100 text-gray-600'
                      }`}>
                        {h}{isRequired ? ' *' : ''}
                      </span>
                    );
                  })}
                </div>
              </div>

              <div className="rounded-xl bg-gray-50 p-4">
                <h4 className="text-xs font-semibold text-gray-700">Example format</h4>
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-gray-200 text-left">
                        {template.headers.slice(0, 4).map(h => (
                          <th key={h} className="pb-1 pr-3 font-medium text-gray-500">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {template.exampleRows.slice(0, 2).map((row, idx) => (
                        <tr key={idx} className="border-b border-gray-100 last:border-0">
                          {template.headers.slice(0, 4).map(h => (
                            <td key={h} className="py-1 pr-3 text-gray-700 truncate max-w-[120px]">{(row as any)[h]}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => downloadTemplate(template.entityType)}
                  className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50"
                >
                  <Download className="h-3.5 w-3.5" />
                  Download template
                </button>
                {template.systemMappings && (
                  <div className="flex items-center gap-1 text-xs text-gray-500">
                    <Sparkles className="h-3 w-3" />
                    Auto-detects QuickBooks, Xero, Sage
                  </div>
                )}
              </div>

              <FileDropZone onFile={handleFile} isLoading={isParsing} />

              {error && (
                <div className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
                  <AlertCircle className="h-4 w-4" />
                  {error}
                </div>
              )}

              {file && (
                <div className="flex items-center justify-between rounded-lg bg-brand-50 px-3 py-2 text-xs">
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-brand-600" />
                    <span className="font-medium text-brand-800">{file.name}</span>
                    <span className="text-brand-600">({(file.size / 1024).toFixed(1)} KB)</span>
                  </div>
                  <button onClick={() => { setFile(null); setPreview(null); }} className="text-brand-600 hover:text-brand-700">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Step: Preview */}
      {step === 'preview' && preview && template && (
        <div className="space-y-6">
          <button
            onClick={() => setStep('upload')}
            className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to upload
          </button>

          <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-semibold text-gray-900">Preview & Validate</h2>
                <p className="text-xs text-gray-500">
                  {preview.totalRows} rows found • {preview.validRows} valid • {preview.invalidRows} invalid
                  {preview.detectedSystem && (
                    <span className="ml-2 rounded-full bg-green-50 px-2 py-0.5 text-green-700">
                      Detected: {preview.detectedSystem}
                    </span>
                  )}
                </p>
              </div>
              
              <div className="flex gap-2">
                <div className="rounded-full bg-green-50 px-3 py-1 text-xs font-medium text-green-700">
                  {preview.validRows} ready
                </div>
                {preview.invalidRows > 0 && (
                  <div className="rounded-full bg-red-50 px-3 py-1 text-xs font-medium text-red-700">
                    {preview.invalidRows} errors
                  </div>
                )}
              </div>
            </div>

            {preview.invalidRows > 0 && (
              <div className="mt-4 max-h-32 overflow-y-auto rounded-lg bg-red-50 p-3">
                <p className="text-xs font-medium text-red-800">Fix these errors before importing:</p>
                <ul className="mt-1 space-y-1">
                  {preview.rows.filter(r => !r.isValid).slice(0, 5).map(row => (
                    <li key={row.rowNumber} className="text-xs text-red-700">
                      Row {row.rowNumber}: {row.errors.join(', ')}
                    </li>
                  ))}
                  {preview.invalidRows > 5 && (
                    <li className="text-xs text-red-600">+{preview.invalidRows - 5} more errors...</li>
                  )}
                </ul>
              </div>
            )}

            <div className="mt-4 overflow-x-auto rounded-xl border border-gray-200">
              <table className="w-full text-xs">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-gray-500">#</th>
                    {preview.headers.slice(0, 6).map(h => (
                      <th key={h} className="px-3 py-2 text-left font-medium text-gray-500">{h}</th>
                    ))}
                    <th className="px-3 py-2 text-left font-medium text-gray-500">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {preview.rows.slice(0, 10).map(row => (
                    <tr key={row.rowNumber} className={row.isValid ? '' : 'bg-red-50/50'}>
                      <td className="px-3 py-2 text-gray-500">{row.rowNumber}</td>
                      {preview.headers.slice(0, 6).map(h => (
                        <td key={h} className="px-3 py-2 text-gray-700 truncate max-w-[120px]">
                          {row.data[h] || <span className="text-gray-400">—</span>}
                        </td>
                      ))}
                      <td className="px-3 py-2">
                        {row.isValid ? (
                          <CheckCircle className="h-4 w-4 text-green-500" />
                        ) : (
                          <AlertCircle className="h-4 w-4 text-red-500" />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {preview.totalRows > 10 && (
                <div className="bg-gray-50 px-3 py-2 text-center text-xs text-gray-500">
                  Showing 10 of {preview.totalRows} rows
                </div>
              )}
            </div>

            <div className="mt-6 flex justify-between">
              <button
                onClick={() => setStep('upload')}
                className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Back
              </button>
              
              <button
                onClick={handleImport}
                disabled={preview.validRows === 0}
                className="flex items-center gap-2 rounded-lg bg-brand-500 px-6 py-2 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Import {preview.validRows} records
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Step: Importing */}
      {step === 'importing' && (
        <div className="mx-auto max-w-lg rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
          </div>
          <h3 className="mt-4 font-semibold text-gray-900">Importing data...</h3>
          <p className="mt-1 text-sm text-gray-500">Please wait while we import your records</p>
          <p className="mt-2 text-xs text-gray-400">This may take a few moments for large files</p>
        </div>
      )}

      {/* Step: Result */}
      {step === 'result' && importResult && (
        <div className="mx-auto max-w-lg">
          <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <div className="text-center">
              <div className={`mx-auto flex h-12 w-12 items-center justify-center rounded-2xl ${
                importResult.failed === 0 ? 'bg-green-50 text-green-600' : 'bg-amber-50 text-amber-600'
              }`}>
                {importResult.failed === 0 ? (
                  <CheckCircle className="h-6 w-6" />
                ) : (
                  <AlertTriangle className="h-6 w-6" />
                )}
              </div>
              
              <h3 className="mt-4 text-lg font-semibold text-gray-900">
                {importResult.failed === 0 ? 'Import successful!' : 'Import completed with issues'}
              </h3>
              
              <div className="mt-4 grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-green-50 p-3">
                  <p className="text-2xl font-bold text-green-700">{importResult.success}</p>
                  <p className="text-xs text-green-600">Imported</p>
                </div>
                <div className="rounded-xl bg-red-50 p-3">
                  <p className="text-2xl font-bold text-red-700">{importResult.failed}</p>
                  <p className="text-xs text-red-600">Failed</p>
                </div>
              </div>

              {importResult.errors && importResult.errors.length > 0 && (
                <div className="mt-4 max-h-40 overflow-y-auto rounded-lg bg-red-50 p-3 text-left">
                  <p className="text-xs font-medium text-red-800">Errors:</p>
                  <ul className="mt-1 space-y-1">
                    {importResult.errors.slice(0, 5).map((err: any, idx: number) => (
                      <li key={idx} className="text-xs text-red-700">
                        Row {err.row}: {err.message}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="mt-6 flex gap-2">
                <button
                  onClick={() => {
                    setStep('select');
                    setSelectedEntity(null);
                    setFile(null);
                    setPreview(null);
                    setImportResult(null);
                  }}
                  className="flex-1 rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  Import more
                </button>
                <button
                  onClick={() => {
                    // Navigate to relevant page
                    if (selectedEntity === 'chart_of_accounts') window.location.href = '/accounts';
                    else if (selectedEntity === 'contacts') window.location.href = '/contacts';
                    else if (selectedEntity === 'products') window.location.href = '/products';
                    else if (selectedEntity === 'fixed_assets') window.location.href = '/assets';
                    else window.location.href = '/dashboard';
                  }}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-600"
                >
                  <Eye className="h-4 w-4" />
                  View data
                </button>
              </div>
            </div>
          </div>

          {/* Next steps */}
          {importResult.success > 0 && (
            <div className="mt-4 rounded-2xl border border-blue-200 bg-blue-50 p-4">
              <h4 className="text-sm font-semibold text-blue-900">Next steps</h4>
              <ul className="mt-2 space-y-1 text-xs text-blue-700">
                {selectedEntity === 'chart_of_accounts' && <li>• Review your Chart of Accounts in Settings → Chart of Accounts</li>}
                {selectedEntity === 'opening_balances' && <li>• Check your Statement of Financial Position to verify opening balances</li>}
                {selectedEntity === 'contacts' && <li>• Your contacts are ready for invoicing</li>}
                <li>• Continue importing other data types from the import hub</li>
                <li>• Run your first financial reports to verify data</li>
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
