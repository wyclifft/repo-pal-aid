import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { X } from 'lucide-react';

export interface CowDetails {
  cowName: string;
  cowBreed: string;
  numberOfCalves: string;
  otherDetails: string;
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
  const [otherDetails, setOtherDetails] = useState('');

  const handleSave = () => {
    onSave({
      cowName: cowName.trim(),
      cowBreed: cowBreed.trim(),
      numberOfCalves: numberOfCalves.trim(),
      otherDetails: otherDetails.trim(),
    });
    // Reset form
    setCowName('');
    setCowBreed('');
    setNumberOfCalves('');
    setOtherDetails('');
  };

  const handleClose = () => {
    // Reset form on close
    setCowName('');
    setCowBreed('');
    setNumberOfCalves('');
    setOtherDetails('');
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="sm:max-w-md mx-4 p-0 rounded-xl overflow-hidden">
        <DialogHeader className="flex flex-row items-center justify-between p-4 bg-white border-b">
          <DialogTitle className="text-xl font-semibold">Add Cow Details</DialogTitle>
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
            type="text"
            inputMode="numeric"
            placeholder="Number of Calves"
            value={numberOfCalves}
            onChange={(e) => setNumberOfCalves(e.target.value)}
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:border-[#5E35B1] text-base"
          />

          {/* Other Details */}
          <input
            type="text"
            placeholder="Other Details"
            value={otherDetails}
            onChange={(e) => setOtherDetails(e.target.value)}
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:border-[#5E35B1] text-base"
          />

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
