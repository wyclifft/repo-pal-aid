import { useState, useEffect, useRef } from 'react';
import { X, Search } from 'lucide-react';
import { type Farmer } from '@/lib/supabase';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

interface FarmerSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectFarmer: (farmer: Farmer) => void;
  farmers: Farmer[];
}

export const FarmerSearchModal = ({
  isOpen,
  onClose,
  onSelectFarmer,
  farmers,
}: FarmerSearchModalProps) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [filteredFarmers, setFilteredFarmers] = useState<Farmer[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset search and focus input when modal opens
  useEffect(() => {
    if (isOpen) {
      setSearchQuery('');
      setFilteredFarmers(farmers.slice(0, 50));
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen, farmers]);

  // Real-time search filter
  useEffect(() => {
    if (!searchQuery.trim()) {
      setFilteredFarmers(farmers.slice(0, 50));
      return;
    }

    const query = searchQuery.toLowerCase().trim();
    // Extract numeric portion if user entered numbers only
    const numericQuery = searchQuery.replace(/\D/g, '');
    
    const filtered = farmers.filter((farmer) => {
      const farmerId = String(farmer.farmer_id || '').toLowerCase();
      const farmerName = String(farmer.name || '').toLowerCase();
      
      // Check for numeric match in farmer_id (e.g., typing "1" matches "M00001")
      if (numericQuery && farmerId.includes(numericQuery)) {
        return true;
      }
      
      // Standard ID prefix match
      if (farmerId.startsWith(query)) {
        return true;
      }
      
      // Name contains match
      if (farmerName.includes(query)) {
        return true;
      }
      
      return false;
    });
    
    setFilteredFarmers(filtered.slice(0, 50));
  }, [searchQuery, farmers]);

  const handleSelect = (farmer: Farmer) => {
    onSelectFarmer(farmer);
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md max-h-[80vh] flex flex-col p-0 gap-0">
        <DialogHeader className="p-4 pb-2 border-b">
          <DialogTitle className="text-lg font-semibold">Select Farmer</DialogTitle>
        </DialogHeader>
        
        {/* Search Input */}
        <div className="p-4 pb-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              ref={inputRef}
              type="text"
              inputMode="text"
              placeholder="Search by ID or name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-3 border-2 border-gray-300 rounded-lg text-base focus:border-teal-500 focus:outline-none min-h-[44px]"
              autoComplete="off"
            />
          </div>
        </div>
        
        {/* Farmer List */}
        <div className="flex-1 overflow-y-auto px-4 pb-4">
          {filteredFarmers.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              No farmers found
            </div>
          ) : (
            <div className="space-y-1">
              {filteredFarmers.map((farmer) => {
                // Clean farmer_id for display (strip leading #)
                const displayId = farmer.farmer_id.replace(/^#/, '').trim();
                return (
                  <div
                    key={farmer.farmer_id}
                    onClick={() => handleSelect(farmer)}
                    className="flex items-center justify-between px-3 py-3 rounded-lg cursor-pointer hover:bg-teal-50 active:bg-teal-100 border border-gray-100 transition-colors min-h-[48px]"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-gray-900 truncate">
                        {displayId}
                      </div>
                      <div className="text-sm text-gray-600 truncate">
                        {farmer.name}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
