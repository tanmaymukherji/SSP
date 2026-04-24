window.SelcoVendorStore = (() => {
  const VENDORS_TABLE = () => (window.APP_CONFIG && window.APP_CONFIG.SELCO_VENDORS_TABLE) || 'selco_vendors';
  const PRODUCTS_TABLE = () => (window.APP_CONFIG && window.APP_CONFIG.SELCO_PRODUCTS_TABLE) || 'selco_products';
  const ADMIN_API_URL = () => `${String(window.APP_CONFIG?.SUPABASE_URL || '').replace(/\/$/, '')}/functions/v1/selco-vendor-admin`;
  let client = null;

  function getClient() {
    if (client) return client;
    const config = window.APP_CONFIG || {};
    if (!config.SUPABASE_URL || !config.SUPABASE_ANON_KEY) throw new Error('Missing Supabase config. Check config.js.');
    if (!window.supabase || typeof window.supabase.createClient !== 'function') throw new Error('Supabase client library failed to load.');
    client = window.supabase.createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY);
    return client;
  }

  async function loadDirectory() {
    const supabase = getClient();
    const [vendorsResult, productsResult] = await Promise.all([
      supabase.from(VENDORS_TABLE()).select('*').order('vendor_name'),
      supabase.from(PRODUCTS_TABLE()).select('*').order('product_name')
    ]);

    if (vendorsResult.error) throw new Error(`Vendor load failed: ${vendorsResult.error.message}`);
    if (productsResult.error) throw new Error(`Product load failed: ${productsResult.error.message}`);

    const products = productsResult.data || [];
    const productsByVendorId = new Map();
    products.forEach((product) => {
      const vendorId = product.portal_vendor_id;
      if (!productsByVendorId.has(vendorId)) productsByVendorId.set(vendorId, []);
      productsByVendorId.get(vendorId).push(product);
    });

    const vendors = (vendorsResult.data || []).map((vendor) => ({
      ...vendor,
      products: productsByVendorId.get(vendor.portal_vendor_id) || []
    }));

    return { vendors, products };
  }

  async function adminRequest(action, payload = {}) {
    const config = window.APP_CONFIG || {};
    const response = await fetch(ADMIN_API_URL(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: String(config.SUPABASE_ANON_KEY || ''),
        Authorization: `Bearer ${String(config.SUPABASE_ANON_KEY || '')}`
      },
      body: JSON.stringify({ action, ...payload })
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(data?.error || 'Admin request failed.');
    return data;
  }

  return { loadDirectory, adminRequest };
})();
