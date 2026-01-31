/**
 * MySQL REST API Service
 * Handles all communication with the MySQL backend
 */

import { API_CONFIG } from '@/config/api';

const API_BASE_URL = `${API_CONFIG.MYSQL_API_URL}/api`;

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  details?: string;
  message?: string;
  offline?: boolean;
}

/**
 * Generic API request handler with error handling
 */
/**
 * Check if error is due to old backend with device_ref column issue
 */
function isDeviceRefColumnError(error: string | undefined): boolean {
  return !!error && (
    error.includes("Unknown column 'device_ref'") ||
    error.includes("device_ref") ||
    error.includes("Unknown column")
  );
}

async function apiRequest<T>(
  endpoint: string,
  options: RequestInit = {},
  timeoutMs = 15000 // 15 second default timeout
): Promise<ApiResponse<T>> {
  // Check if offline before attempting fetch
  if (!navigator.onLine) {
    console.warn(`[OFFLINE] API request skipped: ${endpoint}`);
    return {
      success: false,
      error: 'No internet connection. Operating in offline mode.',
    };
  }

  // Create abort controller for timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      ...options,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    clearTimeout(timeoutId);

    // Check if response is JSON
    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      throw new Error('Server unavailable or returned non-JSON response');
    }

    const data = await response.json();

    // Handle 503 (Service Unavailable) gracefully for offline mode
    if (response.status === 503 && data.offline) {
      return {
        success: false,
        error: data.message || 'Service temporarily unavailable',
        offline: true,
      };
    }

    // Handle 409 (Conflict) for duplicate session delivery - return full response
    if (response.status === 409) {
      return {
        success: false,
        error: data.error || 'Conflict',
        message: data.message,
        data: data, // Include full response data for existing_reference etc.
      };
    }

    // Handle 500 errors that might be due to old backend with device_ref column
    if (response.status === 500 && isDeviceRefColumnError(data.error)) {
      console.warn('[BACKEND] Old backend detected with device_ref column issue:', endpoint);
      return {
        success: false,
        error: 'Backend needs update. Please contact administrator.',
        details: 'The server is running an outdated version that references a removed column.',
      };
    }

    if (!response.ok) {
      throw new Error(data.error || `HTTP error! status: ${response.status}`);
    }

    return data;
  } catch (error) {
    clearTimeout(timeoutId);
    
    // Handle timeout specifically
    if (error instanceof Error && error.name === 'AbortError') {
      console.warn(`API request timeout: ${endpoint}`);
      return {
        success: false,
        error: 'Request timed out. Please check your connection.',
      };
    }
    
    console.error(`API request failed: ${endpoint}`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// ==================== SESSIONS API ====================

export interface Session {
  id?: number;        // Season ID (only for orgtype = 'C')
  SCODE?: string;     // Season code - saved to transactions.CAN column
  descript: string;
  time_from: number;  // Hour in 24-hour format (0-24)
  time_to: number;    // Hour in 24-hour format (0-24)
  ccode?: string;
  // Season-specific fields (orgtype = 'C')
  datefrom?: string;  // YYYY-MM-DD format (e.g., 2025-03-01)
  dateto?: string;    // YYYY-MM-DD format (e.g., 2025-03-10)
  dateEnabled?: boolean; // Backend-calculated: true if current date is within datefrom-dateto range
}

export interface SessionsResponse {
  success: boolean;
  data?: Session[];
  ccode?: string;
  periodLabel?: string; // 'Season' or 'Session'
  orgtype?: string;     // 'C' or 'D'
  error?: string;
}

export const sessionsApi = {
  /**
   * Get all sessions/seasons for a device's company
   * Returns periodLabel and orgtype to determine UI behavior
   */
  getByDevice: async (uniquedevcode: string): Promise<SessionsResponse> => {
    return apiRequest<Session[]>(`/sessions/by-device/${encodeURIComponent(uniquedevcode)}`) as Promise<SessionsResponse>;
  },
  
  /**
   * Get the currently active session based on current time
   */
  getActive: async (uniquedevcode: string): Promise<ApiResponse<Session | null>> => {
    return apiRequest<Session | null>(`/sessions/active/${encodeURIComponent(uniquedevcode)}`);
  },
};

// ==================== ROUTES API (fm_tanks) ====================

export interface Route {
  tcode: string;
  descript: string;
  icode?: string;
  idesc?: string;
  task1?: string;
  task2?: string;
  task3?: string;
  task4?: string;
  task5?: string;
  task6?: string;
  task7?: string;
  task8?: string;
  depart?: string;
  ccode?: string;
  mprefix?: string;
  // clientFetch controls portal/button access
  // 1 = Enable Buy and Sell, Disable Store
  // 2 = Enable Store, Disable Buy and Sell
  // 3 = Enable AI Services
  clientFetch?: number;
  // Explicit permission flags derived from clientFetch
  allowBuy?: boolean;
  allowSell?: boolean;
  allowStore?: boolean;
  allowAI?: boolean;
}

export const routesApi = {
  /**
   * Get routes filtered by device company from fm_tanks table
   */
  getByDevice: async (uniquedevcode: string): Promise<ApiResponse<Route[]>> => {
    return apiRequest<Route[]>(`/routes/by-device/${encodeURIComponent(uniquedevcode)}`);
  },
};

// ==================== FARMERS API ====================

export interface Farmer {
  farmer_id: string;
  name: string;
  route: string;
  multOpt?: number; // 0 = single delivery per session, 1 = multiple allowed
  currqty?: number; // 0 = hide monthly cumulative on receipt, 1 = show monthly cumulative
  crbal?: string; // Credit balance string from cm_members e.g. "CR02#11200,CR22#340"
  ccode?: string; // Credit code for filtering credit entries
  created_at?: string;
  updated_at?: string;
}

export interface CreditType {
  crcode: string;
  descript: string;
}

export const farmersApi = {
  /**
   * Get farmers filtered by device company (secure device-based filtering)
   * @param uniquedevcode - Device fingerprint for authorization
   * @param route - Exact route code filter (for chkroute=1)
   * @param mprefix - Member prefix filter from fm_tanks (for chkroute=0)
   */
  getByDevice: async (uniquedevcode: string, route?: string, mprefix?: string): Promise<ApiResponse<Farmer[]>> => {
    let url = `/farmers/by-device/${encodeURIComponent(uniquedevcode)}`;
    const params: string[] = [];
    if (route) {
      params.push(`route=${encodeURIComponent(route)}`);
    }
    if (mprefix) {
      params.push(`mprefix=${encodeURIComponent(mprefix)}`);
    }
    if (params.length > 0) {
      url += `?${params.join('&')}`;
    }
    return apiRequest<Farmer[]>(url);
  },

  /**
   * Get all farmers (kept for backward compatibility)
   */
  getAll: async (): Promise<Farmer[]> => {
    const response = await apiRequest<Farmer[]>('/farmers');
    return response.data || [];
  },

  /**
   * Get farmer by ID
   */
  getById: async (farmerId: string): Promise<Farmer | null> => {
    const response = await apiRequest<Farmer>(`/farmers/${farmerId}`);
    return response.data || null;
  },

  /**
   * Search farmers by name or ID
   */
  search: async (query: string): Promise<Farmer[]> => {
    const response = await apiRequest<Farmer[]>(`/farmers?search=${encodeURIComponent(query)}`);
    return response.data || [];
  },

  /**
   * Create new farmer
   */
  create: async (farmer: Omit<Farmer, 'created_at' | 'updated_at'>): Promise<Farmer | null> => {
    const response = await apiRequest<Farmer>('/farmers', {
      method: 'POST',
      body: JSON.stringify(farmer),
    });
    return response.data || null;
  },

  /**
   * Update farmer
   */
  update: async (farmerId: string, farmer: Partial<Farmer>): Promise<Farmer | null> => {
    const response = await apiRequest<Farmer>(`/farmers/${farmerId}`, {
      method: 'PUT',
      body: JSON.stringify(farmer),
    });
    return response.data || null;
  },

  /**
   * Delete farmer
   */
  delete: async (farmerId: string): Promise<boolean> => {
    const response = await apiRequest(`/farmers/${farmerId}`, {
      method: 'DELETE',
    });
    return response.success;
  },
};

// ==================== MILK COLLECTION API ====================

// DB Column Mapping for transactions table (Transtype = 1):
// Frontend field → DB column
// reference_no → transrefno
// uploadrefno → Uploadrefno  
// farmer_id → memberno
// farmer_name → (not stored, derived from cm_members.descript)
// route → route
// session → session (AM/PM for dairy, season name for coffee)
// weight → weight
// user_id → userId (login user_id)
// clerk_name → clerk (display name/username)
// collection_date → transdate

export interface MilkCollection {
  id?: number;
  reference_no?: string;      // → DB: transrefno
  uploadrefno?: string;       // → DB: Uploadrefno - Formatted reference (devcode + milkId)
  farmer_id: string;          // → DB: memberno
  farmer_name: string;        // → Not stored, derived from cm_members
  route: string;              // → DB: route
  session: string;            // → DB: session - AM/PM for dairy, season name for coffee
  weight: number;             // → DB: weight (net weight for coffee, total weight for dairy)
  user_id?: string;           // → DB: userId (login user_id for tracking)
  clerk_name: string;         // → DB: clerk (display name/username)
  collection_date: Date | string; // → DB: transdate
  created_at?: string;
  updated_at?: string;
  /**
   * Snapshot of member multOpt at the time of capture (optional; used for client-side rules).
   */
  multOpt?: number;
  orderId?: number;
  synced?: boolean;
  device_fingerprint?: string; // → DB: deviceserial
  // Product info (from fm_items, invtype=01)
  product_code?: string;      // → DB: icode
  product_name?: string;      // → Not stored, derived from fm_items.descript
  // Entry type: 'scale' for Bluetooth scale readings, 'manual' for manual input
  entry_type?: 'scale' | 'manual';
  // Season SCODE from sessions table - saved to transactions.CAN column
  season_code?: string;       // → DB: CAN (stores session.SCODE for all orgtypes)
  // Coffee sack weighing - gross/tare/net (orgtype C only)
  gross_weight?: number;      // Gross weight from scale (before sack deduction)
  tare_weight?: number;       // Fixed sack weight (1 kg per sack)
  net_weight?: number;        // Calculated: gross_weight - tare_weight
}

export const milkCollectionApi = {
  /**
   * Generate next reference number for milk collection
   */
  getNextReference: async (deviceFingerprint: string) => {
    return apiRequest<{ reference_no: string }>('/milk-collection/next-reference', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_fingerprint: deviceFingerprint }),
    });
  },

  /**
   * Get all milk collections with optional filters
   */
  getAll: async (filters?: {
    farmerId?: string;
    session?: string;
    dateFrom?: string;
    dateTo?: string;
  }): Promise<MilkCollection[]> => {
    let url = '/milk-collection';
    const params = new URLSearchParams();

    if (filters?.farmerId) params.append('farmer_id', filters.farmerId);
    if (filters?.session) params.append('session', filters.session);
    if (filters?.dateFrom) params.append('date_from', filters.dateFrom);
    if (filters?.dateTo) params.append('date_to', filters.dateTo);

    if (params.toString()) url += `?${params.toString()}`;

    const response = await apiRequest<MilkCollection[]>(url);
    return response.data || [];
  },

  /**
   * Get milk collection by reference number
   */
  getByReference: async (referenceNo: string): Promise<MilkCollection | null> => {
    const response = await apiRequest<MilkCollection>(`/milk-collection/${referenceNo}`);
    return response.data || null;
  },

  /**
   * Get milk collections by farmer ID, session, and date range
   * Now includes uniquedevcode to filter by ccode for proper accumulation
   */
  getByFarmerSessionDate: async (
    farmerId: string,
    session: string,
    dateFrom: string,
    dateTo: string,
    uniquedevcode?: string
  ): Promise<MilkCollection | null> => {
    let url = `/milk-collection?farmer_id=${farmerId}&session=${session}&date_from=${dateFrom}&date_to=${dateTo}`;
    if (uniquedevcode) {
      url += `&uniquedevcode=${encodeURIComponent(uniquedevcode)}`;
    }
    const response = await apiRequest<MilkCollection>(url);
    const data = response.data;
    // API returns array, we need single record
    return Array.isArray(data) && data.length > 0 ? data[0] : null;
  },

  /**
   * Create new milk collection
   * Returns both success status and the final reference number (may differ if backend regenerated it)
   * Also returns error details for duplicate session delivery cases
   */
  create: async (collection: Omit<MilkCollection, 'id' | 'created_at' | 'updated_at'>): Promise<{ 
    success: boolean; 
    reference_no?: string;
    uploadrefno?: string;
    error?: string;
    message?: string;
    existing_reference?: string;
  }> => {
    const response = await apiRequest<{ reference_no: string; uploadrefno?: string; existing_reference?: string }>('/milk-collection', {
      method: 'POST',
      body: JSON.stringify(collection),
    });
    return { 
      success: response.success || false,
      reference_no: response.data?.reference_no || collection.reference_no,
      uploadrefno: response.data?.uploadrefno || collection.uploadrefno,
      error: response.error,
      message: response.message,
      existing_reference: response.data?.existing_reference
    };
  },

  /**
   * Update milk collection (for weight accumulation)
   * CRITICAL: device_fingerprint is required to ensure updates only affect records for the correct ccode
   */
  update: async (
    referenceNo: string, 
    updates: { weight: number; collection_date?: Date | string; device_fingerprint: string }
  ): Promise<boolean> => {
    const response = await apiRequest<any>(`/milk-collection/${referenceNo}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    });
    return response.success || false;
  },

  /**
   * Delete milk collection
   */
  delete: async (referenceNo: string): Promise<boolean> => {
    const response = await apiRequest(`/milk-collection/${referenceNo}`, {
      method: 'DELETE',
    });
    return response.success;
  },
};

// ==================== APPROVED DEVICES API ====================

export interface ApprovedDevice {
  id: number;
  device_fingerprint: string;
  user_id: string;
  approved: boolean;
  device_info?: string;
  last_sync?: string;
  created_at?: string;
  updated_at?: string;
  approved_at?: string;
  ccode?: string;
  uniquedevcode?: string;
  company_name?: string;
  devcode?: string; // Device code prefix for transaction references (e.g., AG05)
  trnid?: number;   // Last used transaction ID for this device
  milkid?: number;  // Last used milk transaction ID
  storeid?: number; // Last used store transaction ID
  aiid?: number;    // Last used AI transaction ID
}

export const devicesApi = {
  /**
   * Get all devices
   */
  getAll: async (): Promise<ApiResponse<ApprovedDevice[]>> => {
    return apiRequest<ApprovedDevice[]>('/devices');
  },

  /**
   * Get device by fingerprint with fallback for old backend
   */
  getByFingerprint: async (fingerprint: string): Promise<ApprovedDevice | null> => {
    const response = await apiRequest<ApprovedDevice>(`/devices/fingerprint/${encodeURIComponent(fingerprint)}`);
    
    // If old backend error, return null and let caller handle with cached data
    if (!response.success && response.details?.includes('outdated version')) {
      console.warn('[FALLBACK] Using cached device data due to old backend');
      return null;
    }
    
    return response.data || null;
  },

  /**
   * Get device by ID
   */
  getById: async (deviceId: number): Promise<ApprovedDevice | null> => {
    const response = await apiRequest<ApprovedDevice>(`/devices/${deviceId}`);
    return response.data || null;
  },

  /**
   * Register new device (backend generates ID) with fallback handling
   * Returns the device if successful, or a "pending" placeholder if old backend fails
   */
  register: async (device: {
    device_fingerprint: string;
    user_id: string;
    approved: boolean;
    device_info?: string;
  }): Promise<ApprovedDevice | null> => {
    const response = await apiRequest<ApprovedDevice>('/devices', {
      method: 'POST',
      body: JSON.stringify(device),
    });
    
    // If old backend error, return a pending placeholder so app can continue
    if (!response.success && response.details?.includes('outdated version')) {
      console.warn('[FALLBACK] Device registration failed due to old backend, returning pending state');
      // Store in localStorage that we attempted registration
      try {
        const pendingDevices = JSON.parse(localStorage.getItem('pending_device_registrations') || '[]');
        if (!pendingDevices.includes(device.device_fingerprint)) {
          pendingDevices.push(device.device_fingerprint);
          localStorage.setItem('pending_device_registrations', JSON.stringify(pendingDevices));
        }
      } catch (e) {
        console.error('Failed to store pending device registration:', e);
      }
      
      // Return a pending device object
      return {
        id: 0,
        device_fingerprint: device.device_fingerprint,
        user_id: device.user_id,
        approved: false,
        device_info: device.device_info,
      };
    }
    
    return response.data || null;
  },

  /**
   * Update device status by ID
   */
  update: async (deviceId: number, updates: { approved?: boolean; user_id?: string }): Promise<ApprovedDevice | null> => {
    const response = await apiRequest<ApprovedDevice>(`/devices/${deviceId}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    });
    return response.data || null;
  },

  /**
   * Delete device by ID
   */
  delete: async (deviceId: number): Promise<boolean> => {
    const response = await apiRequest(`/devices/${deviceId}`, {
      method: 'DELETE',
    });
    return response.success;
  },

  /**
   * Approve or reject device
   */
  approve: async (deviceId: number, approved: boolean, approvedAt?: string): Promise<ApiResponse<ApprovedDevice>> => {
    return apiRequest<ApprovedDevice>(`/devices/${deviceId}/approve`, {
      method: 'PUT',
      body: JSON.stringify({ approved, approved_at: approvedAt }),
    });
  },
  
  /**
   * Check if there are pending device registrations that need retry
   */
  hasPendingRegistrations: (): boolean => {
    try {
      const pending = JSON.parse(localStorage.getItem('pending_device_registrations') || '[]');
      return pending.length > 0;
    } catch {
      return false;
    }
  },
  
  /**
   * Clear pending registration for a fingerprint (call after successful registration)
   */
  clearPendingRegistration: (fingerprint: string): void => {
    try {
      const pending = JSON.parse(localStorage.getItem('pending_device_registrations') || '[]');
      const updated = pending.filter((f: string) => f !== fingerprint);
      localStorage.setItem('pending_device_registrations', JSON.stringify(updated));
    } catch (e) {
      console.error('Failed to clear pending device registration:', e);
    }
  },
};

