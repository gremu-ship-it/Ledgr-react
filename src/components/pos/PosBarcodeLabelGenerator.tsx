import { useState, useMemo } from 'react';
import { X, Printer, Barcode, Check, Tag, Layers, Search } from 'lucide-react';
import { generateBarcodeSvg } from '@/lib/pos/barcodeGenerator';
import { formatMwkDetailed } from '@/lib/formatters';

interface ProductLabelItem {
  id: string;
  name: string;
  sku?: string | null;
  barcode?: string | null;
  unit_price: number;
  quantity: number;
}

interface PosBarcodeLabelGeneratorProps {
  open: boolean;
  onClose: () => void;
  products: any[];
}

export function PosBarcodeLabelGenerator({
  open,
  onClose,
  products = [],
}: PosBarcodeLabelGeneratorProps) {
  if (!open) return null;

  const [selectedProductIds, setSelectedProductIds] = useState<Record<string, number>>({});
  const [template, setTemplate] = useState<'thermal_50x30' | 'a4_24' | 'a4_40'>('thermal_50x30');
  const [searchQuery, setSearchQuery] = useState('');

  const filteredProducts = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return products;
    return products.filter((p) => {
      const name = (p.name || '').toLowerCase();
      const sku = (p.sku || '').toLowerCase();
      const bc = (p.barcode || '').toLowerCase();
      return name.includes(q) || sku.includes(q) || bc.includes(q);
    });
  }, [products, searchQuery]);

  const handleToggleProduct = (product: any) => {
    setSelectedProductIds((prev) => {
      const copy = { ...prev };
      if (copy[product.id]) {
        delete copy[product.id];
      } else {
        copy[product.id] = 1;
      }
      return copy;
    });
  };

  const handleUpdateQuantity = (productId: string, qty: number) => {
    setSelectedProductIds((prev) => ({
      ...prev,
      [productId]: Math.max(1, qty),
    }));
  };

  const selectedList: ProductLabelItem[] = useMemo(() => {
    const list: ProductLabelItem[] = [];
    Object.entries(selectedProductIds).forEach(([id, qty]) => {
      const prod = products.find((p) => p.id === id);
      if (prod) {
        list.push({
          id: prod.id,
          name: prod.name,
          sku: prod.sku,
          barcode: prod.barcode || prod.sku || prod.id.slice(0, 8),
          unit_price: Number(prod.unit_price ?? prod.unitPrice ?? prod.selling_price ?? 0),
          quantity: qty,
        });
      }
    });
    return list;
  }, [selectedProductIds, products]);

  // Flatten items for printing by quantity
  const flattenedPrintItems = useMemo(() => {
    const items: ProductLabelItem[] = [];
    selectedList.forEach((item) => {
      for (let i = 0; i < item.quantity; i++) {
        items.push(item);
      }
    });
    return items;
  }, [selectedList]);

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
      <div className="w-full max-w-4xl rounded-3xl bg-white p-6 shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 pb-3">
          <div className="flex items-center gap-2">
            <Barcode className="h-5 w-5 text-brand-600" />
            <h2 className="text-base font-black text-gray-900">Barcode & Shelf Price Label Generator</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content Layout */}
        <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-4 overflow-hidden pt-4">
          {/* Left: Product Selection */}
          <div className="flex flex-col overflow-hidden border border-gray-200 rounded-2xl bg-white">
            <div className="p-3 border-b border-gray-100 space-y-2 bg-gray-50/50">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
                <input
                  type="text"
                  placeholder="Filter products to tag..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full rounded-xl border border-gray-200 pl-8 pr-3 py-1.5 text-xs focus:border-brand-500 focus:outline-none"
                />
              </div>

              {/* Template selector */}
              <div className="flex items-center gap-2 text-xs">
                <span className="font-bold text-gray-600">Label Format:</span>
                <select
                  value={template}
                  onChange={(e) => setTemplate(e.target.value as any)}
                  className="rounded-xl border border-gray-200 bg-white px-2.5 py-1 text-xs font-bold text-gray-800"
                >
                  <option value="thermal_50x30">Thermal Roll (50mm x 30mm)</option>
                  <option value="a4_24">A4 Sheet (24 Labels / 70x37mm)</option>
                  <option value="a4_40">A4 Sheet (40 Labels / 52x30mm)</option>
                </select>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto divide-y divide-gray-100 p-2 space-y-1">
              {filteredProducts.map((p) => {
                const isSelected = Boolean(selectedProductIds[p.id]);
                const qty = selectedProductIds[p.id] || 1;
                const price = Number(p.unit_price ?? p.unitPrice ?? p.selling_price ?? 0);

                return (
                  <div
                    key={p.id}
                    className={`flex items-center justify-between p-2.5 rounded-xl border transition-colors ${
                      isSelected ? 'border-brand-500 bg-brand-50/40' : 'border-gray-100 hover:bg-gray-50'
                    }`}
                  >
                    <div
                      onClick={() => handleToggleProduct(p)}
                      className="cursor-pointer min-w-0 flex-1 flex items-center gap-2"
                    >
                      <div
                        className={`h-4 w-4 rounded-md border flex items-center justify-center shrink-0 ${
                          isSelected ? 'bg-brand-600 border-brand-600 text-white' : 'border-gray-300 bg-white'
                        }`}
                      >
                        {isSelected && <Check className="h-3 w-3" />}
                      </div>
                      <div className="min-w-0">
                        <p className="font-bold text-xs text-gray-900 truncate">{p.name}</p>
                        <p className="text-[10px] text-gray-500 font-mono">
                          {p.sku || p.barcode || 'No Code'} • {formatMwkDetailed(price)}
                        </p>
                      </div>
                    </div>

                    {isSelected && (
                      <div className="flex items-center gap-1.5 ml-2">
                        <span className="text-[10px] font-bold text-gray-500">Qty:</span>
                        <input
                          type="number"
                          min={1}
                          max={200}
                          value={qty}
                          onChange={(e) => handleUpdateQuantity(p.id, Number(e.target.value))}
                          className="w-14 rounded-lg border border-gray-300 bg-white px-1.5 py-0.5 text-center text-xs font-black"
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right: Print Preview */}
          <div className="flex flex-col overflow-hidden border border-gray-200 rounded-2xl bg-gray-50/50 p-4">
            <div className="flex items-center justify-between border-b border-gray-200 pb-2 mb-3">
              <span className="text-xs font-bold uppercase tracking-wider text-gray-700">
                Print Preview ({flattenedPrintItems.length} labels)
              </span>
              <button
                type="button"
                onClick={() => setSelectedProductIds({})}
                className="text-[11px] font-bold text-red-600 hover:underline"
              >
                Clear Selected
              </button>
            </div>

            <div className="flex-1 overflow-y-auto pr-1">
              {flattenedPrintItems.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center p-6 text-gray-400">
                  <Tag className="h-8 w-8 text-gray-300 mb-2" />
                  <p className="text-xs font-bold text-gray-600">No Labels Selected</p>
                  <p className="text-[11px] text-gray-400">Select items on the left and set quantities to generate barcodes.</p>
                </div>
              ) : (
                <div
                  className={`grid gap-3 ${
                    template === 'thermal_50x30'
                      ? 'grid-cols-1'
                      : template === 'a4_24'
                      ? 'grid-cols-2'
                      : 'grid-cols-2 sm:grid-cols-3'
                  }`}
                >
                  {flattenedPrintItems.map((item, idx) => {
                    const barcodeCode = item.barcode || item.sku || item.id.slice(0, 8);
                    const svgMarkup = generateBarcodeSvg(barcodeCode, {
                      height: 36,
                      barWidth: 1.5,
                      showText: true,
                    });

                    return (
                      <div
                        key={idx}
                        className="rounded-xl border border-gray-300 bg-white p-3 flex flex-col items-center justify-between text-center shadow-2xs font-sans"
                      >
                        <p className="text-[11px] font-black text-gray-900 line-clamp-1 w-full">
                          {item.name}
                        </p>
                        <div
                          className="my-1.5 flex items-center justify-center w-full overflow-hidden"
                          dangerouslySetInnerHTML={{ __html: svgMarkup }}
                        />
                        <p className="text-xs font-black text-brand-700">
                          {formatMwkDetailed(item.unit_price)}
                        </p>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Print Footer */}
            <div className="pt-3 border-t border-gray-200 mt-2">
              <button
                type="button"
                disabled={flattenedPrintItems.length === 0}
                onClick={handlePrint}
                className="w-full flex items-center justify-center gap-2 rounded-2xl bg-brand-600 hover:bg-brand-700 text-white py-3 text-xs font-black shadow-md disabled:opacity-40 active:scale-95 transition-all"
              >
                <Printer className="h-4 w-4" />
                Print {flattenedPrintItems.length} Label(s)
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
