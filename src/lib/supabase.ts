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
  farmer_id: string;
  farmer_name: string;
  route: string;
  session: string;
  weight: number;
  clerk_name: string;
  collection_date: Date;
  orderId?: number;
  synced?: boolean;
}
