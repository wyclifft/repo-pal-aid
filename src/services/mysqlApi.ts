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

// ==================== FARMERS API ====================

export interface Farmer {
  farmer_id: string;
  name: string;
  route: string;
  route_name?: string;
  member_route?: string;
  created_at?: string;
  updated_at?: string;
}

export const farmersApi = {
  /**
   * Get all farmers
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
  route_name?: string;
  member_route?: string;
  session: 'AM' | 'PM';
  weight: number;
  collected_by: string | null;
  clerk_name: string;
  price_per_liter: number;
  total_amount: number;
  collection_date: Date | string;
  created_at?: string;
  updated_at?: string;
  orderId?: number;
  synced?: boolean;
}

export const milkCollectionApi = {
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
    const response = await apiRequest<MilkCollection>(`/milk-collection/ref/${referenceNo}`);
    return response.data || null;
  },

  /**
   * Get milk collections by farmer ID, session, and date range
   */
  getByFarmerSessionDate: async (
    farmerId: string,
    session: string,
    dateFrom: string,
    dateTo: string
  ): Promise<MilkCollection | null> => {
    const response = await apiRequest<MilkCollection>(
      `/milk-collection?farmer_id=${farmerId}&session=${session}&date_from=${dateFrom}&date_to=${dateTo}`
    );
    const data = response.data;
    // API returns array, we need single record
    return Array.isArray(data) && data.length > 0 ? data[0] : null;
  },

  /**
   * Create new milk collection
   */
  create: async (collection: Omit<MilkCollection, 'id' | 'created_at' | 'updated_at'>): Promise<MilkCollection | null> => {
    const response = await apiRequest<MilkCollection>('/milk-collection', {
      method: 'POST',
      body: JSON.stringify(collection),
    });
    return response.data || null;
  },

  /**
   * Update milk collection (for weight accumulation)
   */
  update: async (referenceNo: string, updates: { weight: number; collection_date?: Date | string }): Promise<MilkCollection | null> => {
    const response = await apiRequest<MilkCollection>(`/milk-collection/ref/${referenceNo}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    });
    return response.data || null;
  },

  /**
   * Delete milk collection
   */
  delete: async (referenceNo: string): Promise<boolean> => {
    const response = await apiRequest(`/milk-collection/ref/${referenceNo}`, {
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
}

export const devicesApi = {
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
};

// Export all APIs
export const mysqlApi = {
  farmers: farmersApi,
  milkCollection: milkCollectionApi,
  devices: devicesApi,
};
