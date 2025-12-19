/**
 * MySQL REST API Service
 * Handles all communication with the MySQL backend at https://backend.maddasystems.co.ke/
 */

const API_BASE_URL = 'https://backend.maddasystems.co.ke/api';

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
async function apiRequest<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<ApiResponse<T>> {
  // Check if offline before attempting fetch
  if (!navigator.onLine) {
    console.warn(`[OFFLINE] API request skipped: ${endpoint}`);
    return {
      success: false,
      error: 'No internet connection. Operating in offline mode.',
    };
  }

  try {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

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

    if (!response.ok) {
      throw new Error(data.error || `HTTP error! status: ${response.status}`);
    }

    return data;
  } catch (error) {
    console.error(`API request failed: ${endpoint}`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// ==================== SESSIONS API ====================

export interface Session {
  descript: string;
  time_from: number; // Hour in 24-hour format (0-24)
  time_to: number;   // Hour in 24-hour format (0-24)
  ccode?: string;
}

export const sessionsApi = {
  /**
   * Get all sessions for a device's company
   */
  getByDevice: async (uniquedevcode: string): Promise<ApiResponse<Session[]>> => {
    return apiRequest<Session[]>(`/sessions/by-device/${encodeURIComponent(uniquedevcode)}`);
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
  created_at?: string;
  updated_at?: string;
}

export const farmersApi = {
  /**
   * Get farmers filtered by device company (secure device-based filtering)
   * Optionally filter by route
   */
  getByDevice: async (uniquedevcode: string, route?: string): Promise<ApiResponse<Farmer[]>> => {
    let url = `/farmers/by-device/${encodeURIComponent(uniquedevcode)}`;
    if (route) {
      url += `?route=${encodeURIComponent(route)}`;
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

export interface MilkCollection {
  id?: number;
  reference_no?: string;
  farmer_id: string;
  farmer_name: string;
  route: string;
  session: 'AM' | 'PM';
  weight: number;
  clerk_name: string;
  collection_date: Date | string;
  created_at?: string;
  updated_at?: string;
  orderId?: number;
  synced?: boolean;
  device_fingerprint?: string;
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
   */
  create: async (collection: Omit<MilkCollection, 'id' | 'created_at' | 'updated_at'>): Promise<{ success: boolean; reference_no?: string }> => {
    const response = await apiRequest<{ reference_no: string }>('/milk-collection', {
      method: 'POST',
      body: JSON.stringify(collection),
    });
    return { 
      success: response.success || false,
      reference_no: response.data?.reference_no || collection.reference_no
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
  device_ref?: string; // Unique device reference number (e.g., AE10000001)
}

export const devicesApi = {
  /**
   * Get all devices
   */
  getAll: async (): Promise<ApiResponse<ApprovedDevice[]>> => {
    return apiRequest<ApprovedDevice[]>('/devices');
  },

  /**
   * Get device by fingerprint
   */
  getByFingerprint: async (fingerprint: string): Promise<ApprovedDevice | null> => {
    const response = await apiRequest<ApprovedDevice>(`/devices/fingerprint/${encodeURIComponent(fingerprint)}`);
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
   * Register new device (backend generates ID)
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

export const zReportApi = {
  /**
   * Get Z Report for a specific date
   */
  get: async (date: string, uniquedevcode: string): Promise<ZReportData | null> => {
    const response = await apiRequest<ZReportData>(`/z-report?date=${date}&uniquedevcode=${encodeURIComponent(uniquedevcode)}`);
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
}

export const itemsApi = {
  /**
   * Get all sellable items filtered by device
   */
  getAll: async (uniquedevcode: string): Promise<ApiResponse<Item[]>> => {
    return apiRequest<Item[]>(`/items?uniquedevcode=${encodeURIComponent(uniquedevcode)}`);
  }
};

// ==================== SALES API ====================

export interface Sale {
  id?: number;
  sale_ref?: string;
  farmer_id: string;
  farmer_name: string;
  item_code: string;
  item_name: string;
  quantity: number;
  price: number;
  total_amount?: number;
  sold_by: string;
  sale_date?: string;
  remarks?: string;
  device_fingerprint?: string;
}

export const salesApi = {
  /**
   * Create a new sale
   */
  create: async (sale: Sale): Promise<boolean> => {
    const response = await apiRequest<{ sale_ref: string }>('/sales', {
      method: 'POST',
      body: JSON.stringify(sale),
    });
    return response.success;
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

const periodicReportApi = {
  async get(startDate: string, endDate: string, uniquedevcode: string, farmerSearch?: string): Promise<ApiResponse<PeriodicReportData[]>> {
    let endpoint = `/periodic-report?start_date=${encodeURIComponent(startDate)}&end_date=${encodeURIComponent(endDate)}&uniquedevcode=${encodeURIComponent(uniquedevcode)}`;
    if (farmerSearch) {
      endpoint += `&farmer_search=${encodeURIComponent(farmerSearch)}`;
    }
    return apiRequest<PeriodicReportData[]>(endpoint);
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
  frequency: number;
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
