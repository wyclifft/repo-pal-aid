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

// CORS
// NOTE: Some Apache/Passenger setups strip or override wildcard CORS, so we
// echo back the request Origin when present.
const getCorsHeaders = (origin) => {
  const allowOrigin = origin || '*';

  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Vary': 'Origin',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS, PATCH',
    'Access-Control-Allow-Headers': 'Content-Type, Accept, Authorization, X-Requested-With, Origin',
    'Access-Control-Max-Age': '86400'
  };
};

// Helper: Send JSON response
const sendJSON = (res, data, status = 200, origin) => {
  const corsHeaders = getCorsHeaders(origin);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    ...corsHeaders
  });
  res.end(JSON.stringify(data));
};

// Main server
const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin;
  const corsHeaders = getCorsHeaders(origin);

  // Ensure headers exist even if something writes early
  for (const [k, v] of Object.entries(corsHeaders)) {
    res.setHeader(k, v);
  }

  const parsedUrl = url.parse(req.url, true);
  const path = parsedUrl.pathname;
  const method = req.method;

  // CORS preflight - handle ALL OPTIONS requests immediately
  if (method === 'OPTIONS') {
    // Use 200 (not 204) to satisfy stricter preflight checks in some environments
    res.writeHead(200, corsHeaders);
    return res.end();
  }

  try {
    // Health check
    if (path === '/api/health') {
      return sendJSON(res, { success: true, message: 'API running', timestamp: new Date() });
    }

    // Sessions endpoint - Fetch from sessions table
    if (path.startsWith('/api/sessions/by-device/') && method === 'GET') {
      const uniquedevcode = decodeURIComponent(path.split('/')[4]);
      
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
      
      // Get sessions from sessions table for this company
      const [rows] = await pool.query(
        `SELECT descript, time_from, time_to, ccode 
         FROM sessions WHERE ccode = ? ORDER BY time_from`,
        [ccode]
      );
      
      return sendJSON(res, { success: true, data: rows, ccode });
    }

    // Get active session for a device (based on current time)
    if (path.startsWith('/api/sessions/active/') && method === 'GET') {
      const uniquedevcode = decodeURIComponent(path.split('/')[4]);
      
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
      
      // Get current time in HH:MM:SS format
      const now = new Date();
      const currentTime = now.toTimeString().split(' ')[0]; // "HH:MM:SS"
      
      // Find active session where current time is between time_from and time_to
      const [rows] = await pool.query(
        `SELECT descript, time_from, time_to, ccode 
         FROM sessions 
         WHERE ccode = ? AND time_from <= ? AND time_to >= ?
         ORDER BY time_from
         LIMIT 1`,
        [ccode, currentTime, currentTime]
      );
      
      if (rows.length === 0) {
        return sendJSON(res, { 
          success: true, 
          data: null, 
          message: 'No active session at current time',
          ccode 
        });
      }
      
      return sendJSON(res, { success: true, data: rows[0], ccode });
    }

    // Routes endpoint - Fetch from fm_tanks table
    if (path.startsWith('/api/routes/by-device/') && method === 'GET') {
      const uniquedevcode = decodeURIComponent(path.split('/')[4]);
      
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
      
      // Get routes from fm_tanks for this company
      const [rows] = await pool.query(
        `SELECT tcode, descript, icode, idesc, task1, task2, task3, task4, task5, task6, task7, task8, depart, ccode, mprefix 
         FROM fm_tanks WHERE ccode = ? ORDER BY descript`,
        [ccode]
      );
      
      return sendJSON(res, { success: true, data: rows, ccode });
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
      
      // Get route filter from query params
      const routeFilter = parsedUrl.query.route;
      
      // Get farmers for this company, optionally filtered by route
      let query = 'SELECT mcode as farmer_id, descript as name, route, ccode FROM cm_members WHERE ccode = ?';
      let params = [ccode];
      
      // Filter by route if specified
      if (routeFilter) {
        query += ' AND route = ?';
        params.push(routeFilter);
      }
      
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
      
      // Get connection for transaction
      const connection = await pool.getConnection();
      
      try {
        // Start transaction
        await connection.beginTransaction();
        
        // Get device_ref from devsettings (slot-based reference, e.g., AE10000001)
        const [deviceRows] = await connection.query(
          'SELECT ccode, device_ref FROM devsettings WHERE uniquedevcode = ?',
          [deviceserial]
        );
        
        if (deviceRows.length === 0) {
          await connection.rollback();
          connection.release();
          return sendJSON(res, { 
            success: false, 
            error: 'Device not found' 
          }, 404);
        }
        
        const deviceRef = deviceRows[0].device_ref;
        
        if (!deviceRef) {
          await connection.rollback();
          connection.release();
          return sendJSON(res, { 
            success: false, 
            error: 'Device has no assigned device_ref. Please re-register the device.' 
          }, 400);
        }
        
        // Extract prefix from device_ref (e.g., "AE1" from "AE10000001")
        const devicePrefix = deviceRef.slice(0, 3);
        
        // Get the last transaction number for THIS DEVICE SLOT with row lock
        const [lastTransRows] = await connection.query(
          'SELECT transrefno FROM transactions WHERE transrefno LIKE ? ORDER BY transrefno DESC LIMIT 1 FOR UPDATE',
          [`${devicePrefix}%`]
        );
        
        let nextNumber = 1; // Starting number for this device slot
        
        if (lastTransRows.length > 0) {
          const lastRef = lastTransRows[0].transrefno;
          // Extract the sequential number (everything after the 3-char prefix "AE1")
          const lastNumber = parseInt(lastRef.substring(3));
          if (!isNaN(lastNumber)) {
            nextNumber = lastNumber + 1;
          }
        }
        
        // Generate reference: Prefix (AE1) + 7-digit sequential number
        const transrefno = `${devicePrefix}${String(nextNumber).padStart(7, '0')}`;
        
        // Commit transaction
        await connection.commit();
        connection.release();
        
        return sendJSON(res, { 
          success: true, 
          data: { reference_no: transrefno }
        });
      } catch (error) {
        await connection.rollback();
        connection.release();
        console.error('Reference generation error:', error);
        return sendJSON(res, { 
          success: false, 
          error: 'Failed to generate reference number' 
        }, 500);
      }
    }

    // NEW: Reserve batch of reference numbers for fast offline generation
    // DUPLICATE-SAFE: Inserts placeholder records to prevent overlapping reservations
    if (path === '/api/milk-collection/reserve-batch' && method === 'POST') {
      const body = await parseBody(req);
      const deviceserial = body.device_fingerprint;
      const batchSize = body.batch_size || 100;
      
      if (!deviceserial) {
        return sendJSON(res, { 
          success: false, 
          error: 'device_fingerprint is required' 
        }, 400);
      }
      
      const connection = await pool.getConnection();
      
      try {
        await connection.beginTransaction();
        
        // Get device_ref from devsettings (slot-based reference)
        const [deviceRows] = await connection.query(
          'SELECT ccode, device_ref FROM devsettings WHERE uniquedevcode = ?',
          [deviceserial]
        );
        
        if (deviceRows.length === 0) {
          await connection.rollback();
          connection.release();
          return sendJSON(res, { 
            success: false, 
            error: 'Device not found' 
          }, 404);
        }
        
        const ccode = deviceRows[0].ccode;
        const deviceRef = deviceRows[0].device_ref;
        
        if (!deviceRef) {
          await connection.rollback();
          connection.release();
          return sendJSON(res, { 
            success: false, 
            error: 'Device has no assigned device_ref' 
          }, 400);
        }
        
        // Extract prefix from device_ref (e.g., "AE1" from "AE10000001")
        const devicePrefix = deviceRef.slice(0, 3);
        
        // CRITICAL: Get the highest transaction number with row lock to prevent duplicates
        const [lastTransRows] = await connection.query(
          'SELECT transrefno FROM transactions WHERE transrefno LIKE ? ORDER BY transrefno DESC LIMIT 1 FOR UPDATE',
          [`${devicePrefix}%`]
        );
        
        let startNumber = 1;
        
        if (lastTransRows.length > 0) {
          const lastRef = lastTransRows[0].transrefno;
          const lastNumber = parseInt(lastRef.substring(3));
          if (!isNaN(lastNumber)) {
            startNumber = lastNumber + 1;
          }
        }
        
        const endNumber = startNumber + batchSize;
        
        // DUPLICATE PREVENTION: Insert a placeholder record at the end of the batch
        // Format: AE1 + 7-digit padded number
        const placeholderRefNo = `${devicePrefix}${String(endNumber - 1).padStart(7, '0')}`;
        
        await connection.query(
          `INSERT INTO transactions (
            transrefno, memberno, itemcode, weight, sprice, amount, 
            Transdate, Transtype, ccode, deviceserial, clerk, 
            session, route, entry_type
          ) VALUES (?, ?, ?, ?, ?, ?, NOW(), ?, ?, ?, ?, ?, ?, ?)`,
          [
            placeholderRefNo,
            'BATCH_RESERVATION',
            '000',
            0,
            0,
            0,
            'R', // R for Reservation placeholder
            ccode,
            deviceserial,
            'SYSTEM',
            'AM',
            'RESERVATION',
            'reservation'
          ]
        );
        
        await connection.commit();
        connection.release();
        
        console.log(`✅ Reserved batch [${startNumber} to ${endNumber - 1}] - Placeholder: ${placeholderRefNo}`);
        
        return sendJSON(res, { 
          success: true, 
          data: { 
            start: startNumber,
            end: endNumber
          } 
        });
      } catch (error) {
        await connection.rollback();
        connection.release();
        console.error('❌ Error reserving batch:', error);
        return sendJSON(res, { 
          success: false, 
          error: 'Failed to reserve batch' 
        }, 500);
      }
    }

    if (path === '/api/milk-collection' && method === 'POST') {
      const body = await parseBody(req);
    
      // Use provided transrefno from frontend (initial attempt)
      let transrefno = body.reference_no;
      if (!transrefno) {
        return sendJSON(res, { 
          success: false, 
          error: 'reference_no is required' 
        }, 400);
      }
      
      console.log('🟢 BACKEND: Creating NEW transaction');
      console.log('📝 Reference:', transrefno);
      console.log('👤 Farmer:', body.farmer_id);
      console.log('⚖️ Weight:', body.weight, 'Kg');
      console.log('📅 Session:', body.session);
      
      const clerk = body.clerk_name || 'unknown';
      const deviceserial = body.device_fingerprint || 'web';
      
      // Fetch ccode from devsettings using uniquedevcode
      const [deviceRows] = await pool.query(
        'SELECT ccode, authorized FROM devsettings WHERE uniquedevcode = ?',
        [deviceserial]
      );
      
      if (deviceRows.length === 0 || !deviceRows[0].authorized) {
        console.log('❌ Device not authorized:', deviceserial);
        return sendJSON(res, { 
          success: false, 
          error: 'Device not authorized' 
        }, 403);
      }
      
      const ccode = deviceRows[0].ccode;
      console.log('🏢 Company Code:', ccode);
      
      // Parse date and time
      const collectionDate = new Date(body.collection_date);
      const transdate = collectionDate.toISOString().split('T')[0]; // YYYY-MM-DD
      const transtime = collectionDate.toTimeString().split(' ')[0]; // HH:MM:SS
      const timestamp = Math.floor(collectionDate.getTime() / 1000); // Unix timestamp
    
      // Helper function to attempt insert with auto-regeneration on duplicate
      // Infinite retries for production - will keep trying until unique reference is generated
      const attemptInsert = async (attemptTransrefno) => {
        let attempt = 0;
        while (true) {
          attempt++;
          try {
            await pool.query(
              `INSERT INTO transactions 
                (transrefno, userId, clerk, deviceserial, memberno, route, weight, session, 
                 transdate, transtime, Transtype, processed, uploaded, ccode, ivat, iprice, 
                 amount, icode, time, capType, entry_type)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'MILK', 0, 0, ?, 0, 0, 0, '', ?, 0, ?)`,
              [attemptTransrefno, clerk, clerk, deviceserial, body.farmer_id, body.route, body.weight, 
               body.session, transdate, transtime, ccode, timestamp, body.entry_type || 'manual']
            );
            
            console.log('✅ BACKEND: NEW record INSERTED successfully with reference:', attemptTransrefno);
            return { success: true, reference_no: attemptTransrefno };
          } catch (error) {
            // Check if it's a duplicate entry error
            if (error.code === 'ER_DUP_ENTRY' && error.message.includes('idx_transrefno_unique')) {
              console.warn(`⚠️ Duplicate reference ${attemptTransrefno} detected (attempt ${attempt})`);
              
              // Add exponential backoff delay to reduce race conditions (max 2 seconds)
              if (attempt > 1) {
                const delay = Math.min(100 * Math.pow(2, attempt - 2), 2000);
                await new Promise(resolve => setTimeout(resolve, delay));
              }
              
              // Regenerate a new reference number using device_ref format
              const connection = await pool.getConnection();
              try {
                await connection.beginTransaction();
                
                // Get device_ref from devsettings
                const [devRefRows] = await connection.query(
                  'SELECT device_ref FROM devsettings WHERE uniquedevcode = ?',
                  [deviceserial]
                );
                
                if (devRefRows.length === 0 || !devRefRows[0].device_ref) {
                  await connection.rollback();
                  connection.release();
                  throw new Error('Device ref not found');
                }
                
                const deviceRef = devRefRows[0].device_ref;
                const devicePrefix = deviceRef.slice(0, 3); // e.g., "AE1"
                
                // Get the highest transaction number with row lock
                const [lastTransRows] = await connection.query(
                  'SELECT transrefno FROM transactions WHERE transrefno LIKE ? ORDER BY transrefno DESC LIMIT 1 FOR UPDATE',
                  [`${devicePrefix}%`]
                );
                
                let nextNumber = 1;
                if (lastTransRows.length > 0) {
                  const lastRef = lastTransRows[0].transrefno;
                  const lastNumber = parseInt(lastRef.substring(3));
                  if (!isNaN(lastNumber)) {
                    nextNumber = lastNumber + 1;
                  }
                }
                
                attemptTransrefno = `${devicePrefix}${String(nextNumber).padStart(7, '0')}`;
                await connection.commit();
                connection.release();
                
                console.log(`🔄 Generated new reference: ${attemptTransrefno} (retry ${attempt})`);
              } catch (genError) {
                await connection.rollback();
                connection.release();
                throw genError;
              }
            } else {
              // Not a duplicate error
              throw error;
            }
          }
        }
      };
      
      try {
        const result = await attemptInsert(transrefno);
        return sendJSON(res, { 
          success: true, 
          message: 'Collection created', 
          reference_no: result.reference_no 
        }, 201);
      } catch (error) {
        console.error('❌ BACKEND INSERT ERROR:', error.message);
        console.error('Error code:', error.code);
        return sendJSON(res, { 
          success: false, 
          error: `Insert failed: ${error.message}` 
        }, 500);
      }
    }

    if (path.startsWith('/api/milk-collection/') && method === 'PUT') {
      const ref = path.split('/')[3];
      const body = await parseBody(req);
      
      console.log('🟡 BACKEND: UPDATING existing transaction');
      console.log('📝 Reference:', ref);
      console.log('⚖️ New Weight:', body.weight, 'Kg');
      
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
        console.log('❌ Device not authorized for update:', deviceserial);
        return sendJSON(res, { 
          success: false, 
          error: 'Device not authorized' 
        }, 403);
      }
      
      const ccode = deviceRows[0].ccode;
      console.log('🏢 Company Code:', ccode);
      
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
      const [result] = await pool.query(`UPDATE transactions SET ${updates.join(', ')} WHERE transrefno = ? AND ccode = ?`, values);
      
      console.log('✅ BACKEND: Record UPDATED, affected rows:', result.affectedRows);
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

      // Group by route (defensive: normalize unexpected session values)
      const byRoute = collections.reduce((acc, c) => {
        const routeKey = c.route || 'Unknown';
        const sessionKey = c.session === 'PM' ? 'PM' : 'AM';

        if (!acc[routeKey]) {
          acc[routeKey] = { AM: [], PM: [], total: 0 };
        }

        acc[routeKey][sessionKey].push(c);
        acc[routeKey].total += parseFloat(c.weight || 0);
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
        'SELECT uniquedevcode, ccode, devcode, device_ref, authorized FROM devsettings WHERE uniquedevcode = ?',
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
        devcode: devRows.length > 0 ? devRows[0].devcode : null,
        device_ref: devRows.length > 0 ? devRows[0].device_ref : null
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
      
      // Get last used sequence for this device_ref prefix for counter sync
      let lastSequence = null;
      if (deviceData.device_ref) {
        const prefix = deviceData.device_ref.slice(0, 3); // e.g., "AE1"
        const [lastRefRows] = await pool.query(
          `SELECT transrefno FROM transactions 
           WHERE transrefno LIKE ? 
           ORDER BY transrefno DESC LIMIT 1`,
          [`${prefix}%`]
        );
        if (lastRefRows.length > 0 && lastRefRows[0].transrefno) {
          // Extract the sequence number from the last reference
          const lastRef = lastRefRows[0].transrefno;
          const seqPart = lastRef.slice(3); // Remove prefix to get sequence
          lastSequence = parseInt(seqPart, 10) || 0;
        }
      }
      deviceData.last_sequence = lastSequence;
      
      return sendJSON(res, { success: true, data: deviceData });
    }

    if (path.startsWith('/api/devices/') && method === 'GET' && path.split('/').length === 4) {
      const deviceId = path.split('/')[3];
      const [rows] = await pool.query('SELECT * FROM approved_devices WHERE id = ?', [deviceId]);
      if (rows.length === 0) return sendJSON(res, { success: false, error: 'Device not found' }, 404);
      return sendJSON(res, { success: true, data: rows[0] });
    }

    if (path === '/api/devices' && method === 'GET') {
      const [rows] = await pool.query('SELECT * FROM approved_devices ORDER BY created_at DESC');
      return sendJSON(res, { success: true, data: rows });
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
        
        // Also get device_ref from devsettings
        const [devRows] = await pool.query(
          'SELECT device_ref FROM devsettings WHERE uniquedevcode = ?',
          [body.device_fingerprint]
        );
        const deviceData = { ...updated[0], device_ref: devRows.length > 0 ? devRows[0].device_ref : null };
        
        return sendJSON(res, { success: true, data: deviceData, message: 'Device already registered' });
      } else {
        // Check if device exists in devsettings to get ccode and device_ref
        const [devRows] = await pool.query(
          'SELECT ccode, device_ref FROM devsettings WHERE uniquedevcode = ?',
          [body.device_fingerprint]
        );
        const ccode = devRows.length > 0 ? devRows[0].ccode : null;
        let deviceRef = devRows.length > 0 ? devRows[0].device_ref : null;

        // Ensure every device gets a slot-based device_ref:
        // Device 1 => AE10000001, AE10000002 ... (slot=1, sequence=7 digits)
        // Device 2 => AE20000001, AE20000002 ... (slot=2, sequence=7 digits)
        if (!deviceRef) {
          const [maxSlotRows] = await pool.query(
            `SELECT MAX(CAST(SUBSTRING(device_ref, 3, 1) AS UNSIGNED)) as max_slot
             FROM devsettings
             WHERE device_ref IS NOT NULL AND device_ref LIKE 'AE%'`
          );

          const nextSlot = maxSlotRows?.[0]?.max_slot ? Number(maxSlotRows[0].max_slot) + 1 : 1;
          deviceRef = `AE${nextSlot}${String(1).padStart(7, '0')}`; // e.g. AE10000001

          if (devRows.length > 0) {
            // Update existing devsettings record
            await pool.query(
              'UPDATE devsettings SET device_ref = ? WHERE uniquedevcode = ?',
              [deviceRef, body.device_fingerprint]
            );
          } else {
            // Create minimal devsettings record so the device_ref exists immediately
            await pool.query(
              'INSERT INTO devsettings (uniquedevcode, device, authorized, device_ref) VALUES (?, ?, 0, ?)',
              [body.device_fingerprint, body.device_info || null, deviceRef]
            );
          }
        }

        // Insert new device - ALWAYS set approved to FALSE for new devices
        const [result] = await pool.query(
          'INSERT INTO approved_devices (device_fingerprint, user_id, approved, device_info, last_sync, ccode, created_at, updated_at) VALUES (?, ?, FALSE, ?, NOW(), ?, NOW(), NOW())',
          [body.device_fingerprint, body.user_id, body.device_info || null, ccode]
        );
        const [newDevice] = await pool.query('SELECT * FROM approved_devices WHERE id = ?', [result.insertId]);
        
        // Include device_ref in response
        const deviceData = { ...newDevice[0], device_ref: deviceRef };
        
        return sendJSON(res, { success: true, data: deviceData, message: 'Device registered' }, 201);
      }
    }

    if (path.startsWith('/api/devices/') && path.endsWith('/approve') && method === 'PUT') {
      const deviceId = path.split('/')[3];
      const body = await parseBody(req);
      const updates = ['approved = ?', 'updated_at = NOW()'];
      const values = [body.approved !== undefined ? body.approved : true];
      
      if (body.approved_at) {
        updates.push('approved_at = ?');
        values.push(body.approved_at);
      }
      
      values.push(deviceId);
      await pool.query(`UPDATE approved_devices SET ${updates.join(', ')} WHERE id = ?`, values);
      const [updatedDevice] = await pool.query('SELECT * FROM approved_devices WHERE id = ?', [deviceId]);
      return sendJSON(res, { success: true, data: updatedDevice[0], message: 'Device approval status updated' });
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

    // Authentication endpoints
    if (path === '/api/auth/login' && method === 'POST') {
      const body = await parseBody(req);
      const { userid, password } = body;
      
      console.log('🔐 Login attempt:', { userid, passwordLength: password?.length });
      
      if (!userid || !password) {
        return sendJSON(res, { 
          success: false, 
          error: 'userid and password are required' 
        }, 400);
      }
      
      // Query user table with trim to handle whitespace
      const [rows] = await pool.query(
        'SELECT * FROM user WHERE TRIM(userid) = ? AND TRIM(password) = ?',
        [userid.trim(), password.trim()]
      );
      
      console.log('🔍 Query result:', rows.length > 0 ? 'User found' : 'No match');
      
      if (rows.length === 0) {
        // Debug: Check if user exists
        const [userCheck] = await pool.query(
          'SELECT userid, LENGTH(password) as pwd_len FROM user WHERE TRIM(userid) = ?',
          [userid.trim()]
        );
        
        if (userCheck.length > 0) {
          console.log('⚠️ User exists but password mismatch. Password length in DB:', userCheck[0].pwd_len);
        } else {
          console.log('⚠️ User not found in database');
        }
        
        return sendJSON(res, { 
          success: false, 
          error: 'Invalid credentials' 
        }, 401);
      }
      
      const user = rows[0];
      
      // Helper to convert MySQL bit/tinyint to boolean
      const toBool = (value) => {
        if (value === null || value === undefined) return false;
        if (typeof value === 'boolean') return value;
        if (typeof value === 'number') return value === 1;
        if (Buffer.isBuffer(value)) return value[0] === 1;
        if (typeof value === 'string') return value === '1' || value.toLowerCase() === 'true';
        return Boolean(value);
      };
      
      // Return user data (excluding sensitive password field)
      return sendJSON(res, { 
        success: true, 
        data: {
          user_id: user.userid,
          username: user.username,
          email: user.email,
          ccode: user.ccode,
          admin: toBool(user.admin),
          supervisor: toBool(user.supervisor),
          dcode: user.dcode,
          groupid: user.groupid,
          depart: user.depart
        }
      });
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
