/**
 * Milk Collection Sync Service
 * Ultra-lightweight Node.js service for cPanel hosting
 * Syncs data between MySQL and external systems
 * 
 * Memory target: <50MB RAM
 * Single-file architecture for easy deployment
 */

const http = require('http');
const mysql = require('mysql2/promise');

// ============================================================================
// CONFIGURATION
// ============================================================================

const PORT = process.env.PORT || 3001;
const VERSION = '1.0.0';
const SERVICE_NAME = 'milk-collection-sync-service';

// Database configuration from environment
const DB_CONFIG = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'maddasys_milk_collection_pwa',
  waitForConnections: true,
  connectionLimit: 5,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000
};

// External API configuration (for syncing to remote systems)
const REMOTE_API_URL = process.env.REMOTE_API_URL || '';
const REMOTE_API_KEY = process.env.REMOTE_API_KEY || '';

// Sync configuration
const SYNC_BATCH_SIZE = parseInt(process.env.SYNC_BATCH_SIZE) || 100;
const SYNC_INTERVAL_MS = parseInt(process.env.SYNC_INTERVAL_MS) || 300000; // 5 minutes

// ============================================================================
// DATABASE CONNECTION POOL
// ============================================================================

let pool = null;

async function getPool() {
  if (!pool) {
    pool = mysql.createPool(DB_CONFIG);
    console.log(`[${new Date().toISOString()}] Database pool created`);
  }
  return pool;
}

async function query(sql, params = []) {
  const p = await getPool();
  const [rows] = await p.execute(sql, params);
  return rows;
}

// ============================================================================
// CORS HEADERS
// ============================================================================

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
  'Access-Control-Max-Age': '86400'
};

// ============================================================================
// HTTP UTILITIES
// ============================================================================

