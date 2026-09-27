import React, { useState, useEffect } from 'react';
import { formatWeight } from '@/utils/weightUtils';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { LogOut, RefreshCcw, Scale, Receipt, ArrowRight } from 'lucide-react';
import { FarmerCollectionsScreen } from './FarmerCollectionsScreen';

interface FarmerDashboardProps {
  farmer: any;
  onLogout: () => void;
}

export function FarmerDashboard({ farmer, onLogout }: FarmerDashboardProps) {
  const [activeTab, setActiveTab] = useState<'overview' | 'collections'>('overview');
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const fetchSummary = async () => {
    setLoading(true);
    try {
      const response = await fetch(`${import.meta.env.VITE_API_URL || ''}/api/farmer/reports?ccode=${farmer.ccode}&mcode=${farmer.farmer_id}`);
      const data = await response.json();
      if (data.success) {
        setSummary(data.data);
      }
    } catch (e) {
      console.error("Failed to load summary", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSummary();
  }, [farmer]);

  if (activeTab === 'collections') {
    return <FarmerCollectionsScreen farmer={farmer} onBack={() => setActiveTab('overview')} />;
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      {/* App Bar */}
      <div className="bg-green-600 text-white p-4 shadow-md sticky top-0 z-10 flex justify-between items-center">
        <div>
          <h1 className="text-xl font-bold">My Portal</h1>
          <p className="text-sm text-green-100 opacity-90">{farmer.name} ({farmer.farmer_id})</p>
        </div>
        <Button variant="ghost" size="icon" onClick={onLogout} className="text-white hover:bg-green-700 rounded-full">
          <LogOut className="h-5 w-5" />
        </Button>
      </div>

      <div className="p-4 space-y-4 max-w-lg mx-auto">
        <div className="flex justify-between items-center px-1">
          <h2 className="font-semibold text-gray-700">Overview</h2>
          <Button variant="ghost" size="sm" onClick={fetchSummary} className="h-8 text-green-600">
            <RefreshCcw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 gap-4">
          <Card className="border-none shadow-sm bg-white overflow-hidden">
            <div className="bg-blue-500 h-1 w-full" />
            <CardContent className="p-4">
              <div className="flex items-center space-x-2 text-blue-600 mb-2">
                <Scale className="h-4 w-4" />
                <span className="text-xs font-semibold uppercase tracking-wider">{summary?.periodLabel || 'Period'} Total</span>
              </div>
              <div className="text-2xl font-bold text-gray-800">
                {loading ? '--' : `${formatWeight(Number(summary?.totalWeight || 0))}`} <span className="text-sm font-normal text-gray-500">KGs</span>
              </div>
            </CardContent>
          </Card>

          <Card className="border-none shadow-sm bg-white overflow-hidden">
             <div className="bg-amber-500 h-1 w-full" />
            <CardContent className="p-4">
              <div className="flex items-center space-x-2 text-amber-600 mb-2">
                <Receipt className="h-4 w-4" />
                <span className="text-xs font-semibold uppercase tracking-wider">Store Deductions</span>
              </div>
              <div className="text-2xl font-bold text-gray-800">
                {loading ? '--' : `${Number(summary?.totalDeductions || 0).toFixed(0)}`} <span className="text-sm font-normal text-gray-500">KES</span>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Nav Cards */}
        <Card
          className="border border-green-100 shadow-sm hover:shadow-md transition-shadow cursor-pointer mt-6"
          onClick={() => setActiveTab('collections')}
        >
          <CardContent className="p-4 flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="p-2 bg-green-100 rounded-lg text-green-600">
                <Scale className="h-5 w-5" />
              </div>
              <div>
                <h3 className="font-semibold text-gray-800">My Collections</h3>
                <p className="text-sm text-gray-500">View your daily delivery history</p>
              </div>
            </div>
            <ArrowRight className="h-5 w-5 text-gray-400" />
          </CardContent>
        </Card>

      </div>
    </div>
  );
}
