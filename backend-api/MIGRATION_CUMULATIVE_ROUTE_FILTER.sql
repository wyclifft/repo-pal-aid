-- MIGRATION: Add cumulative_route_filter to psettings table
-- orgtype = D only: 1 = filter cumulative by selected route, 0 = all routes
ALTER TABLE psettings ADD COLUMN IF NOT EXISTS cumulative_route_filter TINYINT(1) DEFAULT 0;