// ==================== Z-REPORT API ====================

export interface ZReportData {
  date: string;
  totals: {
    liters: number;
    farmers: number;
    entries: number;
  };
  byRoute: {
    [route: string]: {
      AM: MilkCollection[];
      PM: MilkCollection[];
      total: number;
    };
  };
  bySession: {
    AM: {
      entries: number;
      liters: number;
    };
    PM: {
      entries: number;
      liters: number;
    };
  };
  byCollector: {
    [collector: string]: {
      farmers: number;
      entries: number;
      liters: number;
    };
  };
  collections: MilkCollection[];
}

// Device-specific Z Report data structure (matches handwritten layout)
export interface DeviceZReportTransaction {
  transrefno: string;
  refno: string;          // Short ref number for display
  farmer_id: string;
  weight: number;
  time: string;           // HH:MM AM/PM format
  session: string;
  route?: string;         // Route/center code for grouping
  route_name?: string;    // Full route/center description from fm_tanks.descript
  product_code?: string;  // Product code for produce grouping
  product_name?: string;  // Product name from fm_items.descript
}

export interface DeviceZReportData {
  date: string;
  deviceCode: string;     // Device code shown in header/footer
  companyName: string;    // Company name header
  produceLabel: string;   // "MILK" or "COFFEE"
  produceName?: string;   // Specific produce name (e.g., "CHERRY")
  periodLabel: string;    // "Season" or "Session"
  seasonName: string;     // Season/session name
  routeLabel: string;     // "Route" or "Center"
  clerkName: string;      // Collector/clerk name
  totals: {
    weight: number;
    entries: number;
    farmers: number;
  };
  transactions: DeviceZReportTransaction[];
  isCoffee: boolean;      // For weight unit display
}

