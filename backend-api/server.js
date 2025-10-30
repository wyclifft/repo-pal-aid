/**
 * Ultra-Lightweight Milk Collection API
 * Optimized for cPanel with minimal RAM usage
 */

const mysql = require('mysql2/promise');
const http = require('http');
const url = require('url');

// Database connection pool (minimal)
const pool = mysql.createPool({
  host: process.env.MYSQL_HOST || 'localhost',
  user: process.env.MYSQL_USER || 'maddasys_tesh',
  password: process.env.MYSQL_PASSWORD || '0741899183Mutee',
  database: process.env.MYSQL_DATABASE || 'maddasys_milk_collection_pwa',
  port: process.env.MYSQL_PORT || 3306,
  connectionLimit: 2,
  waitForConnections: true,
  queueLimit: 0
});

// Helper: Parse JSON body
const parseBody = (req) => new Promise((resolve) => {
  let body = '';
  req.on('data', chunk => { body += chunk.toString(); });
  req.on('end', () => {
    try { resolve(JSON.parse(body)); } catch { resolve({}); }
  });
});

// Helper: Send JSON response
const sendJSON = (res, data, status = 200) => {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(JSON.stringify(data));
};

// Main server
const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const path = parsedUrl.pathname;
  const method = req.method;

  // CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    return res.end();
  }

  try {
    // Health check
    if (path === '/api/health') {
      return sendJSON(res, { success: true, message: 'API running', timestamp: new Date() });
    }

    // Farmers endpoints
    if (path === '/api/farmers' && method === 'GET') {
      const search = parsedUrl.query.search;
      let query = 'SELECT * FROM farmers';
      let params = [];
      if (search) {
        query += ' WHERE farmer_id LIKE ? OR name LIKE ?';
        params = [`%${search}%`, `%${search}%`];
      }
      query += ' ORDER BY name';
      const [rows] = await pool.query(query, params);
      return sendJSON(res, { success: true, data: rows });
    }

    if (path.startsWith('/api/farmers/') && method === 'GET') {
      const id = path.split('/')[3];
      const [rows] = await pool.query('SELECT * FROM farmers WHERE farmer_id = ?', [id]);
      if (rows.length === 0) return sendJSON(res, { success: false, error: 'Farmer not found' }, 404);
      return sendJSON(res, { success: true, data: rows[0] });
    }

    if (path === '/api/farmers' && method === 'POST') {
      const body = await parseBody(req);
      await pool.query(
        'INSERT INTO farmers (farmer_id, name, route, route_name, member_route) VALUES (?, ?, ?, ?, ?)',
        [body.farmer_id, body.name, body.route, body.route_name || null, body.member_route || null]
      );
      return sendJSON(res, { success: true, message: 'Farmer created' }, 201);
    }

    if (path.startsWith('/api/farmers/') && method === 'PUT') {
      const id = path.split('/')[3];
      const body = await parseBody(req);
      const updates = [];
      const values = [];
      if (body.name) { updates.push('name = ?'); values.push(body.name); }
      if (body.route) { updates.push('route = ?'); values.push(body.route); }
      if (body.route_name !== undefined) { updates.push('route_name = ?'); values.push(body.route_name); }
      if (body.member_route !== undefined) { updates.push('member_route = ?'); values.push(body.member_route); }
      if (updates.length === 0) return sendJSON(res, { success: false, error: 'No fields to update' }, 400);
      values.push(id);
      await pool.query(`UPDATE farmers SET ${updates.join(', ')} WHERE farmer_id = ?`, values);
      return sendJSON(res, { success: true, message: 'Farmer updated' });
    }

    if (path.startsWith('/api/farmers/') && method === 'DELETE') {
      const id = path.split('/')[3];
      await pool.query('DELETE FROM farmers WHERE farmer_id = ?', [id]);
      return sendJSON(res, { success: true, message: 'Farmer deleted' });
    }

    // Milk collection endpoints
    if (path === '/api/milk-collection' && method === 'GET') {
      const { farmer_id, session, date_from, date_to } = parsedUrl.query;
      let query = 'SELECT * FROM milk_collection WHERE 1=1';
      let params = [];
      if (farmer_id) { query += ' AND farmer_id = ?'; params.push(farmer_id); }
      if (session) { query += ' AND session = ?'; params.push(session); }
      if (date_from) { query += ' AND collection_date >= ?'; params.push(date_from); }
      if (date_to) { query += ' AND collection_date <= ?'; params.push(date_to); }
      query += ' ORDER BY collection_date DESC';
      const [rows] = await pool.query(query, params);
      return sendJSON(res, { success: true, data: rows });
    }

    if (path.startsWith('/api/milk-collection/') && method === 'GET') {
      const ref = path.split('/')[3];
      const [rows] = await pool.query('SELECT * FROM milk_collection WHERE reference_no = ?', [ref]);
      if (rows.length === 0) return sendJSON(res, { success: false, error: 'Collection not found' }, 404);
      return sendJSON(res, { success: true, data: rows[0] });
    }

    if (path === '/api/milk-collection' && method === 'POST') {
      const body = await parseBody(req);
    
      // Auto-generate reference_no if missing
      const reference_no = body.reference_no || `REF-${Date.now()}`;
      const farmer_name = body.farmer_name || null;
      const clerk_name = body.clerk_name || null;
    
      await pool.query(
        `INSERT INTO milk_collection 
          (reference_no, farmer_id, farmer_name, route, session, weight, clerk_name, collection_date)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [reference_no, body.farmer_id, farmer_name, body.route, body.session, body.weight, clerk_name, body.collection_date]
      );
    
      return sendJSON(res, { success: true, message: 'Collection created', reference_no }, 201);
    }

    if (path.startsWith('/api/milk-collection/') && method === 'PUT') {
      const ref = path.split('/')[3];
      const body = await parseBody(req);
      const updates = [];
      const values = [];
      if (body.weight !== undefined) {
        updates.push('weight = ?', 'total_amount = weight * price_per_liter');
        values.push(body.weight);
      }
      if (body.collection_date) { updates.push('collection_date = ?'); values.push(body.collection_date); }
      if (updates.length === 0) return sendJSON(res, { success: false, error: 'No fields to update' }, 400);
      values.push(ref);
      await pool.query(`UPDATE milk_collection SET ${updates.join(', ')} WHERE reference_no = ?`, values);
      return sendJSON(res, { success: true, message: 'Collection updated' });
    }

    if (path.startsWith('/api/milk-collection/') && method === 'DELETE') {
      const ref = path.split('/')[3];
      await pool.query('DELETE FROM milk_collection WHERE reference_no = ?', [ref]);
      return sendJSON(res, { success: true, message: 'Collection deleted' });
    }

    // Devices endpoints
    if (path.startsWith('/api/devices/fingerprint/') && method === 'GET') {
      const fingerprint = decodeURIComponent(path.split('/')[4]);
      const [rows] = await pool.query('SELECT * FROM approved_devices WHERE device_fingerprint = ?', [fingerprint]);
      if (rows.length === 0) return sendJSON(res, { success: false, error: 'Device not found' }, 404);
      return sendJSON(res, { success: true, data: rows[0] });
    }

    if (path.startsWith('/api/devices/') && method === 'GET' && path.split('/').length === 4) {
      const deviceId = path.split('/')[3];
      const [rows] = await pool.query('SELECT * FROM approved_devices WHERE id = ?', [deviceId]);
      if (rows.length === 0) return sendJSON(res, { success: false, error: 'Device not found' }, 404);
      return sendJSON(res, { success: true, data: rows[0] });
    }

    if (path === '/api/devices' && method === 'POST') {
      const body = await parseBody(req);
      const [existing] = await pool.query('SELECT * FROM approved_devices WHERE device_fingerprint = ?', [body.device_fingerprint]);
      
      if (existing.length > 0) {
        // Update existing device
        await pool.query('UPDATE approved_devices SET user_id = ?, approved = ?, device_info = ?, last_sync = NOW() WHERE device_fingerprint = ?',
          [body.user_id, body.approved ?? false, body.device_info || null, body.device_fingerprint]);
        return sendJSON(res, { success: true, data: existing[0], message: 'Device updated' });
      } else {
        // Insert new device - MySQL auto-generates id
        const [result] = await pool.query(
          'INSERT INTO approved_devices (device_fingerprint, user_id, approved, device_info, last_sync) VALUES (?, ?, ?, ?, NOW())',
          [body.device_fingerprint, body.user_id, body.approved ?? false, body.device_info || null]
        );
        const [newDevice] = await pool.query('SELECT * FROM approved_devices WHERE id = ?', [result.insertId]);
        return sendJSON(res, { success: true, data: newDevice[0], message: 'Device registered' }, 201);
      }
    }

    if (path.startsWith('/api/devices/') && method === 'PUT') {
      const deviceId = path.split('/')[3];
      const body = await parseBody(req);
      const updates = ['last_sync = NOW()'];
      const values = [];
      if (body.approved !== undefined) { updates.push('approved = ?'); values.push(body.approved); }
      if (body.user_id) { updates.push('user_id = ?'); values.push(body.user_id); }
      values.push(deviceId);
      await pool.query(`UPDATE approved_devices SET ${updates.join(', ')} WHERE id = ?`, values);
      return sendJSON(res, { success: true, message: 'Device updated' });
    }

    if (path.startsWith('/api/devices/') && method === 'DELETE') {
      const deviceId = path.split('/')[3];
      await pool.query('DELETE FROM approved_devices WHERE id = ?', [deviceId]);
      return sendJSON(res, { success: true, message: 'Device deleted' });
    }

    // 404
    sendJSON(res, { success: false, error: 'Endpoint not found' }, 404);

  } catch (error) {
    console.error('Error:', error.message);
    sendJSON(res, { success: false, error: error.message }, 500);
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
