/* ═══════════════════════════════════════
   Admin Dashboard JavaScript
═══════════════════════════════════════ */

let adminUser = null;
let allDrivers = [];
let allDeliveries = [];
let adminMap = null;
let driverMarkers = {};
let activeDeliveryId = null;
let currentStatusFilter = 'all';
let currentDriverFilter = 'all';
let socket = null;
let adminRouteLines = [];
let selectedDeliveryIds = new Set();

// ─── Init ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  adminUser = auth.requireRole('admin');
  if (!adminUser) return;

  // Populate user info
  document.getElementById('adminName').textContent = adminUser.name;
  document.getElementById('adminEmail').textContent = adminUser.email;
  document.getElementById('adminAvatar').textContent = fmt.initials(adminUser.name);

  // Init sidebar navigation
  initSidebarNav();
  window.onSectionChange = onSectionChange;

  // Load initial data
  await loadStats();
  await loadRecentDeliveries();
  await loadDrivers();
  await loadDeliveries();
  await loadOverviewDrivers();

  // Connect socket
  connectSocket();

  // Auto-refresh stats every 30s
  setInterval(loadStats, 30000);

  // Close modals on overlay click
  ['addDriverModal', 'assignDriverModal', 'deliveryDetailModal', 'deleteDriverModal', 'logoutModal'].forEach(id => modal.closeOnOverlay(id));
});

function openSection(section) {
  document.querySelectorAll('[data-section]').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.page-section').forEach(s => s.classList.remove('active'));
  const btn = document.querySelector(`[data-section="${section}"]`);
  const sec = document.getElementById(`section-${section}`);
  if (btn) btn.classList.add('active');
  if (sec) sec.classList.add('active');
  onSectionChange(section);
}

function onSectionChange(section) {
  const titles = {
    overview: 'Dashboard Overview',
    drivers: 'Driver Management',
    deliveries: 'Delivery Management',
    tracking: 'Live Tracking Map'
  };
  document.getElementById('topbarTitle').textContent = titles[section] || section;
  if (section === 'tracking') initAdminMap();
}

// ─── Socket ────────────────────────────────────────────────────
function connectSocket() {
  socket = createSocket();
  if (!socket) return;

  socket.on('connect', () => console.log('🔌 Socket connected'));

  socket.on('driver:location-update', (data) => {
    updateDriverMarker(data);
  });

  socket.on('driver:online', (data) => {
    toast.info(`🟢 ${data.name} is online`);
    loadStats(); loadDrivers(); loadOverviewDrivers();
  });

  socket.on('driver:offline', (data) => {
    toast.warning(`⚫ ${data.name} went offline`);
    loadStats(); loadDrivers(); loadOverviewDrivers();
    if (driverMarkers[data.driverId]) {
      driverMarkers[data.driverId].setOpacity(0.4);
    }
  });

  socket.on('delivery:new', (data) => {
    toast.info(`📦 New order received! #${data.trackingId}`);
    loadStats(); loadDeliveries(); loadRecentDeliveries();
    document.getElementById('sidebarPendingCount').textContent = parseInt(document.getElementById('sidebarPendingCount').textContent || 0) + 1;
  });

  socket.on('delivery:updated', (data) => {
    loadDeliveries(); loadStats();
  });

  socket.on('delivery:assigned', () => { loadDeliveries(); });
}

// ─── Stats ─────────────────────────────────────────────────────
async function loadStats() {
  try {
    const stats = await api.get('/api/admin/stats');
    document.getElementById('stat-total').textContent = stats.totalDeliveries;
    document.getElementById('stat-pending').textContent = stats.pendingDeliveries;
    document.getElementById('stat-active').textContent = stats.activeDeliveries;
    document.getElementById('stat-completed').textContent = stats.completedDeliveries;
    document.getElementById('stat-drivers').textContent = stats.totalDrivers;
    document.getElementById('stat-online').textContent = stats.onlineDrivers;
    document.getElementById('sidebarDriverCount').textContent = stats.totalDrivers;
    document.getElementById('sidebarPendingCount').textContent = stats.pendingDeliveries;
  } catch (err) { console.error(err); }
}

