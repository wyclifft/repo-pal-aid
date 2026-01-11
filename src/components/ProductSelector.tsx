import { useState, useEffect, useCallback } from 'react';
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
}

export const ProductSelector = ({ 
  selectedProduct, 
  onProductChange, 
  routeCode,
  disabled 
}: ProductSelectorProps) => {
  const [products, setProducts] = useState<Item[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const { getItems, saveItems, isReady } = useIndexedDB();
  const { produceLabel } = useAppSettings();

  // Load products with invtype = '01' (produce items)
  const loadProducts = useCallback(async () => {
    setIsLoading(true);
    
    try {
      // First try to load from cache
      if (isReady) {
        try {
          const cachedItems = await getItems();
          // Filter for invtype = '01' (produce items)
          const produceItems = cachedItems.filter((item: Item & { invtype?: string }) => 
            item.invtype === '01'
          );
          if (produceItems.length > 0) {
            setProducts(produceItems);
            // Auto-select if only one product
            if (produceItems.length === 1 && !selectedProduct) {
              onProductChange(produceItems[0]);
            }
          }
        } catch (err) {
          console.warn('Failed to load cached products:', err);
        }
      }

      // Then sync from server if online
      if (navigator.onLine) {
        const deviceFingerprint = await generateDeviceFingerprint();
        // Fetch only produce items (invtype = '01')
        const response = await mysqlApi.items.getAll(deviceFingerprint, '01');
        
        if (response.success && response.data && response.data.length > 0) {
          setProducts(response.data);
          
          // Auto-select if only one product and none selected
          if (response.data.length === 1 && !selectedProduct) {
            onProductChange(response.data[0]);
          }
          
          console.log(`✅ Synced ${response.data.length} produce items (invtype=01)`);
        } else {
          // No produce items for this company
          console.log('No produce items (invtype=01) configured for this company');
          setProducts([]);
        }
      }
    } catch (err) {
      console.warn('Product sync error:', err);
    } finally {
      setIsLoading(false);
      setHasLoaded(true);
    }
  }, [isReady, getItems, selectedProduct, onProductChange]);

  // Load products on mount and when route changes
  useEffect(() => {
    loadProducts();
  }, [loadProducts, routeCode]);

  // Reload when coming back online
  useEffect(() => {
    const handleOnline = () => loadProducts();
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [loadProducts]);

  // Clear selection when route changes
  useEffect(() => {
    if (routeCode && hasLoaded) {
      // Re-apply auto-select logic when route changes
      if (products.length === 1) {
        onProductChange(products[0]);
      } else if (products.length === 0) {
        onProductChange(null);
      }
    }
  }, [routeCode, products, hasLoaded, onProductChange]);

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
      <div className="mb-4">
        <label className="block text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
          <Package className="h-4 w-4 text-[#667eea]" />
          {produceLabel} Type
        </label>
        <div className="w-full px-4 py-3 border border-green-500 bg-green-50 rounded-lg text-gray-800 font-medium">
          {products[0].descript} ({products[0].icode})
        </div>
      </div>
    );
  }

  return (
    <div className="mb-4">
      <label className="block text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
        <Package className="h-4 w-4 text-[#667eea]" />
        Select {produceLabel} Type <span className="text-red-500">*</span>
      </label>
      <div className="relative">
        <select
          value={selectedProduct?.icode || ''}
          onChange={handleChange}
          disabled={disabled || isLoading}
          className={`w-full px-4 py-3 border rounded-lg focus:outline-none focus:border-[#667eea] appearance-none bg-white ${
            selectedProduct ? 'border-green-500 bg-green-50' : 'border-gray-300'
          } ${disabled || isLoading ? 'bg-gray-100 cursor-not-allowed' : ''}`}
        >
          <option value="">-- Select a {produceLabel.toLowerCase()} type --</option>
          {products.map((product) => (
            <option key={product.icode} value={product.icode}>
              {product.descript} ({product.icode})
            </option>
          ))}
        </select>
        {isLoading && (
          <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
            <Loader2 className="h-5 w-5 animate-spin text-[#667eea]" />
          </div>
        )}
      </div>
      {!selectedProduct && products.length > 0 && (
        <p className="text-xs text-red-500 mt-1">
          Please select a {produceLabel.toLowerCase()} type
        </p>
      )}
    </div>
  );
};
