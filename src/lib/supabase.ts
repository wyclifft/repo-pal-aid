import { createClient } from '@supabase/supabase-js';

// External Supabase Database Configuration
const supabaseUrl = 'https://nzwmiuntcrjntnopargu.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im56d21pdW50Y3JqbnRub3Bhcmd1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk3OTQ0NjcsImV4cCI6MjA3NTM3MDQ2N30.SRNF3UcUeuwgxzKu3JP0zsJzJD77LkQyJG5hm0iDlGQ';

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
});

export interface Farmer {
  farmer_id: string;
  name: string;
  route: string;
}

export interface AppUser {
  user_id: string;
  password?: string;
  role: string;
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