// ─── Recent Deliveries (overview) ─────────────────────────────
async function loadRecentDeliveries() {
  try {
    const data = await api.get('/api/admin/deliveries?limit=5');
    const el = document.getElementById('recentDeliveriesList');
    if (!data.deliveries.length) {
      el.innerHTML = '<div class="empty-state"><div class="empty-icon">📦</div><p>No deliveries yet</p></div>';
      return;
    }
    el.innerHTML = data.deliveries.map(d => `
      <div class="flex-between" style="padding:8px 0;border-bottom:1px solid var(--glass-border);" onclick="openDeliveryDetail('${d._id}')">
        <div>
          <div style="font-size:13px;font-weight:600;">${d.trackingId}</div>
          <div class="text-xs text-muted">${d.pickup?.address || 'Unknown'}</div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;">
          ${fmt.statusBadge(d.status)}
        </div>
      </div>
    `).join('');
  } catch (err) { console.error(err); }
}

// ─── Overview Drivers ──────────────────────────────────────────
async function loadOverviewDrivers() {
  try {
    const drivers = await api.get('/api/admin/drivers');
    const el = document.getElementById('overviewDriverList');
    if (!drivers.length) {
      el.innerHTML = '<div class="text-muted text-sm" style="padding:16px 0;">No drivers added yet</div>';
      return;
    }
    el.innerHTML = drivers.slice(0, 4).map(d => `
      <div class="driver-card ${d.isOnline ? (d.activeDeliveries > 0 ? 'busy' : 'online') : 'offline'}">
        <div class="avatar" style="background:${d.avatarColor}">${fmt.initials(d.name)}</div>
        <div class="driver-info">
          <div class="driver-name">${d.name}</div>
          <div class="driver-vehicle">${fmt.vehicleIcon(d.vehicleType)} ${d.vehicleNumber || 'No vehicle'}</div>
        </div>
        <span class="badge ${d.isOnline ? 'badge-online' : 'badge-offline'}">
          <span class="dot ${d.isOnline ? 'dot-pulse' : ''}"></span>
          ${d.isOnline ? 'Online' : 'Offline'}
        </span>
      </div>
    `).join('');
  } catch (err) { console.error(err); }
}

// ─── Drivers Section ───────────────────────────────────────────
async function loadDrivers() {
  try {
    allDrivers = await api.get('/api/admin/drivers');
    renderDrivers();
  } catch (err) {
    toast.error('Failed to load drivers');
  }
}

function renderDrivers() {
  const search = document.getElementById('driverSearch')?.value.toLowerCase() || '';
  let filtered = allDrivers.filter(d =>
    d.name.toLowerCase().includes(search) || d.email.toLowerCase().includes(search) ||
    (d.vehicleNumber || '').toLowerCase().includes(search)
  );
  if (currentDriverFilter === 'online') filtered = filtered.filter(d => d.isOnline);
  if (currentDriverFilter === 'offline') filtered = filtered.filter(d => !d.isOnline);

  const grid = document.getElementById('driversGrid');
  if (!filtered.length) {
    grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1"><div class="empty-icon">🚛</div><h3>No drivers found</h3><p>Add your first driver to get started</p></div>';
    return;
  }

  grid.innerHTML = filtered.map(d => `
    <div class="card" style="cursor:default;">
      <div class="flex-between mb-8">
        <div class="flex-center gap-12">
          <div class="avatar avatar-lg" style="background:${d.avatarColor}">${fmt.initials(d.name)}</div>
          <div>
            <div style="font-size:15px;font-weight:700;">${d.name}</div>
            <div class="text-xs text-muted">${d.email}</div>
          </div>
        </div>
        <span class="badge ${d.isOnline ? 'badge-online' : 'badge-offline'}">
          <span class="dot ${d.isOnline ? 'dot-pulse' : ''}"></span>
          ${d.isOnline ? 'Online' : 'Offline'}
        </span>
      </div>
      <hr class="divider" />
      <div class="info-list" style="margin-bottom:12px;">
        <div class="info-row">
          <span class="info-label">Vehicle</span>
          <span class="info-value">${fmt.vehicleIcon(d.vehicleType)} ${d.vehicleType || '—'}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Plate</span>
          <span class="info-value">${d.vehicleNumber || '—'}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Phone</span>
          <span class="info-value">${d.phone || '—'}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Active</span>
          <span class="info-value text-amber">${d.activeDeliveries || 0} deliveries</span>
        </div>
        <div class="info-row">
          <span class="info-label">Total</span>
          <span class="info-value">${d.totalDeliveries || 0} completed</span>
        </div>
      </div>
      <div class="del-actions">
        <button class="btn btn-sm btn-secondary flex-1" onclick="viewDriverOnMap('${d._id}')">🗺️ Track</button>
        <button class="btn btn-sm btn-danger" onclick="openDeleteDriver('${d._id}', '${d.name}')">🗑️</button>
      </div>
    </div>
  `).join('');
}

