import React, { useState, useEffect } from 'react';
import { Card, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { ArrowLeft, Clock, MapPin, Search, Scale } from 'lucide-react';
import { Input } from '../ui/input';

interface FarmerCollectionsProps {
  farmer: any;
  onBack: () => void;
}

export function FarmerCollectionsScreen({ farmer, onBack }: FarmerCollectionsProps) {
  const [collections, setCollections] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    const fetchCollections = async () => {
      try {
        const response = await fetch(`${import.meta.env.VITE_API_URL || ''}/api/farmer/collections?ccode=${farmer.ccode}&mcode=${farmer.farmer_id}&limit=100`);
        const data = await response.json();
        if (data.success) {
          setCollections(data.data);
        }
      } catch (e) {
        console.error("Failed to load collections", e);
      } finally {
        setLoading(false);
      }
    };
    fetchCollections();
  }, [farmer]);

  const filtered = collections.filter(c =>
    c.date.includes(searchTerm) ||
    (c.session && c.session.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* App Bar */}
      <div className="bg-white text-gray-800 p-4 shadow-sm sticky top-0 z-10 flex items-center border-b">
        <Button variant="ghost" size="icon" onClick={onBack} className="mr-2 -ml-2 text-gray-600">
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-lg font-bold">My Collections</h1>
      </div>

      <div className="p-4 flex-1">
        <div className="relative mb-4">
          <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
          <Input
            placeholder="Filter by date or session..."
            className="pl-9 bg-white"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        {loading ? (
          <div className="text-center py-12 text-gray-400">Loading your history...</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            <Scale className="h-12 w-12 mx-auto mb-3 opacity-20" />
            <p>No collections found.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((c, i) => (
              <Card key={i} className="border-none shadow-sm overflow-hidden">
                <CardContent className="p-0">
                  <div className="flex">
                    {/* Left weight badge */}
                    <div className="bg-green-50 w-24 flex flex-col items-center justify-center p-3 border-r border-green-100">
                      <span className="text-xl font-bold text-green-700">{c.weight}</span>
                      <span className="text-[10px] uppercase font-bold text-green-600 tracking-wider">KGs</span>
                    </div>
                    {/* Right details */}
                    <div className="p-3 flex-1">
                      <div className="font-semibold text-gray-800 text-sm mb-1">
                        {new Date(c.date).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
                      </div>
                      <div className="flex flex-col gap-1 mt-2">
                        <div className="flex items-center text-xs text-gray-500">
                          <Clock className="h-3 w-3 mr-1.5" />
                          <span>{c.session} {c.reference_no ? `• #${c.reference_no}` : ''}</span>
                        </div>
                        <div className="flex items-center text-xs text-gray-500">
                          <MapPin className="h-3 w-3 mr-1.5" />
                          <span>{c.route} • {c.clerk_name}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
