const directoryState = { vendors: [], products: [], filteredVendors: [], geocodeCache: new Map(), map: null, mapReady: false, markers: [] };

const searchEls = {
  supplier: document.getElementById('search-supplier'),
  product: document.getElementById('search-product'),
  tags: document.getElementById('search-tags'),
  location: document.getElementById('search-location'),
  keyword: document.getElementById('search-keyword'),
};

const resultsEl = document.getElementById('vendor-results');
const mapListEl = document.getElementById('map-results-list');
const statusEl = document.getElementById('directory-status');
const resultsSummaryEl = document.getElementById('results-summary');

function esc(value) {
  return String(value || '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
}

function normalizeText(value) { return String(value || '').trim().toLowerCase(); }

function buildVendorSearchText(vendor) {
  return [
    vendor.vendor_name, vendor.about_vendor, vendor.location_text, vendor.city, vendor.state, vendor.country,
    ...(vendor.service_locations || []), ...(vendor.tags || []),
    ...(vendor.products || []).flatMap((product) => [product.product_name, product.product_description, ...(product.tags || [])]),
  ].filter(Boolean).join(' ').toLowerCase();
}

function matchesVendor(vendor, filters) {
  const searchText = buildVendorSearchText(vendor);
  const supplierMatch = !filters.supplier || normalizeText(vendor.vendor_name).includes(filters.supplier);
  const productMatch = !filters.product || (vendor.products || []).some((product) => normalizeText(product.product_name).includes(filters.product));
  const tagsMatch = !filters.tags || [...(vendor.tags || []), ...(vendor.products || []).flatMap((product) => product.tags || [])].some((tag) => normalizeText(tag).includes(filters.tags));
  const locationMatch = !filters.location || [vendor.location_text, vendor.city, vendor.state, vendor.country, ...(vendor.service_locations || [])].filter(Boolean).join(' ').toLowerCase().includes(filters.location);
  const keywordMatch = !filters.keyword || searchText.includes(filters.keyword);
  return supplierMatch && productMatch && tagsMatch && locationMatch && keywordMatch;
}

function getFilters() {
  return {
    supplier: normalizeText(searchEls.supplier.value),
    product: normalizeText(searchEls.product.value),
    tags: normalizeText(searchEls.tags.value),
    location: normalizeText(searchEls.location.value),
    keyword: normalizeText(searchEls.keyword.value),
  };
}

function setCounts() {
  document.getElementById('vendor-total-count').textContent = String(directoryState.vendors.length);
  document.getElementById('product-total-count').textContent = String(directoryState.products.length);
  document.getElementById('filtered-vendor-count').textContent = String(directoryState.filteredVendors.length);
}

function focusVendor(vendorId) {
  if (!vendorId) return;
  const escapedId = window.CSS?.escape ? window.CSS.escape(vendorId) : vendorId.replace(/"/g, '\\"');
  const card = document.querySelector(`[data-vendor-card="${escapedId}"]`);
  if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

async function loadMapSdk() {
  const key = String(window.APP_CONFIG?.MAPMYINDIA_MAP_KEY || '').trim();
  if (!key) {
    document.getElementById('results-map').innerHTML = '<div class="vendor-map-placeholder">Add `MAPMYINDIA_MAP_KEY` in `config.js` to enable the map.</div>';
    return false;
  }
  if (window.mappls) return true;
  await new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `https://apis.mappls.com/advancedmaps/api/${encodeURIComponent(key)}/map_sdk?layer=vector&v=3.0`;
    script.async = true;
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
  return Boolean(window.mappls);
}

async function ensureMap() {
  if (directoryState.mapReady) return true;
  const loaded = await loadMapSdk().catch(() => false);
  if (!loaded || !window.mappls) return false;
  directoryState.map = new window.mappls.Map('results-map', { center: [22.5937, 78.9629], zoom: 4 });
  directoryState.mapReady = true;
  return true;
}

async function geocodeVendor(vendor) {
  const cacheKey = vendor.portal_vendor_id;
  if (directoryState.geocodeCache.has(cacheKey)) return directoryState.geocodeCache.get(cacheKey);
  const query = [vendor.final_contact_address, vendor.location_text, vendor.city, vendor.state, vendor.country].filter(Boolean).join(', ');
  if (!query) return null;
  try {
    const response = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(query)}`, { headers: { Accept: 'application/json' } });
    const data = await response.json();
    const match = Array.isArray(data) ? data[0] : null;
    if (!match) return null;
    const point = { lat: Number(match.lat), lng: Number(match.lon) };
    directoryState.geocodeCache.set(cacheKey, point);
    return point;
  } catch { return null; }
}

function clearMapMarkers() {
  directoryState.markers.forEach((marker) => { if (marker && typeof marker.remove === 'function') marker.remove(); });
  directoryState.markers = [];
}

async function renderMapMarkers(vendors) {
  const ready = await ensureMap();
  if (!ready) return;
  clearMapMarkers();
  const points = [];
  for (const vendor of vendors.slice(0, 25)) {
    const point = await geocodeVendor(vendor);
    if (!point) continue;
    points.push({ vendor, point });
  }
  if (!points.length) return;
  points.forEach(({ vendor, point }, index) => {
    const marker = new window.mappls.Marker({
      map: directoryState.map,
      position: point,
      fitbounds: false,
      popupHtml: `<div class="vendor-map-popup"><strong>${esc(vendor.vendor_name)}</strong><br/>${esc(vendor.location_text || '')}<br/><a href="./vendor-detail.html?vendor=${encodeURIComponent(vendor.portal_vendor_id)}">View Details</a></div>`,
      icon: { html: `<button class="vendor-map-marker" type="button">${index + 1}</button>` },
    });
    directoryState.markers.push(marker);
  });
  if (points[0]?.point && directoryState.map?.setCenter) {
    directoryState.map.setCenter(points[0].point);
    directoryState.map.setZoom(5);
  }
}

function renderResults() {
  const vendors = directoryState.filteredVendors;
  setCounts();
  resultsSummaryEl.textContent = `${vendors.length} supplier result${vendors.length === 1 ? '' : 's'} found`;
  resultsEl.innerHTML = '';
  mapListEl.innerHTML = '';
  if (!vendors.length) {
    resultsEl.innerHTML = '<article class="admin-card"><p>No suppliers match the current filters.</p></article>';
    mapListEl.innerHTML = '<p class="section-note">No map results yet.</p>';
    renderMapMarkers([]);
    return;
  }
  vendors.forEach((vendor, index) => {
    const productPreview = (vendor.products || []).slice(0, 5).map((product) => product.product_name).filter(Boolean);
    const productExtra = Math.max((vendor.products || []).length - productPreview.length, 0);
    resultsEl.insertAdjacentHTML('beforeend', `<article class="vendor-result-card" data-vendor-card="${esc(vendor.portal_vendor_id)}"><div class="vendor-result-top"><div><h4>${esc(vendor.vendor_name)}</h4><p>${esc(vendor.location_text || 'Location not listed')}</p></div><span class="admin-badge approved">${esc(String(vendor.products_count || vendor.products?.length || 0))} products</span></div><p>${esc(vendor.about_vendor || 'No description available.')}</p><p><strong>Service locations:</strong> ${esc((vendor.service_locations || []).join(', ') || 'Not listed')}</p><p><strong>Contact:</strong> ${esc(vendor.final_contact_email || vendor.portal_email || 'No email')} | ${esc(vendor.final_contact_phone || vendor.portal_phone || 'No phone')}</p><p><strong>Products:</strong> ${esc(productPreview.join(', ') || 'No products listed')}${productExtra ? ` +${productExtra} more` : ''}</p><div class="btn-group"><a class="btn btn-small" href="./vendor-detail.html?vendor=${encodeURIComponent(vendor.portal_vendor_id)}">View Details</a><a class="btn btn-warning btn-small" href="${esc(vendor.portal_vendor_link || '#')}" target="_blank" rel="noreferrer">View on Selco Solution Portal</a></div></article>`);
    mapListEl.insertAdjacentHTML('beforeend', `<div class="vendor-map-list-item" data-focus-vendor="${esc(vendor.portal_vendor_id)}"><span class="vendor-flag">${index + 1}</span><span><strong>${esc(vendor.vendor_name)}</strong><br /><small>${esc(vendor.location_text || 'Location not listed')}</small></span><div class="btn-group"><a class="btn btn-small" href="./vendor-detail.html?vendor=${encodeURIComponent(vendor.portal_vendor_id)}">View Details</a><a class="btn btn-warning btn-small" href="${esc(vendor.portal_vendor_link || '#')}" target="_blank" rel="noreferrer">View on Selco Solution Portal</a></div></div>`);
  });
  renderMapMarkers(vendors);
}

function applyFilters() {
  const filters = getFilters();
  directoryState.filteredVendors = directoryState.vendors.filter((vendor) => matchesVendor(vendor, filters));
  renderResults();
}

function clearFilters() {
  Object.values(searchEls).forEach((input) => { input.value = ''; });
  applyFilters();
}

async function initializeDirectory() {
  statusEl.textContent = 'Loading vendor directory from Supabase...';
  try {
    const { vendors, products } = await SelcoVendorStore.loadDirectory();
    directoryState.vendors = vendors;
    directoryState.products = products;
    directoryState.filteredVendors = vendors;
    statusEl.textContent = `Loaded ${vendors.length} vendors and ${products.length} products from the synced Selco directory.`;
    renderResults();
  } catch (error) {
    statusEl.textContent = error.message || 'Vendor directory could not be loaded.';
    resultsEl.innerHTML = `<article class="admin-card"><p>${esc(statusEl.textContent)}</p></article>`;
  }
}

document.getElementById('run-search').addEventListener('click', applyFilters);
document.getElementById('clear-search').addEventListener('click', clearFilters);
Object.values(searchEls).forEach((input) => input.addEventListener('keypress', (event) => { if (event.key === 'Enter') applyFilters(); }));
mapListEl.addEventListener('click', (event) => { if (event.target.closest('a')) return; const target = event.target.closest('[data-focus-vendor]'); if (target) focusVendor(target.dataset.focusVendor); });

initializeDirectory();
