import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceRoleKey = Deno.env.get("SELCO_VENDOR_SERVICE_ROLE_KEY") ?? "";
const selcoBackendUrl = "https://selcobackend-prod.onrender.com";
let supabaseClient: ReturnType<typeof createClient> | null = null;

function getSupabaseAdmin() {
  if (!supabaseUrl || !serviceRoleKey) throw new Error("Function secrets are not configured.");
  if (supabaseClient) return supabaseClient;
  supabaseClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });
  return supabaseClient;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function errorResponse(message: string, status = 400) {
  return jsonResponse({ error: message }, status);
}

function requireString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeLocalizedText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) return value.map((item) => normalizeLocalizedText(item)).filter(Boolean).join(", ");
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const english = requireString(record.en) || requireString(record.english);
    if (english) return english;
    for (const candidate of Object.values(record)) {
      const normalized = normalizeLocalizedText(candidate);
      if (normalized) return normalized;
    }
  }
  return "";
}

function safeUrl(value: string) {
  if (!value) return "";
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}

function dedupe(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

async function hashToken(token: string) {
  const bytes = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function generateToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function validateSession(token: string) {
  const supabase = getSupabaseAdmin();
  const tokenHash = await hashToken(token);
  const { data, error } = await supabase.from("grameee_admin_sessions").select("id, username, expires_at").eq("token_hash", tokenHash).maybeSingle();
  if (error || !data) return null;
  if (new Date(data.expires_at).getTime() <= Date.now()) {
    await supabase.from("grameee_admin_sessions").delete().eq("id", data.id);
    return null;
  }
  await supabase.from("grameee_admin_sessions").update({ last_used_at: new Date().toISOString() }).eq("id", data.id);
  return data;
}

async function verifyAdminPassword(username: string, password: string) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc("grameee_admin_password_matches", { p_username: username, p_password: password });
  if (error) throw new Error(`Admin password verification failed: ${error.message}`);
  return Boolean(data);
}

async function handleLogin(password: string) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.from("grameee_admin_accounts").select("username, password_hash").eq("username", "admin").maybeSingle();
  if (error) return errorResponse(`Admin account lookup failed: ${error.message}`, 500);
  if (!data?.password_hash) return errorResponse("Admin account does not exist yet.", 401);
  const validPassword = await verifyAdminPassword("admin", password).catch(() => false);
  if (!validPassword) return errorResponse("Invalid admin password.", 401);

  const token = generateToken();
  const tokenHash = await hashToken(token);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  await supabase.from("grameee_admin_sessions").delete().eq("username", "admin");
  const { error: sessionError } = await supabase.from("grameee_admin_sessions").insert({ username: "admin", token_hash: tokenHash, expires_at: expiresAt });
  if (sessionError) return errorResponse("Admin session could not be created.", 500);
  return jsonResponse({ token, username: "admin", expires_at: expiresAt });
}

async function handleVerify(token: string) {
  const session = await validateSession(token);
  return jsonResponse({ valid: Boolean(session), username: session?.username ?? null, expires_at: session?.expires_at ?? null });
}

async function handleLogout(token: string) {
  const supabase = getSupabaseAdmin();
  const tokenHash = await hashToken(token);
  await supabase.from("grameee_admin_sessions").delete().eq("token_hash", tokenHash);
  return jsonResponse({ ok: true });
}

async function fetchJson(url: string) {
  const response = await fetch(url, { headers: { "User-Agent": "Selco Vendor Directory/1.0", Accept: "application/json" } });
  if (!response.ok) throw new Error(`Fetch failed for ${url}: ${response.status}`);
  return await response.json();
}

async function fetchAllSelcoVendors() {
  const firstPage = await fetchJson(`${selcoBackendUrl}/api/public/vendors?page=1&limit=100&sort_by=createdAt&sort_order=desc`);
  const items = [...(Array.isArray(firstPage?.data) ? firstPage.data : [])];
  const totalPages = Number(firstPage?.pagination?.totalPages || 1);
  for (let page = 2; page <= totalPages; page += 1) {
    const nextPage = await fetchJson(`${selcoBackendUrl}/api/public/vendors?page=${page}&limit=100&sort_by=createdAt&sort_order=desc`);
    items.push(...(Array.isArray(nextPage?.data) ? nextPage.data : []));
  }
  return items;
}

async function fetchAllSelcoProducts() {
  const firstPage = await fetchJson(`${selcoBackendUrl}/api/public/products?page=1&limit=100`);
  const items = [...(Array.isArray(firstPage?.items) ? firstPage.items : [])];
  const total = Number(firstPage?.total || items.length);
  const totalPages = Math.max(1, Math.ceil(total / 100));
  for (let page = 2; page <= totalPages; page += 1) {
    const nextPage = await fetchJson(`${selcoBackendUrl}/api/public/products?page=${page}&limit=100`);
    items.push(...(Array.isArray(nextPage?.items) ? nextPage.items : []));
  }
  return items;
}