export const zReportApi = {
  /**
   * Get Z Report for a specific date (legacy - company-wide)
   */
  get: async (date: string, uniquedevcode: string): Promise<ZReportData | null> => {
    const response = await apiRequest<ZReportData>(`/z-report?date=${date}&uniquedevcode=${encodeURIComponent(uniquedevcode)}`);
    return response.data || null;
  },

  /**
   * Get device-specific Z Report (per device, not mixed)
   * Filters by deviceserial (device code) and date
   */
  getByDevice: async (date: string, uniquedevcode: string, seasonCode?: string): Promise<DeviceZReportData | null> => {
    let url = `/z-report/device?date=${date}&uniquedevcode=${encodeURIComponent(uniquedevcode)}`;
    if (seasonCode) {
      url += `&season=${encodeURIComponent(seasonCode)}`;
    }
    const response = await apiRequest<DeviceZReportData>(url);
    return response.data || null;
  },

};

// ==================== ITEMS API ====================

export interface Item {
  ID: number;
  icode: string;
  descript: string;
  sprice: number;
  mprice: number;
  stockbal: number;
  ccode?: string;
  sellable: number;
  invtype?: string; // '01' = produce (milk, cherry), '05' = store items, '06' = AI items
}

export const itemsApi = {
  /**
   * Get all sellable items filtered by device and optionally by invtype
   * @param uniquedevcode - Device code
   * @param invtype - Optional item type filter: '01' = produce, '05' = store, '06' = AI
   */
  getAll: async (uniquedevcode: string, invtype?: string): Promise<ApiResponse<Item[]>> => {
    let url = `/items?uniquedevcode=${encodeURIComponent(uniquedevcode)}`;
    if (invtype) {
      url += `&invtype=${encodeURIComponent(invtype)}`;
    }
    return apiRequest<Item[]>(url);
  }
};

