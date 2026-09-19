import { useState, useMemo, useRef } from 'react';
import {
  Search,
  ScanBarcode,
  Package,
  Plus,
} from 'lucide-react';
import { formatMwkDetailed } from '@/lib/formatters';

interface PosProductCatalogProps {
  products: any[];
  categories?: string[];
  isLoading?: boolean;
  onAddToCart: (product: any) => void;
}

export function PosProductCatalog({
  products = [],
  categories = [],
  isLoading = false,
  onAddToCart,
}: PosProductCatalogProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const barcodeInputRef = useRef<HTMLInputElement>(null);

  // Filter products by category & search query (name, sku, barcode)
  const filteredProducts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return products.filter((p) => {
      // Category filter
      if (selectedCategory !== 'all') {
        const cat = p.category || p.category_id;
        if (cat !== selectedCategory) return false;
      }
      // Search term
      if (!q) return true;
      const name = (p.name || '').toLowerCase();
      const sku = (p.sku || '').toLowerCase();
      const barcode = (p.barcode || '').toLowerCase();
      return name.includes(q) || sku.includes(q) || barcode.includes(q);
    });
  }, [products, searchQuery, selectedCategory]);

  // Handle barcode scanner input enter
  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      const q = searchQuery.trim();
      if (!q) return;

      // Exact match for barcode or SKU
      const exactMatch = products.find(
        (p) =>
          (p.barcode && p.barcode.toLowerCase() === q.toLowerCase()) ||
          (p.sku && p.sku.toLowerCase() === q.toLowerCase()),
      );

      if (exactMatch) {
        onAddToCart(exactMatch);
        setSearchQuery('');
      } else if (filteredProducts.length === 1) {
        onAddToCart(filteredProducts[0]);
        setSearchQuery('');
      }
    }
  };

  return (
    <div className="flex flex-col h-full bg-gray-50/50">
      {/* ── Search & Barcode Bar ── */}
      <div className="p-4 border-b border-gray-200 bg-white space-y-3">
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            ref={barcodeInputRef}
            type="text"
            placeholder="Scan barcode (Enter) or search item by name/SKU..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            className="w-full rounded-2xl border border-gray-200 bg-gray-50/70 pl-10 pr-10 py-3 text-xs font-semibold focus:border-brand-500 focus:bg-white focus:outline-none transition-all shadow-2xs"
          />
          <button
            type="button"
            onClick={() => barcodeInputRef.current?.focus()}
            title="Focus Barcode Scanner"
            className="absolute right-3 top-1/2 -translate-y-1/2 rounded-xl p-1 text-gray-400 hover:text-brand-600 hover:bg-gray-100"
          >
            <ScanBarcode className="h-4 w-4" />
          </button>
        </div>

        {/* Category Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 scrollbar-none">
          <button
            type="button"
            onClick={() => setSelectedCategory('all')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all ${
              selectedCategory === 'all'
                ? 'bg-brand-600 text-white shadow-2xs'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            All Products ({products.length})
          </button>
          {categories.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setSelectedCategory(cat)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all ${
                selectedCategory === cat
                  ? 'bg-brand-600 text-white shadow-2xs'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* ── Products Grid ── */}
      <div className="flex-1 overflow-y-auto p-4">
        {isLoading ? (
          <div className="h-full flex items-center justify-center text-xs font-bold text-gray-400">
            Loading products catalog...
          </div>
        ) : filteredProducts.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-6 text-gray-400">
            <Package className="h-10 w-10 text-gray-300 stroke-[1.5] mb-2" />
            <p className="text-sm font-bold text-gray-600">No products found</p>
            <p className="text-xs text-gray-400 mt-0.5">Try a different search term or category filter.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
            {filteredProducts.map((p) => {
              const price = p.unit_price ?? p.unitPrice ?? p.selling_price ?? 0;
              const stock = p.stock_quantity ?? p.stockQuantity ?? 0;
              const isLowStock = stock <= 5;
              const isOutOfStock = stock <= 0;

              return (
                <button
                  key={p.id}
                  type="button"
                  disabled={isOutOfStock}
                  onClick={() => onAddToCart(p)}
                  className={`group relative flex flex-col justify-between p-3 rounded-2xl border text-left transition-all active:scale-95 select-none ${
                    isOutOfStock
                      ? 'border-gray-200 bg-gray-100 opacity-60 cursor-not-allowed'
                      : 'border-gray-200 bg-white hover:border-brand-500 hover:shadow-md'
                  }`}
                >
                  <div>
                    <div className="flex items-start justify-between gap-1 mb-1.5">
                      <span className="text-[10px] uppercase font-bold text-gray-400 truncate max-w-[80px]">
                        {p.sku || p.category || 'General'}
                      </span>
                      <span
                        className={`rounded-md px-1.5 py-0.5 text-[9px] font-black uppercase ${
                          isOutOfStock
                            ? 'bg-red-100 text-red-700'
                            : isLowStock
                            ? 'bg-amber-100 text-amber-700'
                            : 'bg-emerald-50 text-emerald-700'
                        }`}
                      >
                        {isOutOfStock ? 'Out' : `${stock} left`}
                      </span>
                    </div>

                    <h4 className="font-bold text-xs text-gray-900 line-clamp-2 leading-snug group-hover:text-brand-600 transition-colors">
                      {p.name}
                    </h4>
                  </div>

                  <div className="mt-3 flex items-center justify-between pt-2 border-t border-gray-100">
                    <span className="text-xs font-black text-gray-900">
                      {formatMwkDetailed(price)}
                    </span>
                    <div className="flex h-6 w-6 items-center justify-center rounded-xl bg-brand-50 text-brand-600 group-hover:bg-brand-600 group-hover:text-white transition-colors">
                      <Plus className="h-3.5 w-3.5" />
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