async function scrapeContactDetails(websiteUrl: string) {
  if (!websiteUrl) return { websiteEmail: "", websitePhone: "", websiteAddress: "", contactSourceUrl: "", websiteStatus: "No website" };
  try {
    const response = await fetch(websiteUrl, { headers: { "User-Agent": "Selco Vendor Directory/1.0", Accept: "text/html" } });
    if (!response.ok) return { websiteEmail: "", websitePhone: "", websiteAddress: "", contactSourceUrl: websiteUrl, websiteStatus: `Website fetch failed: ${response.status}` };
    const html = await response.text();
    const text = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    const emailMatches = dedupe(Array.from(text.matchAll(/\b[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}\b/gi)).map((match) => match[0]));
    const phoneMatches = dedupe(Array.from(text.matchAll(/(?<!\d)(?:\+?\d[\d()\-\s]{7,}\d)/g)).map((match) => match[0]).filter((value) => value.replace(/\D/g, "").length >= 8));
    const addressMatch = text.match(/(?:address|registered office|head office|corporate office)[^.:]*[:.-]?\s*([^|]{20,220})/i);
    return {
      websiteEmail: emailMatches.slice(0, 3).join("; "),
      websitePhone: phoneMatches.slice(0, 3).join("; "),
      websiteAddress: requireString(addressMatch?.[1]),
      contactSourceUrl: response.url,
      websiteStatus: emailMatches.length || phoneMatches.length || addressMatch ? "OK" : "Website reachable, no contact details extracted",
    };
  } catch {
    return { websiteEmail: "", websitePhone: "", websiteAddress: "", contactSourceUrl: websiteUrl, websiteStatus: "Website fetch failed" };
  }
}

function buildVendorTags(vendor: Record<string, unknown>, products: Record<string, unknown>[]) {
  return dedupe([
    normalizeLocalizedText(vendor.vendor_type),
    ...((vendor.service_locations as unknown[]) || []).map((item) => normalizeLocalizedText(item)),
    ...products.map((product) => normalizeLocalizedText(product.name)),
    ...products.flatMap((product) => (Array.isArray(product.features) ? product.features.map((item) => normalizeLocalizedText(item)) : [])),
  ]);
}

async function mapInBatches<T, R>(items: T[], batchSize: number, worker: (item: T) => Promise<R>) {
  const results: R[] = [];
  for (let index = 0; index < items.length; index += batchSize) {
    const batch = items.slice(index, index + batchSize);
    const batchResults = await Promise.all(batch.map((item) => worker(item)));
    results.push(...batchResults);
  }
  return results;
}

async function handleListSelcoSyncRuns(token: string) {
  const supabase = getSupabaseAdmin();
  const session = await validateSession(token);
  if (!session) return errorResponse("Invalid admin session.", 401);
  const { data, error } = await supabase.from("selco_vendor_sync_runs").select("*").order("created_at", { ascending: false }).limit(10);
  if (error) return errorResponse("Selco sync runs could not be loaded.", 500);
  return jsonResponse({ items: data ?? [] });
}