// ==================== SALES API ====================

export interface Sale {
  id?: number;
  sale_ref?: string;
  transrefno?: string;  // Frontend-generated reference (same format as Buy) → DB: transrefno
  uploadrefno?: string; // Frontend-generated type-specific ID → DB: Uploadrefno
  transtype?: number;   // 2 = Store, 3 = AI → DB: Transtype
  farmer_id: string;    // → DB: memberno
  farmer_name: string;  // → Not stored, used for display
  route?: string;       // → DB: route (fm_tanks.tcode or farmer route)
  item_code: string;    // → DB: icode
  item_name: string;    // → Not stored, derived from icode
  quantity: number;     // → DB: weight
  price: number;        // → DB: iprice
  total_amount?: number; // → DB: amount
  user_id?: string;     // → DB: userId (login user_id for tracking)
  sold_by: string;      // → DB: clerk (display name/username)
  sale_date?: string;   // → DB: transdate
  remarks?: string;
  device_fingerprint?: string; // → DB: deviceserial
  photo?: string;       // Base64 encoded buyer photo for theft prevention
  season?: string;      // → DB: CAN (session.SCODE for all orgtypes)
  // AI-specific fields (mapped to DB columns):
  // Frontend field → DB column
  cow_name?: string;          // → DB: cowname
  cow_breed?: string;         // → DB: cowbreed
  number_of_calves?: string;  // → DB: noofcalfs
  other_details?: string;     // → DB: aibreed
}

