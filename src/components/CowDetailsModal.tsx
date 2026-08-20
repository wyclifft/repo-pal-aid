import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { X } from 'lucide-react';

export interface CowDetails {
  cowName: string;
  cowBreed: string;
  numberOfCalves: string;
  bullCode: string;
  bullName: string;
  nextHeat: string;
}

interface CowDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (details: CowDetails) => void;
  itemName?: string; // The AI item being added (e.g., "Freshian white")
}

export const CowDetailsModal = ({ 
  isOpen, 
  onClose, 
  onSave,
  itemName 
}: CowDetailsModalProps) => {
  const [cowName, setCowName] = useState('');
  const [cowBreed, setCowBreed] = useState('');
  const [numberOfCalves, setNumberOfCalves] = useState('');
  const [bullCode, setBullCode] = useState('');
  const [bullName, setBullName] = useState('');
  const [nextHeat, setNextHeat] = useState('');

  const handleSave = () => {
    onSave({
      cowName: cowName.trim(),
      cowBreed: cowBreed.trim(),
      numberOfCalves: numberOfCalves.trim(),
      bullCode: bullCode.trim(),
      bullName: bullName.trim(),
      nextHeat: nextHeat.trim(),
    });
    // Reset form
    setCowName('');
    setCowBreed('');
    setNumberOfCalves('');
    setBullCode('');
    setBullName('');
    setNextHeat('');
  };

  const handleClose = () => {
    // Reset form on close
    setCowName('');
    setCowBreed('');
    setNumberOfCalves('');
    setBullCode('');
    setBullName('');
    setNextHeat('');
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="sm:max-w-md mx-4 p-0 rounded-xl overflow-hidden" hideCloseButton>
        <DialogHeader className="flex flex-row items-center justify-between p-4 bg-white border-b">
          <div>
            <DialogTitle className="text-xl font-semibold">Add Cow Details</DialogTitle>
            <DialogDescription className="sr-only">
              Enter details about the cow for this AI service
            </DialogDescription>
          </div>
          <button 
            onClick={handleClose}
            className="p-1.5 hover:bg-gray-100 rounded-full transition-colors"
          >
            <X className="h-5 w-5 text-gray-500" />
          </button>
        </DialogHeader>
        
        <div className="p-4 bg-white space-y-4">
          {/* Item name display */}
          {itemName && (
            <div className="text-center text-[#5E35B1] font-medium text-lg mb-4">
              {itemName}
            </div>
          )}

          {/* Cow Name */}
          <input
            type="text"
            placeholder="Cow Name"
            value={cowName}
            onChange={(e) => setCowName(e.target.value)}
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:border-[#5E35B1] text-base"
          />

          {/* Cow Breed */}
          <input
            type="text"
            placeholder="Cow Breed"
            value={cowBreed}
            onChange={(e) => setCowBreed(e.target.value)}
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:border-[#5E35B1] text-base"
          />

          {/* Number of Calves */}
          <input
            type="number"
            autoComplete="off"
            placeholder="Number of Calves"
            value={numberOfCalves}
            onChange={(e) => setNumberOfCalves(e.target.value)}
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:border-[#5E35B1] text-base"
          />

          {/* Bull Code */}
          <input
            type="text"
            placeholder="Bull Code"
            value={bullCode}
            onChange={(e) => setBullCode(e.target.value)}
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:border-[#5E35B1] text-base"
          />

          {/* Bull Name */}
          <input
            type="text"
            placeholder="Bull Name"
            value={bullName}
            onChange={(e) => setBullName(e.target.value)}
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:border-[#5E35B1] text-base"
          />

          {/* Next Heat Date Picker */}
          <div className="space-y-1">
            <label className="text-sm text-gray-500 ml-1">Next Heat Date</label>
            <input
              type="date"
              value={nextHeat}
              onChange={(e) => setNextHeat(e.target.value)}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:border-[#5E35B1] text-base"
            />
          </div>

          {/* Save Button */}
          <button
            onClick={handleSave}
            className="w-full py-3 bg-[#5E35B1] text-white font-semibold rounded-full hover:bg-[#4a2a90] transition-colors text-base"
          >
            Save Cow Details
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