async function handleSyncSelcoVendors(token: string) {
  const supabase = getSupabaseAdmin();
  const session = await validateSession(token);
  if (!session) return errorResponse("Invalid admin session.", 401);

  const { data: runData, error: runError } = await supabase.from("selco_vendor_sync_runs").insert({ status: "running", requested_by: session.username, started_at: new Date().toISOString() }).select("id").single();
  if (runError || !runData?.id) return errorResponse("Selco sync run could not be created.", 500);
  const runId = String(runData.id);

  try {
    const [vendors, products] = await Promise.all([fetchAllSelcoVendors(), fetchAllSelcoProducts()]);
    const productsByVendor = new Map<string, Record<string, unknown>[]>();
    const scrapedByVendorId = new Map<string, Awaited<ReturnType<typeof scrapeContactDetails>>>();
    for (const product of products as Record<string, unknown>[]) {
      const vendorValue = product.vendorId;
      const vendorId = typeof vendorValue === "object" && vendorValue ? requireString((vendorValue as Record<string, unknown>)._id) : requireString(vendorValue);
      if (!vendorId) continue;
      if (!productsByVendor.has(vendorId)) productsByVendor.set(vendorId, []);
      productsByVendor.get(vendorId)?.push(product);
    }

    await mapInBatches(vendors as Record<string, unknown>[], 8, async (vendor) => {
      const portalVendorId = requireString(vendor._id);
      const websiteDetails = safeUrl(requireString(vendor.website_url) || requireString(vendor.website));
      const scraped = await scrapeContactDetails(websiteDetails);
      scrapedByVendorId.set(portalVendorId, scraped);
      return scraped;
    });

    const vendorRows = [];
    for (const vendor of vendors as Record<string, unknown>[]) {
      const portalVendorId = requireString(vendor._id);
      const relatedProducts = productsByVendor.get(portalVendorId) || [];
      const websiteDetails = safeUrl(requireString(vendor.website_url) || requireString(vendor.website));
      const scraped = scrapedByVendorId.get(portalVendorId) || await scrapeContactDetails(websiteDetails);
      const serviceLocations = dedupe(((vendor.service_locations as unknown[]) || []).map((item) => normalizeLocalizedText(item)));
      const locationText = dedupe([normalizeLocalizedText(vendor.city), normalizeLocalizedText(vendor.state), normalizeLocalizedText(vendor.country)]).join(", ");
      const tags = buildVendorTags(vendor, relatedProducts);
      const finalEmail = scraped.websiteEmail || requireString(vendor.email_address) || requireString(vendor.email_of_poc);
      const finalPhone = scraped.websitePhone || requireString(vendor.phone);
      vendorRows.push({
        portal_vendor_id: portalVendorId,
        vendor_name: normalizeLocalizedText(vendor.name),
        about_vendor: normalizeLocalizedText(vendor.description),
        website_details: websiteDetails || null,
        location_text: locationText || null,
        city: normalizeLocalizedText(vendor.city) || null,
        state: normalizeLocalizedText(vendor.state) || null,
        country: normalizeLocalizedText(vendor.country) || null,
        service_locations: serviceLocations,
        tags,
        portal_vendor_link: portalVendorId ? `https://solutionsportal.org/en/vendors/${portalVendorId}` : null,
        portal_contact_name: normalizeLocalizedText(vendor.point_of_contact) || null,
        portal_email: requireString(vendor.email_address) || requireString(vendor.email_of_poc) || null,
        portal_phone: requireString(vendor.phone) || null,
        website_email: scraped.websiteEmail || null,
        website_phone: scraped.websitePhone || null,
        website_address: scraped.websiteAddress || null,
        final_contact_email: finalEmail || null,
        final_contact_phone: finalPhone || null,
        final_contact_address: scraped.websiteAddress || null,
        contact_source_url: scraped.contactSourceUrl || null,
        website_status: scraped.websiteStatus || null,
        products_count: relatedProducts.length,
        search_text: dedupe([normalizeLocalizedText(vendor.name), normalizeLocalizedText(vendor.description), locationText, ...serviceLocations, ...tags, ...relatedProducts.flatMap((product) => [normalizeLocalizedText(product.name), normalizeLocalizedText(product.product_description)])]).join(" "),
        raw_vendor: vendor,
        synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    }

    const productRows = (products as Record<string, unknown>[]).map((product) => {
      const vendorValue = product.vendorId;
      const portalVendorId = typeof vendorValue === "object" && vendorValue ? requireString((vendorValue as Record<string, unknown>)._id) : requireString(vendorValue);
      const productName = normalizeLocalizedText(product.name);
      const productDescription = normalizeLocalizedText(product.product_description);
      const tags = dedupe([...(Array.isArray(product.features) ? product.features.map((item) => normalizeLocalizedText(item)) : []), ...(Array.isArray(product.specifications) ? product.specifications.map((item) => normalizeLocalizedText((item as Record<string, unknown>).key)) : [])]);
      return {
        portal_product_id: requireString(product._id),
        portal_vendor_id: portalVendorId,
        vendor_name: normalizeLocalizedText((vendorValue as Record<string, unknown>)?.name) || "Unknown Vendor",
        product_name: productName,
        product_description: productDescription || null,
        product_link: product._id ? `https://solutionsportal.org/en/products/${requireString(product._id)}` : null,
        tags,
        search_text: dedupe([productName, productDescription, ...tags]).join(" "),
        raw_product: product,
        synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
    }).filter((row) => row.portal_product_id && row.portal_vendor_id);

    const { error: vendorError } = await supabase.from("selco_vendors").upsert(vendorRows, { onConflict: "portal_vendor_id" });
    if (vendorError) throw new Error(`Vendor upsert failed: ${vendorError.message}`);
    const { error: productError } = await supabase.from("selco_products").upsert(productRows, { onConflict: "portal_product_id" });
    if (productError) throw new Error(`Product upsert failed: ${productError.message}`);

    await supabase.from("selco_vendor_sync_runs").update({ status: "success", finished_at: new Date().toISOString(), vendor_count: vendorRows.length, product_count: productRows.length, updated_at: new Date().toISOString() }).eq("id", runId);
    return jsonResponse({ ok: true, vendorCount: vendorRows.length, productCount: productRows.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Selco vendor sync failed.";
    await supabase.from("selco_vendor_sync_runs").update({ status: "failed", finished_at: new Date().toISOString(), error_message: message, updated_at: new Date().toISOString() }).eq("id", runId);
    return errorResponse(message, 500);
  }
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return errorResponse("Method not allowed.", 405);
  if (!supabaseUrl || !serviceRoleKey) return errorResponse("Function secrets are not configured.", 500);

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return errorResponse("Invalid JSON body.", 400); }

  const action = requireString(body.action);
  const token = requireString(body.token);
  const password = requireString(body.password);

  switch (action) {
    case "login":
      return await handleLogin(password);
    case "verify":
      return await handleVerify(token);
    case "logout":
      return await handleLogout(token);
    case "listSelcoSyncRuns":
      return await handleListSelcoSyncRuns(token);
    case "syncSelcoVendors":
      return await handleSyncSelcoVendors(token);
    default:
      return errorResponse("Unknown admin action.", 400);
  }
});
