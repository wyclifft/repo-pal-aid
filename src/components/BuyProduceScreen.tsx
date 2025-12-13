import { useState, useEffect, useRef } from 'react';
import { CornerDownLeft, Search, X } from 'lucide-react';
import { type Farmer, type MilkCollection } from '@/lib/supabase';
import { type Route, type Session } from '@/services/mysqlApi';
import { useIndexedDB } from '@/hooks/useIndexedDB';
import { mysqlApi } from '@/services/mysqlApi';
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
}: BuyProduceScreenProps) => {
  const [memberNo, setMemberNo] = useState('');
  const [suggestions, setSuggestions] = useState<Farmer[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [cachedFarmers, setCachedFarmers] = useState<Farmer[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const { getFarmers } = useIndexedDB();

  const today = new Date().toISOString().split('T')[0];

  // Load cached farmers
  useEffect(() => {
    const loadFarmers = async () => {
      try {
        const farmers = await getFarmers();
        const filtered = route?.tcode 
          ? farmers.filter(f => f.route === route.tcode)
          : farmers;
        setCachedFarmers(filtered);
      } catch (err) {
        console.error('Failed to load farmers:', err);
      }
    };
    loadFarmers();
  }, [getFarmers, route?.tcode]);

  // Search farmers
  const searchFarmers = (query: string) => {
    if (!query) {
      setSuggestions(cachedFarmers.slice(0, 10));
      return;
    }
    const lowerQuery = query.toLowerCase();
    const filtered = cachedFarmers.filter((f) => {
      const idMatch = String(f.farmer_id || '').toLowerCase().startsWith(lowerQuery);
      const nameMatch = String(f.name || '').toLowerCase().includes(lowerQuery);
      return idMatch || nameMatch;
    });
    setSuggestions(filtered.slice(0, 10));
  };

  useEffect(() => {
    searchFarmers(memberNo);
  }, [memberNo, cachedFarmers]);

  const handleEnter = () => {
    if (suggestions.length === 1) {
      handleSelectFarmer(suggestions[0]);
    } else if (suggestions.length > 1) {
      setShowSuggestions(true);
    }
  };

  const handleSearch = () => {
    setShowSuggestions(true);
    searchFarmers(memberNo);
  };

  const handleClear = () => {
    setMemberNo('');
    setSuggestions([]);
    setShowSuggestions(false);
    onClearFarmer();
  };

  const handleSelectFarmer = (farmer: Farmer) => {
    setMemberNo(farmer.farmer_id);
    setShowSuggestions(false);
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

      {/* Produce Buying Banner */}
      <div className="bg-teal-500 text-white text-center py-2 font-semibold text-sm sm:text-base">
        Produce Buying
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

        {/* Manual Weight Entry */}
        <div className="flex gap-2 items-center">
          <span className="text-xs sm:text-sm font-medium text-gray-700 whitespace-nowrap">Manual:</span>
          <input
            type="number"
            inputMode="decimal"
            step="0.1"
            min="0"
            placeholder="Enter weight"
            onChange={(e) => onManualWeightChange?.(parseFloat(e.target.value) || 0)}
            className="flex-1 px-3 sm:px-4 py-2.5 sm:py-2 border-2 border-gray-300 rounded-lg text-base sm:text-lg min-h-[44px]"
          />
        </div>

        {/* Member Search */}
        <div className="flex gap-1.5 sm:gap-2 relative">
          <input
            ref={inputRef}
            type="text"
            inputMode="text"
            placeholder="Enter Member No."
            value={memberNo}
            onChange={(e) => {
              setMemberNo(e.target.value);
              setShowSuggestions(true);
            }}
            onFocus={() => setShowSuggestions(true)}
            className="flex-1 px-3 sm:px-4 py-2.5 sm:py-3 border-2 border-gray-300 rounded-lg text-base sm:text-lg min-h-[44px]"
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

          {/* Suggestions Dropdown */}
          {showSuggestions && suggestions.length > 0 && (
            <div className="absolute top-full left-0 right-20 bg-white border-2 border-gray-300 rounded-lg shadow-lg max-h-60 overflow-y-auto z-50 mt-1">
              {suggestions.map((farmer) => (
                <div
                  key={farmer.farmer_id}
                  className="px-4 py-3 cursor-pointer hover:bg-teal-100 border-b border-gray-100"
                  onClick={() => handleSelectFarmer(farmer)}
                >
                  <div className="font-semibold">{farmer.farmer_id} - {farmer.name}</div>
                </div>
              ))}
            </div>
          )}
        </div>

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
            className="flex-1 py-3 bg-white border-2 border-teal-500 rounded-lg font-semibold text-teal-600 hover:bg-teal-50 active:bg-teal-100 min-h-[48px] text-sm sm:text-base"
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

        {/* Transactions */}
        <div className="bg-white border border-gray-200 rounded-lg p-4 text-center">
          {capturedCollections.length === 0 ? (
            <span className="text-gray-500">NO TRANSACTIONS ...</span>
          ) : (
            <div className="space-y-2">
              {capturedCollections.map((c, i) => (
                <div key={i} className="flex justify-between text-sm border-b border-gray-100 pb-1">
                  <span>#{i + 1} - {c.reference_no?.slice(-6)}</span>
                  <span className="font-semibold">{c.weight.toFixed(1)} KGS</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
