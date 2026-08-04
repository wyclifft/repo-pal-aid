import { useState, useEffect, useCallback, useRef } from 'react';
import { mysqlApi, Item } from '@/services/mysqlApi';
import { useIndexedDB } from '@/hooks/useIndexedDB';
import { generateDeviceFingerprint } from '@/utils/deviceFingerprint';
import { useAppSettings } from '@/hooks/useAppSettings';
import { Loader2, Package } from 'lucide-react';

interface ProductSelectorProps {
  selectedProduct: Item | null;
  onProductChange: (product: Item | null) => void;
  routeCode?: string; // Route tcode to filter products
  disabled?: boolean;
  onProductsLoaded?: (count: number) => void; // Notify parent of available product count
}

/**
 * v2.12.6: the load effect no longer depends on `selectedProduct` /
 * `onProductChange`. Those changed identity on every selection, which
 * re-ran the effect and fired another /api/items request — a self-feeding
 * loop that hammered the backend and made the selector flicker/freeze while
 * online. Callbacks and current selection now live in refs, the network sync
 * is deferred until after first paint, and the cached list renders instantly.
 */
export const ProductSelector = ({ 
  selectedProduct, 
  onProductChange, 
  routeCode,
  disabled,
  onProductsLoaded
}: ProductSelectorProps) => {
  const [products, setProducts] = useState<Item[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const { getItems, isReady } = useIndexedDB();
  const { produceLabel } = useAppSettings();

  // Stable refs — reading these never invalidates the load callback.
  const selectedProductRef = useRef(selectedProduct);
  const onProductChangeRef = useRef(onProductChange);
  const onProductsLoadedRef = useRef(onProductsLoaded);
  useEffect(() => { selectedProductRef.current = selectedProduct; }, [selectedProduct]);
  useEffect(() => { onProductChangeRef.current = onProductChange; }, [onProductChange]);
  useEffect(() => { onProductsLoadedRef.current = onProductsLoaded; }, [onProductsLoaded]);

  const isReadyRef = useRef(isReady);
  useEffect(() => { isReadyRef.current = isReady; }, [isReady]);
  const getItemsRef = useRef(getItems);
  useEffect(() => { getItemsRef.current = getItems; }, [getItems]);

  const applyProducts = useCallback((list: Item[]) => {
    setProducts(list);
    // Auto-select when there is exactly one option and nothing selected yet.
    if (list.length === 1 && !selectedProductRef.current) {
      onProductChangeRef.current(list[0]);
    }
  }, []);

  // Load products with invtype = '01' (produce items)
  const loadProducts = useCallback(async (force = false) => {
    // Phase 1 — paint from cache immediately (never blocks the selector).
    if (isReadyRef.current) {
      try {
        const cachedItems = await getItemsRef.current();
        const produceItems = cachedItems.filter((item: Item & { invtype?: string }) =>
          item.invtype === '01'
        );
        if (produceItems.length > 0) {
          applyProducts(produceItems);
          setHasLoaded(true);
        }
      } catch (err) {
        console.warn('Failed to load cached products:', err);
      }
    }

    if (!navigator.onLine) {
      setHasLoaded(true);
      return;
    }

    // Phase 2 — background sync. The request layer de-dupes and caches, so
    // repeated mounts do not create repeated backend calls.
    setIsLoading(true);
    try {
      const deviceFingerprint = await generateDeviceFingerprint();
      const response = await mysqlApi.items.getAll(deviceFingerprint, '01', force);

      if (response.success && response.data && response.data.length > 0) {
        applyProducts(response.data);
        console.log(`[ITEMS] ${response.data.length} produce items (invtype=01) available`);
      } else if (response.success) {
        console.log('[ITEMS] No produce items (invtype=01) configured for this company');
        setProducts([]);
      }
    } catch (err) {
      console.warn('Product sync error:', err);
    } finally {
      setIsLoading(false);
      setHasLoaded(true);
    }
  }, [applyProducts]);

  // Notify parent whenever product count changes
  useEffect(() => {
    if (hasLoaded && onProductsLoadedRef.current) {
      onProductsLoadedRef.current(products.length);
    }
  }, [products.length, hasLoaded]);

  // Load on mount / route change — deferred to after first paint so the
  // dropdown is interactive immediately.
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      if (!cancelled) loadProducts(false);
    }, 0);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [loadProducts, routeCode, isReady]);

  // Reload when coming back online (forced — data may have changed).
  useEffect(() => {
    const handleOnline = () => loadProducts(true);
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [loadProducts]);

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const icode = e.target.value;
    if (!icode) {
      onProductChange(null);
    } else {
      const product = products.find(p => p.icode === icode);
      onProductChange(product || null);
    }
  };

  // Don't render if no products with invtype = '01'
  if (hasLoaded && products.length === 0) {
    return null;
  }

  // Don't render dropdown if only one product (it's auto-selected)
  if (hasLoaded && products.length === 1) {
    return (
      <div className="mb-2 p-2">
        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1 flex items-center gap-2">
          <Package className="h-4 w-4 text-[#667eea] flex-shrink-0" />
          {produceLabel} Type
        </label>
        <div className="w-full px-3 py-2.5 border border-green-500 dark:border-green-800 bg-green-50 dark:bg-green-950/20 rounded-lg text-gray-800 dark:text-gray-200 font-medium">
          {products[0].descript} ({products[0].icode})
        </div>
      </div>
    );
  }

  return (
    <div className="mb-2 p-2">
      <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1 flex items-center gap-2">
        <Package className="h-4 w-4 text-[#667eea] flex-shrink-0" />
        Select {produceLabel} Type <span className="text-red-500">*</span>
      </label>
      <div className="relative">
        <select
          value={selectedProduct?.icode || ''}
          onChange={handleChange}
          /* v2.12.6: never disabled just because a background refresh is in
             flight — only when the parent disables it or there is nothing yet. */
          disabled={disabled || products.length === 0}
          className={`w-full px-3 py-2.5 border rounded-lg focus:outline-none focus:border-[#667eea] appearance-none bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100 ${
            selectedProduct ? 'border-green-500 bg-green-50 dark:bg-green-950/20' : 'border-gray-300 dark:border-gray-700'
          } ${disabled ? 'bg-gray-100 dark:bg-gray-800 cursor-not-allowed' : ''}`}
        >
          <option value="">-- Select a {produceLabel.toLowerCase()} type --</option>
          {products.map((product) => (
            <option key={product.icode} value={product.icode} className="dark:bg-gray-900">
              {product.descript} ({product.icode})
            </option>
          ))}
        </select>
        {isLoading && products.length === 0 && (
          <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
            <Loader2 className="h-5 w-5 animate-spin text-[#667eea]" />
          </div>
        )}
      </div>
      {!selectedProduct && products.length > 0 && (
        <p className="text-[10px] text-red-500 dark:text-red-400 mt-1">
          Please select a {produceLabel.toLowerCase()} type
        </p>
      )}
    </div>
  );
};
