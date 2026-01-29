import { useState, useEffect, useRef } from 'react';
import { CornerDownLeft, Search, X } from 'lucide-react';
import { type Farmer, type MilkCollection } from '@/lib/supabase';
import { type Route, type Session } from '@/services/mysqlApi';
import { useIndexedDB } from '@/hooks/useIndexedDB';
import { useAppSettings } from '@/hooks/useAppSettings';
import { useHaptics } from '@/hooks/useHaptics';
import { FarmerSearchModal } from './FarmerSearchModal';
import { LiveWeightDisplay } from './LiveWeightDisplay';
import { CoffeeWeightDisplay } from './CoffeeWeightDisplay';
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
  onWeightChange?: (weight: number) => void;
  onEntryTypeChange?: (entryType: 'scale' | 'manual') => void;
  blacklistedFarmerIds?: Set<string>; // Farmers who already delivered (multOpt=0)
  sessionSubmittedFarmerIds?: Set<string>; // Local tracking of submitted farmers this session
  onFarmersLoaded?: (farmers: Farmer[]) => void;
  captureDisabled?: boolean;
  submitDisabled?: boolean; // Disable submit for multOpt=0 farmers who already submitted
  // Supervisor mode capture restrictions
  allowDigital?: boolean;
  allowManual?: boolean;
  // Coffee mode: gross/tare/net weight handling
  grossWeight?: number;
  onGrossWeightChange?: (grossWeight: number) => void;
  onNetWeightChange?: (netWeight: number) => void;
  onTareWeightChange?: (tareWeight: number) => void;
  // Configurable sack tare weight from psettings (default 1 kg)
  sackTareWeight?: number;
  // Whether user can edit sack weight (psettings: allowSackEdit)
  allowSackEdit?: boolean;
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
  onWeightChange,
  onEntryTypeChange,
  blacklistedFarmerIds,
  sessionSubmittedFarmerIds,
  onFarmersLoaded,
  captureDisabled,
  submitDisabled,
  allowDigital = true,
  allowManual = true,
  grossWeight = 0,
  onGrossWeightChange,
  onNetWeightChange,
  onTareWeightChange,
  sackTareWeight = 1,
  allowSackEdit = false,
}: BuyProduceScreenProps) => {
  const [memberNo, setMemberNo] = useState('');
  const [showSearchModal, setShowSearchModal] = useState(false);
  const [cachedFarmers, setCachedFarmers] = useState<Farmer[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const prevCapturedLenRef = useRef<number>(0);
  const { getFarmers } = useIndexedDB();
  
  // Track current effective tare weight (starts from psettings, can be edited by user)
  const [currentTareWeight, setCurrentTareWeight] = useState(sackTareWeight);
  const { light: hapticLight, medium: hapticMedium, success: hapticSuccess } = useHaptics();
  
  // Get psettings for AutoW enforcement and produce labeling
  // These values update automatically when psettings change in the database
  const appSettings = useAppSettings();
  const { autoWeightOnly: psettingsAutoWeightOnly, produceLabel, routeLabel, useRouteFilter, isCoffee } = appSettings;
  
  // Supervisor mode overrides psettings for capture mode:
  // - If supervisor restricts to digital only (!allowManual), manual is disabled
  // - If supervisor restricts to manual only (!allowDigital), digital is disabled
  // - psettings autoWeightOnly (autow=1) further restricts manual if allowed
  const manualDisabled = !allowManual || psettingsAutoWeightOnly;
  const digitalDisabled = !allowDigital;

  const today = new Date().toISOString().split('T')[0];
  
  // Log when capture mode changes for debugging
  useEffect(() => {
    console.log('📱 BuyProduceScreen - Supervisor mode:', { allowDigital, allowManual }, '| manualDisabled:', manualDisabled, 'digitalDisabled:', digitalDisabled, 'psettingsAutoWeightOnly:', psettingsAutoWeightOnly);
  }, [allowDigital, allowManual, manualDisabled, digitalDisabled, psettingsAutoWeightOnly]);

  // Sync currentTareWeight when psettings value changes
  useEffect(() => {
    setCurrentTareWeight(sackTareWeight);
  }, [sackTareWeight]);

  // Load cached farmers with chkroute logic
  // chkroute=1: filter by exact route match, chkroute=0: filter by mprefix from fm_tanks
  useEffect(() => {
    const loadFarmers = async () => {
      try {
        const farmers = await getFarmers();
        let filtered: Farmer[];
        
        if (useRouteFilter && route?.tcode) {
          // chkroute=1: Filter by exact route match
          filtered = farmers.filter(f => f.route === route.tcode);
        } else if (!useRouteFilter && route?.mprefix) {
          // chkroute=0: Filter by mprefix (farmer_id starts with mprefix)
          filtered = farmers.filter(f => 
            f.farmer_id && f.farmer_id.startsWith(route.mprefix!)
          );
        } else {
          filtered = farmers;
        }
        
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
  }, [getFarmers, route?.tcode, route?.mprefix, onFarmersLoaded, useRouteFilter]);

  // Filter out blacklisted farmers for display
  // IMPORTANT: blacklist applies only to multOpt=0 farmers; do not hide multOpt=1 farmers.
  const availableFarmers = blacklistedFarmerIds && blacklistedFarmerIds.size > 0
    ? cachedFarmers.filter(f => {
        const cleanId = f.farmer_id.replace(/^#/, '').trim();
        return !(f.multOpt === 0 && blacklistedFarmerIds.has(cleanId));
      })
    : cachedFarmers;

  // Derive session type (AM/PM) from session time_from
  const getSessionType = (): 'AM' | 'PM' => {
    const hour = session.time_from >= 100
      ? Math.floor(session.time_from / 100)
      : session.time_from;
    return hour >= 12 ? 'PM' : 'AM';
  };

  // Check if a farmer is blocked (blacklisted OR submitted this session OR already in capture queue with multOpt=0)
  const isFarmerBlocked = (farmerId: string, checkMultOpt: boolean = false): boolean => {
    const cleanId = farmerId.replace(/^#/, '').trim();
    if (blacklistedFarmerIds?.has(cleanId)) return true;
    if (sessionSubmittedFarmerIds?.has(cleanId)) return true;
    
    // Check if farmer with multOpt=0 is already in capturedCollections
    if (checkMultOpt) {
      const today = new Date().toISOString().split('T')[0];
      const currentSessionType = getSessionType();
      const alreadyCaptured = capturedCollections.some(c => {
        const captureDate = new Date(c.collection_date).toISOString().split('T')[0];
        return (
          c.farmer_id.replace(/^#/, '').trim() === cleanId &&
          c.session === currentSessionType &&
          captureDate === today &&
          c.multOpt === 0
        );
      });
      if (alreadyCaptured) return true;
    }
    
    return false;
  };

  // Resolve numeric input to full farmer ID (only from available farmers)
  const resolveFarmerId = (input: string): Farmer | null => {
    if (!input.trim()) return null;
    
    const numericInput = input.replace(/\D/g, '');
    
    // Search by exact farmer_id first (in ALL cached farmers to detect blocked ones)
    const exactMatch = cachedFarmers.find(
      f => f.farmer_id.toLowerCase() === input.toLowerCase()
    );
    if (exactMatch) {
      // Check if this farmer is blocked (multOpt=0 and already submitted or in queue)
      const cleanId = exactMatch.farmer_id.replace(/^#/, '').trim();
      if (exactMatch.multOpt === 0 && isFarmerBlocked(cleanId, true)) {
        toast.error(`${exactMatch.name} has already delivered this session and cannot deliver again.`, { duration: 5000 });
        return null;
      }
      return exactMatch;
    }
    
    // If pure numeric, resolve to padded format (e.g., 1 -> M00001)
    if (numericInput && numericInput === input.trim()) {
      const paddedId = `M${numericInput.padStart(5, '0')}`;
      const paddedMatch = cachedFarmers.find(
        f => f.farmer_id.toUpperCase() === paddedId.toUpperCase()
      );
      if (paddedMatch) {
        const cleanId = paddedMatch.farmer_id.replace(/^#/, '').trim();
        if (paddedMatch.multOpt === 0 && isFarmerBlocked(cleanId, true)) {
          toast.error(`${paddedMatch.name} has already delivered this session and cannot deliver again.`, { duration: 5000 });
          return null;
        }
        return paddedMatch;
      }
      
      // Also try matching by numeric portion
      const numericMatch = cachedFarmers.find(f => {
        const farmerNumeric = f.farmer_id.replace(/\D/g, '');
        return parseInt(farmerNumeric, 10) === parseInt(numericInput, 10);
      });
      if (numericMatch) {
        const cleanId = numericMatch.farmer_id.replace(/^#/, '').trim();
        if (numericMatch.multOpt === 0 && isFarmerBlocked(cleanId, true)) {
          toast.error(`${numericMatch.name} has already delivered this session and cannot deliver again.`, { duration: 5000 });
          return null;
        }
        return numericMatch;
      }
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
  const handleClear = () => {
    hapticLight();
    setMemberNo('');
    onClearFarmer();
  };
  
  // Wrap capture/submit with haptic feedback
  const handleCaptureWithHaptic = () => {
    hapticMedium();
    onCapture();
  };
  
  const handleSubmitWithHaptic = () => {
    hapticSuccess();
    onSubmit();
  };
  
  const handleBackWithHaptic = () => {
    hapticLight();
    onBack();
  };

  const handleSelectFarmer = (farmer: Farmer) => {
    // Check if farmer is blocked before allowing selection (includes queue check)
    const cleanId = farmer.farmer_id.replace(/^#/, '').trim();
    if (farmer.multOpt === 0 && isFarmerBlocked(cleanId, true)) {
      toast.error(`${farmer.name} has already delivered this session and cannot deliver again.`, { duration: 5000 });
      return;
    }
    setMemberNo(cleanId);
    setShowSearchModal(false);
    onSelectFarmer(farmer);
  };
  
  // Focus input when member is cleared (for post-submit flow)
  const focusMemberInput = () => {
    setTimeout(() => {
      inputRef.current?.focus();
    }, 100);
  };
  
  // When capturedCollections transitions from >0 to 0 (submit completed), clear member input and focus.
  // NOTE: selectedFarmer prop can be a new object on each parent re-render; do NOT depend on it.
  useEffect(() => {
    const prev = prevCapturedLenRef.current;
    const next = capturedCollections.length;

    if (prev > 0 && next === 0) {
      setMemberNo('');
      focusMemberInput();
    }

    prevCapturedLenRef.current = next;
  }, [capturedCollections.length]);

  // Listen for receipt modal close event to focus input
  useEffect(() => {
    const handleReceiptModalClosed = () => {
      setMemberNo('');
      focusMemberInput();
    };
    window.addEventListener('receiptModalClosed', handleReceiptModalClosed);
    return () => window.removeEventListener('receiptModalClosed', handleReceiptModalClosed);
  }, []);

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
        {/* Weight Display - Coffee mode shows Gross/Sack/Net, Dairy mode shows simple weight */}
        {isCoffee ? (
          <CoffeeWeightDisplay
            grossWeight={grossWeight}
            onGrossWeightChange={onGrossWeightChange || (() => {})}
            onNetWeightChange={(net) => {
              onNetWeightChange?.(net);
              onWeightChange?.(net); // Also update main weight for capture
            }}
            onTareWeightChange={(tare) => {
              setCurrentTareWeight(tare); // Update local state for manual entry
              onTareWeightChange?.(tare); // Also notify parent
            }}
            onEntryTypeChange={onEntryTypeChange || (() => {})}
            digitalDisabled={digitalDisabled}
            sackTareWeight={sackTareWeight}
            allowSackEdit={allowSackEdit}
          />
        ) : (
          <LiveWeightDisplay
            weight={weight}
            onWeightChange={onWeightChange || (() => {})}
            onEntryTypeChange={onEntryTypeChange || (() => {})}
            digitalDisabled={digitalDisabled}
          />
        )}

        {/* Manual Weight Entry - enforces supervisor mode and psettings AutoW */}
        <div className={`flex gap-2 items-center ${manualDisabled ? 'opacity-50' : ''}`}>
          <span className="text-xs sm:text-sm font-medium text-gray-700 whitespace-nowrap">
            {isCoffee ? 'Manual Gross:' : 'Manual:'}
            {manualDisabled && <span className="text-red-500 ml-1">(Disabled)</span>}
          </span>
          <input
            type="number"
            inputMode="decimal"
            step="0.1"
            min="0"
            placeholder={manualDisabled ? "Use scale only" : (isCoffee ? "Enter gross weight" : "Enter weight")}
            disabled={manualDisabled}
            onChange={(e) => {
              if (manualDisabled) {
                toast.error('Manual weight entry is disabled. Please use the digital scale.');
                return;
              }
              const grossValue = parseFloat(e.target.value) || 0;
              if (isCoffee) {
                // For coffee: manual entry is gross weight, calculate net using CURRENT tare (may be edited)
                onGrossWeightChange?.(grossValue);
                const netValue = Math.max(0, grossValue - currentTareWeight);
                onNetWeightChange?.(parseFloat(netValue.toFixed(2)));
                onWeightChange?.(parseFloat(netValue.toFixed(2))); // Main weight is net
                onEntryTypeChange?.('manual');
              } else {
                onManualWeightChange?.(grossValue);
              }
            }}
            className={`flex-1 px-3 sm:px-4 py-2.5 sm:py-2 border-2 rounded-lg text-base sm:text-lg min-h-[44px] ${
              manualDisabled 
                ? 'border-gray-200 bg-gray-100 cursor-not-allowed' 
                : 'border-gray-300'
            }`}
          />
        </div>
        {manualDisabled && (
          <p className="text-xs text-red-500 -mt-2 mb-2 px-1">
            Manual entry is disabled. Use the digital scale.
          </p>
        )}
        {isCoffee && !manualDisabled && (
          <p className="text-xs text-amber-600 -mt-2 mb-2 px-1">
            Enter gross weight. Net = Gross - {currentTareWeight} kg (sack weight)
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
            onClick={handleBackWithHaptic}
            className="flex-1 py-3 bg-white border-2 border-gray-800 rounded-lg font-semibold text-gray-800 hover:bg-gray-100 active:bg-gray-200 min-h-[48px] text-sm sm:text-base"
          >
            Back
          </button>
          <button
            onClick={handleCaptureWithHaptic}
            disabled={!!captureDisabled || weight <= 0}
            className={`flex-1 py-3 bg-white border-2 border-teal-500 rounded-lg font-semibold text-teal-600 hover:bg-teal-50 active:bg-teal-100 min-h-[48px] text-sm sm:text-base ${(captureDisabled || weight <= 0) ? 'opacity-50 pointer-events-none' : ''}`}
          >
            Capture
          </button>
          <button
            onClick={handleSubmitWithHaptic}
            disabled={!!submitDisabled}
            className={`flex-1 py-3 bg-white border-2 border-teal-500 rounded-lg font-semibold text-teal-600 hover:bg-teal-50 active:bg-teal-100 min-h-[48px] text-sm sm:text-base ${submitDisabled ? 'opacity-50 pointer-events-none' : ''}`}
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
                  {/* Coffee mode: show Gross/Sack/Net breakdown */}
                  {isCoffee && c.gross_weight !== undefined ? (
                    <div className="text-right text-xs">
                      <div className="text-gray-500">G:{c.gross_weight?.toFixed(1)} S:{c.tare_weight?.toFixed(1)}</div>
                      <div className="font-bold text-green-700">Net: {c.weight.toFixed(1)}</div>
                    </div>
                  ) : (
                    <span className="font-bold text-gray-900">{c.weight.toFixed(1)}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
