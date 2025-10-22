-- ============================================
-- APPROVED DEVICES TABLE SETUP
-- Run this in your Supabase SQL Editor
-- ============================================

-- 1. Drop existing table if it exists
DROP TABLE IF EXISTS public.approved_devices CASCADE;

-- 2. Create the approved_devices table
CREATE TABLE public.approved_devices (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  device_name TEXT NULL,
  approved BOOLEAN NOT NULL DEFAULT false,
  approved_at TIMESTAMP WITH TIME ZONE NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  last_used TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT approved_devices_pkey PRIMARY KEY (id),
  CONSTRAINT approved_devices_user_id_device_id_key UNIQUE (user_id, device_id)
);

-- 3. Enable Row Level Security
ALTER TABLE public.approved_devices ENABLE ROW LEVEL SECURITY;

-- 4. Create RLS Policies

-- Allow anyone to insert new device registrations
CREATE POLICY "Anyone can register devices"
ON public.approved_devices
FOR INSERT
TO anon, authenticated
WITH CHECK (true);

-- Allow anyone to view device records
CREATE POLICY "Anyone can view devices"
ON public.approved_devices
FOR SELECT
TO anon, authenticated
USING (true);

-- Allow anyone to update device records (for last_used and approval)
CREATE POLICY "Anyone can update devices"
ON public.approved_devices
FOR UPDATE
TO anon, authenticated
USING (true)
WITH CHECK (true);

-- Allow anyone to delete device records (for rejection)
CREATE POLICY "Anyone can delete devices"
ON public.approved_devices
FOR DELETE
TO anon, authenticated
USING (true);

-- 5. Create index for faster lookups
CREATE INDEX idx_approved_devices_user_device ON public.approved_devices(user_id, device_id);
CREATE INDEX idx_approved_devices_approved ON public.approved_devices(approved);

-- 6. Verify the setup
SELECT 
  schemaname, 
  tablename, 
  policyname, 
  permissive, 
  roles, 
  cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'approved_devices'
ORDER BY policyname;

-- ============================================
-- DONE! Your table is ready to use.
-- ============================================
