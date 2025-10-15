// API Configuration for cPanel MySQL Backend
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

// API helper functions
const api = {
  get: async (endpoint: string) => {
    const response = await fetch(`${API_URL}${endpoint}`);
    if (!response.ok) throw new Error(`API error: ${response.statusText}`);
    return response.json();
  },
  
  post: async (endpoint: string, data: any) => {
    const response = await fetch(`${API_URL}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!response.ok) throw new Error(`API error: ${response.statusText}`);
    return response.json();
  },
};

// Query builder to match Supabase interface
class QueryBuilder implements PromiseLike<{ data: any; error: any }> {
  public table: string;
  public filterData: any = {};
  public updateData: any = null;
  
  constructor(table: string) {
    this.table = table;
  }
  
  select(columns: string = '*') {
    return this;
  }
  
  eq(column: string, value: any) {
    this.filterData[column] = value;
    return this;
  }
  
  or(filter: string) {
    // Simplified OR filter support
    return this;
  }
  
  gte(column: string, value: any) {
    this.filterData[`${column}_gte`] = value;
    return this;
  }
  
  lte(column: string, value: any) {
    this.filterData[`${column}_lte`] = value;
    return this;
  }
  
  limit(count: number) {
    this.filterData._limit = count;
    return this;
  }
  
  order(column: string, options?: any) {
    return this;
  }
  
  maybeSingle(): Promise<{ data: any; error: any }> {
    return this.executeQuery().then(result => {
      if (result.data && result.data.length > 0) {
        return { data: result.data[0], error: null };
      }
      return { data: null, error: null };
    });
  }
  
  single(): Promise<{ data: any; error: any }> {
    return this.maybeSingle();
  }
  
  // Make the QueryBuilder thenable (promise-like)
  then<TResult1 = { data: any; error: any }, TResult2 = never>(
    onfulfilled?: ((value: { data: any; error: any }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return this.executeQuery().then(onfulfilled, onrejected);
  }
  
  private async executeQuery(): Promise<{ data: any; error: any }> {
    if (this.table === 'farmers') {
      const data = await api.get('/api/farmers');
      let filtered = data;
      
      // Apply filters
      Object.keys(this.filterData).forEach(key => {
        if (!key.startsWith('_')) {
          filtered = filtered.filter((item: any) => item[key] === this.filterData[key]);
        }
      });
      
      return { data: filtered, error: null };
    }
    
    if (this.table === 'app_users') {
      // This is handled by the login endpoint
      return { data: [], error: null };
    }
    
    if (this.table === 'milk_collection') {
      return { data: [], error: null };
    }
    
    return { data: [], error: null };
  }
}

// Compatibility layer to match old Supabase interface
export const supabase = {
  from: (table: string) => {
    const builder = new QueryBuilder(table);
    return {
      select: (columns: string = '*') => builder.select(columns),
      insert: async (data: any) => {
        if (table === 'milk_collection') {
          const result = await api.post('/api/milk-collection', data);
          return { data: result, error: null };
        }
        return { data: null, error: new Error('Not implemented') };
      },
      update: (data: any) => {
        const updateBuilder = new QueryBuilder(table);
        updateBuilder.updateData = data;
        return updateBuilder;
      },
    };
  },
  
  // Realtime channel (stub for compatibility)
  channel: (name: string) => ({
    on: (event: string, config: any, callback: any) => ({
      subscribe: () => {},
    }),
  }),
  
  removeChannel: (channel: any) => {},
  
  // Authentication methods
  auth: {
    signIn: async ({ email, password }: { email: string; password: string }) => {
      try {
        const user = await api.post('/api/auth/login', { user_id: email, password });
        return { data: { user }, error: null };
      } catch (error: any) {
        return { data: null, error };
      }
    },
  },
};

export interface Farmer {
  farmer_id: string;
  name: string;
  route: string;
  route_name?: string;
}

export interface AppUser {
  user_id: string;
  password?: string;
  role: string;
}

export interface MilkCollection {
  reference_no?: string;
  farmer_id: string;
  farmer_name: string;
  route: string;
  route_name?: string;
  member_route?: string;
  section: string;
  weight: number;
  collected_by: string | null;
  clerk_name: string;
  price_per_liter: number;
  total_amount: number;
  collection_date: Date;
  orderId?: number;
  synced?: boolean;
}
