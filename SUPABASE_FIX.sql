-- ============================================
-- FIX RLS POLICIES FOR MILK COLLECTION APP
-- Run these commands in your Supabase SQL Editor
-- ============================================

-- 1. Enable RLS on all tables (if not already enabled)
ALTER TABLE public.milk_collection ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.farmers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collection_items ENABLE ROW LEVEL SECURITY;

-- 2. DROP existing policies (if any) to avoid conflicts
DROP POLICY IF EXISTS "Allow anonymous inserts on milk_collection" ON public.milk_collection;
DROP POLICY IF EXISTS "Allow anonymous selects on milk_collection" ON public.milk_collection;
DROP POLICY IF EXISTS "Allow all operations on milk_collection" ON public.milk_collection;

DROP POLICY IF EXISTS "Allow anonymous selects on farmers" ON public.farmers;
DROP POLICY IF EXISTS "Allow all operations on farmers" ON public.farmers;

DROP POLICY IF EXISTS "Allow anonymous selects on app_users" ON public.app_users;
DROP POLICY IF EXISTS "Allow all operations on app_users" ON public.app_users;

DROP POLICY IF EXISTS "Allow all operations on collection_items" ON public.collection_items;

-- 3. CREATE PERMISSIVE POLICIES for milk_collection
-- Allow anyone to insert milk collection records
CREATE POLICY "Allow anonymous inserts on milk_collection"
ON public.milk_collection
FOR INSERT
TO anon, authenticated
WITH CHECK (true);

-- Allow anyone to view milk collection records
CREATE POLICY "Allow anonymous selects on milk_collection"
ON public.milk_collection
FOR SELECT
TO anon, authenticated
USING (true);

-- Allow anyone to update milk collection records (for syncing)
CREATE POLICY "Allow anonymous updates on milk_collection"
ON public.milk_collection
FOR UPDATE
TO anon, authenticated
USING (true)
WITH CHECK (true);

-- 4. CREATE POLICIES for farmers table
CREATE POLICY "Allow anonymous selects on farmers"
ON public.farmers
FOR SELECT
TO anon, authenticated
USING (true);

-- 5. CREATE POLICIES for app_users table
CREATE POLICY "Allow anonymous selects on app_users"
ON public.app_users
FOR SELECT
TO anon, authenticated
USING (true);

-- 6. CREATE POLICIES for collection_items table
CREATE POLICY "Allow all operations on collection_items"
ON public.collection_items
FOR ALL
TO anon, authenticated
USING (true)
WITH CHECK (true);

-- 7. Verify policies are created
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
AND tablename IN ('milk_collection', 'farmers', 'app_users', 'collection_items')
ORDER BY tablename, policyname;

-- ============================================
-- NOTES:
-- - These policies allow anonymous access for offline-first functionality
-- - If you need user-specific access control, modify policies to use auth.uid()
-- - Run this script in your Supabase SQL Editor
-- ============================================
