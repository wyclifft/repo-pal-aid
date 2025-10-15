-- MySQL Schema for Milk Collection App
-- Run this in your cPanel MySQL database

-- Farmers table
CREATE TABLE IF NOT EXISTS farmers (
  farmer_id VARCHAR(50) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  route VARCHAR(50),
  route_name VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- App users table
CREATE TABLE IF NOT EXISTS app_users (
  user_id VARCHAR(50) PRIMARY KEY,
  password VARCHAR(255) NOT NULL,
  role VARCHAR(50) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Milk collection table
CREATE TABLE IF NOT EXISTS milk_collection (
  id INT AUTO_INCREMENT PRIMARY KEY,
  reference_no VARCHAR(50),
  farmer_id VARCHAR(50) NOT NULL,
  farmer_name VARCHAR(255) NOT NULL,
  route VARCHAR(50),
  route_name VARCHAR(255),
  member_route VARCHAR(50),
  section VARCHAR(50) NOT NULL,
  weight DECIMAL(10,2) NOT NULL,
  collected_by VARCHAR(50),
  clerk_name VARCHAR(255) NOT NULL,
  price_per_liter DECIMAL(10,2) DEFAULT 0,
  total_amount DECIMAL(10,2) DEFAULT 0,
  collection_date DATETIME NOT NULL,
  synced TINYINT(1) DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (farmer_id) REFERENCES farmers(farmer_id),
  INDEX idx_farmer_date (farmer_id, collection_date),
  INDEX idx_section_date (section, collection_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Insert sample data (optional)
-- Note: Passwords should be hashed with bcrypt before inserting
-- Example: For password "clerk123", use bcrypt to generate hash
INSERT INTO app_users (user_id, password, role) VALUES
('clerk1', '$2b$10$YourBcryptHashHere', 'clerk'),
('admin1', '$2b$10$YourBcryptHashHere', 'admin');