function filterDrivers() { renderDrivers(); }
function setDriverFilter(f) {
  currentDriverFilter = f;
  document.querySelectorAll('.filter-chips .chip').forEach(c => {
    c.classList.toggle('active', c.dataset.filter === f);
  });
  renderDrivers();
}

// ─── Add Driver ────────────────────────────────────────────────
document.getElementById('addDriverForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('addDriverBtn');
  btn.disabled = true; btn.textContent = 'Adding...';

  try {
    await api.post('/api/admin/drivers', {
      name: document.getElementById('dName').value.trim(),
      email: document.getElementById('dEmail').value.trim(),
      password: document.getElementById('dPassword').value || 'driver123',
      phone: document.getElementById('dPhone').value,
      vehicleNumber: document.getElementById('dVehicleNumber').value,
      vehicleType: document.getElementById('dVehicleType').value
    });
    modal.close('addDriverModal');
    toast.success('Driver added successfully! 🚛');
    document.getElementById('addDriverForm').reset();
    await loadDrivers(); await loadStats();
  } catch (err) {
    toast.error(err.message);
  } finally {
    btn.disabled = false; btn.textContent = 'Add Driver';
  }
});

// ─── Delete Driver ─────────────────────────────────────────────
let driverToDelete = null;
function openDeleteDriver(id, name) {
  driverToDelete = id;
  document.getElementById('deleteDriverName').textContent = name;
  modal.open('deleteDriverModal');
}

async function confirmDeleteDriver() {
  if (!driverToDelete) return;
  try {
    await api.delete(`/api/admin/drivers/${driverToDelete}`);
    modal.close('deleteDriverModal');
    toast.success('Driver deleted');
    driverToDelete = null;
    await loadDrivers(); await loadStats();
  } catch (err) { toast.error(err.message); }
}

// ─── Deliveries Section ────────────────────────────────────────
async function loadDeliveries() {
  try {
    const data = await api.get('/api/admin/deliveries?limit=50');
    allDeliveries = data.deliveries;
    renderDeliveries();
  } catch (err) { toast.error('Failed to load deliveries'); }
}

