const loginForm = document.getElementById('loginForm');
const loginStatus = document.getElementById('loginStatus');
const sessionStatus = document.getElementById('sessionStatus');
const sessionPanel = document.getElementById('sessionPanel');
const selcoSyncPanel = document.getElementById('selcoSyncPanel');
const selcoSyncMeta = document.getElementById('selcoSyncMeta');
const selcoSyncRuns = document.getElementById('selcoSyncRuns');
const runSelcoSyncButton = document.getElementById('runSelcoSync');
const signOutButton = document.getElementById('signOutButton');

const ADMIN_SESSION_KEY = 'selco-vendor-admin-session';

function setStatus(element, message, isError = false) {
  element.textContent = message;
  element.classList.toggle('error', Boolean(isError));
}

function escapeHtml(value) {
  return String(value || '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
}

function formatDate(value) {
  if (!value) return 'Unknown date';
  return new Date(value).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

function getStoredToken() {
  return window.sessionStorage.getItem(ADMIN_SESSION_KEY) || '';
}

function storeToken(token) {
  if (token) window.sessionStorage.setItem(ADMIN_SESSION_KEY, token);
  else window.sessionStorage.removeItem(ADMIN_SESSION_KEY);
}

function updateSessionUi(isSignedIn) {
  loginForm.style.display = isSignedIn ? 'none' : 'grid';
  sessionPanel.classList.toggle('active', Boolean(isSignedIn));
  selcoSyncPanel.classList.toggle('active', Boolean(isSignedIn));
}

function renderSelcoSyncRuns(items) {
  selcoSyncRuns.innerHTML = '';
  if (!items.length) {
    selcoSyncRuns.innerHTML = '<article class="admin-card"><p>No Selco sync runs yet.</p></article>';
    return;
  }
  items.forEach((item) => {
    const card = document.createElement('article');
    card.className = 'admin-card';
    card.innerHTML = `<div class="admin-card-header"><h4>${escapeHtml(item.status || 'unknown')}</h4><span class="admin-badge ${item.status === 'success' ? 'approved' : ''}">${escapeHtml(item.status || 'unknown')}</span></div><p><strong>Requested By:</strong> ${escapeHtml(item.requested_by || 'Unknown')}</p><p><strong>Started:</strong> ${escapeHtml(formatDate(item.started_at || item.created_at))}</p><p><strong>Finished:</strong> ${escapeHtml(formatDate(item.finished_at))}</p><p><strong>Vendors:</strong> ${escapeHtml(String(item.vendor_count || 0))}</p><p><strong>Products:</strong> ${escapeHtml(String(item.product_count || 0))}</p><p><strong>Error:</strong> ${escapeHtml(item.error_message || 'None')}</p>`;
    selcoSyncRuns.appendChild(card);
  });
}

async function verifySession() {
  const token = getStoredToken();
  if (!token) {
    updateSessionUi(false);
    return false;
  }
  try {
    const data = await SelcoVendorStore.adminRequest('verify', { token });
    if (!data?.valid) throw new Error('Session invalid');
    updateSessionUi(true);
    return true;
  } catch {
    storeToken('');
    updateSessionUi(false);
    selcoSyncMeta.textContent = 'Your admin session has expired. Please sign in again.';
    return false;
  }
}

async function loadSelcoSyncRuns() {
  const token = getStoredToken();
  if (!token) {
    selcoSyncMeta.textContent = 'Sign in as admin to view and run sync operations.';
    selcoSyncRuns.innerHTML = '';
    return;
  }
  selcoSyncMeta.textContent = 'Loading Selco sync history...';
  try {
    const data = await SelcoVendorStore.adminRequest('listSelcoSyncRuns', { token });
    const items = Array.isArray(data?.items) ? data.items : [];
    selcoSyncMeta.textContent = `${items.length} Selco sync run${items.length === 1 ? '' : 's'} recorded`;
    renderSelcoSyncRuns(items);
  } catch (error) {
    selcoSyncMeta.textContent = error.message || 'Selco sync history could not be loaded.';
  }
}

async function runSelcoSync() {
  runSelcoSyncButton.disabled = true;
  setStatus(sessionStatus, 'Running Selco vendor sync...');
  try {
    const data = await SelcoVendorStore.adminRequest('syncSelcoVendors', { token: getStoredToken() });
    setStatus(sessionStatus, `Selco sync completed: ${data.vendorCount || 0} vendors and ${data.productCount || 0} products.`);
    await loadSelcoSyncRuns();
  } catch (error) {
    setStatus(sessionStatus, error.message || 'Selco sync failed.', true);
  } finally {
    runSelcoSyncButton.disabled = false;
  }
}

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const password = String(document.getElementById('adminPassword').value || '').trim();
  if (!password) {
    setStatus(loginStatus, 'Enter the admin password.', true);
    return;
  }
  setStatus(loginStatus, 'Signing in...');
  try {
    const data = await SelcoVendorStore.adminRequest('login', { password });
    if (!data?.token) throw new Error('Admin login failed.');
    storeToken(data.token);
    document.getElementById('adminPassword').value = '';
    updateSessionUi(true);
    setStatus(loginStatus, 'Signed in successfully.');
    await loadSelcoSyncRuns();
  } catch (error) {
    setStatus(loginStatus, error.message || 'Admin login failed.', true);
  }
});

signOutButton.addEventListener('click', async () => {
  const token = getStoredToken();
  try {
    if (token) await SelcoVendorStore.adminRequest('logout', { token });
  } catch {}
  storeToken('');
  updateSessionUi(false);
  selcoSyncMeta.textContent = 'Sign in as admin to view and run sync operations.';
  selcoSyncRuns.innerHTML = '';
  setStatus(sessionStatus, '');
  setStatus(loginStatus, '');
});

runSelcoSyncButton.addEventListener('click', async () => { await runSelcoSync(); });

(async () => {
  const valid = await verifySession();
  if (valid) await loadSelcoSyncRuns();
})();
