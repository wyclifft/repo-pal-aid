import React, { useState } from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import { Leaf } from 'lucide-react';
import { farmersApi } from '../../lib/api'; // or adjust to exact path for your fetcher

interface FarmerLoginProps {
  onLoginSuccess: (farmer: any) => void;
  onCancel: () => void;
}

export function FarmerLoginScreen({ onLoginSuccess, onCancel }: FarmerLoginProps) {
  const [ccode, setCcode] = useState('');
  const [mcode, setMcode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      // NOTE: Using a direct fetch here as this endpoint is unique to farmers
      const response = await fetch(`${import.meta.env.VITE_API_URL || ''}/api/farmer/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ccode, mcode })
      });

      const data = await response.json();

      if (response.ok && data.success) {
        localStorage.setItem('farmer_session', JSON.stringify(data.farmer));
        onLoginSuccess(data.farmer);
      } else {
        setError(data.error || 'Login failed. Verify your codes.');
      }
    } catch (err) {
      setError('Network error. Please check your connection.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-green-50 p-4">
      <Card className="w-full max-w-sm shadow-xl border-green-100">
        <CardHeader className="space-y-2 text-center pb-4">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-green-100 mb-2">
            <Leaf className="h-6 w-6 text-green-600" />
          </div>
          <CardTitle className="text-2xl font-bold text-green-900">Farmer Portal</CardTitle>
          <p className="text-sm text-green-600/80">Self-service access to your collections</p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleLogin} className="space-y-5">
            {error && (
              <div className="rounded-md bg-red-50 p-3 text-sm text-red-600 border border-red-100 text-center font-medium">
                {error}
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-sm font-semibold text-gray-700">Company Code</label>
              <Input
                value={ccode}
                onChange={(e) => setCcode(e.target.value.toUpperCase())}
                placeholder="e.g. C001"
                required
                className="font-mono text-center uppercase tracking-widest text-lg h-12"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-semibold text-gray-700">Member ID</label>
              <Input
                value={mcode}
                onChange={(e) => setMcode(e.target.value)}
                placeholder="e.g. 1234 or M01234"
                required
                className="font-mono text-center tracking-widest text-lg h-12"
              />
            </div>

            <div className="pt-2 flex flex-col gap-3">
              <Button
                type="submit"
                className="w-full bg-green-600 hover:bg-green-700 text-white h-12 text-lg"
                disabled={loading}
              >
                {loading ? 'Verifying...' : 'Access My Portal'}
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="w-full text-gray-500 hover:text-gray-700"
                onClick={onCancel}
              >
                Go Back
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <p className="mt-8 text-center text-xs text-green-800/60 font-medium">
        Secure Cooperative Member Access
      </p>
    </div>
  );
}
