// Type definitions for MySQL/cPanel backend
// No Supabase client - all data comes from cPanel MySQL API

export interface Farmer {
  farmer_id: string;
  name: string;
  route: string;
  multOpt?: number; // 0 = single delivery per session, 1 = multiple allowed
}

export interface AppUser {
  user_id: string;
  username?: string;
  email?: string;
  ccode?: string;
  admin?: boolean;
  supervisor?: boolean;
  dcode?: string;
  groupid?: string;
  depart?: string;
  password?: string; // For offline caching only
  role?: string; // Kept for backward compatibility
}

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