function sendJSON(res, statusCode, data) {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    ...CORS_HEADERS,
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

function sendError(res, statusCode, message, details = null) {
  sendJSON(res, statusCode, {
    success: false,
    error: message,
    details,
    timestamp: new Date().toISOString()
  });
}

async function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function log(level, message, data = null) {
  const timestamp = new Date().toISOString();
  const logEntry = { timestamp, level, message, ...(data && { data }) };
  console.log(JSON.stringify(logEntry));
}

// ============================================================================
// SYNC STATUS TRACKING
// ============================================================================

const syncStatus = {
  lastSync: null,
  lastSyncSuccess: null,
  totalSynced: 0,
  totalErrors: 0,
  isRunning: false,
  pendingCount: 0,
  syncHistory: [] // Keep last 20 sync operations
};

function addSyncHistory(operation, success, count, error = null) {
  syncStatus.syncHistory.unshift({
    timestamp: new Date().toISOString(),
    operation,
    success,
    count,
    error
  });
  
  // Keep only last 20 entries
  if (syncStatus.syncHistory.length > 20) {
    syncStatus.syncHistory = syncStatus.syncHistory.slice(0, 20);
  }
}

// ============================================================================
// SYNC OPERATIONS
// ============================================================================

/**
 * Get records that need to be synced (not yet synced or updated since last sync)
 */
async function getPendingSyncRecords(tableName, syncField = 'synced_at', limit = SYNC_BATCH_SIZE) {
  try {
    // Check if sync field exists
    const columns = await query(`SHOW COLUMNS FROM ${tableName} LIKE ?`, [syncField]);
    
    let sql;
    if (columns.length > 0) {
      // Table has sync tracking field
      sql = `SELECT * FROM ${tableName} 
             WHERE ${syncField} IS NULL 
             OR updated_at > ${syncField} 
             ORDER BY created_at ASC 
             LIMIT ?`;
    } else {
      // No sync field - get all records (for initial sync)
      sql = `SELECT * FROM ${tableName} ORDER BY created_at ASC LIMIT ?`;
    }
    
    return await query(sql, [limit]);
  } catch (error) {
    log('error', `Failed to get pending sync records from ${tableName}`, { error: error.message });
    throw error;
  }
}

/**
 * Mark records as synced
 */
async function markAsSynced(tableName, ids, syncField = 'synced_at') {
  if (ids.length === 0) return;
  
  try {
    const placeholders = ids.map(() => '?').join(',');
    await query(
      `UPDATE ${tableName} SET ${syncField} = NOW() WHERE id IN (${placeholders})`,
      ids
    );
    log('info', `Marked ${ids.length} records as synced in ${tableName}`);
  } catch (error) {
    log('error', `Failed to mark records as synced in ${tableName}`, { error: error.message });
    throw error;
  }
}

/**
 * Sync milk collection records to remote system
 */
async function syncMilkCollection() {
  log('info', 'Starting milk collection sync');
  
  try {
    const records = await query(`
      SELECT mc.*, f.farmer_name, f.route_name as farmer_route
      FROM milk_collection mc
      LEFT JOIN farmers f ON mc.farmer_id = f.farmer_id
      ORDER BY mc.created_at DESC
      LIMIT ?
    `, [SYNC_BATCH_SIZE]);
    
    if (records.length === 0) {
      log('info', 'No milk collection records to sync');
      return { synced: 0, errors: 0 };
    }
    
    // If remote API is configured, send data
    if (REMOTE_API_URL) {
      const result = await sendToRemoteAPI('/milk-collection/batch', records);
      if (result.success) {
        syncStatus.totalSynced += records.length;
        addSyncHistory('milk_collection', true, records.length);
        return { synced: records.length, errors: 0 };
      } else {
        syncStatus.totalErrors++;
        addSyncHistory('milk_collection', false, 0, result.error);
        return { synced: 0, errors: 1 };
      }
    }
    
    // No remote API - just return count
    log('info', `Found ${records.length} milk collection records (no remote API configured)`);
    return { synced: records.length, errors: 0 };
    
  } catch (error) {
    log('error', 'Milk collection sync failed', { error: error.message });
    syncStatus.totalErrors++;
    addSyncHistory('milk_collection', false, 0, error.message);
    return { synced: 0, errors: 1 };
  }
}

/**
 * Sync farmers to remote system
 */
async function syncFarmers() {
  log('info', 'Starting farmers sync');
  
  try {
    const records = await query(`SELECT * FROM farmers ORDER BY created_at DESC LIMIT ?`, [SYNC_BATCH_SIZE]);
    
    if (records.length === 0) {
      log('info', 'No farmer records to sync');
      return { synced: 0, errors: 0 };
    }
    
    if (REMOTE_API_URL) {
      const result = await sendToRemoteAPI('/farmers/batch', records);
      if (result.success) {
        syncStatus.totalSynced += records.length;
        addSyncHistory('farmers', true, records.length);
        return { synced: records.length, errors: 0 };
      } else {
        syncStatus.totalErrors++;
        addSyncHistory('farmers', false, 0, result.error);
        return { synced: 0, errors: 1 };
      }
    }
    
    log('info', `Found ${records.length} farmer records (no remote API configured)`);
    return { synced: records.length, errors: 0 };
    
  } catch (error) {
    log('error', 'Farmers sync failed', { error: error.message });
    syncStatus.totalErrors++;
    addSyncHistory('farmers', false, 0, error.message);
    return { synced: 0, errors: 1 };
  }
}

/**
 * Sync devices to remote system
 */
async function syncDevices() {
  log('info', 'Starting devices sync');
  
  try {
    const records = await query(`SELECT * FROM approved_devices ORDER BY created_at DESC LIMIT ?`, [SYNC_BATCH_SIZE]);
    
    if (records.length === 0) {
      log('info', 'No device records to sync');
      return { synced: 0, errors: 0 };
    }
    
    if (REMOTE_API_URL) {
      const result = await sendToRemoteAPI('/devices/batch', records);
      if (result.success) {
        syncStatus.totalSynced += records.length;
        addSyncHistory('devices', true, records.length);
        return { synced: records.length, errors: 0 };
      } else {
        syncStatus.totalErrors++;
        addSyncHistory('devices', false, 0, result.error);
        return { synced: 0, errors: 1 };
      }
    }
    
    log('info', `Found ${records.length} device records (no remote API configured)`);
    return { synced: records.length, errors: 0 };
    
  } catch (error) {
    log('error', 'Devices sync failed', { error: error.message });
    syncStatus.totalErrors++;
    addSyncHistory('devices', false, 0, error.message);
    return { synced: 0, errors: 1 };
  }
}

/**
 * Send data to remote API
 */
async function sendToRemoteAPI(endpoint, data) {
  if (!REMOTE_API_URL) {
    return { success: false, error: 'No remote API URL configured' };
  }
  
  try {
    const url = new URL(endpoint, REMOTE_API_URL);
    const body = JSON.stringify(data);
    
    return new Promise((resolve) => {
      const protocol = url.protocol === 'https:' ? require('https') : require('http');
      
      const options = {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          ...(REMOTE_API_KEY && { 'Authorization': `Bearer ${REMOTE_API_KEY}` })
        },
        timeout: 30000
      };
      
      const req = protocol.request(options, (res) => {
        let responseBody = '';
        res.on('data', chunk => { responseBody += chunk; });
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ success: true, data: responseBody });
          } else {
            resolve({ success: false, error: `HTTP ${res.statusCode}: ${responseBody}` });
          }
        });
      });
      
      req.on('error', (error) => {
        resolve({ success: false, error: error.message });
      });
      
      req.on('timeout', () => {
        req.destroy();
        resolve({ success: false, error: 'Request timeout' });
      });
      
      req.write(body);
      req.end();
    });
    
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Run full sync operation
 */
