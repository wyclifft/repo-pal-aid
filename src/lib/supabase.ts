// Type definitions for MySQL/cPanel backend
// No Supabase client - all data comes from cPanel MySQL API

export interface Farmer {
  farmer_id: string;
  name: string;
  route: string;
  multOpt?: number; // 0 = single delivery per session, 1 = multiple allowed
  currqty?: number; // 0 = hide monthly cumulative on receipt, 1 = show monthly cumulative
}

export interface AppUser {
  user_id: string;
  username?: string;
  email?: string;
  ccode?: string;
  admin?: boolean;
  /**
   * Supervisor mode controlling milk capture and Z-report:
   * 0 = digital capture + print Z
   * 1 = manual capture + print Z
   * 2 = digital capture only (no Z)
   * 3 = manual capture only (no Z)
   * 4 = manual or digital capture + print Z
   */
  supervisor?: number;
  dcode?: string;
  groupid?: string;
  depart?: string;
  password?: string; // For offline caching only
  role?: string; // Kept for backward compatibility
}

/**
 * Helper to determine capture mode from supervisor value
 */
export const getCaptureMode = (supervisor?: number): {
  allowDigital: boolean;
  allowManual: boolean;
  allowZReport: boolean;
} => {
  const mode = supervisor ?? 0;
  switch (mode) {
    case 0: // digital capture + print Z
      return { allowDigital: true, allowManual: false, allowZReport: true };
    case 1: // manual capture + print Z
      return { allowDigital: false, allowManual: true, allowZReport: true };
    case 2: // digital capture only (no Z)
      return { allowDigital: true, allowManual: false, allowZReport: false };
    case 3: // manual capture only (no Z)
      return { allowDigital: false, allowManual: true, allowZReport: false };
    case 4: // manual or digital capture + print Z
      return { allowDigital: true, allowManual: true, allowZReport: true };
    default:
      return { allowDigital: true, allowManual: true, allowZReport: true };
  }
};

export interface MilkCollection {
  reference_no?: string;
  uploadrefno?: string; // Formatted reference (devcode + milkId) for approval workflows - e.g., BA0500000031
  farmer_id: string;
  farmer_name: string;
  route: string;
  session: string;
  weight: number;
  clerk_name: string;
  collection_date: Date;
  /**
   * Snapshot of member multOpt at the time of capture.
   * 0 = single delivery per session, 1 = multiple allowed.
   */
  multOpt?: number;
  orderId?: number;
  synced?: boolean;
}