export interface BatchSaleRequest {
  uploadrefno: string;
  transtype: number;
  farmer_id: string;
  farmer_name: string;
  route?: string;       // → DB: route (fm_tanks.tcode or farmer route)
  user_id?: string;     // → DB: userId (login user_id for tracking)
  sold_by: string;      // → DB: clerk (display name/username)
  device_fingerprint: string;
  photo?: string;  // ONE photo for entire batch
  season?: string; // → DB: CAN (session.SCODE for all orgtypes)
  items: Array<{
    transrefno: string;  // Unique per item
    item_code: string;
    item_name: string;
    quantity: number;
    price: number;
  }>;
}

export interface BatchSaleResponse {
  success: boolean;
  message?: string;
  uploadrefno?: string;
  transrefnos?: string[];
  photo_saved?: boolean;
  photo_path?: string;
  error?: string;
}

export const salesApi = {
  /**
   * Create a new sale (Store transtype=2, AI transtype=3)
   */
  create: async (sale: Sale): Promise<boolean> => {
    const response = await apiRequest<{ transrefno: string }>('/sales', {
      method: 'POST',
      body: JSON.stringify(sale),
    });
    return response.success;
  },

  /**
   * Create batch sale - ONE photo, MULTIPLE items with unique transrefnos
   * Used by Store for multi-item transactions
   */
  createBatch: async (batch: BatchSaleRequest): Promise<BatchSaleResponse> => {
    const response = await apiRequest<BatchSaleResponse>('/sales/batch', {
      method: 'POST',
      body: JSON.stringify(batch),
    });
    return {
      success: response.success,
      message: response.data?.message || response.error,
      uploadrefno: response.data?.uploadrefno,
      transrefnos: response.data?.transrefnos,
      photo_saved: response.data?.photo_saved,
      photo_path: response.data?.photo_path,
      error: response.error,
    };
  },

  /**
   * Get all sales with optional filters
   */
  getAll: async (filters?: { farmer_id?: string; date_from?: string; date_to?: string }): Promise<Sale[]> => {
    const params = new URLSearchParams();
    if (filters?.farmer_id) params.append('farmer_id', filters.farmer_id);
    if (filters?.date_from) params.append('date_from', filters.date_from);
    if (filters?.date_to) params.append('date_to', filters.date_to);
    
    const url = params.toString() ? `/sales?${params.toString()}` : '/sales';
    const response = await apiRequest<Sale[]>(url);
    return response.data || [];
  }
};

