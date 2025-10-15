const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const bcrypt = require('bcrypt');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// MySQL connection pool
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// Test database connection
pool.getConnection()
  .then(connection => {
    console.log('✅ Connected to MySQL database');
    connection.release();
  })
  .catch(err => {
    console.error('❌ Database connection failed:', err);
  });

// Routes

// Get all farmers
app.get('/api/farmers', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM farmers ORDER BY name');
    res.json(rows);
  } catch (error) {
    console.error('Error fetching farmers:', error);
    res.status(500).json({ error: 'Failed to fetch farmers' });
  }
});

// Get user by ID (for authentication)
app.post('/api/auth/login', async (req, res) => {
  const { user_id, password } = req.body;
  
  try {
    const [rows] = await pool.query('SELECT * FROM app_users WHERE user_id = ?', [user_id]);
    
    if (rows.length === 0) {
      return res.status(401).json({ error: 'User not found' });
    }
    
    const user = rows[0];
    const isValidPassword = await bcrypt.compare(password, user.password);
    
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid password' });
    }
    
    // Don't send password back
    const { password: _, ...userWithoutPassword } = user;
    res.json(userWithoutPassword);
  } catch (error) {
    console.error('Error during login:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Save milk collection (with accumulation)
app.post('/api/milk-collection', async (req, res) => {
  const {
    farmer_id,
    farmer_name,
    route,
    route_name,
    member_route,
    section,
    weight,
    collected_by,
    clerk_name,
    collection_date
  } = req.body;

  try {
    const connection = await pool.getConnection();
    
    try {
      await connection.beginTransaction();
      
      // Check if record exists for same farmer, section, and date
      const [existing] = await connection.query(
        `SELECT * FROM milk_collection 
         WHERE farmer_id = ? AND section = ? AND DATE(collection_date) = DATE(?)`,
        [farmer_id, section, collection_date]
      );

      if (existing.length > 0) {
        // Update existing record by adding weight
        const newWeight = parseFloat(existing[0].weight) + parseFloat(weight);
        await connection.query(
          `UPDATE milk_collection 
           SET weight = ?, updated_at = NOW() 
           WHERE id = ?`,
          [newWeight, existing[0].id]
        );
        
        await connection.commit();
        res.json({ 
          message: 'Weight accumulated successfully',
          total_weight: newWeight,
          id: existing[0].id
        });
      } else {
        // Insert new record
        const [result] = await connection.query(
          `INSERT INTO milk_collection 
           (farmer_id, farmer_name, route, route_name, member_route, section, weight, 
            collected_by, clerk_name, price_per_liter, total_amount, collection_date) 
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?)`,
          [farmer_id, farmer_name, route, route_name, member_route, section, weight,
           collected_by, clerk_name, collection_date]
        );
        
        await connection.commit();
        res.json({ 
          message: 'Collection saved successfully',
          id: result.insertId,
          total_weight: weight
        });
      }
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error('Error saving milk collection:', error);
    res.status(500).json({ error: 'Failed to save collection' });
  }
});

// Get unsynced collections (for sync functionality)
app.get('/api/milk-collection/unsynced', async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM milk_collection WHERE synced = 0 ORDER BY collection_date DESC'
    );
    res.json(rows);
  } catch (error) {
    console.error('Error fetching unsynced collections:', error);
    res.status(500).json({ error: 'Failed to fetch collections' });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