function renderDeliveries() {
  const search = document.getElementById('deliverySearch')?.value.toLowerCase() || '';
  let filtered = allDeliveries.filter(d => {
    const matchSearch = !search ||
      d.trackingId.toLowerCase().includes(search) ||
      (d.pickup?.address || '').toLowerCase().includes(search) ||
      (d.dropoff?.address || '').toLowerCase().includes(search) ||
      (d.user?.name || '').toLowerCase().includes(search);
    const matchStatus = currentStatusFilter === 'all' || d.status === currentStatusFilter;
    return matchSearch && matchStatus;
  });

  const tbody = document.getElementById('deliveriesTableBody');
  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="8"><div class="empty-state"><div class="empty-icon">📦</div><h3>No deliveries found</h3></div></td></tr>';
    return;
  }

  tbody.innerHTML = filtered.map(d => {
    const canAssign = d.status === 'pending' || d.status === 'assigned';
    return `
    <tr onclick="openDeliveryDetail('${d._id}')">
      <td>
        ${canAssign ? `<input type="checkbox" class="delivery-cb" value="${d._id}" ${selectedDeliveryIds.has(d._id) ? 'checked' : ''} onchange="toggleDeliverySelection(this, '${d._id}')" onclick="event.stopPropagation()" />` : ''}
      </td>
      <td><span class="font-semibold text-accent">${d.trackingId}</span></td>
      <td>
        <div class="flex-center gap-8">
          <div class="avatar avatar-sm" style="background:${d.user?.avatarColor || '#6366f1'}">${fmt.initials(d.user?.name || '?')}</div>
          <div>
            <div style="font-size:13px;font-weight:500;">${d.user?.name || '—'}</div>
            <div class="text-xs text-muted">${d.user?.phone || ''}</div>
          </div>
        </div>
      </td>
      <td>
        <div class="text-xs text-muted truncate" style="max-width:160px;">${d.pickup?.address || 'N/A'}</div>
        <div class="text-xs" style="color:var(--accent-hover)">→ ${d.dropoff?.address || 'N/A'}</div>
      </td>
      <td>
        ${d.driver ? `
          <div class="flex-center gap-8">
            <div class="avatar avatar-sm" style="background:${d.driver.avatarColor}">${fmt.initials(d.driver.name)}</div>
            <span style="font-size:13px;">${d.driver.name}</span>
          </div>` : '<span class="text-muted text-xs">Unassigned</span>'}
      </td>
      <td>${fmt.statusBadge(d.status)}</td>
      <td>${fmt.priorityBadge(d.priority)}</td>
      <td class="text-xs text-muted">${fmt.timeAgo(d.createdAt)}</td>
      <td onclick="event.stopPropagation()">
        <div class="del-actions">
          ${d.status === 'pending' || d.status === 'assigned' ? `
            <button class="btn btn-sm btn-primary" onclick="openAssignDriver('${d._id}')">🔗 Assign</button>
          ` : ''}
          <button class="btn btn-sm btn-secondary" onclick="openDeliveryDetail('${d._id}')">👁️</button>
        </div>
      </td>
    </tr>
    `;
  }).join('');
}

function toggleAllDeliveries(checkbox) {
  const cbs = document.querySelectorAll('.delivery-cb');
  cbs.forEach(cb => {
    cb.checked = checkbox.checked;
    if (checkbox.checked) selectedDeliveryIds.add(cb.value);
    else selectedDeliveryIds.delete(cb.value);
  });
  updateBulkAssignButton();
}

function toggleDeliverySelection(checkbox, id) {
  if (checkbox.checked) selectedDeliveryIds.add(id);
  else selectedDeliveryIds.delete(id);
  updateBulkAssignButton();
}

function updateBulkAssignButton() {
  const btn = document.getElementById('bulkAssignBtn');
  if (selectedDeliveryIds.size > 0) {
    btn.style.display = 'block';
    btn.innerHTML = `🔗 Assign Selected (${selectedDeliveryIds.size})`;
  } else {
    btn.style.display = 'none';
  }
}

function filterDeliveries() { renderDeliveries(); updateBulkAssignButton(); }
function setStatusFilter(status) {
  currentStatusFilter = status;
  document.querySelectorAll('#statusFilterChips .chip').forEach(c => {
    c.classList.toggle('active', c.dataset.status === status);
  });
  renderDeliveries();
  updateBulkAssignButton();
}

// ─── Assign Driver ─────────────────────────────────────────────
async function openAssignDriver(deliveryId) {
  activeDeliveryId = deliveryId;
  const delivery = allDeliveries.find(d => d._id === deliveryId);

  document.getElementById('assignDeliveryInfo').innerHTML = `
    <div class="info-list">
      <div class="info-row"><span class="info-label">Tracking ID</span><span class="info-value text-accent">${delivery.trackingId}</span></div>
      <div class="info-row"><span class="info-label">From</span><span class="info-value">${delivery.pickup?.address || 'N/A'}</span></div>
      <div class="info-row"><span class="info-label">To</span><span class="info-value">${delivery.dropoff?.address || 'N/A'}</span></div>
      <div class="info-row"><span class="info-label">Package</span><span class="info-value">${delivery.packageDescription}</span></div>
    </div>
  `;
  populateAvailableDrivers();
  modal.open('assignDriverModal');
}