// ============= Periodic Report API =============
export interface PeriodicReportData {
  farmer_id: string;
  farmer_name: string;
  route: string;
  total_weight: number;
  collection_count: number;
}

export interface FarmerDetailReportData {
  company_name: string;
  farmer_id: string;
  farmer_name: string;
  farmer_route: string;
  produce_name: string;
  start_date: string;
  end_date: string;
  total_weight: number;
  transactions: Array<{
    date: string;
    rec_no: string;
    quantity: number;
    time: string;
  }>;
}

const periodicReportApi = {
  async get(startDate: string, endDate: string, uniquedevcode: string, farmerSearch?: string): Promise<ApiResponse<PeriodicReportData[]>> {
    let endpoint = `/periodic-report?start_date=${encodeURIComponent(startDate)}&end_date=${encodeURIComponent(endDate)}&uniquedevcode=${encodeURIComponent(uniquedevcode)}`;
    if (farmerSearch) {
      endpoint += `&farmer_search=${encodeURIComponent(farmerSearch)}`;
    }
    return apiRequest<PeriodicReportData[]>(endpoint);
  },
  
  async getFarmerDetail(startDate: string, endDate: string, farmerId: string, uniquedevcode: string): Promise<ApiResponse<FarmerDetailReportData>> {
    const endpoint = `/periodic-report/farmer-detail?start_date=${encodeURIComponent(startDate)}&end_date=${encodeURIComponent(endDate)}&farmer_id=${encodeURIComponent(farmerId)}&uniquedevcode=${encodeURIComponent(uniquedevcode)}`;
    return apiRequest<FarmerDetailReportData>(endpoint);
  },
};

