/* ═══════════════════════════════════════
   User Dashboard JavaScript
═══════════════════════════════════════ */

let userUser = null;
let orderMap = null;
let trackMap = null;
let pickupMarker = null;
let dropoffMarker = null;
let mapMode = 'pickup'; // 'pickup' or 'dropoff'
let myOrders = [];
let socket = null;
let currentTrackDelivery = null;
let trackDriverMarker = null;

// ─── MILESTONES CONFIG ──────────────────────────────────────────
const MILESTONES = [
  { event: 'order_placed',      icon: '📋', label: 'Ordered' },
  { event: 'driver_assigned',   icon: '🔗', label: 'Assigned' },
  { event: 'picked_up',         icon: '📦', label: 'Picked Up' },
  { event: 'in_transit',        icon: '🚛', label: 'In Transit' },
  { event: 'out_for_delivery',  icon: '🏃', label: 'Out for Del.' },
  { event: 'delivered',         icon: '✅', label: 'Delivered' }
];

const EVENT_NAMES = {
  order_placed: '📋 Order Placed', driver_assigned: '🔗 Driver Assigned',
  picked_up: '📦 Picked Up', in_transit: '🚛 In Transit',
  reached_checkpoint: '📍 Checkpoint', out_for_delivery: '🏃 Out for Delivery',
  delivered: '✅ Delivered', cancelled: '❌ Cancelled'
};

// ─── INIT ───────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  userUser = auth.requireRole('user');
  if (!userUser) return;

  document.getElementById('userName').textContent = userUser.name;
  document.getElementById('userEmail').textContent = userUser.email;
  document.getElementById('userAvatar').textContent = fmt.initials(userUser.name);
  document.getElementById('userAvatar').style.background = userUser.avatarColor || '#3b82f6';

  initSidebarNav();
  window.onSectionChange = onSectionChange;

  await loadOrders();
  connectSocket();
  modal.closeOnOverlay('logoutModal');
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
  const titles = { 'orders': 'My Orders', 'place-order': 'Place New Order', 'track': 'Track Package' };
  document.getElementById('topbarTitle').textContent = titles[section] || section;
  if (section === 'place-order') initOrderMap();
}

// ─── SOCKET ─────────────────────────────────────────────────────
function connectSocket() {
  socket = createSocket();
  if (!socket) return;

  socket.on('delivery:milestone', (data) => {
    showNotification(`📦 Update: ${data.description}`, data.trackingId);
    loadOrders();
    // If currently tracking this delivery, refresh
    if (currentTrackDelivery && (currentTrackDelivery._id === data.deliveryId || currentTrackDelivery.trackingId === data.trackingId)) {
      trackDelivery(currentTrackDelivery._id);
    }
  });

  socket.on('delivery:updated', () => { loadOrders(); });
  
  socket.on('driver:location-update', (data) => {
    if (currentTrackDelivery && trackMap) {
      // Create or move truck marker
      if (!trackDriverMarker) {
        const icon = L.divIcon({
          className: '',
          html: `<div style="width:32px;height:32px;border-radius:50%;background:${data.avatarColor || '#3b82f6'};border:2px solid white;display:flex;align-items:center;justify-content:center;color:white;font-size:16px;box-shadow:0 2px 5px rgba(0,0,0,0.3);">🚛</div>`,
          iconSize: [32,32], iconAnchor: [16,16]
        });
        trackDriverMarker = L.marker([data.lat, data.lng], { icon }).addTo(trackMap).bindPopup('Driver is here');
      } else {
        trackDriverMarker.setLatLng([data.lat, data.lng]);
      }
      
      // Pan if the truck is moving
      trackMap.panTo([data.lat, data.lng], { animate: true, duration: 1 });
    }
  });
}

function showNotification(title, trackingId) {
  const banner = document.getElementById('notifBanner');
  document.getElementById('notifTitle').textContent = title;
  document.getElementById('notifDesc').textContent = `Tracking ID: ${trackingId}`;
  banner.style.display = 'block';
  setTimeout(() => { banner.style.display = 'none'; }, 6000);
}

// ─── ORDERS ─────────────────────────────────────────────────────
async function loadOrders() {
  try {
    myOrders = await api.get('/api/user/orders');
    const activeCount = myOrders.filter(o =>
      ['assigned', 'picked_up', 'in_transit', 'out_for_delivery'].includes(o.status)
    ).length;
    document.getElementById('activeOrderCount').textContent = activeCount;
    renderOrders();
  } catch (err) { toast.error('Failed to load orders'); }
}