async function openBulkAssignModal() {
  if (selectedDeliveryIds.size === 0) return;
  activeDeliveryId = 'bulk';
  document.getElementById('assignDeliveryInfo').innerHTML = `
    <div style="text-align:center; padding:10px;">
      <div style="font-size:24px; margin-bottom:10px;">📦</div>
      <div style="font-size:16px; font-weight:700;">Assign ${selectedDeliveryIds.size} Deliveries</div>
      <div style="color:var(--text-3); font-size:13px; margin-top:4px;">You are assigning multiple deliveries to a single truck as a manifest.</div>
    </div>
  `;
  populateAvailableDrivers();
  modal.open('assignDriverModal');
}

function populateAvailableDrivers() {
  const available = allDrivers.filter(d => d.isOnline && d.isAvailable);
  const select = document.getElementById('assignDriverSelect');
  select.innerHTML = '<option value="">— Choose driver —</option>';
  allDrivers.forEach(d => {
    const option = document.createElement('option');
    option.value = d._id;
    option.textContent = `${d.isOnline ? '🟢' : '⚫'} ${d.name} — ${fmt.vehicleIcon(d.vehicleType)} ${d.vehicleType} (${d.activeDeliveries} active)`;
    select.appendChild(option);
  });
}

async function confirmAssignDriver() {
  const driverId = document.getElementById('assignDriverSelect').value;
  if (!driverId) { toast.warning('Please select a driver'); return; }

  const confirmBtn = document.getElementById('confirmAssignBtn');
  const cancelBtn = document.getElementById('cancelAssignBtn');
  
  // Visual Loading State
  confirmBtn.disabled = true;
  cancelBtn.disabled = true;
  const originalText = confirmBtn.innerHTML;
  confirmBtn.innerHTML = '<span>⏳</span> Assigning...';

  try {
    const idsToAssign = activeDeliveryId === 'bulk' ? Array.from(selectedDeliveryIds) : [activeDeliveryId];
    
    // Assign sequentially (to avoid hammering the server if there are many)
    for (const id of idsToAssign) {
      await api.put(`/api/admin/deliveries/${id}/assign`, { driverId });
    }
    
    // Clear selection
    selectedDeliveryIds.clear();
    const selectAllCb = document.getElementById('selectAllDeliveries');
    if (selectAllCb) selectAllCb.checked = false;
    updateBulkAssignButton();
    
    modal.close('assignDriverModal');
    toast.success(`🎉 Successfully assigned ${idsToAssign.length} deliveries!`);
    await loadDeliveries(); await loadStats();
  } catch (err) { 
    toast.error(err.message); 
  } finally {
    // Reset button state
    confirmBtn.disabled = false;
    cancelBtn.disabled = false;
    confirmBtn.innerHTML = originalText;
  }
}