async function runFullSync() {
  if (syncStatus.isRunning) {
    log('warn', 'Sync already running, skipping');
    return { skipped: true };
  }
  
  syncStatus.isRunning = true;
  syncStatus.lastSync = new Date().toISOString();
  
  log('info', '=== Starting full sync ===');
  
  const results = {
    farmers: { synced: 0, errors: 0 },
    milk_collection: { synced: 0, errors: 0 },
    devices: { synced: 0, errors: 0 }
  };
  
  try {
    results.farmers = await syncFarmers();
    results.milk_collection = await syncMilkCollection();
    results.devices = await syncDevices();
    
    const totalSynced = results.farmers.synced + results.milk_collection.synced + results.devices.synced;
    const totalErrors = results.farmers.errors + results.milk_collection.errors + results.devices.errors;
    
    syncStatus.lastSyncSuccess = totalErrors === 0;
    
    log('info', '=== Full sync completed ===', { totalSynced, totalErrors, results });
    
    return { success: true, results, totalSynced, totalErrors };
    
  } catch (error) {
    log('error', 'Full sync failed', { error: error.message });
    syncStatus.lastSyncSuccess = false;
    return { success: false, error: error.message };
    
  } finally {
    syncStatus.isRunning = false;
  }
}

// ============================================================================
// SCHEDULED SYNC (Optional - can be triggered externally)
// ============================================================================

let syncInterval = null;

function startScheduledSync() {
  if (syncInterval) {
    clearInterval(syncInterval);
  }
  
  if (SYNC_INTERVAL_MS > 0) {
    log('info', `Starting scheduled sync every ${SYNC_INTERVAL_MS / 1000} seconds`);
    syncInterval = setInterval(runFullSync, SYNC_INTERVAL_MS);
  }
}

function stopScheduledSync() {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
    log('info', 'Scheduled sync stopped');
  }
}

// ============================================================================
// ROUTE HANDLERS
// ============================================================================

