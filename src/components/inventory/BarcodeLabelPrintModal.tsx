import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Barcode, Printer, X } from 'lucide-react';
import { getBarcodeData } from '@/lib/pos/barcodeGenerator';
import { formatMwkDetailed } from '@/lib/formatters';

export interface BarcodeLabelProduct {
  id: string;
  name: string;
  sku?: string | null;
  barcode?: string | null;
  unit_price: number;
  /** Used as the default label count when a product is selected. */
  stock_quantity?: number | null;
}

interface BarcodeLabelPrintModalProps {
  open: boolean;
  onClose: () => void;
  products: BarcodeLabelProduct[];
  businessName?: string;
  initialProductId?: string;
}

function defaultCountFor(product: BarcodeLabelProduct | undefined): string {
  return String(Math.max(1, Math.floor(Number(product?.stock_quantity) || 1)));
}

/** Prints N copies of one product's barcode on a 3-across sticker sheet/roll. */
export function BarcodeLabelPrintModal({
  open,
  onClose,
  products,
  businessName,
  initialProductId,
}: BarcodeLabelPrintModalProps) {
  const { t } = useTranslation();
  const [selectedId, setSelectedId] = useState('');
  const [labelCount, setLabelCount] = useState('1');

  useEffect(() => {
    if (!open) return;
    const preferred = products.find((product) => product.id === initialProductId)
      ?? products.find((product) => product.id === selectedId)
      ?? products[0];
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset count to the selected item's stock on open
    setSelectedId(preferred?.id ?? '');
    setLabelCount(defaultCountFor(preferred));
  }, [open, initialProductId, products, selectedId]);

  const selected = products.find((product) => product.id === selectedId);
  const count = Math.max(1, parseInt(labelCount, 10) || 1);
  const barcodeValue = selected?.barcode || selected?.sku || selected?.id || '';
  const barcodeData = useMemo(
    () => getBarcodeData(barcodeValue, { height: 30, barWidth: 1.2 }),
    [barcodeValue],
  );
  const labels = useMemo(() => Array.from({ length: count }, (_, index) => index), [count]);

  if (!open) return null;

  const handleSelect = (productId: string) => {
    setSelectedId(productId);
    setLabelCount(defaultCountFor(products.find((product) => product.id === productId)));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
          <div className="flex items-center gap-2">
            <Barcode className="h-5 w-5 text-brand-600" />
            <h2 className="text-base font-black text-gray-900">{t('barcodeLabels.title')}</h2>
          </div>
          <button
            type="button"
            aria-label={t('barcodeLabels.close')}
            onClick={onClose}
            className="rounded-xl p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="grid flex-1 grid-cols-1 gap-4 overflow-hidden p-5 md:grid-cols-[260px_1fr]">
          <div className="space-y-4">
            <div>
              <label htmlFor="barcode-label-product" className="mb-1 block text-xs font-bold text-gray-600">
                {t('barcodeLabels.product')}
              </label>
              <select
                id="barcode-label-product"
                value={selectedId}
                onChange={(event) => handleSelect(event.target.value)}
                className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
              >
                {products.length === 0 && <option value="">{t('barcodeLabels.noProducts')}</option>}
                {products.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.name}{product.sku ? ` · ${product.sku}` : ''}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="barcode-label-count" className="mb-1 block text-xs font-bold text-gray-600">
                {t('barcodeLabels.labelCount')}
              </label>
              <input
                id="barcode-label-count"
                type="number"
                min="1"
                step="1"
                value={labelCount}
                onChange={(event) => setLabelCount(event.target.value)}
                onBlur={() => setLabelCount(String(count))}
                className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm font-bold focus:border-brand-500 focus:outline-none"
              />
              <p className="mt-1 text-[11px] text-gray-500">
                {t('barcodeLabels.preview', { count })}
              </p>
            </div>
          </div>

          <div className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-gray-200 bg-gray-50/60">
            <div className="border-b border-gray-200 px-4 py-2 text-xs font-bold uppercase tracking-wide text-gray-600">
              {t('barcodeLabels.preview', { count })}
            </div>
            <div id="ledgr-barcode-sheet" className="grid flex-1 grid-cols-2 gap-2 overflow-y-auto p-3 sm:grid-cols-3">
              {labels.map((index) => (
                <div
                  key={index}
                  className="label-card flex min-h-[110px] flex-col items-center justify-center rounded-lg border border-dashed border-gray-300 bg-white p-2 text-center"
                >
                  <p className="w-full truncate text-[10px] font-bold uppercase text-gray-500">
                    {businessName || t('barcodeLabels.businessFallback')}
                  </p>
                  <p className="w-full truncate text-xs font-black text-gray-900">{selected?.name ?? '—'}</p>
                  <p className="w-full truncate font-mono text-[10px] text-gray-600">
                    {t('barcodeLabels.sku')}: {selected?.sku || selected?.barcode || '—'}
                  </p>
                  <div className="my-1 flex w-full items-center justify-center overflow-hidden">
                    {barcodeData.bars.length > 0 && (
                      <svg
                        viewBox={`0 0 ${barcodeData.totalWidth} ${barcodeData.height + 12}`}
                        width={Math.min(barcodeData.totalWidth, 190)}
                        height={barcodeData.height + 12}
                        aria-label={barcodeValue}
                      >
                        {barcodeData.bars.map((bar, barIndex) => (
                          <rect
                            key={barIndex}
                            x={bar.x}
                            y={0}
                            width={bar.width}
                            height={barcodeData.height}
                            fill="#000000"
                          />
                        ))}
                        <text
                          x={barcodeData.totalWidth / 2}
                          y={barcodeData.height + 10}
                          fontFamily="monospace"
                          fontSize={9}
                          fontWeight="bold"
                          textAnchor="middle"
                          fill="#000000"
                        >
                          {barcodeData.text}
                        </text>
                      </svg>
                    )}
                  </div>
                  <p className="text-xs font-black text-brand-700">
                    {formatMwkDetailed(Number(selected?.unit_price ?? 0))}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="border-t border-gray-100 px-5 py-3">
          <button
            type="button"
            disabled={!selected}
            onClick={() => window.print()}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-600 py-3 text-sm font-black text-white hover:bg-brand-700 disabled:opacity-40"
          >
            <Printer className="h-4 w-4" />
            {t('barcodeLabels.print', { count })}
          </button>
        </div>
      </div>

      <style>{`
        @media print {
          @page { size: A4; margin: 8mm; }
          body * { visibility: hidden !important; }
          #ledgr-barcode-sheet, #ledgr-barcode-sheet * { visibility: visible !important; }
          #ledgr-barcode-sheet {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
            display: grid !important;
            grid-template-columns: repeat(3, 1fr);
            gap: 0;
            padding: 0;
            overflow: visible !important;
          }
          .label-card {
            height: 32mm;
            min-height: 32mm;
            border: 1px dashed #999;
            page-break-inside: avoid;
            break-inside: avoid;
          }
        }
      `}</style>
    </div>
  );
}

export default BarcodeLabelPrintModal;