// ─── Delivery Detail Modal ─────────────────────────────────────
async function openDeliveryDetail(deliveryId) {
  modal.open('deliveryDetailModal');
  document.getElementById('deliveryDetailContent').innerHTML = '<div class="skeleton" style="height:300px;"></div>';

  try {
    const { delivery: d, events } = await api.get(`/api/admin/deliveries/${deliveryId}`);
    const statusOrder = ['order_placed', 'driver_assigned', 'picked_up', 'in_transit', 'out_for_delivery', 'delivered'];
    const doneEvents = new Set(events.map(e => e.event));
    const lastEvent = events[events.length - 1]?.event;

    document.getElementById('deliveryDetailContent').innerHTML = `
      <div class="form-grid mb-16">
        <div>
          <div class="text-xs text-muted mb-4">Tracking ID</div>
          <div class="font-bold text-accent" style="font-size:15px;">${d.trackingId}</div>
        </div>
        <div>
          <div class="text-xs text-muted mb-4">Status</div>
          ${fmt.statusBadge(d.status)}
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px;">
        <div class="card">
          <div class="text-xs text-muted font-semibold mb-8">📍 PICKUP</div>
          <div style="font-size:13px;">${d.pickup?.address || 'N/A'}</div>
          <div class="text-xs text-muted">${d.pickup?.lat?.toFixed(4)}, ${d.pickup?.lng?.toFixed(4)}</div>
        </div>
        <div class="card">
          <div class="text-xs text-muted font-semibold mb-8">🏁 DROPOFF</div>
          <div style="font-size:13px;">${d.dropoff?.address || 'N/A'}</div>
          <div class="text-xs text-muted">${d.dropoff?.lat?.toFixed(4)}, ${d.dropoff?.lng?.toFixed(4)}</div>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px;">
        <div class="card">
          <div class="text-xs text-muted font-semibold mb-8">👤 CUSTOMER</div>
          ${d.user ? `<div style="font-size:13px;font-weight:600;">${d.user.name}</div><div class="text-xs text-muted">${d.user.email}</div><div class="text-xs text-muted">${d.user.phone || ''}</div>` : '—'}
        </div>
        <div class="card">
          <div class="text-xs text-muted font-semibold mb-8">🚛 DRIVER</div>
          ${d.driver ? `<div style="font-size:13px;font-weight:600;">${d.driver.name}</div><div class="text-xs text-muted">${d.driver.phone || ''}</div><div class="text-xs text-muted">${fmt.vehicleIcon(d.driver.vehicleType)} ${d.driver.vehicleNumber || ''}</div>` : '<span class="text-muted">Not assigned</span>'}
        </div>
      </div>

      <div class="card">
        <div class="card-title mb-8">📍 Tracking Timeline</div>
        <ul class="timeline">
          ${events.map((ev, i) => `
            <li class="timeline-item ${i < events.length - 1 ? 'done' : 'active'}">
              <div class="timeline-event">${formatEventName(ev.event)}</div>
              <div class="timeline-desc">${ev.description}</div>
              <div class="timeline-time">${fmt.datetime(ev.timestamp)}</div>
            </li>
          `).join('')}
        </ul>
      </div>
    `;
  } catch (err) {
    document.getElementById('deliveryDetailContent').innerHTML = `<div class="text-red">Failed to load: ${err.message}</div>`;
  }
}

function formatEventName(event) {
  const names = {
    order_placed: '📋 Order Placed', driver_assigned: '🔗 Driver Assigned',
    picked_up: '📦 Picked Up', in_transit: '🚛 In Transit',
    reached_checkpoint: '📍 Checkpoint Reached', out_for_delivery: '🏃 Out for Delivery',
    delivered: '✅ Delivered', cancelled: '❌ Cancelled'
  };
  return names[event] || event;
}

// ─── Admin Map ─────────────────────────────────────────────────
function initAdminMap() {
  if (adminMap) { setTimeout(() => adminMap.invalidateSize(), 200); return; }

  adminMap = L.map('adminMap').setView([20.5937, 78.9629], 5);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap'
  }).addTo(adminMap);

  loadMapDrivers();
  setInterval(loadMapDrivers, 5000);
}

