function esc(value) {
  return String(value || '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
}

function renderSpecifications(specifications) {
  if (!Array.isArray(specifications) || !specifications.length) {
    return '<p><strong>Product Specifications:</strong> Not listed</p>';
  }
  return `<div><strong>Product Specifications</strong><div class="vendor-spec-list">${specifications.map((spec) => `<div class="vendor-spec-item"><strong>${esc(spec.key || 'Specification')}</strong>: ${esc(spec.value || 'Not listed')}</div>`).join('')}</div></div>`;
}

async function initVendorDetail() {
  const params = new URLSearchParams(window.location.search);
  const vendorId = params.get('vendor');
  const root = document.getElementById('vendor-detail-root');
  if (!vendorId) {
    root.innerHTML = '<section class="section"><p>Vendor id is missing.</p></section>';
    return;
  }
  try {
    const { vendors } = await SelcoVendorStore.loadDirectory();
    const vendor = vendors.find((item) => item.portal_vendor_id === vendorId);
    if (!vendor) {
      root.innerHTML = '<section class="section"><p>Vendor not found in the synced Supabase directory.</p></section>';
      return;
    }
    document.getElementById('detail-title').textContent = vendor.vendor_name;
    document.getElementById('detail-subtitle').textContent = vendor.location_text || 'Supplier details from the synced Selco directory';
    root.innerHTML = `<section class="section"><div class="vendor-result-top"><div><h3>${esc(vendor.vendor_name)}</h3><p>${esc(vendor.location_text || 'Location not listed')}</p></div><span class="admin-badge approved">${esc(String(vendor.products_count || vendor.products?.length || 0))} products</span></div><p>${esc(vendor.about_vendor || 'No description available.')}</p><div class="vendor-detail-grid"><div><h4>Contacts</h4><p><strong>Name:</strong> ${esc(vendor.portal_contact_name || 'Not listed')}</p><p><strong>Email:</strong> ${esc(vendor.final_contact_email || vendor.portal_email || 'Not listed')}</p><p><strong>Phone:</strong> ${esc(vendor.final_contact_phone || vendor.portal_phone || 'Not listed')}</p><p><strong>Address:</strong> ${esc(vendor.final_contact_address || 'Not listed')}</p><p><strong>Contact Notes:</strong> ${esc(vendor.contact_notes || vendor.website_status || 'Not listed')}</p></div><div><h4>Coverage</h4><p><strong>Website:</strong> ${vendor.website_details ? `<a href="${esc(vendor.website_details)}" target="_blank" rel="noreferrer">${esc(vendor.website_details)}</a>` : 'Not listed'}</p><p><strong>Service locations:</strong> ${esc((vendor.service_locations || []).join(', ') || 'Not listed')}</p><p><strong>Supplier tags:</strong> ${esc((vendor.tags || []).join(', ') || 'Not listed')}</p><p><strong>Selco:</strong> <a href="${esc(vendor.portal_vendor_link || '#')}" target="_blank" rel="noreferrer">Open vendor on Selco Solution Portal</a></p></div></div>${vendor.legacy_products_links ? `<div class="vendor-inline-list"><strong>Legacy Product Links</strong><div>${esc(vendor.legacy_products_links)}</div></div>` : ''}</section><section class="section"><h3>Products Offered</h3><div class="vendor-products-grid">${(vendor.products || []).length ? (vendor.products || []).map((product) => `<article class="vendor-product-card"><div class="vendor-product-media">${product.product_image_url ? `<img class="vendor-product-image" src="${esc(product.product_image_url)}" alt="${esc(product.product_name)}" loading="lazy" referrerpolicy="no-referrer" />` : ''}<div><h4>${esc(product.product_name)}</h4><p>${esc(product.product_description || 'No description available.')}</p>${renderSpecifications(product.product_specifications)}<p><strong>Search tags:</strong> ${esc((product.tags || []).join(', ') || 'Not listed')}</p></div></div><div class="btn-group"><a class="btn btn-warning btn-small" href="${esc(product.product_link || '#')}" target="_blank" rel="noreferrer">View on Selco Solution Portal</a></div></article>`).join('') : '<p>No product offerings were synced for this vendor.</p>'}</div></section>`;
  } catch (error) {
    root.innerHTML = `<section class="section"><p>${esc(error.message || 'Vendor detail could not be loaded.')}</p></section>`;
  }
}

initVendorDetail();