function renderOrders() {
  const el = document.getElementById('ordersList');
  if (!myOrders.length) {
    el.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📭</div>
        <h3>No orders yet</h3>
        <p>Place your first order to get started!</p>
        <button class="btn btn-primary btn-lg" style="margin-top:16px;" onclick="openSection('place-order')">+ Place Order</button>
      </div>`;
    return;
  }

  el.innerHTML = myOrders.map(o => `
    <div class="order-card ${currentTrackDelivery?._id === o._id ? 'active-track' : ''}" onclick="viewOrderTracking('${o._id}')">
      <div class="flex-between mb-8">
        <div class="flex-center gap-8">
          <div style="font-size:22px;">${o.status === 'delivered' ? '✅' : o.status === 'cancelled' ? '❌' : '📦'}</div>
          <div>
            <div class="font-semibold text-accent" style="font-size:14px;">${o.trackingId}</div>
            <div class="text-xs text-muted">${fmt.timeAgo(o.createdAt)}</div>
          </div>
        </div>
        ${fmt.statusBadge(o.status)}
      </div>
      <div class="text-xs text-muted truncate" style="margin-bottom:4px;">
        <span class="text-green">📍</span> ${o.pickup?.address || 'N/A'}
      </div>
      <div class="text-xs text-muted truncate">
        <span style="color:var(--red);">🏁</span> ${o.dropoff?.address || 'N/A'}
      </div>
      ${o.driver ? `
        <div class="flex-center gap-8 mt-4">
          <div class="avatar avatar-sm" style="background:${o.driver.avatarColor}">${fmt.initials(o.driver.name)}</div>
          <span class="text-xs">Driver: <strong>${o.driver.name}</strong></span>
          ${fmt.vehicleIcon(o.driver.vehicleType)}
        </div>` : ''}
      <div style="text-align:right;margin-top:6px;">
        <span class="text-xs" style="color:var(--accent-hover);">Click to track →</span>
      </div>
    </div>
  `).join('');
}

async function viewOrderTracking(orderId) {
  openSection('track');
  await trackDelivery(orderId);
}

// ─── TRACK ──────────────────────────────────────────────────────
async function trackById() {
  const id = document.getElementById('trackingInput').value.trim();
  if (!id) { toast.warning('Enter a tracking ID'); return; }

  // Find in existing orders first
  const existing = myOrders.find(o => o.trackingId === id);
  if (existing) {
    await trackDelivery(existing._id);
    return;
  }

  try {
    const data = await api.get(`/api/user/track/${id}`);
    renderTrackResult(data.delivery, data.events);
  } catch (err) {
    document.getElementById('trackResult').style.display = 'none';
    document.getElementById('trackEmpty').style.display = 'block';
    toast.error('Tracking ID not found');
  }
}

async function trackDelivery(orderId) {
  try {
    const { delivery, events } = await api.get(`/api/user/orders/${orderId}`);
    currentTrackDelivery = delivery;
    document.getElementById('trackingInput').value = delivery.trackingId;
    renderTrackResult(delivery, events);
  } catch (err) { toast.error('Failed to load tracking info'); }
}

function renderTrackResult(delivery, events) {
  document.getElementById('trackResult').style.display = 'block';
  document.getElementById('trackEmpty').style.display = 'none';
  document.getElementById('trackIdDisplay').textContent = delivery.trackingId;
  document.getElementById('trackStatusBadge').innerHTML = fmt.statusBadge(delivery.status);

  // Milestone row
  const doneEvents = new Set(events.map(e => e.event));
  const lastIdx = MILESTONES.findIndex(m => m.event === (delivery.status === 'in_transit' ? 'in_transit' : delivery.status));

  document.getElementById('milestonesRow').innerHTML = MILESTONES.map((m, i) => {
    const isDone = doneEvents.has(m.event) && i < MILESTONES.findIndex(ms => ms.event === (events[events.length-1]?.event));
    const isActive = doneEvents.has(m.event) && !isDone;
    const state = isActive || (i === MILESTONES.findIndex(ms => ms.event === events[events.length-1]?.event)) ? 'active' : doneEvents.has(m.event) ? 'done' : '';
    // Simplified: mark all events that happened as done, last as active
    const happened = doneEvents.has(m.event);
    const isLast = m.event === events[events.length - 1]?.event;
    return `
      <div class="milestone ${isLast ? 'active' : happened ? 'done' : ''}">
        <div class="milestone-icon">${m.icon}</div>
        <div class="milestone-label">${m.label}</div>
      </div>
    `;
  }).join('');

  // Last event card
  const lastEvent = events[events.length - 1];
  document.getElementById('lastEventCard').innerHTML = lastEvent ? `
    <div class="card" style="background:var(--accent-light);border-color:rgba(99,102,241,0.2);">
      <div class="flex-center gap-12">
        <div style="font-size:28px;">📍</div>
        <div>
          <div style="font-size:11px;font-weight:700;color:var(--accent-hover);letter-spacing:0.05em;">LATEST UPDATE</div>
          <div style="font-size:14px;font-weight:700;margin-top:2px;">${lastEvent.description}</div>
          <div class="text-xs text-muted mt-4">${fmt.datetime(lastEvent.timestamp)}</div>
        </div>
      </div>
    </div>` : '';

  // Driver info
  const driverEl = document.getElementById('driverInfoCard');
  if (delivery.driver) {
    driverEl.style.display = 'block';
    document.getElementById('driverInfoContent').innerHTML = `
      <div class="flex-center gap-12">
        <div class="avatar avatar-lg" style="background:${delivery.driver.avatarColor}">${fmt.initials(delivery.driver.name)}</div>
        <div>
          <div style="font-size:15px;font-weight:700;">${delivery.driver.name}</div>
          <div class="text-sm text-muted">${delivery.driver.phone || '—'}</div>
          <div class="text-xs text-muted">${fmt.vehicleIcon(delivery.driver.vehicleType)} ${delivery.driver.vehicleNumber || 'No plate'}</div>
        </div>
      </div>
    `;
  } else {
    driverEl.style.display = 'none';
  }

  // Timeline
  document.getElementById('trackTimeline').innerHTML = events.map((ev, i) => `
    <li class="timeline-item ${i === events.length - 1 ? 'active' : 'done'}">
      <div class="timeline-event">${EVENT_NAMES[ev.event] || ev.event}</div>
      <div class="timeline-desc">${ev.description}</div>
      <div class="timeline-time">${fmt.datetime(ev.timestamp)}</div>
    </li>
  `).join('') || '<li class="timeline-item"><div class="timeline-desc text-muted">No events yet</div></li>';

  // Static map
  initTrackMap(delivery);
}

function initTrackMap(delivery) {
  const center = [delivery.pickup.lat, delivery.pickup.lng];

  if (!trackMap) {
    trackMap = L.map('trackMap').setView(center, 10);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap'
    }).addTo(trackMap);
  } else {
    trackMap.setView(center, 10);
    trackMap.eachLayer(l => { 
      if (l instanceof L.Marker || l instanceof L.Polyline) trackMap.removeLayer(l); 
    });
  }
  trackDriverMarker = null;

  // Only show pickup and dropoff — NO live GPS for user
  const pickupIcon = L.divIcon({ className: '', html: `<div style="font-size:24px;">📍</div>`, iconSize:[24,24], iconAnchor:[12,24] });
  const dropoffIcon = L.divIcon({ className: '', html: `<div style="font-size:24px;">🏁</div>`, iconSize:[24,24], iconAnchor:[12,24] });

  L.marker([delivery.pickup.lat, delivery.pickup.lng], { icon: pickupIcon })
    .bindPopup(`<b>Pickup</b><br>${delivery.pickup.address || 'Pickup location'}`)
    .addTo(trackMap);

  L.marker([delivery.dropoff.lat, delivery.dropoff.lng], { icon: dropoffIcon })
    .bindPopup(`<b>Dropoff</b><br>${delivery.dropoff.address || 'Dropoff location'}`)
    .addTo(trackMap);

  // Draw a simple dotted line between pickup and dropoff (NOT live route)
  L.polyline([
    [delivery.pickup.lat, delivery.pickup.lng],
    [delivery.dropoff.lat, delivery.dropoff.lng]
  ], { color: '#6366f1', weight: 3, dashArray: '8, 8', opacity: 0.6 }).addTo(trackMap);

  trackMap.fitBounds([
    [delivery.pickup.lat, delivery.pickup.lng],
    [delivery.dropoff.lat, delivery.dropoff.lng]
  ], { padding: [30, 30] });

  setTimeout(() => trackMap.invalidateSize(), 200);
}

// ─── ORDER MAP ──────────────────────────────────────────────────
function initOrderMap() {
  if (orderMap) { setTimeout(() => orderMap.invalidateSize(), 200); return; }

  orderMap = L.map('orderMap').setView([20.5937, 78.9629], 5);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap'
  }).addTo(orderMap);

  orderMap.on('click', onMapClick);

  // Search input handler
  const searchInput = document.getElementById('mapSearchInput');
  if (searchInput) {
    searchInput.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const query = searchInput.value.trim();
        if (!query) return;
        
        try {
          const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}`);
          const data = await res.json();
          if (data && data.length > 0) {
            const { lat, lon, display_name } = data[0];
            orderMap.setView([lat, lon], 13);
            setPinLocation(lat, lon, display_name);
          } else {
            toast.warning('Address not found');
          }
        } catch (err) {
          toast.error('Search failed');
        }
      }
    });
  }
}

