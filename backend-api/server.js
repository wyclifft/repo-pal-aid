/**
 * Ultra-Lightweight Milk Collection API
 * Optimized for minimal RAM usage on cPanel
 */

const express = require('express');
const mysql = require('mysql2/promise');

const app = express();
const PORT = process.env.PORT || 3000;

// Ultra-minimal MySQL connection pool
const pool = mysql.createPool({
  host: process.env.MYSQL_HOST || 'localhost',
  user: process.env.MYSQL_USER || 'maddasys_wycliff',
  password: process.env.MYSQL_PASSWORD || '0741899183Mutee',
  database: process.env.MYSQL_DATABASE || 'maddasys_delicop',
  port: process.env.MYSQL_PORT || 3306,
  connectionLimit: 2,
  waitForConnections: true,
  queueLimit: 0
});

// Minimal middleware
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});
app.use(express.json({ limit: '500kb' }));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ success: true, message: 'API running' });
});

// FARMERS ENDPOINTS
app.get('/api/farmers', async (req, res) => {
  try {
    const search = req.query.search;
    let query = 'SELECT * FROM farmers';
    let params = [];
    if (search) {
      query += ' WHERE farmer_id LIKE ? OR name LIKE ?';
      params = [`%${search}%`, `%${search}%`];
    }
    query += ' ORDER BY name';
    const [rows] = await pool.execute(query, params);
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/farmers/:id', async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT * FROM farmers WHERE farmer_id = ?', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ success: false, error: 'Farmer not found' });
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/farmers', async (req, res) => {
  try {
    const { farmer_id, name, route } = req.body;
    await pool.execute('INSERT INTO farmers (farmer_id, name, route) VALUES (?, ?, ?)', [farmer_id, name, route]);
    res.status(201).json({ success: true, message: 'Farmer created' });
  } catch (err) {
    res.status(err.code === 'ER_DUP_ENTRY' ? 409 : 500).json({ success: false, error: err.message });
  }
});

