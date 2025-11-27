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

    // Farmers endpoints - Fetch from cm_members table
    
    // NEW: Device-based farmer filtering endpoint
    if (path.startsWith('/api/farmers/by-device/') && method === 'GET') {
      const uniquedevcode = decodeURIComponent(path.split('/')[4]);
      const search = parsedUrl.query.search;
      
      // Get device and check authorization
      const [deviceRows] = await pool.query(
        'SELECT ccode, authorized FROM devsettings WHERE uniquedevcode = ?',
        [uniquedevcode]
      );
      
      if (deviceRows.length === 0 || deviceRows[0].authorized !== 1) {
        return sendJSON(res, { 
          success: false, 
          message: 'Device not authorized' 
        }, 401);
      }
      
      const ccode = deviceRows[0].ccode;
      
      // Get farmers for this company
      let query = 'SELECT mcode as farmer_id, descript as name, route, ccode FROM cm_members WHERE ccode = ?';
      let params = [ccode];
      
      if (search) {
        query += ' AND (mcode LIKE ? OR descript LIKE ?)';
        params.push(`%${search}%`, `%${search}%`);
      }
      
      query += ' ORDER BY descript';
      const [rows] = await pool.query(query, params);
      return sendJSON(res, { success: true, data: rows, ccode });
    }
    
    // Original farmers endpoint (kept for backward compatibility)
    if (path === '/api/farmers' && method === 'GET') {
      const search = parsedUrl.query.search;
      let query = 'SELECT mcode as farmer_id, descript as name, route FROM cm_members';
      let params = [];
      if (search) {
        query += ' WHERE mcode LIKE ? OR descript LIKE ?';
        params = [`%${search}%`, `%${search}%`];
      }
      query += ' ORDER BY descript';
      const [rows] = await pool.query(query, params);
      return sendJSON(res, { success: true, data: rows });
    }

    if (path.startsWith('/api/farmers/') && method === 'GET') {
      const id = path.split('/')[3];
      const [rows] = await pool.query('SELECT mcode as farmer_id, descript as name, route FROM cm_members WHERE mcode = ?', [id]);
      if (rows.length === 0) return sendJSON(res, { success: false, error: 'Farmer not found' }, 404);
      return sendJSON(res, { success: true, data: rows[0] });
    }

    if (path === '/api/farmers' && method === 'POST') {
      const body = await parseBody(req);
      await pool.query(
        'INSERT INTO cm_members (mcode, descript, route) VALUES (?, ?, ?)',
        [body.farmer_id, body.name, body.route]
      );
      return sendJSON(res, { success: true, message: 'Farmer created' }, 201);
    }

    if (path.startsWith('/api/farmers/') && method === 'PUT') {
      const id = path.split('/')[3];
      const body = await parseBody(req);
      const updates = [];
      const values = [];
      if (body.name) { updates.push('descript = ?'); values.push(body.name); }
      if (body.route) { updates.push('route = ?'); values.push(body.route); }
      if (updates.length === 0) return sendJSON(res, { success: false, error: 'No fields to update' }, 400);
      values.push(id);
      await pool.query(`UPDATE cm_members SET ${updates.join(', ')} WHERE mcode = ?`, values);
      return sendJSON(res, { success: true, message: 'Farmer updated' });
    }

    if (path.startsWith('/api/farmers/') && method === 'DELETE') {
      const id = path.split('/')[3];
      await pool.query('DELETE FROM cm_members WHERE mcode = ?', [id]);
      return sendJSON(res, { success: true, message: 'Farmer deleted' });
    }

    // Milk collection endpoints - now using transactions table
    if (path === '/api/milk-collection' && method === 'GET') {
      const { farmer_id, session, date_from, date_to, uniquedevcode } = parsedUrl.query;
      
      // CRITICAL: When querying for accumulation, ccode MUST be enforced
      // Get device's ccode if uniquedevcode provided
      let ccode = null;
      if (uniquedevcode) {
        const [deviceRows] = await pool.query(
          'SELECT ccode FROM devsettings WHERE uniquedevcode = ?',
          [uniquedevcode]
        );
        if (deviceRows.length > 0) {
          ccode = deviceRows[0].ccode;
        }
      }
      
      // Build query with STRICT ccode filtering
      let query = 'SELECT * FROM transactions WHERE Transtype = "MILK"';
      let params = [];
      
      // When checking for accumulation (farmer_id + session + date range provided),
      // ccode filter is REQUIRED to prevent cross-ccode accumulation
      if (farmer_id && session && date_from && date_to) {
        if (ccode === null) {
          // If uniquedevcode was provided but ccode not found, return empty result
          return sendJSON(res, { success: true, data: [] });
        }
        // STRICT: Filter by BOTH memberno AND ccode for accumulation checks
        query += ' AND memberno = ? AND ccode = ? AND session = ? AND transdate >= ? AND transdate <= ?';
        params.push(farmer_id, ccode, session, date_from, date_to);
      } else {
        // For general listing, apply filters as provided
        if (ccode !== null) { query += ' AND ccode = ?'; params.push(ccode); }
        if (farmer_id) { query += ' AND memberno = ?'; params.push(farmer_id); }
        if (session) { query += ' AND session = ?'; params.push(session); }
        if (date_from) { query += ' AND transdate >= ?'; params.push(date_from); }
        if (date_to) { query += ' AND transdate <= ?'; params.push(date_to); }
      }
      
      query += ' ORDER BY transdate DESC';
      const [rows] = await pool.query(query, params);
      
      // Map transactions fields back to expected format
      const mappedRows = rows.map(row => ({
        reference_no: row.transrefno,
        farmer_id: row.memberno,
        farmer_name: row.memberno,
        route: row.route,
        session: row.session,
        weight: row.weight,
        clerk_name: row.clerk,
        collection_date: row.transdate
      }));
      
      return sendJSON(res, { success: true, data: mappedRows });
    }

    if (path.startsWith('/api/milk-collection/') && method === 'GET') {
      const ref = path.split('/')[3];
      const [rows] = await pool.query('SELECT * FROM transactions WHERE transrefno = ?', [ref]);
      if (rows.length === 0) return sendJSON(res, { success: false, error: 'Collection not found' }, 404);
      
      // Map transaction fields back to expected format
      const mapped = {
        reference_no: rows[0].transrefno,
        farmer_id: rows[0].memberno,
        farmer_name: rows[0].memberno,
        route: rows[0].route,
        session: rows[0].session,
        weight: rows[0].weight,
        clerk_name: rows[0].clerk,
        collection_date: rows[0].transdate
      };
      
      return sendJSON(res, { success: true, data: mapped });
    }

    // NEW: Generate next reference number endpoint
    if (path === '/api/milk-collection/next-reference' && method === 'POST') {
      const body = await parseBody(req);
      const deviceserial = body.device_fingerprint;
      
      if (!deviceserial) {
        return sendJSON(res, { 
          success: false, 
          error: 'device_fingerprint is required' 
        }, 400);
      }
      
      // Get ccode from device
      const [deviceRows] = await pool.query(
        'SELECT ccode FROM devsettings WHERE uniquedevcode = ?',
        [deviceserial]
      );
      
      if (deviceRows.length === 0) {
        return sendJSON(res, { 
          success: false, 
          error: 'Device not found' 
        }, 404);
      }
      
      const ccode = deviceRows[0].ccode;
      
      // Get company name and device code
      const [companyAndDeviceRows] = await pool.query(
        `SELECT p.cname, d.devcode 
         FROM psettings p 
         JOIN devsettings d ON p.ccode = d.ccode 
         WHERE d.ccode = ? AND d.uniquedevcode = ?`,
        [ccode, deviceserial]
      );
      
      if (companyAndDeviceRows.length === 0) {
        return sendJSON(res, { 
          success: false, 
          error: 'Company or device not found' 
        }, 404);
      }
      
      const cname = companyAndDeviceRows[0].cname;
      const devcode = companyAndDeviceRows[0].devcode || '00000';
      
      // Generate company prefix (first 2 chars of company name)
      const companyPrefix = cname.substring(0, 2).toUpperCase();
      
      // Pad device code to 5 characters
      const deviceCode = String(devcode).padStart(5, '0');
      
      // Create the prefix for this specific device
      const devicePrefix = `${companyPrefix}${deviceCode}`;
      
      // Get the last transaction number for THIS SPECIFIC DEVICE
      const [lastTransRows] = await pool.query(
        'SELECT transrefno FROM transactions WHERE deviceserial = ? AND transrefno LIKE ? ORDER BY transrefno DESC LIMIT 1',
        [deviceserial, `${devicePrefix}%`]
      );
      
      let nextNumber = 1; // Starting number for this device
      
      if (lastTransRows.length > 0) {
        const lastRef = lastTransRows[0].transrefno;
        // Extract the sequential number (everything after the 7-char prefix)
        const lastNumber = parseInt(lastRef.substring(7));
        nextNumber = lastNumber + 1;
      }
      
      // Generate continuous reference number: CompanyCode + DeviceCode + SequentialNumber
      const transrefno = `${devicePrefix}${nextNumber}`;
      
      return sendJSON(res, { 
        success: true, 
        reference_no: transrefno 
      });
    }

    if (path === '/api/milk-collection' && method === 'POST') {
      const body = await parseBody(req);
    
      // Use provided transrefno from frontend
      const transrefno = body.reference_no;
      if (!transrefno) {
        return sendJSON(res, { 
          success: false, 
          error: 'reference_no is required' 
        }, 400);
      }
      
      const clerk = body.clerk_name || 'unknown';
      const deviceserial = body.device_fingerprint || 'web';
      
      // Fetch ccode from devsettings using uniquedevcode
      const [deviceRows] = await pool.query(
        'SELECT ccode, authorized FROM devsettings WHERE uniquedevcode = ?',
        [deviceserial]
      );
      
      if (deviceRows.length === 0 || !deviceRows[0].authorized) {
        return sendJSON(res, { 
          success: false, 
          error: 'Device not authorized' 
        }, 403);
      }
      
      const ccode = deviceRows[0].ccode;
      
      // Parse date and time
      const collectionDate = new Date(body.collection_date);
      const transdate = collectionDate.toISOString().split('T')[0]; // YYYY-MM-DD
      const transtime = collectionDate.toTimeString().split(' ')[0]; // HH:MM:SS
      const timestamp = Math.floor(collectionDate.getTime() / 1000); // Unix timestamp
    
      await pool.query(
        `INSERT INTO transactions 
          (transrefno, userId, clerk, deviceserial, memberno, route, weight, session, 
           transdate, transtime, Transtype, processed, uploaded, ccode, ivat, iprice, 
           amount, icode, time, capType, entry_type)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'MILK', 0, 0, ?, 0, 0, 0, '', ?, 0, ?)`,
        [transrefno, clerk, clerk, deviceserial, body.farmer_id, body.route, body.weight, 
         body.session, transdate, transtime, ccode, timestamp, body.entry_type || 'manual']
      );
    
      return sendJSON(res, { success: true, message: 'Collection created', reference_no: transrefno }, 201);
    }

    if (path.startsWith('/api/milk-collection/') && method === 'PUT') {
      const ref = path.split('/')[3];
      const body = await parseBody(req);
      
      // CRITICAL: Get device's ccode to ensure update only affects records for this device
      const deviceserial = body.device_fingerprint;
      if (!deviceserial) {
        return sendJSON(res, { 
          success: false, 
          error: 'device_fingerprint is required for updates' 
        }, 400);
      }
      
      const [deviceRows] = await pool.query(
        'SELECT ccode, authorized FROM devsettings WHERE uniquedevcode = ?',
        [deviceserial]
      );
      
      if (deviceRows.length === 0 || !deviceRows[0].authorized) {
        return sendJSON(res, { 
          success: false, 
          error: 'Device not authorized' 
        }, 403);
      }
      
      const ccode = deviceRows[0].ccode;
      
      const updates = [];
      const values = [];
      if (body.weight !== undefined) {
        updates.push('weight = ?');
        values.push(body.weight);
      }
      if (body.collection_date) {
        const collectionDate = new Date(body.collection_date);
        const transdate = collectionDate.toISOString().split('T')[0];
        const transtime = collectionDate.toTimeString().split(' ')[0];
        updates.push('transdate = ?', 'transtime = ?');
        values.push(transdate, transtime);
      }
      if (updates.length === 0) return sendJSON(res, { success: false, error: 'No fields to update' }, 400);
      
      // STRICT: Update only records matching BOTH transrefno AND ccode
      values.push(ref, ccode);
      await pool.query(`UPDATE transactions SET ${updates.join(', ')} WHERE transrefno = ? AND ccode = ?`, values);
      return sendJSON(res, { success: true, message: 'Collection updated' });
    }

    if (path.startsWith('/api/milk-collection/') && method === 'DELETE') {
      const ref = path.split('/')[3];
      await pool.query('DELETE FROM transactions WHERE transrefno = ?', [ref]);
      return sendJSON(res, { success: true, message: 'Collection deleted' });
    }

    // Periodic Report endpoint - aggregated by farmer with date range
    if (path === '/api/periodic-report' && method === 'GET') {
      const startDate = parsedUrl.query.start_date;
      const endDate = parsedUrl.query.end_date;
      const farmerSearch = parsedUrl.query.farmer_search;
      const uniquedevcode = parsedUrl.query.uniquedevcode;

      if (!startDate || !endDate) {
        return sendJSON(res, { success: false, error: 'start_date and end_date are required' }, 400);
      }

      if (!uniquedevcode) {
        return sendJSON(res, { success: false, error: 'uniquedevcode is required' }, 400);
      }

      // Get device's company code
      const [deviceRows] = await pool.query(
        'SELECT ccode FROM devsettings WHERE uniquedevcode = ? AND authorized = 1',
        [uniquedevcode]
      );
      
      if (deviceRows.length === 0) {
        return sendJSON(res, { 
          success: false, 
          error: 'Device not authorized or not found' 
        }, 401);
      }
      
      const ccode = deviceRows[0].ccode;

      let query = `
        SELECT 
          t.memberno as farmer_id,
          cm.descript as farmer_name,
          cm.route,
          SUM(t.weight) as total_weight,
          COUNT(*) as collection_count
        FROM transactions t
        LEFT JOIN cm_members cm ON t.memberno = cm.mcode AND t.ccode = cm.ccode
        WHERE t.Transtype = 'MILK' 
          AND t.transdate BETWEEN ? AND ?
          AND t.ccode = ?
      `;
      let params = [startDate, endDate, ccode];

      if (farmerSearch) {
        query += ` AND (t.memberno LIKE ? OR cm.descript LIKE ?)`;
        params.push(`%${farmerSearch}%`, `%${farmerSearch}%`);
      }

      query += ` GROUP BY t.memberno, cm.descript, cm.route ORDER BY cm.descript`;

      const [rows] = await pool.query(query, params);
      return sendJSON(res, { success: true, data: rows });
    }

    // Z-Report endpoint - now using transactions table
    if (path === '/api/z-report' && method === 'GET') {
      const date = parsedUrl.query.date || new Date().toISOString().split('T')[0];
      const uniquedevcode = parsedUrl.query.uniquedevcode;

      if (!uniquedevcode) {
        return sendJSON(res, { success: false, error: 'uniquedevcode is required' }, 400);
      }

      // Get device's company code
      const [deviceRows] = await pool.query(
        'SELECT ccode FROM devsettings WHERE uniquedevcode = ? AND authorized = 1',
        [uniquedevcode]
      );
      
      if (deviceRows.length === 0) {
        return sendJSON(res, { 
          success: false, 
          error: 'Device not authorized or not found' 
        }, 401);
      }
      
      const ccode = deviceRows[0].ccode;
      
      // Fetch all collections for the specified date and company
      const [collections] = await pool.query(
        `SELECT transrefno, memberno as farmer_id, route, weight, session, 
                transdate as collection_date, clerk as clerk_name
         FROM transactions 
         WHERE transdate = ? AND Transtype = 'MILK' AND ccode = ?
         ORDER BY session, route, memberno`,
        [date, ccode]
      );

      // Calculate totals
      const totalLiters = collections.reduce((sum, c) => sum + parseFloat(c.weight || 0), 0);
      const totalFarmers = new Set(collections.map(c => c.farmer_id)).size;
      const totalEntries = collections.length;

      // Group by route
      const byRoute = collections.reduce((acc, c) => {
        if (!acc[c.route]) {
          acc[c.route] = { AM: [], PM: [], total: 0 };
        }
        acc[c.route][c.session].push(c);
        acc[c.route].total += parseFloat(c.weight || 0);
        return acc;
      }, {});

      // Group by session
      const bySession = {
        AM: collections.filter(c => c.session === 'AM'),
        PM: collections.filter(c => c.session === 'PM')
      };

      // Group by collector
      const byCollector = collections.reduce((acc, c) => {
        const collector = c.clerk_name || 'Unknown';
        if (!acc[collector]) {
          acc[collector] = { entries: 0, liters: 0, farmers: new Set() };
        }
        acc[collector].entries++;
        acc[collector].liters += parseFloat(c.weight || 0);
        acc[collector].farmers.add(c.farmer_id);
        return acc;
      }, {});

      // Convert collector farmers Set to count
      Object.keys(byCollector).forEach(key => {
        byCollector[key].farmers = byCollector[key].farmers.size;
      });

      return sendJSON(res, {
        success: true,
        data: {
          date,
          totals: {
            liters: parseFloat(totalLiters.toFixed(2)),
            farmers: totalFarmers,
            entries: totalEntries
          },
          byRoute,
          bySession: {
            AM: {
              entries: bySession.AM.length,
              liters: parseFloat(bySession.AM.reduce((sum, c) => sum + parseFloat(c.weight || 0), 0).toFixed(2))
            },
            PM: {
              entries: bySession.PM.length,
              liters: parseFloat(bySession.PM.reduce((sum, c) => sum + parseFloat(c.weight || 0), 0).toFixed(2))
            }
          },
          byCollector,
          collections
        }
      });
    }

    // Items endpoints
    if (path === '/api/items' && method === 'GET') {
      const uniquedevcode = parsedUrl.query.uniquedevcode;
      
      if (!uniquedevcode) {
        return sendJSON(res, { 
          success: false, 
          message: 'Device code required' 
        }, 400);
      }
      
      // Get device and check authorization
      const [deviceRows] = await pool.query(
        'SELECT ccode, authorized FROM devsettings WHERE uniquedevcode = ?',
        [uniquedevcode]
      );
      
      if (deviceRows.length === 0 || deviceRows[0].authorized !== 1) {
        return sendJSON(res, { 
          success: false, 
          message: 'Device not authorized' 
        }, 401);
      }
      
      const ccode = deviceRows[0].ccode;
      
      // Filter items by device's company code
      const [rows] = await pool.query(
        'SELECT * FROM fm_items WHERE sellable = 1 AND ccode = ? ORDER BY descript',
        [ccode]
      );
      
      return sendJSON(res, { success: true, data: rows });
    }

    // Sales endpoints
    if (path === '/api/sales' && method === 'POST') {
      const body = await parseBody(req);
      const conn = await pool.getConnection();
      
      try {
        await conn.beginTransaction();
        
        // Generate sale reference
        const sale_ref = body.sale_ref || `SALE-${Date.now()}`;
        
        // Get current date and time
        const now = new Date();
        const transdate = now.toISOString().split('T')[0]; // YYYY-MM-DD
        const transtime = now.toTimeString().split(' ')[0]; // HH:MM:SS
        const timestamp = Math.floor(now.getTime() / 1000); // Unix timestamp
        
        // Calculate amount (quantity * price)
        const amount = (body.quantity || 0) * (body.price || 0);
        
        // Get device's ccode from devsettings using device_fingerprint
        let ccode = '';
        if (body.device_fingerprint) {
          const [deviceRows] = await conn.query(
            'SELECT ccode FROM devsettings WHERE uniquedevcode = ?',
            [body.device_fingerprint]
          );
          if (deviceRows.length > 0) {
            ccode = deviceRows[0].ccode || '';
          }
        }
        
        // Insert into transactions table
        await conn.query(
          `INSERT INTO transactions 
            (transrefno, userId, clerk, deviceserial, memberno, route, weight, session, 
             transdate, transtime, Transtype, processed, uploaded, ccode, ivat, iprice, 
             amount, icode, time, capType, milk_session_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            sale_ref,                           // transrefno
            body.sold_by || '',                 // userId
            body.sold_by || '',                 // clerk
            body.device_fingerprint || '',      // deviceserial
            body.farmer_id || '',               // memberno
            '',                                 // route (empty for store sales)
            body.quantity || 0,                 // weight (using quantity)
            '',                                 // session (empty for store sales)
            transdate,                          // transdate
            transtime,                          // transtime
            'STORE',                            // Transtype
            0,                                  // processed
            0,                                  // uploaded
            ccode,                              // ccode (from device's devsettings)
            0,                                  // ivat
            body.price || 0,                    // iprice
            amount,                             // amount
            body.item_code || '',               // icode
            timestamp,                          // time
            0,                                  // capType
            ''                                  // milk_session_id
          ]
        );
        
        // Update stock balance
        await conn.query(
          'UPDATE fm_items SET stockbal = stockbal - ? WHERE icode = ?',
          [body.quantity, body.item_code]
        );
        
        await conn.commit();
        conn.release();
        
        return sendJSON(res, { success: true, message: 'Sale recorded', sale_ref }, 201);
      } catch (error) {
        await conn.rollback();
        conn.release();
        throw error;
      }
    }

    if (path === '/api/sales' && method === 'GET') {
      const { farmer_id, date_from, date_to, uniquedevcode } = parsedUrl.query;
      
      // Get device's ccode if uniquedevcode provided
      let ccode = null;
      if (uniquedevcode) {
        const [deviceRows] = await pool.query(
          'SELECT ccode FROM devsettings WHERE uniquedevcode = ?',
          [uniquedevcode]
        );
        if (deviceRows.length > 0) {
          ccode = deviceRows[0].ccode;
        }
      }
      
      let query = 'SELECT * FROM transactions WHERE Transtype = "STORE"';
      let params = [];
      if (ccode !== null) { query += ' AND ccode = ?'; params.push(ccode); }
      if (farmer_id) { query += ' AND memberno = ?'; params.push(farmer_id); }
      if (date_from) { query += ' AND transdate >= ?'; params.push(date_from); }
      if (date_to) { query += ' AND transdate <= ?'; params.push(date_to); }
      query += ' ORDER BY transdate DESC, transtime DESC';
      const [rows] = await pool.query(query, params);
      
      // Map transactions fields back to frontend expected format
      const mappedRows = rows.map(row => ({
        sale_ref: row.transrefno,
        farmer_id: row.memberno,
        item_code: row.icode,
        quantity: row.weight,
        price: row.iprice,
        amount: row.amount,
        sold_by: row.clerk,
        sale_date: `${row.transdate} ${row.transtime}`,
        device_fingerprint: row.deviceserial
      }));
      
      return sendJSON(res, { success: true, data: mappedRows });
    }

    // Devices endpoints
    if (path.startsWith('/api/devices/fingerprint/') && method === 'GET') {
      const fingerprint = decodeURIComponent(path.split('/')[4]);
      
      // First check approved_devices for registration data
      const [approvedRows] = await pool.query(
        'SELECT * FROM approved_devices WHERE device_fingerprint = ?',
        [fingerprint]
      );
      
      // Then check devsettings for authorization, company info, and device code
      const [devRows] = await pool.query(
        'SELECT uniquedevcode, ccode, devcode, authorized FROM devsettings WHERE uniquedevcode = ?',
        [fingerprint]
      );
      
      if (approvedRows.length === 0 && devRows.length === 0) {
        return sendJSON(res, { success: false, error: 'Device not found' }, 404);
      }
      
      // Combine data from both tables
      const deviceData = {
        ...(approvedRows.length > 0 ? approvedRows[0] : {}),
        authorized: devRows.length > 0 ? devRows[0].authorized : 0,
        ccode: devRows.length > 0 && devRows[0].ccode ? devRows[0].ccode : (approvedRows[0]?.ccode || null),
        devcode: devRows.length > 0 ? devRows[0].devcode : null
      };
      
      // Get company name from psettings if ccode exists
      let companyName = null;
      if (deviceData.ccode) {
        const [companyRows] = await pool.query(
          'SELECT cname FROM psettings WHERE ccode = ?',
          [deviceData.ccode]
        );
        
        if (companyRows.length > 0) {
          companyName = companyRows[0].cname;
        }
      }
      
      // Always include company_name in response (null if not found)
      deviceData.company_name = companyName;
      
      return sendJSON(res, { success: true, data: deviceData });
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
        // Device exists - update last_sync and return
        await pool.query(
          'UPDATE approved_devices SET last_sync = NOW(), updated_at = NOW() WHERE device_fingerprint = ?',
          [body.device_fingerprint]
        );
        const [updated] = await pool.query('SELECT * FROM approved_devices WHERE device_fingerprint = ?', [body.device_fingerprint]);
        return sendJSON(res, { success: true, data: updated[0], message: 'Device already registered' });
      } else {
        // Check if device exists in devsettings to get ccode
        const [devRows] = await pool.query(
          'SELECT ccode FROM devsettings WHERE uniquedevcode = ?',
          [body.device_fingerprint]
        );
        const ccode = devRows.length > 0 ? devRows[0].ccode : null;
        
        // Insert new device - ALWAYS set approved to FALSE for new devices
        const [result] = await pool.query(
          'INSERT INTO approved_devices (device_fingerprint, user_id, approved, device_info, last_sync, ccode, created_at, updated_at) VALUES (?, ?, FALSE, ?, NOW(), ?, NOW(), NOW())',
          [body.device_fingerprint, body.user_id, body.device_info || null, ccode]
        );
        const [newDevice] = await pool.query('SELECT * FROM approved_devices WHERE id = ?', [result.insertId]);
        return sendJSON(res, { success: true, data: newDevice[0], message: 'Device registered' }, 201);
      }
    }

    if (path.startsWith('/api/devices/') && method === 'PUT') {
      const deviceId = path.split('/')[3];
      const body = await parseBody(req);
      const updates = ['last_sync = NOW()', 'updated_at = NOW()'];
      const values = [];
      // ONLY allow updating user_id and device_info - NEVER approved status
      if (body.user_id) { updates.push('user_id = ?'); values.push(body.user_id); }
      if (body.device_info) { updates.push('device_info = ?'); values.push(body.device_info); }
      values.push(deviceId);
      await pool.query(`UPDATE approved_devices SET ${updates.join(', ')} WHERE id = ?`, values);
      return sendJSON(res, { success: true, message: 'Device synced' });
    }

    if (path.startsWith('/api/devices/') && method === 'DELETE') {
      const deviceId = path.split('/')[3];
      await pool.query('DELETE FROM approved_devices WHERE id = ?', [deviceId]);
      return sendJSON(res, { success: true, message: 'Device deleted' });
    }

    // SMS Configuration endpoints
    if (path === '/api/sms/config' && method === 'GET') {
      const ccode = parsedUrl.query.ccode;
      
      if (!ccode) {
        return sendJSON(res, { success: false, error: 'ccode is required' }, 400);
      }
      
      const [rows] = await pool.query(
        'SELECT * FROM sms_config WHERE ccode = ?',
        [ccode]
      );
      
      // Return sms_enabled status (default to false if not found)
      const smsEnabled = rows.length > 0 ? rows[0].sms_enabled : false;
      
      return sendJSON(res, { 
        success: true, 
        data: { ccode, sms_enabled: smsEnabled } 
      });
    }

    if (path === '/api/sms/config' && method === 'POST') {
      const body = await parseBody(req);
      const { ccode, sms_enabled } = body;
      
      if (!ccode) {
        return sendJSON(res, { success: false, error: 'ccode is required' }, 400);
      }
      
      // Insert or update SMS config
      await pool.query(
        `INSERT INTO sms_config (ccode, sms_enabled) 
         VALUES (?, ?) 
         ON DUPLICATE KEY UPDATE sms_enabled = ?, updated_at = NOW()`,
        [ccode, sms_enabled !== false, sms_enabled !== false]
      );
      
      return sendJSON(res, { 
        success: true, 
        message: 'SMS configuration updated' 
      });
    }

    // SMS Send endpoint
    if (path === '/api/sms/send' && method === 'POST') {
      const body = await parseBody(req);
      const { phone, message, ccode } = body;
      
      if (!phone || !message) {
        return sendJSON(res, { 
          success: false, 
          error: 'phone and message are required' 
        }, 400);
      }
      
      // Check if SMS is enabled for this ccode
      if (ccode) {
        const [configRows] = await pool.query(
          'SELECT sms_enabled FROM sms_config WHERE ccode = ?',
          [ccode]
        );
        
        if (configRows.length === 0 || !configRows[0].sms_enabled) {
          return sendJSON(res, { 
            success: false, 
            message: 'SMS not enabled for this company' 
          }, 403);
        }
      }
      
      // Get API key from environment
      const apiKey = process.env.SAVVY_BULK_SMS_API_KEY;
      
      if (!apiKey) {
        return sendJSON(res, { 
          success: false, 
          error: 'SMS API key not configured' 
        }, 500);
      }
      
      // Send SMS via Savvy Bulk SMS API
      try {
        const https = require('https');
        const postData = JSON.stringify({
          partnerID: '7878',
          apikey: apiKey,
          pass_type: 'plain',
          clientsmsid: Date.now().toString(),
          mobile: phone,
          message: message,
          shortcode: 'POLYTANO'
        });
        
        const options = {
          hostname: 'sms.textsms.co.ke',
          port: 443,
          path: '/api/services/sendsms/',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData)
          }
        };
        
        const smsResponse = await new Promise((resolve, reject) => {
          const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
              try {
                resolve(JSON.parse(data));
              } catch (e) {
                resolve({ success: false, error: 'Invalid response from SMS provider' });
              }
            });
          });
          
          req.on('error', (e) => {
            reject(e);
          });
          
          req.write(postData);
          req.end();
        });
        
        return sendJSON(res, { 
          success: true, 
          message: 'SMS sent successfully',
          response: smsResponse 
        });
        
      } catch (error) {
        console.error('SMS Error:', error);
        return sendJSON(res, { 
          success: false, 
          error: 'Failed to send SMS',
          details: error.message 
        }, 500);
      }
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