async function onMapClick(e) {
  const { lat, lng } = e.latlng;
  let address = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`);
    const data = await res.json();
    if (data && data.display_name) {
      // Clean up the long string for the form
      const parts = data.display_name.split(', ');
      address = parts.slice(0, 3).join(', '); 
    }
  } catch (err) { console.error('Geocode err:', err); }

  setPinLocation(lat, lng, address);
}

function setPinLocation(lat, lng, address) {
  if (mapMode === 'pickup') {
    if (pickupMarker) orderMap.removeLayer(pickupMarker);
    const icon = L.divIcon({ className: '', html: `<div style="font-size:28px;">📍</div>`, iconSize:[28,28], iconAnchor:[14,28] });
    pickupMarker = L.marker([lat, lng], { icon }).addTo(orderMap).bindPopup('Pickup: ' + address).openPopup();
    document.getElementById('pickupLat').value = lat;
    document.getElementById('pickupLng').value = lng;
    document.getElementById('pickupAddress').value = address;

    mapMode = 'dropoff';
    updateMapModeBtn();
    toast.info('📍 Pickup set! Now click or search for Dropoff');
    document.getElementById('mapSearchInput').value = '';
    document.getElementById('mapSearchInput').placeholder = 'Search dropoff address...';
    
  } else {
    if (dropoffMarker) orderMap.removeLayer(dropoffMarker);
    const icon = L.divIcon({ className: '', html: `<div style="font-size:28px;">🏁</div>`, iconSize:[28,28], iconAnchor:[14,28] });
    dropoffMarker = L.marker([lat, lng], { icon }).addTo(orderMap).bindPopup('Dropoff: ' + address).openPopup();
    document.getElementById('dropoffLat').value = lat;
    document.getElementById('dropoffLng').value = lng;
    document.getElementById('dropoffAddress').value = address;

    mapMode = 'pickup';
    updateMapModeBtn();
    toast.success('🏁 Dropoff set! Fill in the form and place your order.');
    document.getElementById('mapSearchInput').value = '';
    document.getElementById('mapSearchInput').placeholder = 'Search pickup address...';
  }
}

function toggleMapMode() {
  mapMode = mapMode === 'pickup' ? 'dropoff' : 'pickup';
  updateMapModeBtn();
}

function updateMapModeBtn() {
  const btn = document.getElementById('mapModeBtn');
  if (mapMode === 'pickup') {
    btn.textContent = '📍 Setting: Pickup';
    btn.style.background = 'var(--green-light)';
    btn.style.color = 'var(--green)';
  } else {
    btn.textContent = '🏁 Setting: Dropoff';
    btn.style.background = 'var(--red-light)';
    btn.style.color = 'var(--red)';
  }
}

function resetMapPins() {
  if (pickupMarker) { orderMap.removeLayer(pickupMarker); pickupMarker = null; }
  if (dropoffMarker) { orderMap.removeLayer(dropoffMarker); dropoffMarker = null; }
  ['pickupLat','pickupLng','dropoffLat','dropoffLng','pickupAddress','dropoffAddress'].forEach(id => {
    document.getElementById(id).value = '';
  });
  mapMode = 'pickup';
  updateMapModeBtn();
}

// ─── PLACE ORDER ────────────────────────────────────────────────
document.getElementById('orderForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('placeOrderBtn');

  const pLat = document.getElementById('pickupLat').value;
  const pLng = document.getElementById('pickupLng').value;
  const dLat = document.getElementById('dropoffLat').value;
  const dLng = document.getElementById('dropoffLng').value;

  if (!pLat || !dLat) {
    toast.warning('Please set both Pickup and Dropoff on the map!');
    return;
  }

  btn.disabled = true;
  btn.innerHTML = '<span>⏳</span> Placing Order...';

  try {
    const order = await api.post('/api/user/orders', {
      pickupAddress: document.getElementById('pickupAddress').value,
      pickupLat: pLat, pickupLng: pLng,
      dropoffAddress: document.getElementById('dropoffAddress').value,
      dropoffLat: dLat, dropoffLng: dLng,
      packageDescription: document.getElementById('orderPackage').value || 'General Goods',
      packageWeight: document.getElementById('orderWeight').value || '1 kg',
      priority: document.getElementById('orderPriority').value,
      notes: document.getElementById('orderNotes')?.value || ''
    });

    toast.success(`🎉 Order placed! Tracking ID: ${order.trackingId}`);
    document.getElementById('orderForm').reset();
    resetMapPins();
    await loadOrders();

    // Switch to tracking
    setTimeout(() => {
      openSection('track');
      trackDelivery(order._id);
    }, 1000);
  } catch (err) {
    toast.error(err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<span>🚀</span> Place Order';
  }
});

function logout() {
  if (socket) socket.disconnect();
  auth.clear();
  window.location.href = '/login.html';
}
