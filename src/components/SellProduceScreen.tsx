import { useState, useEffect, useRef } from 'react';
import { X, ChevronDown } from 'lucide-react';
import { type Farmer, type MilkCollection } from '@/lib/supabase';
import { type Route, type Session, farmersApi } from '@/services/mysqlApi';
import { useIndexedDB } from '@/hooks/useIndexedDB';
import { useAppSettings } from '@/hooks/useAppSettings';
import { useHaptics } from '@/hooks/useHaptics';
import { LiveWeightDisplay } from './LiveWeightDisplay';
import { CoffeeWeightDisplay } from './CoffeeWeightDisplay';
import { toast } from 'sonner';
import { generateDeviceFingerprint } from '@/utils/deviceFingerprint';

interface SellProduceScreenProps {
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

// Sell member interface (mcode starts with 'D')
interface SellMember {
  farmer_id: string;
  name: string;
  route?: string;
  ccode?: string;
  multOpt?: number;
  currqty?: number;
}

export const SellProduceScreen = ({
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
  captureDisabled,
  submitDisabled,
  blacklistedFarmerIds,
  sessionSubmittedFarmerIds,
  allowDigital = true,
  allowManual = true,
  grossWeight = 0,
  onGrossWeightChange,
  onNetWeightChange,
  onTareWeightChange,
  sackTareWeight = 1,
  allowSackEdit = false,
}: SellProduceScreenProps) => {
  const [sellMembers, setSellMembers] = useState<SellMember[]>([]);
  const [isLoadingMembers, setIsLoadingMembers] = useState(false);
  const [selectedMemberId, setSelectedMemberId] = useState('');
  const selectRef = useRef<HTMLSelectElement>(null);
  const prevCapturedLenRef = useRef<number>(0);
  const { saveFarmers, getFarmers } = useIndexedDB();
  
  // Track current effective tare weight (starts from psettings, can be edited by user)
  const [currentTareWeight, setCurrentTareWeight] = useState(sackTareWeight);
  const { light: hapticLight, medium: hapticMedium, success: hapticSuccess } = useHaptics();
  
  // Get psettings for produce labeling - updates automatically when psettings change
  const appSettings = useAppSettings();
  const { produceLabel, autoWeightOnly: psettingsAutoWeightOnly, isCoffee } = appSettings;
  
  // Supervisor mode overrides psettings for capture mode
  const manualDisabled = !allowManual || psettingsAutoWeightOnly;
  const digitalDisabled = !allowDigital;

  const today = new Date().toISOString().split('T')[0];
  
  // Log when settings change for debugging
  useEffect(() => {
    console.log('📱 SellProduceScreen - Supervisor mode:', { allowDigital, allowManual }, '| manualDisabled:', manualDisabled, 'digitalDisabled:', digitalDisabled, 'psettingsAutoWeightOnly:', psettingsAutoWeightOnly);
  }, [allowDigital, allowManual, manualDisabled, digitalDisabled, psettingsAutoWeightOnly]);

  // Sync currentTareWeight when psettings value changes
  useEffect(() => {
    setCurrentTareWeight(sackTareWeight);
  }, [sackTareWeight]);

  // Load sell members (mcode starts with 'D') from API with offline fallback
  useEffect(() => {
    const loadSellMembers = async () => {
      setIsLoadingMembers(true);
      
      try {
        // First, try to load from local cache for instant UI
        const cachedFarmers = await getFarmers();
        const cachedSellMembers = cachedFarmers.filter(f => 
          f.farmer_id && f.farmer_id.toUpperCase().startsWith('D')
        );
        
        if (cachedSellMembers.length > 0) {
          console.log(`[SELL] Loaded ${cachedSellMembers.length} sell members from cache`);
          setSellMembers(cachedSellMembers.map(f => ({
            farmer_id: f.farmer_id,
            name: f.name,
            route: f.route,
            ccode: f.ccode,
            multOpt: f.multOpt,
            currqty: f.currqty,
          })));
        }
        
        // If online, fetch fresh data from API
        if (navigator.onLine) {
          const deviceFingerprint = await generateDeviceFingerprint();
          const response = await farmersApi.getSellMembers(deviceFingerprint);
          
          if (response.success && response.data) {
            console.log(`[SELL] Fetched ${response.data.length} sell members from API`);
            const apiMembers = response.data.map(f => ({
              farmer_id: f.farmer_id,
              name: f.name,
              route: f.route,
              ccode: f.ccode,
              multOpt: f.multOpt,
              currqty: f.currqty,
            }));
            setSellMembers(apiMembers);
            
            // Cache the D-members along with existing farmers
            // We merge to avoid overwriting non-D members
            const nonDFarmers = cachedFarmers.filter(f => 
              !f.farmer_id || !f.farmer_id.toUpperCase().startsWith('D')
            );
            const allFarmers = [...nonDFarmers, ...response.data];
            saveFarmers(allFarmers);
          }
        }
      } catch (err) {
        console.error('Failed to load sell members:', err);
        toast.error('Failed to load members. Using cached data.');
      } finally {
        setIsLoadingMembers(false);
      }
    };
    
    loadSellMembers();
  }, [getFarmers, saveFarmers]);

  // Derive session type (AM/PM) from session time_from
  const getSessionType = (): 'AM' | 'PM' => {
    const hour = session.time_from >= 100
      ? Math.floor(session.time_from / 100)
      : session.time_from;
    return hour >= 12 ? 'PM' : 'AM';
  };

  // Check if a farmer is blocked (blacklisted OR submitted this session)
  const isFarmerBlocked = (farmerId: string): boolean => {
    const cleanId = farmerId.replace(/^#/, '').trim();
    if (blacklistedFarmerIds?.has(cleanId)) return true;
    if (sessionSubmittedFarmerIds?.has(cleanId)) return true;
    return false;
  };

  // Handle dropdown selection
  const handleMemberSelect = (memberId: string) => {
    if (!memberId) {
      handleClear();
      return;
    }
    
    const member = sellMembers.find(m => m.farmer_id === memberId);
    if (!member) {
      toast.error('Member not found');
      return;
    }
    
    // Check if member is blocked
    if (member.multOpt === 0 && isFarmerBlocked(memberId)) {
      toast.error(`${member.name} has already delivered this session and cannot deliver again.`, { duration: 5000 });
      setSelectedMemberId('');
      return;
    }
    
    setSelectedMemberId(memberId);
    
    // Convert to Farmer type for parent component
    const farmerData: Farmer = {
      farmer_id: member.farmer_id,
      name: member.name,
      route: member.route || '',
      multOpt: member.multOpt,
      currqty: member.currqty,
      ccode: member.ccode,
    };
    
    onSelectFarmer(farmerData);
    hapticLight();
  };

  // Handle clear button with haptic feedback
  const handleClear = () => {
    hapticLight();
    setSelectedMemberId('');
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
  
  // Focus select when member is cleared (for post-submit flow)
  const focusMemberSelect = () => {
    setTimeout(() => {
      selectRef.current?.focus();
    }, 100);
  };
  
  // When capturedCollections transitions from >0 to 0 (submit completed), clear member input and focus.
  useEffect(() => {
    const prev = prevCapturedLenRef.current;
    const next = capturedCollections.length;

    if (prev > 0 && next === 0) {
      setSelectedMemberId('');
      focusMemberSelect();
    }

    prevCapturedLenRef.current = next;
  }, [capturedCollections.length]);

  // Listen for receipt modal close event to focus select
  useEffect(() => {
    const handleReceiptModalClosed = () => {
      setSelectedMemberId('');
      focusMemberSelect();
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

      {/* Produce Selling Portal Banner - uses orgtype to switch wording */}
      <div className="bg-teal-500 text-white text-center py-2 font-semibold text-sm sm:text-base">
        {produceLabel} Selling Portal
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

        {/* Member Selection Dropdown - only shows D-members */}
        <div className="flex gap-1.5 sm:gap-2">
          <div className="flex-1 relative">
            <select
              ref={selectRef}
              value={selectedMemberId}
              onChange={(e) => handleMemberSelect(e.target.value)}
              disabled={isLoadingMembers}
              className="w-full px-3 sm:px-4 py-2.5 sm:py-3 border-2 border-gray-800 bg-white rounded-lg text-base sm:text-lg min-h-[44px] font-semibold appearance-none cursor-pointer pr-10"
            >
              <option value="">
                {isLoadingMembers ? 'Loading members...' : 'Select Member'}
              </option>
              {sellMembers.map((member) => (
                <option key={member.farmer_id} value={member.farmer_id}>
                  {member.farmer_id} - {member.name}
                </option>
              ))}
            </select>
            <ChevronDown className="absolute right-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-500 pointer-events-none" />
          </div>
          <button
            onClick={handleClear}
            className="w-11 sm:w-14 bg-red-500 text-white rounded-lg flex items-center justify-center active:bg-red-600 min-h-[44px]"
          >
            <X className="h-5 w-5 sm:h-6 sm:w-6" />
          </button>
        </div>

        {/* Member Info Card */}
        <div className="bg-white border border-gray-200 rounded-lg p-3 sm:p-4 space-y-2">
          <div className="flex justify-between items-center border-b border-gray-100 pb-2">
            <div className="min-w-0 flex-1">
              <span className="text-gray-600 text-xs sm:text-sm">MEMBER</span>
              <p className="font-semibold text-sm sm:text-base truncate">
                {selectedFarmer ? `SELECT MEMBER [${selectedFarmer.name}]` : 'SELECT MEMBER []'}
              </p>
            </div>
            <span className="font-bold text-base sm:text-lg ml-2">
              {totalCapturedWeight > 0 ? totalCapturedWeight.toFixed(1) : '0.0'}
            </span>
          </div>
          
          <div className="border-b border-gray-100 pb-2">
            <span className="font-bold text-sm sm:text-base">CLERK [{userName?.toUpperCase()}]</span>
            <p className="text-gray-600 text-xs sm:text-sm">{userName}</p>
          </div>
          
          <div className="flex justify-between items-center">
            <span className="font-bold text-sm sm:text-base">WEIGHT TODAY</span>
            <span className="text-gray-600 text-sm sm:text-base">
              {todayWeight > 0 ? todayWeight.toFixed(1) : '-'}
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
