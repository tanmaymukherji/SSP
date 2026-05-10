const directoryState = {
  vendors: [],
  products: [],
  filteredVendors: [],
  currentPage: 1,
  pageSize: 12,
  hasSearched: false,
  geocodeCache: new Map(),
  map: null,
  mapReady: false,
  mapLoadPromise: null,
  markers: [],
  selectedVendorId: null,
};

const INDIA_CENTER = { lat: 22.9734, lng: 78.6569 };
const INDIA_BOUNDS = {
  minLat: 6,
  maxLat: 38,
  minLng: 68,
  maxLng: 98,
};
const SEARCH_STATE_KEY = 'ssp_search_state_v1';
const searchEls = {
  supplier: document.getElementById('search-supplier'),
  product: document.getElementById('search-product'),
  tags: document.getElementById('search-tags'),
  location: document.getElementById('search-location'),
  keyword: document.getElementById('search-keyword'),
};

const resultsEl = document.getElementById('vendor-results');
const statusEl = document.getElementById('directory-status');
const resultsSummaryEl = document.getElementById('results-summary');
const paginationEls = [
  document.getElementById('results-pagination-top'),
  document.getElementById('results-pagination-bottom'),
];

function uniqueSortedValues(values) {
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' }));
}

function populateSelectOptions(selectEl, values, placeholder) {
  if (!selectEl) return;
  const previousValue = selectEl.value;
  selectEl.innerHTML = '';
  const defaultOption = document.createElement('option');
  defaultOption.value = '';
  defaultOption.textContent = placeholder;
  selectEl.appendChild(defaultOption);
  values.forEach((value) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = value;
    selectEl.appendChild(option);
  });
  selectEl.value = values.includes(previousValue) ? previousValue : '';
}

function populateFilterOptions() {
  populateSelectOptions(
    searchEls.supplier,
    uniqueSortedValues(directoryState.vendors.map((vendor) => vendor.vendor_name)),
    'All organisations'
  );
  populateSelectOptions(
    searchEls.product,
    uniqueSortedValues(directoryState.products.map((product) => product.product_name)),
    'All machines'
  );
}

