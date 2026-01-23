// Type definitions for MySQL/cPanel backend
// No Supabase client - all data comes from cPanel MySQL API

export interface Farmer {
  farmer_id: string;
  name: string;
  route: string;
  multOpt?: number; // 0 = single delivery per session, 1 = multiple allowed
  currqty?: number; // 0 = hide monthly cumulative on receipt, 1 = show monthly cumulative
  crbal?: string; // Credit balance string from cm_members e.g. "CR02#11200,CR22#340"
  ccode?: string; // Credit code for filtering credit entries
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

// DB Column Mapping for transactions table (Transtype = 1):
// Frontend field → DB column
// reference_no → transrefno
// uploadrefno → Uploadrefno  
// farmer_id → memberno
// session → session (AM/PM for dairy, season name for coffee)
// weight → weight
// clerk_name → clerk
// collection_date → transdate
// product_code → icode

export interface MilkCollection {
  reference_no?: string;      // → DB: transrefno
  uploadrefno?: string;       // → DB: Uploadrefno - Formatted reference (devcode + milkId)
  farmer_id: string;          // → DB: memberno
  farmer_name: string;        // Display only, not stored directly
  route: string;              // → DB: route
  session: string;            // → DB: session - AM/PM for dairy, season name for coffee
  weight: number;             // → DB: weight
  user_id?: string;           // → DB: userId (login user_id for tracking)
  clerk_name: string;         // → DB: clerk (display name/username)
  collection_date: Date;      // → DB: transdate
  /**
   * Snapshot of member multOpt at the time of capture.
   * 0 = single delivery per session, 1 = multiple allowed.
   */
  multOpt?: number;
  orderId?: number;
  synced?: boolean;
  // Product info (from fm_items, invtype=01)
  product_code?: string;      // → DB: icode
  product_name?: string;      // Display only, derived from fm_items.descript
  // Entry type: 'scale' for Bluetooth scale readings, 'manual' for manual input
  entry_type?: 'scale' | 'manual';
}
