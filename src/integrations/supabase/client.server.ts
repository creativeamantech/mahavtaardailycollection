// Stub server client - Supabase removed, no authentication required
export const supabaseAdmin = {
  auth: {
    getUser: async () => ({ data: { user: null }, error: null }),
  },
};