const routes = {
  // Health check
  'GET /': async (req, res) => {
    sendJSON(res, 200, {
      success: true,
      service: SERVICE_NAME,
      version: VERSION,
      status: 'running',
      timestamp: new Date().toISOString()
    });
  },
  
  // Version endpoint
  'GET /api/version': async (req, res) => {
    sendJSON(res, 200, {
      success: true,
      service: SERVICE_NAME,
      version: VERSION,
      node: process.version,
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      timestamp: new Date().toISOString()
    });
  },
  
  // Health check with DB
  'GET /api/health': async (req, res) => {
    try {
      await query('SELECT 1');
      sendJSON(res, 200, {
        success: true,
        database: 'connected',
        service: SERVICE_NAME,
        version: VERSION,
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        syncStatus: {
          lastSync: syncStatus.lastSync,
          lastSyncSuccess: syncStatus.lastSyncSuccess,
          totalSynced: syncStatus.totalSynced,
          totalErrors: syncStatus.totalErrors,
          isRunning: syncStatus.isRunning
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      sendJSON(res, 503, {
        success: false,
        database: 'disconnected',
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  },
  
  // Get sync status
  'GET /api/sync/status': async (req, res) => {
    sendJSON(res, 200, {
      success: true,
      ...syncStatus,
      remoteApiConfigured: !!REMOTE_API_URL,
      scheduledSyncActive: !!syncInterval,
      syncIntervalMs: SYNC_INTERVAL_MS,
      timestamp: new Date().toISOString()
    });
  },
  
  // Trigger manual sync
  'POST /api/sync/run': async (req, res) => {
    log('info', 'Manual sync triggered via API');
    
    const result = await runFullSync();
    
    if (result.skipped) {
      sendJSON(res, 409, {
        success: false,
        message: 'Sync already in progress',
        timestamp: new Date().toISOString()
      });
    } else {
      sendJSON(res, 200, {
        success: true,
        message: 'Sync completed',
        ...result,
        timestamp: new Date().toISOString()
      });
    }
  },
  
  // Sync specific table
  'POST /api/sync/:table': async (req, res, params) => {
    const table = params.table;
    log('info', `Manual sync triggered for table: ${table}`);
    
    let result;
    switch (table) {
      case 'farmers':
        result = await syncFarmers();
        break;
      case 'milk_collection':
        result = await syncMilkCollection();
        break;
      case 'devices':
        result = await syncDevices();
        break;
      default:
        return sendError(res, 400, `Unknown table: ${table}`);
    }
    
    sendJSON(res, 200, {
      success: true,
      table,
      ...result,
      timestamp: new Date().toISOString()
    });
  },
  
  // Get sync history
  'GET /api/sync/history': async (req, res) => {
    sendJSON(res, 200, {
      success: true,
      history: syncStatus.syncHistory,
      timestamp: new Date().toISOString()
    });
  },
  
  // Start scheduled sync
  'POST /api/sync/schedule/start': async (req, res) => {
    startScheduledSync();
    sendJSON(res, 200, {
      success: true,
      message: 'Scheduled sync started',
      intervalMs: SYNC_INTERVAL_MS,
      timestamp: new Date().toISOString()
    });
  },
  
  // Stop scheduled sync
  'POST /api/sync/schedule/stop': async (req, res) => {
    stopScheduledSync();
    sendJSON(res, 200, {
      success: true,
      message: 'Scheduled sync stopped',
      timestamp: new Date().toISOString()
    });
  },
  
  // Get table counts
  'GET /api/stats': async (req, res) => {
    try {
      const [farmers] = await query('SELECT COUNT(*) as count FROM farmers');
      const [milkCollection] = await query('SELECT COUNT(*) as count FROM milk_collection');
      const [devices] = await query('SELECT COUNT(*) as count FROM approved_devices');
      
      sendJSON(res, 200, {
        success: true,
        counts: {
          farmers: farmers?.count || 0,
          milk_collection: milkCollection?.count || 0,
          devices: devices?.count || 0
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      sendError(res, 500, 'Failed to get stats', error.message);
    }
  },
  
  // Import data from external source
  'POST /api/import/farmers': async (req, res) => {
    try {
      const body = await parseBody(req);
      
      if (!Array.isArray(body.farmers)) {
        return sendError(res, 400, 'farmers array required');
      }
      
      let imported = 0;
      let errors = 0;
      
      for (const farmer of body.farmers) {
        try {
          await query(
            `INSERT INTO farmers (farmer_id, farmer_name, route_name, created_at, updated_at)
             VALUES (?, ?, ?, NOW(), NOW())
             ON DUPLICATE KEY UPDATE 
               farmer_name = VALUES(farmer_name),
               route_name = VALUES(route_name),
               updated_at = NOW()`,
            [farmer.farmer_id, farmer.farmer_name, farmer.route_name || null]
          );
          imported++;
        } catch (e) {
          errors++;
          log('error', 'Failed to import farmer', { farmer, error: e.message });
        }
      }
      
      sendJSON(res, 200, {
        success: true,
        imported,
        errors,
        total: body.farmers.length,
        timestamp: new Date().toISOString()
      });
      
    } catch (error) {
      sendError(res, 500, 'Import failed', error.message);
    }
  },
  
  // Export data
  'GET /api/export/farmers': async (req, res) => {
    try {
      const farmers = await query('SELECT * FROM farmers ORDER BY farmer_id');
      sendJSON(res, 200, {
        success: true,
        count: farmers.length,
        farmers,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      sendError(res, 500, 'Export failed', error.message);
    }
  },
  
  'GET /api/export/milk_collection': async (req, res) => {
    try {
      // Get query params for date filtering
      const url = new URL(req.url, `http://${req.headers.host}`);
      const fromDate = url.searchParams.get('from');
      const toDate = url.searchParams.get('to');
      const limit = parseInt(url.searchParams.get('limit')) || 1000;
      
      let sql = `SELECT mc.*, f.farmer_name 
                 FROM milk_collection mc
                 LEFT JOIN farmers f ON mc.farmer_id = f.farmer_id`;
      const params = [];
      
      if (fromDate || toDate) {
        const conditions = [];
        if (fromDate) {
          conditions.push('mc.collection_date >= ?');
          params.push(fromDate);
        }
        if (toDate) {
          conditions.push('mc.collection_date <= ?');
          params.push(toDate);
        }
        sql += ' WHERE ' + conditions.join(' AND ');
      }
      
      sql += ' ORDER BY mc.collection_date DESC, mc.created_at DESC LIMIT ?';
      params.push(limit);
      
      const records = await query(sql, params);
      
      sendJSON(res, 200, {
        success: true,
        count: records.length,
        filters: { fromDate, toDate, limit },
        records,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      sendError(res, 500, 'Export failed', error.message);
    }
  }
};

// ============================================================================
// REQUEST ROUTER
// ============================================================================

async function handleRequest(req, res) {
  const startTime = Date.now();
  
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS_HEADERS);
    return res.end();
  }
  
  // Parse URL
  const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = parsedUrl.pathname.replace(/\/+$/, '') || '/';
  
  // Find matching route
  let handler = null;
  let params = {};
  
  // Try exact match first
  const routeKey = `${req.method} ${pathname}`;
  if (routes[routeKey]) {
    handler = routes[routeKey];
  } else {
    // Try pattern matching
    for (const [pattern, h] of Object.entries(routes)) {
      const [method, path] = pattern.split(' ');
      if (method !== req.method) continue;
      
      // Convert :param to regex
      const regexStr = path.replace(/:([^/]+)/g, '([^/]+)');
      const regex = new RegExp(`^${regexStr}$`);
      const match = pathname.match(regex);
      
      if (match) {
        handler = h;
        // Extract params
        const paramNames = (path.match(/:([^/]+)/g) || []).map(p => p.slice(1));
        paramNames.forEach((name, i) => {
          params[name] = match[i + 1];
        });
        break;
      }
    }
  }
  
  if (handler) {
    try {
      await handler(req, res, params);
    } catch (error) {
      log('error', 'Request handler error', { 
        method: req.method, 
        path: pathname, 
        error: error.message 
      });
      sendError(res, 500, 'Internal server error', error.message);
    }
  } else {
    sendError(res, 404, 'Not found', `${req.method} ${pathname}`);
  }
  
  // Log request
  const duration = Date.now() - startTime;
  log('info', 'Request completed', {
    method: req.method,
    path: pathname,
    status: res.statusCode,
    duration: `${duration}ms`
  });
}

// ============================================================================
// SERVER STARTUP
// ============================================================================

const server = http.createServer(handleRequest);

server.listen(PORT, () => {
  console.log('='.repeat(60));
  console.log(`${SERVICE_NAME} v${VERSION}`);
  console.log('='.repeat(60));
  console.log(`Server running on port ${PORT}`);
  console.log(`Database: ${DB_CONFIG.database}@${DB_CONFIG.host}`);
  console.log(`Remote API: ${REMOTE_API_URL || 'Not configured'}`);
  console.log(`Sync batch size: ${SYNC_BATCH_SIZE}`);
  console.log(`Sync interval: ${SYNC_INTERVAL_MS}ms`);
  console.log('='.repeat(60));
  console.log('Endpoints:');
  console.log('  GET  /                     - Service info');
  console.log('  GET  /api/version          - Version info');
  console.log('  GET  /api/health           - Health check');
  console.log('  GET  /api/stats            - Table counts');
  console.log('  GET  /api/sync/status      - Sync status');
  console.log('  POST /api/sync/run         - Trigger full sync');
  console.log('  POST /api/sync/:table      - Sync specific table');
  console.log('  GET  /api/sync/history     - Sync history');
  console.log('  POST /api/sync/schedule/start - Start scheduled sync');
  console.log('  POST /api/sync/schedule/stop  - Stop scheduled sync');
  console.log('  POST /api/import/farmers   - Import farmers');
  console.log('  GET  /api/export/farmers   - Export farmers');
  console.log('  GET  /api/export/milk_collection - Export milk collection');
  console.log('='.repeat(60));
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down...');
  stopScheduledSync();
  if (pool) {
    await pool.end();
  }
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled rejection at:', promise, 'reason:', reason);
});
