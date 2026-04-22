import { useState, useEffect, useRef } from 'react';
import { z } from 'zod';
import { Loader2, UserPlus, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';

import { useIndexedDB } from '@/hooks/useIndexedDB';
import { mysqlApi } from '@/services/mysqlApi';
import { useAuth } from '@/contexts/AuthContext';
import { generateDeviceFingerprint, getStoredDeviceId } from '@/utils/deviceFingerprint';

interface RouteOption {
  tcode: string;
  descript: string;
}

interface AddMemberModalProps {
  open: boolean;
  onClose: () => void;
  onMemberAdded?: () => void;
}

// Zod schema for client-side validation
const memberSchema = z.object({
  mmcode: z.string().trim().min(1, 'Member ID is required').max(50, 'Member ID too long'),
  descript: z.string().trim().min(1, 'Full name is required').max(100, 'Name too long'),
  gender: z.enum(['M', 'F', 'O'], { errorMap: () => ({ message: 'Select gender' }) }),
  idno: z
    .string()
    .trim()
    .min(1, 'ID number is required')
    .max(50, 'ID number too long')
    .regex(/^[0-9]+$/, 'ID number must contain only digits'),
  route: z.string().trim().min(1, 'Route is required'),
  multOpt: z.boolean(),
});

export const AddMemberModal = ({ open, onClose, onMemberAdded }: AddMemberModalProps) => {
  const { currentUser } = useAuth();
  const { getRoutes, isReady } = useIndexedDB();

  const [routes, setRoutes] = useState<RouteOption[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [suggestingId, setSuggestingId] = useState(false);

  const [mmcode, setMmcode] = useState('');
  const [descript, setDescript] = useState('');
  const [gender, setGender] = useState<'M' | 'F' | 'O' | ''>('');
  const [idno, setIdno] = useState('');
  const [route, setRoute] = useState('');
  const [multOpt, setMultOpt] = useState(true);
  // v2.10.58: explicit Member (M) vs Debtor (D) selector for the next-id suggestion
  const [memberType, setMemberType] = useState<'M' | 'D'>('M');

  // v2.10.43: inline success banner state
  const [lastSuccessMessage, setLastSuccessMessage] = useState<string | null>(null);
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const ccode = (typeof window !== 'undefined' && localStorage.getItem('device_ccode')) || '';

  // Helper: clear the inline success banner (and any pending auto-clear timer)
  const clearSuccessBanner = () => {
    if (successTimerRef.current) {
      clearTimeout(successTimerRef.current);
      successTimerRef.current = null;
    }
    setLastSuccessMessage(null);
  };

  // Helper: resolve fingerprint same way as the rest of the app
  const resolveFingerprint = async (): Promise<string> => {
    let fp = getStoredDeviceId() || '';
    if (!fp) {
      try {
        fp = await generateDeviceFingerprint();
      } catch (e) {
        console.warn('[AddMember] generateDeviceFingerprint failed:', e);
      }
    }
    return fp;
  };

  // Helper: fetch next-id suggestion (optionally for a specific prefix) and pre-fill mmcode
  const fetchAndApplyNextId = async (prefixOverride?: 'M' | 'D') => {
    if (!navigator.onLine) return;
    setSuggestingId(true);
    try {
      const fp = await resolveFingerprint();
      if (!fp) return;
      const requestedPrefix = prefixOverride ?? memberType;
      const result = await mysqlApi.members.getNextId(fp, requestedPrefix);
      if (result.success && result.data?.suggested) {
        setMmcode(result.data.suggested);
      }
    } catch (err) {
      console.warn('[AddMember] getNextId failed:', err);
    } finally {
      setSuggestingId(false);
    }
  };

  // Reset fields + fetch suggestion when opened
  useEffect(() => {
    if (open) {
      setMmcode('');
      setDescript('');
      setGender('');
      setIdno('');
      setRoute('');
      setMultOpt(true);
      // Default to Member on every fresh open
      setMemberType('M');
      clearSuccessBanner();
      // Fire-and-forget: pre-fill mmcode with next available Member ID
      void fetchAndApplyNextId('M');
    } else {
      clearSuccessBanner();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Handle Member/Debtor toggle: refresh the suggested ID for the chosen prefix
  const handleMemberTypeChange = (value: string) => {
    if (value !== 'M' && value !== 'D') return; // ToggleGroup may emit '' on deselect
    if (value === memberType) return;
    setMemberType(value);
    editingClear();
    void fetchAndApplyNextId(value);
  };

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (successTimerRef.current) clearTimeout(successTimerRef.current);
    };
  }, []);

  // Load routes from IndexedDB cache when modal opens
  useEffect(() => {
    if (!open || !isReady) return;
    (async () => {
      try {
        const cached = await getRoutes();
        const opts: RouteOption[] = (cached || [])
          .filter((r: any) => r && r.tcode)
          .map((r: any) => ({ tcode: String(r.tcode).trim(), descript: String(r.descript || r.tcode).trim() }));
        setRoutes(opts);
      } catch (err) {
        console.warn('[AddMember] failed to load routes:', err);
      }
    })();
  }, [open, isReady, getRoutes]);

  // Wrap setters to auto-clear the success banner when the user starts editing
  const editingClear = () => {
    if (lastSuccessMessage) clearSuccessBanner();
  };

  const handleSubmit = async () => {
    if (!navigator.onLine) {
      toast.error('Add Member requires an internet connection');
      return;
    }
    if (!currentUser?.user_id) {
      toast.error('You must be logged in');
      return;
    }

    const parsed = memberSchema.safeParse({
      mmcode,
      descript,
      gender,
      idno,
      route,
      multOpt,
    });

    if (!parsed.success) {
      const first = parsed.error.errors[0];
      toast.error(first?.message || 'Please complete all required fields');
      return;
    }

    const deviceFingerprint = await resolveFingerprint();
    if (!deviceFingerprint) {
      toast.error('Device fingerprint missing — please reload the app');
      return;
    }

    setSubmitting(true);
    try {
      const result = await mysqlApi.members.create(
        {
          mmcode: parsed.data.mmcode,
          descript: parsed.data.descript,
          gender: parsed.data.gender,
          idno: parsed.data.idno,
          route: parsed.data.route,
          multOpt: parsed.data.multOpt ? 1 : 0,
        },
        currentUser.user_id,
        deviceFingerprint
      );

      if (result.success) {
        const savedId = result.data?.farmer_id || parsed.data.mmcode;
        console.log('[SUCCESS] Member created:', savedId);

        // Inline success banner (auto-clear after 5s)
        const msg = `Member ${savedId} added successfully`;
        setLastSuccessMessage(msg);
        if (successTimerRef.current) clearTimeout(successTimerRef.current);
        successTimerRef.current = setTimeout(() => setLastSuccessMessage(null), 5000);

        // Toast fallback for users who close the modal quickly
        toast.success(msg);

        // Notify other components to refresh caches
        window.dispatchEvent(new CustomEvent('membersUpdated'));
        onMemberAdded?.();

        // Reset form fields for rapid sequential entry, keep modal open
        setDescript('');
        setGender('');
        setIdno('');
        // Keep `route` and `multOpt` defaults the operator most likely wants again
        setMmcode('');

        // Pre-fill the next suggested ID
        void fetchAndApplyNextId();
      } else {
        const errMsg = (result as any).error || 'Failed to add member';
        toast.error(errMsg);
      }
    } catch (err: any) {
      console.error('[ERROR] Add member failed:', err);
      toast.error(err?.message || 'Failed to add member');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="h-5 w-5" />
            Add New Member
          </DialogTitle>
          <DialogDescription>
            Register a new member directly into the system. Required fields are marked with *.
          </DialogDescription>
        </DialogHeader>

        {/* v2.10.43: Inline success banner pinned to top of form */}
        {lastSuccessMessage && (
          <Alert
            className="border-[hsl(142_76%_36%/0.4)] bg-[hsl(142_76%_36%/0.08)] text-[hsl(142_76%_28%)] dark:text-[hsl(142_76%_70%)]"
            role="status"
          >
            <CheckCircle2 className="h-4 w-4 !text-[hsl(142_76%_36%)]" />
            <AlertDescription className="font-medium">
              {lastSuccessMessage}
            </AlertDescription>
          </Alert>
        )}

        <div className="space-y-3 py-2">
          {/* Auto-applied ccode badge */}
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Company Code</span>
            <Badge variant="secondary">{ccode || 'unknown'}</Badge>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="mm-mmcode">Member ID *</Label>
            <div className="relative">
              <Input
                id="mm-mmcode"
                value={mmcode}
                onChange={(e) => { setMmcode(e.target.value); editingClear(); }}
                placeholder={suggestingId ? 'Fetching next ID…' : 'e.g. M00001'}
                maxLength={50}
                disabled={submitting}
              />
              {suggestingId && (
                <Loader2 className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Auto-suggested next ID — you can edit if needed.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="mm-name">Full Name *</Label>
            <Input
              id="mm-name"
              value={descript}
              onChange={(e) => { setDescript(e.target.value); editingClear(); }}
              placeholder="e.g. John Doe"
              maxLength={100}
              disabled={submitting}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="mm-gender">Gender *</Label>
            <Select value={gender} onValueChange={(v) => { setGender(v as 'M' | 'F' | 'O'); editingClear(); }} disabled={submitting}>
              <SelectTrigger id="mm-gender">
                <SelectValue placeholder="Select gender" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="M">Male</SelectItem>
                <SelectItem value="F">Female</SelectItem>
                <SelectItem value="O">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="mm-idno">ID Number *</Label>
            <Input
              id="mm-idno"
              type="tel"
              inputMode="numeric"
              value={idno}
              onChange={(e) => { setIdno(e.target.value); editingClear(); }}
              placeholder="e.g. 12345678"
              maxLength={50}
              disabled={submitting}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="mm-route">Route *</Label>
            <Select value={route} onValueChange={(v) => { setRoute(v); editingClear(); }} disabled={submitting || routes.length === 0}>
              <SelectTrigger id="mm-route">
                <SelectValue placeholder={routes.length === 0 ? 'No routes available' : 'Select route'} />
              </SelectTrigger>
              <SelectContent>
                {routes.map((r) => (
                  <SelectItem key={r.tcode} value={r.tcode}>
                    {r.tcode} — {r.descript}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between rounded-md border p-3">
            <div className="space-y-0.5">
              <Label htmlFor="mm-multopt" className="text-sm">Active (multOpt)</Label>
              <p className="text-xs text-muted-foreground">
                Allow multiple deliveries per session
              </p>
            </div>
            <Switch
              id="mm-multopt"
              checked={multOpt}
              onCheckedChange={(v) => { setMultOpt(v); editingClear(); }}
              disabled={submitting}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Close
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Adding...
              </>
            ) : (
              <>
                <UserPlus className="mr-2 h-4 w-4" />
                Add Member
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default AddMemberModal;
