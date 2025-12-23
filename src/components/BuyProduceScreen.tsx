import { useState, useEffect, useRef } from 'react';
import { CornerDownLeft, Search, X } from 'lucide-react';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { type Farmer, type MilkCollection } from '@/lib/supabase';
import { type Route, type Session } from '@/services/mysqlApi';
import { useIndexedDB } from '@/hooks/useIndexedDB';
import { useAppSettings } from '@/hooks/useAppSettings';
import { FarmerSearchModal } from './FarmerSearchModal';
import { toast } from 'sonner';

interface BuyProduceScreenProps {
  route: Route;
  session: Session;
  userName: string;
  weight: number;
  capturedCollections: MilkCollection[];
  onBack: () => void;
  onCapture: () => void;
  onSubmit: () => void;
  onSelectFarmer: (farmer: Farmer) => void;
  onClearFarmer: () => void;
  selectedFarmer: { id: string; name: string } | null;
  todayWeight: number;
  onManualWeightChange?: (weight: number) => void;
  blacklistedFarmerIds?: Set<string>; // Farmers who already delivered (multOpt=0)
  onFarmersLoaded?: (farmers: Farmer[]) => void;
  captureDisabled?: boolean;
}

export const BuyProduceScreen = ({
  route,
  session,
  userName,
  weight,
  capturedCollections,
  onBack,
  onCapture,
  onSubmit,
  onSelectFarmer,
  onClearFarmer,
  selectedFarmer,
  todayWeight,
  onManualWeightChange,
  blacklistedFarmerIds,
  onFarmersLoaded,
  captureDisabled,
}: BuyProduceScreenProps) => {
  const [memberNo, setMemberNo] = useState('');
  const [showSearchModal, setShowSearchModal] = useState(false);
  const [cachedFarmers, setCachedFarmers] = useState<Farmer[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const { getFarmers } = useIndexedDB();
  
  // Get psettings for AutoW enforcement and produce labeling
  // These values update automatically when psettings change in the database
  const appSettings = useAppSettings();
  const { autoWeightOnly, produceLabel, routeLabel } = appSettings;

  const today = new Date().toISOString().split('T')[0];
  
  // Log when autoWeightOnly changes for debugging
  useEffect(() => {
    console.log('📱 BuyProduceScreen - autoWeightOnly:', autoWeightOnly);
  }, [autoWeightOnly]);

  // Load cached farmers
  useEffect(() => {
    const loadFarmers = async () => {
      try {
        const farmers = await getFarmers();
        const filtered = route?.tcode 
          ? farmers.filter(f => f.route === route.tcode)
          : farmers;
        setCachedFarmers(filtered);
        // Notify parent of loaded farmers
        if (onFarmersLoaded) {
          onFarmersLoaded(filtered);
        }
      } catch (err) {
        console.error('Failed to load farmers:', err);
      }
    };
    loadFarmers();
  }, [getFarmers, route?.tcode, onFarmersLoaded]);

  // Filter out blacklisted farmers for display
  const availableFarmers = blacklistedFarmerIds && blacklistedFarmerIds.size > 0
    ? cachedFarmers.filter(f => !blacklistedFarmerIds.has(f.farmer_id.replace(/^#/, '').trim()))
    : cachedFarmers;

  // Resolve numeric input to full farmer ID (only from available farmers)
  const resolveFarmerId = (input: string): Farmer | null => {
    if (!input.trim()) return null;
    
    const numericInput = input.replace(/\D/g, '');
    
    // Search by exact farmer_id first
    const exactMatch = availableFarmers.find(
      f => f.farmer_id.toLowerCase() === input.toLowerCase()
    );
    if (exactMatch) return exactMatch;
    
    // If pure numeric, resolve to padded format (e.g., 1 -> M00001)
    if (numericInput && numericInput === input.trim()) {
      const paddedId = `M${numericInput.padStart(5, '0')}`;
      const paddedMatch = availableFarmers.find(
        f => f.farmer_id.toUpperCase() === paddedId.toUpperCase()
      );
      if (paddedMatch) return paddedMatch;
      
      // Also try matching by numeric portion
      const numericMatch = availableFarmers.find(f => {
        const farmerNumeric = f.farmer_id.replace(/\D/g, '');
        return parseInt(farmerNumeric, 10) === parseInt(numericInput, 10);
      });
      if (numericMatch) return numericMatch;
    }
    
    // Check if farmer is blacklisted
    const blacklisted = cachedFarmers.find(
      f => f.farmer_id.toLowerCase() === input.toLowerCase() || 
           f.farmer_id.replace(/\D/g, '') === numericInput
    );
    if (blacklisted && blacklistedFarmerIds?.has(blacklisted.farmer_id.replace(/^#/, '').trim())) {
      toast.error(`${blacklisted.name} has already delivered this session`);
      return null;
    }
    
    return null;
  };

  // Handle arrow button - resolve and select farmer
  const handleEnter = () => {
    const farmer = resolveFarmerId(memberNo);
    if (farmer) {
      handleSelectFarmer(farmer);
    } else if (memberNo.trim()) {
      toast.error(`Farmer "${memberNo}" not found`);
    }
  };

  // Handle search button - open modal
  const handleSearch = () => {
    setShowSearchModal(true);
  };

  // Handle clear button with haptic feedback
  const handleClear = async () => {
    try {
      await Haptics.impact({ style: ImpactStyle.Light });
    } catch (err) {
      // Haptics not available (web browser)
    }
    setMemberNo('');
    onClearFarmer();
  };

  const handleSelectFarmer = (farmer: Farmer) => {
    // Strip any leading # from farmer_id for display
    const cleanId = farmer.farmer_id.replace(/^#/, '').trim();
    setMemberNo(cleanId);
    setShowSearchModal(false);
    onSelectFarmer(farmer);
  };

  // Calculate total captured weight for current farmer
  const totalCapturedWeight = capturedCollections.reduce((sum, c) => sum + c.weight, 0);

  return (
    <div className="min-h-screen min-h-[100dvh] bg-gradient-to-b from-teal-100 to-teal-200 flex flex-col overflow-x-hidden">
      {/* Purple Header */}
      <header className="bg-purple-600 text-white px-3 sm:px-4 py-3 sticky top-0 z-40" style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}>
        <h1 className="text-sm sm:text-lg font-semibold truncate">
          [{route?.tcode}] {route?.descript} {session?.descript} {today}
        </h1>
      </header>

      {/* Produce Buying Banner - uses orgtype to switch wording */}
      <div className="bg-teal-500 text-white text-center py-2 font-semibold text-sm sm:text-base">
        {produceLabel} Buying
      </div>

      {/* Main Content */}
      <div className="flex-1 px-3 sm:px-4 py-3 sm:py-4 space-y-3 sm:space-y-4 overflow-y-auto" style={{ paddingBottom: 'max(1.5rem, calc(env(safe-area-inset-bottom) + 1rem))' }}>
        {/* Weight Display */}
        <div className="flex gap-2">
          <div className="flex-1 bg-white border-2 border-gray-800 rounded-lg p-4 sm:p-6 flex items-center justify-center">
            <span className="text-2xl sm:text-3xl font-bold">Kgs</span>
          </div>
          <div className="flex-1 bg-white border-2 border-gray-800 rounded-lg p-4 sm:p-6 flex items-center justify-center">
            <span className="text-2xl sm:text-3xl font-bold">
              {weight > 0 ? weight.toFixed(1) : '--'}
            </span>
          </div>
        </div>

        {/* Manual Weight Entry - enforces AutoW (autow=1 disables manual entry) */}
        <div className={`flex gap-2 items-center ${autoWeightOnly ? 'opacity-50' : ''}`}>
          <span className="text-xs sm:text-sm font-medium text-gray-700 whitespace-nowrap">
            Manual:
            {autoWeightOnly && <span className="text-red-500 ml-1">(Disabled)</span>}
          </span>
          <input
            type="number"
            inputMode="decimal"
            step="0.1"
            min="0"
            placeholder={autoWeightOnly ? "Use scale only" : "Enter weight"}
            disabled={autoWeightOnly}
            onChange={(e) => {
              if (autoWeightOnly) {
                toast.error('Manual weight entry is disabled. Please use the digital scale.');
                return;
              }
              onManualWeightChange?.(parseFloat(e.target.value) || 0);
            }}
            className={`flex-1 px-3 sm:px-4 py-2.5 sm:py-2 border-2 rounded-lg text-base sm:text-lg min-h-[44px] ${
              autoWeightOnly 
                ? 'border-gray-200 bg-gray-100 cursor-not-allowed' 
                : 'border-gray-300'
            }`}
          />
        </div>
        {autoWeightOnly && (
          <p className="text-xs text-red-500 -mt-2 mb-2 px-1">
            Manual entry is disabled. Use the digital scale.
          </p>
        )}

        {/* Member Search */}
        <div className="flex gap-1.5 sm:gap-2">
          <input
            ref={inputRef}
            type="text"
            inputMode="text"
            placeholder="Enter Member No."
            value={memberNo}
            onChange={(e) => setMemberNo(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleEnter()}
            className="flex-1 px-3 sm:px-4 py-2.5 sm:py-3 border-2 border-gray-800 bg-white rounded-lg text-base sm:text-lg min-h-[44px] font-semibold"
          />
          <button
            onClick={handleEnter}
            className="w-11 sm:w-14 bg-teal-500 text-white rounded-lg flex items-center justify-center active:bg-teal-600 min-h-[44px]"
          >
            <CornerDownLeft className="h-5 w-5 sm:h-6 sm:w-6" />
          </button>
          <button
            onClick={handleSearch}
            className="w-11 sm:w-14 bg-teal-500 text-white rounded-lg flex items-center justify-center active:bg-teal-600 min-h-[44px]"
          >
            <Search className="h-5 w-5 sm:h-6 sm:w-6" />
          </button>
          <button
            onClick={handleClear}
            className="w-11 sm:w-14 bg-red-500 text-white rounded-lg flex items-center justify-center active:bg-red-600 min-h-[44px]"
          >
            <X className="h-5 w-5 sm:h-6 sm:w-6" />
          </button>
        </div>

        {/* Farmer Search Modal */}
        <FarmerSearchModal
          isOpen={showSearchModal}
          onClose={() => setShowSearchModal(false)}
          onSelectFarmer={handleSelectFarmer}
          farmers={availableFarmers}
        />

        {/* Member Info Card */}
        <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-2">
          <div className="flex justify-between items-center border-b border-gray-100 pb-2">
            <div>
              <span className="text-gray-600 text-sm">MEMBER</span>
              <p className="font-semibold">
                {selectedFarmer ? `${selectedFarmer.id} - ${selectedFarmer.name}` : '-'}
              </p>
            </div>
            <span className="font-bold text-lg">
              {totalCapturedWeight > 0 ? `${totalCapturedWeight.toFixed(1)}KGS` : '-KGS'}
            </span>
          </div>
          
          <div className="border-b border-gray-100 pb-2">
            <span className="font-bold">CLERK [{userName?.toUpperCase()}]</span>
            <p className="text-gray-600 text-sm">{userName}</p>
          </div>
          
          <div className="flex justify-between items-center">
            <span className="font-bold">WEIGHT TODAY</span>
            <span className="text-gray-600">
              {todayWeight > 0 ? `${todayWeight.toFixed(1)} KGS` : '-'}
            </span>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-2 sm:gap-3">
          <button
            onClick={onBack}
            className="flex-1 py-3 bg-white border-2 border-gray-800 rounded-lg font-semibold text-gray-800 hover:bg-gray-100 active:bg-gray-200 min-h-[48px] text-sm sm:text-base"
          >
            Back
          </button>
          <button
            onClick={onCapture}
            disabled={!!captureDisabled}
            className={`flex-1 py-3 bg-white border-2 border-teal-500 rounded-lg font-semibold text-teal-600 hover:bg-teal-50 active:bg-teal-100 min-h-[48px] text-sm sm:text-base ${captureDisabled ? 'opacity-50 pointer-events-none' : ''}`}
          >
            Capture
          </button>
          <button
            onClick={onSubmit}
            className="flex-1 py-3 bg-white border-2 border-teal-500 rounded-lg font-semibold text-teal-600 hover:bg-teal-50 active:bg-teal-100 min-h-[48px] text-sm sm:text-base"
          >
            Submit
          </button>
        </div>

        {/* Transactions List */}
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          {capturedCollections.length === 0 ? (
            <div className="p-4 text-center text-gray-500">NO TRANSACTIONS ...</div>
          ) : (
            <div className="divide-y divide-gray-100">
              {capturedCollections.map((c, i) => (
                <div key={i} className="flex items-center px-3 py-2 text-sm">
                  <span className="w-8 h-8 flex items-center justify-center bg-gray-100 rounded text-xs font-semibold text-gray-600">
                    {i + 1}
                  </span>
                  <span className="flex-1 ml-3 text-gray-700">
                    {new Date(c.collection_date).toLocaleDateString('en-GB', { 
                      day: '2-digit', 
                      month: '2-digit', 
                      year: 'numeric' 
                    })} {new Date(c.collection_date).toLocaleTimeString('en-US', {
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                      hour12: true
                    })}
                  </span>
                  <span className="font-bold text-gray-900">{c.weight.toFixed(1)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