// ==================== AUTHENTICATION API ====================

export interface AuthUser {
  user_id: string;
  username?: string;
  email?: string;
  ccode?: string;
  admin?: boolean;
  supervisor?: boolean;
  dcode?: string;
  groupid?: string;
  depart?: string;
}

export const authApi = {
  /**
   * Login with userid and password
   */
  login: async (userid: string, password: string): Promise<ApiResponse<AuthUser>> => {
    return apiRequest<AuthUser>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ userid, password }),
    });
  },
};

// ==================== FARMER FREQUENCY API ====================

export interface FarmerMonthlyFrequency {
  farmer_id: string;
  frequency?: number; // Deprecated: kept for backwards compatibility
  cumulative_weight: number; // Total weight sum for the month
  month_start: string;
  month_end: string;
}

export const farmerFrequencyApi = {
  /**
   * Get farmer's monthly cumulative frequency (collection count for current month)
   */
  getMonthlyFrequency: async (farmerId: string, uniquedevcode: string): Promise<ApiResponse<FarmerMonthlyFrequency>> => {
    return apiRequest<FarmerMonthlyFrequency>(
      `/farmer-monthly-frequency?farmer_id=${encodeURIComponent(farmerId)}&uniquedevcode=${encodeURIComponent(uniquedevcode)}`
    );
  },
};

// Export all APIs
export const mysqlApi = {
  auth: authApi,
  farmers: farmersApi,
  milkCollection: milkCollectionApi,
  devices: devicesApi,
  zReport: zReportApi,
  items: itemsApi,
  sales: salesApi,
  periodicReport: periodicReportApi,
  routes: routesApi,
  sessions: sessionsApi,
  farmerFrequency: farmerFrequencyApi,
};