async function loadMapDrivers() {
  try {
    const drivers = await api.get('/api/admin/drivers');
    const listEl = document.getElementById('trackingDriverList');
    const onlineDrivers = drivers.filter(d => d.isOnline);

    document.getElementById('onlineCount').textContent = onlineDrivers.length;

    // Update markers
    drivers.forEach(d => {
      if (!d.currentLocation || !adminMap) return;
      const { lat, lng } = d.currentLocation;
      const color = d.isOnline ? (d.activeDeliveries > 0 ? '#f59e0b' : '#10b981') : '#64748b';

      const icon = L.divIcon({
        className: '',
        html: `<div style="
          width:34px;height:34px;border-radius:50%;
          background:${d.avatarColor || color};
          border:3px solid ${color};
          display:flex;align-items:center;justify-content:center;
          color:white;font-size:11px;font-weight:700;
          box-shadow:0 2px 10px rgba(0,0,0,0.4);
          ${d.isOnline ? `box-shadow:0 0 0 4px ${color}33,0 2px 10px rgba(0,0,0,0.4);` : ''}
        ">${fmt.initials(d.name)}</div>`,
        iconSize: [34, 34],
        iconAnchor: [17, 17]
      });

      if (driverMarkers[d._id]) {
        driverMarkers[d._id].setLatLng([lat, lng]).setIcon(icon);
      } else {
        const marker = L.marker([lat, lng], { icon })
          .bindPopup(`
            <div class="map-driver-popup">
              <h4>${d.name}</h4>
              <p>${fmt.vehicleIcon(d.vehicleType)} ${d.vehicleType} • ${d.vehicleNumber || 'No plate'}</p>
              <p style="margin-top:4px;">${d.isOnline ? '🟢 Online' : '⚫ Offline'} • ${d.activeDeliveries || 0} active delivery</p>
            </div>
          `)
          .addTo(adminMap);
        driverMarkers[d._id] = marker;
      }
      if (d.isOnline) {
        driverMarkers[d._id]?.setOpacity(1);
      } else {
        driverMarkers[d._id]?.setOpacity(0.4);
      }
    });
    
    // Draw active routes
    adminRouteLines.forEach(line => adminMap.removeLayer(line));
    adminRouteLines = [];
    allDeliveries.forEach(del => {
      if (['picked_up', 'in_transit', 'out_for_delivery'].includes(del.status) && del.routeWaypoints?.length > 0) {
        const line = L.polyline(del.routeWaypoints.map(p => [p.lat, p.lng]), {
          color: '#6366f1', weight: 4, opacity: 0.6, dashArray: '8, 8'
        }).addTo(adminMap);
        adminRouteLines.push(line);
      }
    });

    // Update sidebar list
    listEl.innerHTML = onlineDrivers.length ? onlineDrivers.map(d => `
      <div class="driver-card ${d.activeDeliveries > 0 ? 'busy' : 'online'}" onclick="focusDriverOnMap('${d._id}', ${d.currentLocation.lat}, ${d.currentLocation.lng})">
        <div class="avatar" style="background:${d.avatarColor}">${fmt.initials(d.name)}</div>
        <div class="driver-info">
          <div class="driver-name">${d.name}</div>
          <div class="driver-vehicle">${fmt.vehicleIcon(d.vehicleType)} ${d.vehicleNumber || 'No plate'}</div>
          <div class="text-xs ${d.activeDeliveries > 0 ? 'text-amber' : 'text-green'}">${d.activeDeliveries > 0 ? `📦 ${d.activeDeliveries} active` : '✅ Available'}</div>
        </div>
      </div>
    `).join('') : '<div class="empty-state" style="padding:30px 0;"><div class="empty-icon" style="font-size:32px;">📡</div><p>No drivers online</p></div>';

  } catch (err) { console.error('Map load error:', err); }
}

function updateDriverMarker(data) {
  if (!adminMap) return;
  const { driverId, lat, lng, avatarColor, name } = data;
  if (driverMarkers[driverId]) {
    driverMarkers[driverId].setLatLng([lat, lng]);
  }
}

function focusDriverOnMap(driverId, lat, lng) {
  openSection('tracking');
  setTimeout(() => {
    if (adminMap) {
      adminMap.setView([lat, lng], 13, { animate: true });
      driverMarkers[driverId]?.openPopup();
    }
  }, 300);
}

function viewDriverOnMap(driverId) {
  const driver = allDrivers.find(d => d._id === driverId);
  if (driver?.currentLocation) {
    focusDriverOnMap(driverId, driver.currentLocation.lat, driver.currentLocation.lng);
  }
}

// ─── Misc ──────────────────────────────────────────────────────
async function refreshAll() {
  const btn = document.getElementById('refreshBtn');
  btn.classList.add('spinning');
  await Promise.all([loadStats(), loadDrivers(), loadDeliveries(), loadRecentDeliveries(), loadOverviewDrivers()]);
  setTimeout(() => btn.classList.remove('spinning'), 500);
  toast.success('Data refreshed!');
}

function logout() {
  if (socket) socket.disconnect();
  auth.clear();
  window.location.href = '/login.html';
}