app.put('/api/farmers/:id', async (req, res) => {
  try {
    const updates = [];
    const values = [];
    ['name', 'route', 'route_name', 'member_route'].forEach(field => {
      if (req.body[field] !== undefined) {
        updates.push(`${field} = ?`);
        values.push(req.body[field]);
      }
    });
    if (updates.length === 0) return res.status(400).json({ success: false, error: 'No fields to update' });
    values.push(req.params.id);
    const [result] = await pool.execute(`UPDATE farmers SET ${updates.join(', ')} WHERE farmer_id = ?`, values);
    if (result.affectedRows === 0) return res.status(404).json({ success: false, error: 'Farmer not found' });
    res.json({ success: true, message: 'Farmer updated' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/farmers/:id', async (req, res) => {
  try {
    const [result] = await pool.execute('DELETE FROM farmers WHERE farmer_id = ?', [req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ success: false, error: 'Farmer not found' });
    res.json({ success: true, message: 'Farmer deleted' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// MILK COLLECTION ENDPOINTS
app.get('/api/milk-collection', async (req, res) => {
  try {
    let query = 'SELECT * FROM milk_collection WHERE 1=1';
    const params = [];
    if (req.query.farmer_id) {
      query += ' AND farmer_id = ?';
      params.push(req.query.farmer_id);
    }
    if (req.query.session) {
      query += ' AND session = ?';
      params.push(req.query.session);
    }
    if (req.query.date_from) {
      query += ' AND collection_date >= ?';
      params.push(req.query.date_from);
    }
    if (req.query.date_to) {
      query += ' AND collection_date <= ?';
      params.push(req.query.date_to);
    }
    query += ' ORDER BY collection_date DESC';
    const [rows] = await pool.execute(query, params);
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/milk-collection/:ref', async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT * FROM milk_collection WHERE referenceNo = ?', [req.params.ref]);
    if (rows.length === 0) return res.status(404).json({ success: false, error: 'Collection not found' });
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/milk-collection', async (req, res) => {
  try {
    const { referenceNo, farmer_id, weight, rate, session, collection_date } = req.body;
    if (!['morning', 'evening'].includes(session)) {
      return res.status(400).json({ success: false, error: 'Invalid session' });
    }
    const total_amount = weight * rate;
    await pool.execute(
      'INSERT INTO milk_collection (referenceNo, farmer_id, weight, rate, total_amount, session, collection_date) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [referenceNo, farmer_id, weight, rate, total_amount, session, collection_date]
    );
    res.status(201).json({ success: true, message: 'Collection created' });
  } catch (err) {
    res.status(err.code === 'ER_DUP_ENTRY' ? 409 : 500).json({ success: false, error: err.message });
  }
});

app.put('/api/milk-collection/:ref', async (req, res) => {
  try {
    const updates = [];
    const values = [];
    if (req.body.weight !== undefined) {
      updates.push('weight = ?', 'total_amount = weight * rate');
      values.push(req.body.weight);
    }
    if (req.body.collection_date !== undefined) {
      updates.push('collection_date = ?');
      values.push(req.body.collection_date);
    }
    if (updates.length === 0) return res.status(400).json({ success: false, error: 'No fields to update' });
    values.push(req.params.ref);
    const [result] = await pool.execute(`UPDATE milk_collection SET ${updates.join(', ')} WHERE referenceNo = ?`, values);
    if (result.affectedRows === 0) return res.status(404).json({ success: false, error: 'Collection not found' });
    res.json({ success: true, message: 'Collection updated' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/milk-collection/:ref', async (req, res) => {
  try {
    const [result] = await pool.execute('DELETE FROM milk_collection WHERE referenceNo = ?', [req.params.ref]);
    if (result.affectedRows === 0) return res.status(404).json({ success: false, error: 'Collection not found' });
    res.json({ success: true, message: 'Collection deleted' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DEVICES ENDPOINTS
app.get('/api/devices/:deviceId', async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT * FROM approved_devices WHERE device_id = ?', [req.params.deviceId]);
    if (rows.length === 0) return res.status(404).json({ success: false, error: 'Device not found' });
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/devices', async (req, res) => {
  try {
    const { device_id, user_id, approved } = req.body;
    const [existing] = await pool.execute('SELECT * FROM approved_devices WHERE device_id = ?', [device_id]);
    if (existing.length > 0) {
      await pool.execute('UPDATE approved_devices SET user_id = ?, approved = ? WHERE device_id = ?', [user_id, approved, device_id]);
      res.json({ success: true, message: 'Device updated' });
    } else {
      await pool.execute('INSERT INTO approved_devices (device_id, user_id, approved) VALUES (?, ?, ?)', [device_id, user_id, approved]);
      res.status(201).json({ success: true, message: 'Device registered' });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.put('/api/devices/:deviceId', async (req, res) => {
  try {
    const updates = [];
    const values = [];
    if (req.body.approved !== undefined) {
      updates.push('approved = ?');
      values.push(req.body.approved);
    }
    if (req.body.user_id !== undefined) {
      updates.push('user_id = ?');
      values.push(req.body.user_id);
    }
    if (updates.length === 0) return res.status(400).json({ success: false, error: 'No fields to update' });
    values.push(req.params.deviceId);
    const [result] = await pool.execute(`UPDATE approved_devices SET ${updates.join(', ')} WHERE device_id = ?`, values);
    if (result.affectedRows === 0) return res.status(404).json({ success: false, error: 'Device not found' });
    res.json({ success: true, message: 'Device updated' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/devices/:deviceId', async (req, res) => {
  try {
    const [result] = await pool.execute('DELETE FROM approved_devices WHERE device_id = ?', [req.params.deviceId]);
    if (result.affectedRows === 0) return res.status(404).json({ success: false, error: 'Device not found' });
    res.json({ success: true, message: 'Device deleted' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 404 handler
app.use((req, res) => res.status(404).json({ success: false, error: 'Not found' }));

// Start server
app.listen(PORT, () => console.log(`API running on port ${PORT}`));

module.exports = app;