function esc(value) {
  return String(value || '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
}

function persistSearchState() {
  const snapshot = {
    search: {
      supplier: searchEls.supplier.value,
      product: searchEls.product.value,
      tags: searchEls.tags.value,
      location: searchEls.location.value,
      keyword: searchEls.keyword.value,
    },
    currentPage: directoryState.currentPage,
    hasSearched: directoryState.hasSearched,
    selectedVendorId: directoryState.selectedVendorId,
  };
  try {
    window.sessionStorage.setItem(SEARCH_STATE_KEY, JSON.stringify(snapshot));
  } catch {}
}

function restoreSearchState() {
  try {
    const raw = window.sessionStorage.getItem(SEARCH_STATE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function applySearchSnapshot(snapshot) {
  if (!snapshot?.search) return;
  searchEls.supplier.value = String(snapshot.search.supplier || '');
  searchEls.product.value = String(snapshot.search.product || '');
  searchEls.tags.value = String(snapshot.search.tags || '');
  searchEls.location.value = String(snapshot.search.location || '');
  searchEls.keyword.value = String(snapshot.search.keyword || '');
  directoryState.currentPage = Number(snapshot.currentPage || 1);
  directoryState.selectedVendorId = snapshot.selectedVendorId || null;
}

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

function isWithinIndia(point) {
  return Boolean(
    point &&
    Number.isFinite(point.lat) &&
    Number.isFinite(point.lng) &&
    point.lat >= INDIA_BOUNDS.minLat &&
    point.lat <= INDIA_BOUNDS.maxLat &&
    point.lng >= INDIA_BOUNDS.minLng &&
    point.lng <= INDIA_BOUNDS.maxLng
  );
}

function tokenize(value) {
  return normalizeText(value).split(/[^a-z0-9]+/).filter(Boolean);
}

function buildVendorIndex(vendor) {
  const productNames = (vendor.products || []).map((product) => normalizeText(product.product_name)).join(' ');
  const productDescriptions = (vendor.products || []).map((product) => normalizeText(product.product_description)).join(' ');
  const tags = [...(vendor.tags || []), ...(vendor.products || []).flatMap((product) => product.tags || []), ...(vendor.products || []).flatMap((product) => (product.product_specifications || []).flatMap((spec) => [spec?.key, spec?.value]))].map(normalizeText).join(' ');
  const locations = [vendor.location_text, vendor.city, vendor.state, vendor.country, vendor.final_contact_address, ...(vendor.service_locations || [])].map(normalizeText).join(' ');
  const contacts = [vendor.portal_contact_name, vendor.portal_email, vendor.portal_phone, vendor.website_email, vendor.website_phone, vendor.final_contact_email, vendor.final_contact_phone].map(normalizeText).join(' ');
  const website = [vendor.website_details, vendor.website_status, vendor.contact_notes, vendor.legacy_products_links].map(normalizeText).join(' ');
  const keyword = [vendor.vendor_name, vendor.about_vendor, productNames, productDescriptions, tags, locations, contacts, website, vendor.search_text].map(normalizeText).join(' ');
  return {
    supplier: normalizeText(vendor.vendor_name),
    products: productNames,
    tags,
    location: locations,
    keyword,
  };
}

function tokensMatchAll(haystack, tokens) {
  return tokens.every((token) => haystack.includes(token));
}

function scoreAgainstTokens(haystack, tokens, weight) {
  if (!tokens.length) return 0;
  let score = 0;
  for (const token of tokens) {
    if (!haystack.includes(token)) return null;
    score += haystack === token ? weight * 3 : haystack.startsWith(token) ? weight * 2 : weight;
  }
  return score;
}

function scoreVendor(vendor, filters) {
  const index = vendor._searchIndex || (vendor._searchIndex = buildVendorIndex(vendor));
  let score = 0;

  const supplierScore = scoreAgainstTokens(index.supplier, filters.supplierTokens, 22);
  if (supplierScore === null) return null;
  score += supplierScore;

  const productScore = scoreAgainstTokens(index.products, filters.productTokens, 18);
  if (productScore === null) return null;
  score += productScore;

  const tagScore = scoreAgainstTokens(index.tags, filters.tagTokens, 10);
  if (tagScore === null) return null;
  score += tagScore;

  const locationScore = scoreAgainstTokens(index.location, filters.locationTokens, 12);
  if (locationScore === null) return null;
  score += locationScore;

  if (filters.keywordTokens.length) {
    if (!tokensMatchAll(index.keyword, filters.keywordTokens)) return null;
    score += filters.keywordTokens.reduce((total, token) => total + (index.supplier.includes(token) ? 20 : 8), 0);
  }

  if (filters.keywordPhrase && index.keyword.includes(filters.keywordPhrase)) score += 35;
  if (filters.supplierPhrase && index.supplier.includes(filters.supplierPhrase)) score += 25;
  if ((vendor.products_count || vendor.products?.length || 0) > 0) score += 3;
  if (vendor.final_contact_address) score += 2;
  if (vendor.latitude && vendor.longitude) score += 4;

  return score;
}

function getFilters() {
  const supplier = normalizeText(searchEls.supplier.value);
  const product = normalizeText(searchEls.product.value);
  const tags = normalizeText(searchEls.tags.value);
  const location = normalizeText(searchEls.location.value);
  const keyword = normalizeText(searchEls.keyword.value);
  return {
    supplierPhrase: supplier,
    productPhrase: product,
    tagPhrase: tags,
    locationPhrase: location,
    keywordPhrase: keyword,
    supplierTokens: tokenize(supplier),
    productTokens: tokenize(product),
    tagTokens: tokenize(tags),
    locationTokens: tokenize(location),
    keywordTokens: tokenize(keyword),
  };
}

function hasAnyFilter(filters) {
  return Boolean(
    filters.supplierTokens.length ||
    filters.productTokens.length ||
    filters.tagTokens.length ||
    filters.locationTokens.length ||
    filters.keywordTokens.length
  );
}

function setCounts() {
  document.getElementById('vendor-total-count').textContent = String(directoryState.vendors.length);
  document.getElementById('product-total-count').textContent = String(directoryState.products.length);
  document.getElementById('filtered-vendor-count').textContent = String(directoryState.filteredVendors.length);
}

function getPageCount() {
  return Math.max(1, Math.ceil(directoryState.filteredVendors.length / directoryState.pageSize));
}

function getPageResults() {
  const start = (directoryState.currentPage - 1) * directoryState.pageSize;
  return directoryState.filteredVendors.slice(start, start + directoryState.pageSize);
}

function setSelectedVendor(vendorId) {
  directoryState.selectedVendorId = vendorId || null;
  document.querySelectorAll('[data-vendor-card]').forEach((card) => {
    card.classList.toggle('active', card.dataset.vendorCard === vendorId);
  });
  document.querySelectorAll('[data-focus-vendor]').forEach((item) => {
    item.classList.toggle('active', item.dataset.focusVendor === vendorId);
  });
}

function focusVendor(vendorId, options = {}) {
  if (!vendorId) return;
  const shouldScroll = Boolean(options.scroll);
  setSelectedVendor(vendorId);
  persistSearchState();
  if (!shouldScroll) return;
  const escapedId = window.CSS?.escape ? window.CSS.escape(vendorId) : vendorId.replace(/"/g, '\\"');
  const card = document.querySelector(`[data-vendor-card="${escapedId}"]`);
  if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function ensureMapCss() {
  if (document.getElementById('mappls-web-sdk-css')) return;
  const link = document.createElement('link');
  link.id = 'mappls-web-sdk-css';
  link.rel = 'stylesheet';
  link.href = 'https://apis.mappls.com/vector_map/assets/v3.5/mappls-glob.css';
  document.head.appendChild(link);
}

async function loadMapSdk() {
  const key = String(window.APP_CONFIG?.MAPMYINDIA_MAP_KEY || '').trim();
  if (!key) {
    document.getElementById('results-map').innerHTML = '<div class="vendor-map-placeholder">Add `MAPMYINDIA_MAP_KEY` in `config.js` to enable the map.</div>';
    return false;
  }
  if (window.mappls?.Map) return true;
  ensureMapCss();
  const urls = [
    `https://sdk.mappls.com/map/sdk/web?v=3.0&access_token=${encodeURIComponent(key)}`,
    `https://sdk.mappls.com/map/sdk/web?v=3.0&layer=vector&access_token=${encodeURIComponent(key)}`,
    `https://apis.mappls.com/advancedmaps/api/${encodeURIComponent(key)}/map_sdk?layer=vector&v=3.0`,
  ];
  for (const src of urls) {
    try {
      await new Promise((resolve, reject) => {
        document.querySelectorAll('script[data-mappls-sdk="true"]').forEach((node) => node.remove());
        const script = document.createElement('script');
        script.src = src;
        script.async = true;
        script.defer = true;
        script.dataset.mapplsSdk = 'true';
        script.onload = () => window.mappls?.Map ? resolve() : reject(new Error('Mappls SDK unavailable'));
        script.onerror = reject;
        document.head.appendChild(script);
      });
      return true;
    } catch {}
  }
  document.getElementById('results-map').innerHTML = '<div class="vendor-map-placeholder">The MapMyIndia SDK could not be loaded for this page.</div>';
  return false;
}

async function ensureMap() {
  if (directoryState.mapReady) return true;
  if (directoryState.mapLoadPromise) return await directoryState.mapLoadPromise;
  const loaded = await loadMapSdk();
  if (!loaded || !window.mappls?.Map) return false;
  directoryState.mapLoadPromise = new Promise((resolve) => {
    directoryState.map = new window.mappls.Map('results-map', {
      center: INDIA_CENTER,
      zoom: 4.8,
      zoomControl: true,
      geolocation: false,
      location: false,
    });
    let settled = false;
    const markReady = () => {
      if (settled) return;
      settled = true;
      directoryState.mapReady = true;
      resolve(true);
    };
    directoryState.map?.on?.('load', markReady);
    directoryState.map?.addListener?.('load', markReady);
    window.setTimeout(markReady, 1500);
  });
  return await directoryState.mapLoadPromise;
}

async function geocodeVendor(vendor) {
  const cacheKey = vendor.portal_vendor_id;
  if (directoryState.geocodeCache.has(cacheKey)) return directoryState.geocodeCache.get(cacheKey);
  const lat = Number(vendor.latitude);
  const lng = Number(vendor.longitude);
  if (Number.isFinite(lat) && Number.isFinite(lng) && (Math.abs(lat) > 0.0001 || Math.abs(lng) > 0.0001)) {
    const point = { lat: Number(vendor.latitude), lng: Number(vendor.longitude) };
    if (!isWithinIndia(point)) {
      directoryState.geocodeCache.set(cacheKey, null);
      return null;
    }
    directoryState.geocodeCache.set(cacheKey, point);
    return point;
  }
  const query = [vendor.location_text, vendor.city, vendor.state, vendor.country, vendor.final_contact_address].filter(Boolean).join(', ');
  if (!query) return null;
  try {
    const response = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=in&q=${encodeURIComponent(query)}`, {
      headers: { Accept: 'application/json' },
    });
    const data = await response.json();
    const match = Array.isArray(data) ? data[0] : null;
    if (!match) return null;
    const point = { lat: Number(match.lat), lng: Number(match.lon) };
    if (!isWithinIndia(point)) {
      directoryState.geocodeCache.set(cacheKey, null);
      return null;
    }
    directoryState.geocodeCache.set(cacheKey, point);
    return point;
  } catch {
    return null;
  }
}

function clearMapMarkers() {
  directoryState.markers.forEach((marker) => marker?.remove?.());
  directoryState.markers = [];
}

function groupMapPoints(entries) {
  const groups = new Map();
  entries.forEach((entry) => {
    const key = `${entry.point.lat.toFixed(3)}|${entry.point.lng.toFixed(3)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  });
  return Array.from(groups.values());
}

function buildPopupHtml(entries) {
  return `<div class="vendor-map-popup">${entries.map(({ vendor }) => `<div><strong>${esc(vendor.vendor_name)}</strong><br/>${esc(vendor.location_text || 'Location not listed')}<br/><a href="./vendor-detail.html?vendor=${encodeURIComponent(vendor.portal_vendor_id)}">View Details</a> | <a href="${esc(vendor.portal_vendor_link || '#')}" target="_blank" rel="noreferrer">View on Selco</a></div>`).join('<hr style="border:none;border-top:1px solid #dbe5eb;margin:.55rem 0;" />')}</div>`;
}

function createRingPoints(point, count) {
  if (count <= 1) return [point];
  const radius = Math.min(0.08, 0.012 + (count * 0.0025));
  return Array.from({ length: count }, (_, index) => {
    const angle = (Math.PI * 2 * index) / count;
    const latOffset = Math.sin(angle) * radius;
    const lngOffset = Math.cos(angle) * radius / Math.max(Math.cos((point.lat * Math.PI) / 180), 0.35);
    return {
      lat: point.lat + latOffset,
      lng: point.lng + lngOffset,
    };
  });
}

function buildMarkerHtml(count) {
  const size = count > 1 ? 34 : 20;
  const halo = count > 1 ? 10 : 7;
  const border = count > 1 ? 4 : 3;
  const label = count > 1 ? `<span style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#fff;font:700 13px/1 'Segoe UI',Arial,sans-serif;">${count}</span>` : '';
  return `<div style="position:relative;width:${size}px;height:${size}px;border-radius:999px;background:#1976d2;border:${border}px solid #fff;box-shadow:0 0 0 ${halo}px rgba(25,118,210,.18),0 8px 18px rgba(25,118,210,.28);">${label}</div>`;
}

function buildMapBounds(points) {
  if (!Array.isArray(points) || !points.length) return null;
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  points.forEach((point) => {
    if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lng)) return;
    minLat = Math.min(minLat, point.lat);
    maxLat = Math.max(maxLat, point.lat);
    minLng = Math.min(minLng, point.lng);
    maxLng = Math.max(maxLng, point.lng);
  });
  if (!Number.isFinite(minLat) || !Number.isFinite(maxLat) || !Number.isFinite(minLng) || !Number.isFinite(maxLng)) {
    return null;
  }
  return {
    minLat,
    maxLat,
    minLng,
    maxLng,
    boundsArray: [
      [minLng, minLat],
      [maxLng, maxLat],
    ],
    boundsObject: {
      north: maxLat,
      south: minLat,
      east: maxLng,
      west: minLng,
    },
    center: {
      lat: (minLat + maxLat) / 2,
      lng: (minLng + maxLng) / 2,
    },
  };
}

function fitMapToPoints(points) {
  if (!directoryState.map) return;
  if (!points.length) {
    directoryState.map?.setCenter?.(INDIA_CENTER);
    directoryState.map?.setZoom?.(4.8);
    return;
  }
  if (points.length === 1) {
    directoryState.map?.setCenter?.(points[0]);
    directoryState.map?.setZoom?.(8);
    return;
  }
  const bounds = buildMapBounds(points);
  if (!bounds) {
    directoryState.map?.setCenter?.(INDIA_CENTER);
    directoryState.map?.setZoom?.(4.8);
    return;
  }
  try {
    if (typeof directoryState.map?.fitBounds === 'function') {
      try {
        directoryState.map.fitBounds(bounds.boundsArray, { padding: 60, maxZoom: 8.5, duration: 0 });
        return;
      } catch {}
      try {
        directoryState.map.fitBounds(bounds.boundsArray, { padding: 60, maxZoom: 8.5 });
        return;
      } catch {}
      try {
        directoryState.map.fitBounds(bounds.boundsObject, { padding: 60, maxZoom: 8.5 });
        return;
      } catch {}
      try {
        directoryState.map.fitBounds(bounds.boundsArray);
        return;
      } catch {}
    }
  } catch {}

  const latSpan = Math.max(bounds.maxLat - bounds.minLat, 0.01);
  const lngSpan = Math.max(bounds.maxLng - bounds.minLng, 0.01);
  const maxSpan = Math.max(latSpan, lngSpan);
  const fallbackZoom = maxSpan > 20 ? 4.4 : maxSpan > 10 ? 5.1 : maxSpan > 5 ? 5.8 : maxSpan > 2 ? 6.6 : 7.4;
  directoryState.map?.setCenter?.(bounds.center);
  directoryState.map?.setZoom?.(fallbackZoom);
}

async function renderMapMarkers(vendors) {
  const ready = await ensureMap();
  if (!ready) return;
  clearMapMarkers();
  const points = [];
  for (const vendor of vendors) {
    const point = await geocodeVendor(vendor);
    if (point) points.push({ vendor, point });
  }
  if (!points.length) {
    directoryState.map?.setCenter?.(INDIA_CENTER);
    directoryState.map?.setZoom?.(4.8);
    return;
  }
  const groupedPoints = groupMapPoints(points);
  groupedPoints.forEach((entries) => {
    const [{ point }] = entries;
    const ringPoints = createRingPoints(point, entries.length);
    entries.forEach((entry, index) => {
      const marker = new window.mappls.Marker({
        map: directoryState.map,
        position: ringPoints[index],
        html: buildMarkerHtml(entries.length),
        width: entries.length > 1 ? 34 : 20,
        height: entries.length > 1 ? 34 : 20,
        popupHtml: buildPopupHtml([entry]),
        fitbounds: false,
      });
      marker.on?.('click', () => focusVendor(entry.vendor.portal_vendor_id));
      marker.addListener?.('click', () => focusVendor(entry.vendor.portal_vendor_id));
      directoryState.markers.push(marker);
    });
  });
  const indiaPoints = points.map(({ point }) => point).filter(isWithinIndia);
  fitMapToPoints(indiaPoints);
}

function renderPagination(totalPages, totalMatches) {
  paginationEls.forEach((container) => {
    if (!container) return;
    container.innerHTML = '';
    if (!directoryState.hasSearched || !totalMatches) return;
    container.insertAdjacentHTML('beforeend', `<div class="vendor-page-summary">Showing ${getPageResults().length} of ${totalMatches} results</div>`);
    const prevDisabled = directoryState.currentPage === 1 ? 'disabled' : '';
    container.insertAdjacentHTML('beforeend', `<button class="btn btn-small btn-pagination" data-page-nav="prev" ${prevDisabled}>Prev</button>`);
    const start = Math.max(1, directoryState.currentPage - 2);
    const end = Math.min(totalPages, start + 4);
    for (let page = start; page <= end; page += 1) {
      container.insertAdjacentHTML('beforeend', `<button class="btn btn-small btn-pagination ${page === directoryState.currentPage ? 'active' : ''}" data-page-number="${page}">${page}</button>`);
    }
    const nextDisabled = directoryState.currentPage === totalPages ? 'disabled' : '';
    container.insertAdjacentHTML('beforeend', `<button class="btn btn-small btn-pagination" data-page-nav="next" ${nextDisabled}>Next</button>`);
  });
}

async function renderResults() {
  const totalMatches = directoryState.filteredVendors.length;
  const totalPages = getPageCount();
  const pageVendors = getPageResults();
  setCounts();
  resultsEl.innerHTML = '';
  renderPagination(totalPages, totalMatches);

  if (!directoryState.hasSearched) {
    resultsSummaryEl.textContent = 'Enter a supplier, product, specification, location, or keyword to search the directory.';
    resultsEl.innerHTML = '<div class="vendor-empty-state">The directory is loaded and ready. Start with a keyword or one of the filters on the left, then run the search to see suppliers.</div>';
    await renderMapMarkers([]);
    return;
  }

  if (!totalMatches) {
    resultsSummaryEl.textContent = 'No suppliers matched the current filters.';
    resultsEl.innerHTML = '<div class="vendor-empty-state">No suppliers match this combination yet. Try a shorter keyword, a broader location, or remove one filter at a time.</div>';
    await renderMapMarkers([]);
    return;
  }

  resultsSummaryEl.textContent = `${totalMatches} supplier result${totalMatches === 1 ? '' : 's'} found. Page ${directoryState.currentPage} of ${totalPages}.`;

  pageVendors.forEach((vendor) => {
    const productPreview = (vendor.products || []).slice(0, 4).map((product) => product.product_name).filter(Boolean);
    const productExtra = Math.max((vendor.products || []).length - productPreview.length, 0);
    const contactLine = [vendor.final_contact_email || vendor.portal_email || 'No email', vendor.final_contact_phone || vendor.portal_phone || 'No phone'].join(' | ');
    const noteLine = vendor.contact_notes || vendor.website_status || 'Portal contacts only';
    resultsEl.insertAdjacentHTML('beforeend', `<article class="vendor-result-card" data-vendor-card="${esc(vendor.portal_vendor_id)}"><div class="vendor-result-header"><div class="vendor-result-topline"><div class="vendor-result-heading"><h4>${esc(vendor.vendor_name)}</h4><p>${esc(vendor.location_text || 'Location not listed')}</p></div><div class="vendor-result-meta"><span class="admin-badge approved">${esc(String(vendor.products_count || vendor.products?.length || 0))} products</span></div></div><div class="vendor-result-actions"><div class="btn-group"><a class="btn btn-small" href="./vendor-detail.html?vendor=${encodeURIComponent(vendor.portal_vendor_id)}">View Details</a><a class="btn btn-warning btn-small" href="${esc(vendor.portal_vendor_link || '#')}" target="_blank" rel="noreferrer">View on Selco Solution Portal</a></div></div></div><div class="vendor-result-body"><p>${esc(vendor.about_vendor || 'No description available.')}</p><p><strong>Service locations:</strong> ${esc((vendor.service_locations || []).join(', ') || 'Not listed')}</p><p><strong>Contact:</strong> ${esc(contactLine)}</p><p><strong>Address:</strong> ${esc(vendor.final_contact_address || 'Not listed')}</p><p><strong>Enrichment:</strong> ${esc(noteLine)}</p><p><strong>Products:</strong> ${esc(productPreview.join(', ') || 'No products listed')}${productExtra ? ` +${productExtra} more` : ''}</p></div></article>`);
  });

  const selectedVendor = directoryState.selectedVendorId && directoryState.filteredVendors.some((vendor) => vendor.portal_vendor_id === directoryState.selectedVendorId)
    ? directoryState.selectedVendorId
    : directoryState.filteredVendors[0]?.portal_vendor_id || null;
  setSelectedVendor(selectedVendor);
  persistSearchState();
  await renderMapMarkers(directoryState.filteredVendors);
}

function applyFilters() {
  const filters = getFilters();
  if (!hasAnyFilter(filters)) {
    directoryState.hasSearched = false;
    directoryState.filteredVendors = [];
    directoryState.currentPage = 1;
    statusEl.textContent = `Loaded ${directoryState.vendors.length} vendors and ${directoryState.products.length} products from the synced Selco directory.`;
    renderResults();
    return;
  }
  const scored = directoryState.vendors
    .map((vendor) => ({ vendor, score: scoreVendor(vendor, filters) }))
    .filter((entry) => entry.score !== null)
    .sort((left, right) => right.score - left.score || left.vendor.vendor_name.localeCompare(right.vendor.vendor_name))
    .map((entry) => entry.vendor);
  directoryState.hasSearched = true;
  directoryState.filteredVendors = scored;
  directoryState.currentPage = 1;
  persistSearchState();
  renderResults();
}

function clearFilters() {
  Object.values(searchEls).forEach((input) => { input.value = ''; });
  directoryState.selectedVendorId = null;
  try { window.sessionStorage.removeItem(SEARCH_STATE_KEY); } catch {}
  applyFilters();
}

async function initializeDirectory() {
  statusEl.textContent = 'Loading vendor directory from Supabase...';
  try {
    const { vendors, products } = await SelcoVendorStore.loadDirectory();
    directoryState.vendors = vendors;
    directoryState.products = products;
    directoryState.filteredVendors = [];
    populateFilterOptions();
    statusEl.textContent = `Loaded ${vendors.length} vendors and ${products.length} products from the synced Selco directory.`;
    const snapshot = restoreSearchState();
    if (snapshot?.hasSearched) {
      applySearchSnapshot(snapshot);
      const filters = getFilters();
      const scored = directoryState.vendors
        .map((vendor) => ({ vendor, score: scoreVendor(vendor, filters) }))
        .filter((entry) => entry.score !== null)
        .sort((left, right) => right.score - left.score || left.vendor.vendor_name.localeCompare(right.vendor.vendor_name))
        .map((entry) => entry.vendor);
      directoryState.hasSearched = true;
      directoryState.filteredVendors = scored;
      directoryState.currentPage = Math.min(Math.max(1, directoryState.currentPage), Math.max(1, Math.ceil(scored.length / directoryState.pageSize)));
    }
    await renderResults();
  } catch (error) {
    statusEl.textContent = error.message || 'Vendor directory could not be loaded.';
    resultsEl.innerHTML = `<article class="admin-card"><p>${esc(statusEl.textContent)}</p></article>`;
  }
}

document.getElementById('run-search').addEventListener('click', applyFilters);
document.getElementById('clear-search').addEventListener('click', clearFilters);
Object.values(searchEls).forEach((input) => {
  input.addEventListener('keypress', (event) => { if (event.key === 'Enter') applyFilters(); });
  input.addEventListener('input', persistSearchState);
  input.addEventListener('change', persistSearchState);
});
resultsEl.addEventListener('click', (event) => {
  if (event.target.closest('a')) return;
  const target = event.target.closest('[data-vendor-card]');
  if (target) {
    setSelectedVendor(target.dataset.vendorCard);
    persistSearchState();
  }
});
paginationEls.forEach((container) => container?.addEventListener('click', (event) => {
  const pageButton = event.target.closest('[data-page-number]');
  if (pageButton) {
    directoryState.currentPage = Number(pageButton.dataset.pageNumber);
    persistSearchState();
    renderResults();
    return;
  }
  const navButton = event.target.closest('[data-page-nav]');
  if (!navButton) return;
  const direction = navButton.dataset.pageNav;
  if (direction === 'prev' && directoryState.currentPage > 1) directoryState.currentPage -= 1;
  if (direction === 'next' && directoryState.currentPage < getPageCount()) directoryState.currentPage += 1;
  persistSearchState();
  renderResults();
}));

initializeDirectory();
