

let driverUser = null;
let driverMap = null;
let routeControl = null;
let activeDeliveries = [];   // all active deliveries
let activeDelivery = null;   // the one currently shown in route map
let allDeliveries = [];
let socket = null;
let simulationInterval = null;
let simRoutePoints = [];
let simCurrentIndex = 0;
let driverMarker = null;
let locationShareTimer = null;
let routePreparedForDeliveryId = null;
let simulationRunning = false;
let activeSimDeliveryId = null; // which delivery is being simulated
let routeOverlay = null;
let expandedCards = new Set(); // track which cards are expanded

// ─── STATUS CONFIG ──────────────────────────────────────────────
const STATUS_STEPS = [
  { key: 'assigned',        icon: '🔗', label: 'Assigned' },
  { key: 'picked_up',       icon: '📦', label: 'Picked Up' },
  { key: 'in_transit',      icon: '🚛', label: 'In Transit' },
  { key: 'out_for_delivery',icon: '🏃', label: 'Out for Del.' },
  { key: 'delivered',       icon: '✅', label: 'Delivered' }
];

const NEXT_ACTION_LABELS = {
  assigned: { label: '📦 Mark as Picked Up', emoji: '📦' },
  picked_up: { label: '🚛 Start Transit', emoji: '🚛' },
  in_transit: { label: '🏃 Mark Out for Delivery', emoji: '🏃' },
  out_for_delivery: { label: '✅ Mark as Delivered', emoji: '✅' }
};

// ─── INIT ───────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  driverUser = auth.requireRole('driver');
  if (!driverUser) return;

  // Set driver info
  document.getElementById('driverName').textContent = driverUser.name;
  document.getElementById('driverAvatar').textContent = fmt.initials(driverUser.name);
  document.getElementById('driverAvatar').style.background = driverUser.avatarColor || '#3b82f6';

  // Load profile to get vehicle info
  try {
    const profile = await api.get('/api/auth/profile');
    document.getElementById('driverVehicle').textContent = `${fmt.vehicleIcon(profile.vehicleType)} ${profile.vehicleNumber || 'No vehicle'}`;
    if (profile.isOnline) {
      document.getElementById('onlineTrack').classList.add('on');
      setOnlineUI(true);
    }
  } catch (err) { console.error(err); }

  initSidebarNav();
  window.onSectionChange = onSectionChange;

  await Promise.all([loadActiveDelivery(), loadAllDeliveries()]);

  connectSocket();
  if (driverUser && driverUser.isOnline) startLocationSharing();

  ['logoutModal'].forEach(id => modal.closeOnOverlay(id));
});

function onSectionChange(section) {
  const titles = { current: 'Active Deliveries', queue: 'My Deliveries', map: 'Route Map' };
  document.getElementById('topbarTitle').textContent = titles[section] || section;
  if (section === 'map') {
    if (activeDelivery) initDriverMap();
    else if (activeDeliveries.length) { activeDelivery = activeDeliveries[0]; initDriverMap(); }
  }
}

// ─── SOCKET ─────────────────────────────────────────────────────
function connectSocket() {
  socket = createSocket();
  if (!socket) return;

  socket.on('connect', () => {
    console.log('🔌 Driver socket connected');
    // Mark online
    api.put('/api/driver/availability', { isOnline: true }).catch(console.error);
    document.getElementById('onlineTrack').classList.add('on');
    setOnlineUI(true);
    startLocationSharing();
  });

  socket.on('delivery:assigned', async (delivery) => {
    toast.success(`🎉 New delivery assigned! #${delivery.trackingId}`, 6000);
    await loadActiveDelivery();
    await loadAllDeliveries();
  });

  socket.on('driver:location-update', (data) => {
    if (data?.lat != null && data?.lng != null) {
      updateDriverMarker([data.lat, data.lng]);
    }
  });

  socket.on('disconnect', () => {
    console.log('❌ Socket disconnected');
    stopLocationSharing();
  });
}

// ─── ONLINE TOGGLE ──────────────────────────────────────────────
async function toggleOnlineStatus() {
  const track = document.getElementById('onlineTrack');
  const isOnline = !track.classList.contains('on');
  try {
    await api.put('/api/driver/availability', { isOnline });
    if (isOnline) track.classList.add('on');
    else track.classList.remove('on');
    setOnlineUI(isOnline);
    if (isOnline) startLocationSharing();
    else stopLocationSharing();
    toast.success(isOnline ? 'You are now online!' : 'You are offline');
  } catch (err) {
    toast.error(err.message);
  }
}

function setOnlineUI(isOnline) {
  document.getElementById('onlineLabel').textContent = isOnline ? 'Online' : 'Go Online';
  const badge = document.getElementById('driverStatusBadge');
  badge.textContent = isOnline ? '🟢 Online' : '⚫ Offline';
  badge.style.background = isOnline ? 'var(--green-light)' : 'var(--red-light)';
  badge.style.color = isOnline ? 'var(--green)' : 'var(--red)';
  badge.style.borderColor = isOnline ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.2)';
}

// ─── ACTIVE DELIVERIES (multi) ──────────────────────────────────
async function loadActiveDelivery() {
  try {
    const result = await api.get('/api/driver/deliveries/active');
    activeDeliveries = Array.isArray(result) ? result : (result ? [result] : []);
    activeDelivery = activeDeliveries[0] || null;

    const noDeliveryEl = document.getElementById('noActiveDelivery');
    const container = document.getElementById('activeDeliveriesContainer');

    if (!activeDeliveries.length) {
      noDeliveryEl.style.display = 'block';
      container.innerHTML = '';
      document.getElementById('topbarSub').textContent = 'No active deliveries';
      return;
    }

    noDeliveryEl.style.display = 'none';
    document.getElementById('topbarSub').textContent =
      activeDeliveries.length === 1
        ? `#${activeDeliveries[0].trackingId} — ${activeDeliveries[0].packageDescription}`
        : `${activeDeliveries.length} active deliveries`;

    renderActiveDeliveryCards(activeDeliveries);

    // Refresh map if open
    if (driverMap && activeDelivery) buildRoute(activeDelivery);

  } catch (err) {
    console.error('Load active delivery error:', err);
    document.getElementById('topbarSub').textContent = 'Unable to load deliveries';
  }
}

function toggleDeliveryCard(id) {
  if (expandedCards.has(id)) {
    expandedCards.delete(id);
  } else {
    expandedCards.add(id);
  }
  renderActiveDeliveryCards(activeDeliveries);
}

function renderActiveDeliveryCards(deliveries) {
  const container = document.getElementById('activeDeliveriesContainer');

  container.innerHTML = deliveries.map((d, idx) => {
    const isExpanded = expandedCards.has(d._id);
    const canSim = ['picked_up', 'in_transit', 'out_for_delivery'].includes(d.status);
    const isThisSim = activeSimDeliveryId === d._id;
    const isDone = d.status === 'delivered' || d.status === 'cancelled';

    const nextAction = {
      assigned:         { label: 'Mark as Picked Up', emoji: '📦' },
      picked_up:        { label: 'Start Transit',      emoji: '🚛' },
      in_transit:       { label: 'Out for Delivery',   emoji: '🏃' },
      out_for_delivery: { label: 'Mark as Delivered',  emoji: '✅' }
    }[d.status];

    const statusFlowHtml = STATUS_STEPS.map((step, i) => {
      const curIdx = STATUS_STEPS.findIndex(s => s.key === d.status);
      const isDoneStep = i < curIdx;
      const isActiveStep = i === curIdx;
      const connClass = isDoneStep ? 'done' : '';
      return `
        <div class="status-step">
          <div class="step-node">
            <div class="step-circle ${isDoneStep ? 'done' : isActiveStep ? 'active' : ''}">${step.icon}</div>
            <div class="step-label ${isDoneStep ? 'done' : isActiveStep ? 'active' : ''}">${step.label}</div>
          </div>
          ${i < STATUS_STEPS.length - 1 ? `<div class="step-connector ${connClass}"></div>` : ''}
        </div>`;
    }).join('');

    return `
    <div class="card mb-16" id="dcard-${d._id}" style="border: 1px solid ${
      isThisSim ? 'rgba(99,102,241,0.4)' : 'var(--border)'
    };">

      <!-- Card Header -->
      <div class="flex-between" style="cursor:pointer; padding-bottom: ${isExpanded ? '16px' : '0'}; ${isExpanded ? 'border-bottom:1px solid var(--border); margin-bottom:16px;' : ''}" onclick="toggleDeliveryCard('${d._id}')">
        <div>
          <div style="display:flex; align-items:center; gap:10px;">
            <span class="font-semibold text-accent" style="font-size:14px;">#${d.trackingId}</span>
            ${fmt.statusBadge(d.status)}
            ${isThisSim ? '<span class="badge" style="background:rgba(99,102,241,0.15);color:#6366f1;border:1px solid rgba(99,102,241,0.3);font-size:10px;">🔴 SIM</span>' : ''}
          </div>
          <div class="text-xs text-muted mt-4">${d.packageDescription} • ${d.user?.name || 'N/A'}</div>
        </div>
        <div style="font-size:18px; color:var(--text-3); transition:transform 0.2s; transform:rotate(${isExpanded ? '90' : '0'}deg);">›</div>
      </div>

      <!-- Expanded Body -->
      ${isExpanded ? `
        <!-- Status Flow: centred, not edge-to-edge -->
        <div style="display:flex; justify-content:center; margin-bottom:20px;">
          <div class="status-flow" style="max-width:520px; width:100%;">${statusFlowHtml}</div>
        </div>

        <!-- Info: clean labelled rows with a subtle divider -->
        <div style="border:1px solid var(--border); border-radius:10px; overflow:hidden; margin-bottom:16px; font-size:13px;">
          <div style="display:flex; justify-content:space-between; padding:10px 14px; border-bottom:1px solid var(--border);">
            <span style="color:var(--text-3); font-weight:500;">Customer</span>
            <span style="font-weight:600;">${d.user?.name || '—'}</span>
          </div>
          <div style="display:flex; justify-content:space-between; padding:10px 14px; border-bottom:1px solid var(--border);">
            <span style="color:var(--text-3); font-weight:500;">Package</span>
            <span style="font-weight:600;">${d.packageDescription || '—'}</span>
          </div>
          <div style="display:flex; justify-content:space-between; padding:10px 14px; border-bottom:1px solid var(--border);">
            <span style="color:var(--text-3); font-weight:500;">Weight</span>
            <span style="font-weight:600;">${d.packageWeight || '—'}</span>
          </div>
          <div style="padding:10px 14px; border-bottom:1px solid var(--border);">
            <div style="color:var(--text-3); font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:.5px; margin-bottom:4px;">Pickup</div>
            <div style="font-weight:600;">${d.pickup?.address || `${d.pickup?.lat}, ${d.pickup?.lng}`}</div>
          </div>
          <div style="padding:10px 14px; ">
            <div style="color:var(--text-3); font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:.5px; margin-bottom:4px;">Dropoff</div>
            <div style="font-weight:600;">${d.dropoff?.address || `${d.dropoff?.lat}, ${d.dropoff?.lng}`}</div>
            ${d.estimatedDistance ? `<div style="display:inline-flex; align-items:center; gap:5px; margin-top:6px; padding:3px 10px; background:rgba(13,148,136,0.12); border:1px solid rgba(13,148,136,0.25); border-radius:20px; font-size:12px; font-weight:600; color:var(--teal);">🗺️ ${d.estimatedDistance} &bull; ${d.estimatedDuration}</div>` : ''}
          </div>
        </div>

        <!-- Advance Status -->
        ${!isDone && nextAction ? `
        <button class="btn btn-primary btn-full" id="advBtn-${d._id}" onclick="advanceDeliveryStatusFor('${d._id}')" style="margin-bottom:10px;">
          ${nextAction.emoji} ${nextAction.label}
        </button>` : ''}
        ${isDone ? `<div class="text-xs text-muted" style="text-align:center; padding:8px;">Delivery ${d.status}.</div>` : ''}

        <!-- Simulation Controls -->
        ${canSim ? `
        <div class="sim-controls" style="margin-top:4px; margin-bottom:10px;">
          <div style="font-size:11px; font-weight:700; color:#92400e; margin-bottom:8px; text-transform:uppercase;">Dev Mode — Simulate Truck</div>
          <div style="display:flex; gap:8px;">
            <select id="simSpeed-${d._id}" class="form-select" style="padding:4px 8px; font-size:12px; width:90px; flex-shrink:0;">
              <option value="1">1x Slow</option>
              <option value="3" selected>3x Normal</option>
              <option value="10">10x Fast</option>
            </select>
            <button class="btn btn-sm flex-1" id="startSimBtn-${d._id}" onclick="startSimulationFor('${d._id}')">
              ${isThisSim ? '⏺ Running' : '▶ Start'}
            </button>
            <button class="btn btn-sm flex-1" onclick="stopSimulation()">&#9632; Stop All</button>
          </div>
        </div>` : ''}

        <!-- Divider -->
        <div style="border-top:1px solid var(--border); margin:12px 0;"></div>

        <!-- View Route Button -->
        <button class="btn btn-sm btn-full" onclick="viewRouteFor('${d._id}')">
          🗺️ View on Route Map
        </button>
      ` : ''}
    </div>`;
  }).join('');
}

function renderStatusFlow(currentStatus) {
  const currentIdx = STATUS_STEPS.findIndex(s => s.key === currentStatus);
  const html = STATUS_STEPS.map((step, i) => {
    const isDone = i < currentIdx;
    const isActive = i === currentIdx;
    const connClass = i < currentIdx ? 'done' : '';
    return `
      <div class="status-step">
        <div class="step-node">
          <div class="step-circle ${isDone ? 'done' : isActive ? 'active' : ''}">${step.icon}</div>
          <div class="step-label ${isDone ? 'done' : isActive ? 'active' : ''}">${step.label}</div>
        </div>
        ${i < STATUS_STEPS.length - 1 ? `<div class="step-connector ${connClass}"></div>` : ''}
      </div>
    `;
  }).join('');
  return html;
}

async function advanceDeliveryStatusFor(deliveryId) {
  const btn = document.getElementById(`advBtn-${deliveryId}`);
  if (btn) btn.disabled = true;

  try {
    const updated = await api.put(`/api/driver/deliveries/${deliveryId}/status`, {});
    
    // Update local state
    const idx = activeDeliveries.findIndex(d => d._id === deliveryId);
    if (idx !== -1) {
      activeDeliveries[idx] = updated;
    }

    toast.success(`Status updated: ${updated.status.replace('_', ' ')} ✅`);
    
    if (updated.status === 'delivered' || updated.status === 'cancelled') {
      if (activeSimDeliveryId === deliveryId) {
        stopSimulation();
      }
      activeDeliveries = activeDeliveries.filter(d => d._id !== deliveryId);
    }
    
    renderActiveDeliveryCards(activeDeliveries);
    await loadAllDeliveries();
  } catch (err) {
    toast.error(err.message);
    if (btn) btn.disabled = false;
  }
}

// ─── ALL DELIVERIES ──────────────────────────────────────────────
async function loadAllDeliveries() {
  try {
    allDeliveries = await api.get('/api/driver/deliveries');
    document.getElementById('queueCount').textContent = allDeliveries.filter(d =>
      ['assigned', 'picked_up', 'in_transit', 'out_for_delivery'].includes(d.status)
    ).length;
    renderQueue();
  } catch (err) { console.error(err); }
}

async function loadAllAssignments() {
  return loadAllDeliveries();
}

function setRouteSummary({ distance, duration, status }) {
  const distanceEl = document.getElementById('routeDistance');
  const durationEl = document.getElementById('routeDuration');
  const statusEl = document.getElementById('routeStatus');

  if (distanceEl) distanceEl.textContent = distance || '—';
  if (durationEl) durationEl.textContent = duration || '—';
  if (statusEl) statusEl.textContent = status || '—';
}

function getSimulationPoints(delivery) {
  const start = delivery?.pickup;
  const end = delivery?.dropoff;
  if (!start || !end) return [];

  const points = [];
  const steps = 40;
  for (let i = 0; i <= steps; i += 1) {
    const ratio = i / steps;
    points.push({
      lat: start.lat + (end.lat - start.lat) * ratio,
      lng: start.lng + (end.lng - start.lng) * ratio
    });
  }
  return points;
}

function getRouteCache(delivery) {
  const waypoints = Array.isArray(delivery?.routeWaypoints) ? delivery.routeWaypoints : [];
  return waypoints.length > 1 ? waypoints : [];
}

async function fetchRouteFromService(delivery) {
  return api.post(`/api/driver/deliveries/${delivery._id}/route/compute`);
}

async function resolveRoute(delivery) {
  const cachedWaypoints = getRouteCache(delivery);
  if (cachedWaypoints.length) {
    return {
      waypoints: cachedWaypoints,
      distance: delivery.estimatedDistance || null,
      duration: delivery.estimatedDuration || null
    };
  }

  try {
    return await fetchRouteFromService(delivery);
  } catch (err) {
    console.warn('Route service unavailable, using fallback route', err.message);
    return {
      waypoints: getSimulationPoints(delivery),
      distance: null,
      duration: null
    };
  }
}

function estimateDistanceKm(start, end) {
  const toRad = (value) => (value * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const dLat = toRad(end.lat - start.lat);
  const dLng = toRad(end.lng - start.lng);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(start.lat)) * Math.cos(toRad(end.lat)) * Math.sin(dLng / 2) ** 2;
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function setSimulationRunningUI(isRunning) {
  const startBtn = document.getElementById('startSimulationBtn');
  const stopBtn = document.getElementById('stopSimulationBtn');
  if (startBtn) {
    startBtn.disabled = isRunning;
    startBtn.innerHTML = isRunning ? '⏺ Running' : '▶ Start';
  }
  if (stopBtn) {
    stopBtn.disabled = !isRunning;
  }
}

function sendCurrentLocation() {
  if (!navigator.geolocation) return;
  if (!document.getElementById('onlineTrack')?.classList.contains('on')) return;

  navigator.geolocation.getCurrentPosition((position) => {
    api.put('/api/driver/location', {
      lat: position.coords.latitude,
      lng: position.coords.longitude
    }).catch((err) => console.warn('Location update failed:', err.message));
  }, (err) => {
    console.warn('Geolocation unavailable:', err.message);
  }, {
    enableHighAccuracy: true,
    timeout: 10000,
    maximumAge: 15000
  });
}

function startLocationSharing() {
  if (locationShareTimer || !navigator.geolocation) return;
  sendCurrentLocation();
  locationShareTimer = setInterval(sendCurrentLocation, 10000);
}

function stopLocationSharing() {
  if (locationShareTimer) {
    clearInterval(locationShareTimer);
    locationShareTimer = null;
  }
}

function renderQueue() {
  const el = document.getElementById('deliveryQueueList');
  if (!allDeliveries.length) {
    el.innerHTML = '<div class="empty-state"><div class="empty-icon">📭</div><h3>No deliveries</h3><p>Deliveries assigned to you will appear here</p></div>';
    return;
  }

  el.innerHTML = allDeliveries.map(d => {
    const isActive = activeDelivery && d._id === activeDelivery._id;
    return `
      <div class="delivery-queue-item ${isActive ? 'current' : ''}">
        <div style="font-size:24px;">${d.status === 'delivered' ? '✅' : d.status === 'cancelled' ? '❌' : '📦'}</div>
        <div class="flex-1">
          <div class="flex-between">
            <span class="font-semibold text-accent" style="font-size:13px;">${d.trackingId}</span>
            ${fmt.statusBadge(d.status)}
          </div>
          <div class="text-xs text-muted mt-4">${d.pickup?.address || 'N/A'} → ${d.dropoff?.address || 'N/A'}</div>
          <div class="text-xs text-muted">${d.packageDescription} • ${fmt.timeAgo(d.createdAt)}</div>
        </div>
      </div>
    `;
  }).join('');
}

// ─── DRIVER MAP ──────────────────────────────────────────────────
function initDriverMap() {
  if (driverMap) { setTimeout(() => driverMap.invalidateSize(), 200); return; }

  driverMap = L.map('driverMap').setView([20.5937, 78.9629], 5);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap'
  }).addTo(driverMap);

  if (activeDelivery) buildRoute(activeDelivery);
}

function focusRouteOnMap(points) {
  if (!driverMap || !Array.isArray(points) || points.length === 0) return;
  const bounds = L.latLngBounds(points.map(point => [point.lat, point.lng]));
  if (bounds.isValid()) {
    driverMap.fitBounds(bounds.pad(0.18), { animate: true });
  }
}

async function buildRoute(delivery) {
  if (!driverMap) return;

  setRouteSummary({
    distance: 'Calculating…',
    duration: 'Calculating…',
    status: `Loading route for #${delivery.trackingId || delivery._id}`
  });

  if (routeControl) {
    driverMap.removeControl(routeControl);
    routeControl = null;
  }

  if (routeOverlay) {
    driverMap.removeLayer(routeOverlay);
    routeOverlay = null;
  }

  const resolvedRoute = await resolveRoute(delivery);
  const resolvedWaypoints = resolvedRoute.waypoints || [];

  if (resolvedWaypoints.length > 1) {
    routeOverlay = L.polyline(resolvedWaypoints.map(p => [p.lat, p.lng]), {
      color: '#6366f1',
      weight: 5,
      opacity: 0.85
    }).addTo(driverMap);

    setRouteSummary({
      distance: resolvedRoute.distance || '—',
      duration: resolvedRoute.duration || '—',
      status: `Previewing route for #${delivery.trackingId || delivery._id}`
    });

    simRoutePoints = resolvedWaypoints;
    simCurrentIndex = 0;
    routePreparedForDeliveryId = delivery._id;
    addDriverMarker([delivery.pickup.lat, delivery.pickup.lng]);
    focusRouteOnMap(resolvedWaypoints);

    if (!getRouteCache(delivery).length) {
      try {
        await api.put(`/api/driver/deliveries/${delivery._id}/route`, {
          waypoints: resolvedWaypoints,
          distance: resolvedRoute.distance,
          duration: resolvedRoute.duration
        });
      } catch (err) {
        console.warn('Route save failed:', err.message);
      }
    }
    return;
  }

  const fallbackWaypoints = getSimulationPoints(delivery);
  if (!fallbackWaypoints.length) return;
  routeOverlay = L.polyline(fallbackWaypoints.map(p => [p.lat, p.lng]), {
    color: '#6366f1',
    weight: 5,
    opacity: 0.85,
    dashArray: '8 10'
  }).addTo(driverMap);
  simRoutePoints = fallbackWaypoints;
  simCurrentIndex = 0;
  routePreparedForDeliveryId = delivery._id;
  setRouteSummary({
    distance: delivery.estimatedDistance || `${estimateDistanceKm(delivery.pickup, delivery.dropoff).toFixed(1)} km`,
    duration: delivery.estimatedDuration || '—',
    status: `Previewing fallback route for #${delivery.trackingId || delivery._id}`
  });
  addDriverMarker([delivery.pickup.lat, delivery.pickup.lng]);
  focusRouteOnMap(fallbackWaypoints);
}

async function viewRouteFor(deliveryId) {
  const delivery = activeDeliveries.find(d => d._id === deliveryId) || allDeliveries.find(d => d._id === deliveryId);
  if (!delivery) {
    toast.warning('Delivery not found');
    return;
  }

  activeDelivery = delivery;

  const mapTab = document.querySelector('[data-section="map"]');
  if (mapTab) {
    mapTab.click();
  } else if (!driverMap) {
    initDriverMap();
  }

  if (driverMap) {
    await buildRoute(delivery);
  }
}

function addDriverMarker(pos) {
  if (driverMarker) driverMarker.remove();
  const icon = L.divIcon({
    className: '',
    html: `<div style="
      width:38px;height:38px;border-radius:50%;
      background:${driverUser.avatarColor || '#3b82f6'};
      border:3px solid white;
      display:flex;align-items:center;justify-content:center;
      color:white;font-size:13px;font-weight:700;
      box-shadow:0 0 0 4px rgba(99,102,241,0.3),0 2px 10px rgba(0,0,0,0.4);
    ">${fmt.initials(driverUser.name)}</div>`,
    iconSize: [38, 38], iconAnchor: [19, 19]
  });
  driverMarker = L.marker(pos, { icon }).addTo(driverMap).bindPopup('📍 You are here');
}

function updateDriverMarker(pos) {
  if (!driverMap) return;
  if (!driverMarker) {
    addDriverMarker(pos);
    return;
  }

  driverMarker.setLatLng(pos);
  if (activeDelivery && activeDelivery.pickup && activeDelivery.dropoff) {
    driverMap.panTo(pos, { animate: true, duration: 0.8 });
  }
}

// ─── SIMULATION (per delivery, only one at a time) ──────────────
async function startSimulationFor(deliveryId) {
  const delivery = activeDeliveries.find(d => d._id === deliveryId);
  if (!delivery) { toast.warning('Delivery not found'); return; }

  // Auto-stop any running sim first (backend handles this too, but good UX)
  if (activeSimDeliveryId && activeSimDeliveryId !== deliveryId) {
    toast.info('Stopping previous simulation...');
    await stopSimulation();
  }

  // Ensure route exists before starting the backend simulation.
  let routePoints = getRouteCache(delivery);
  if (!routePoints.length) {
    try {
      const resolvedRoute = await resolveRoute(delivery);
      routePoints = resolvedRoute.waypoints || [];
      if (routePoints.length > 1) {
        simRoutePoints = routePoints;
        simCurrentIndex = 0;
        routePreparedForDeliveryId = delivery._id;
        await api.put(`/api/driver/deliveries/${delivery._id}/route`, {
          waypoints: routePoints,
          distance: resolvedRoute.distance,
          duration: resolvedRoute.duration
        });
      }
    } catch (err) {
      toast.error('Route lookup failed: ' + err.message);
      return;
    }
  }

  if (!routePoints.length) {
    toast.error('Route not available yet');
    return;
  }

  simRoutePoints = routePoints;
  simCurrentIndex = 0;
  routePreparedForDeliveryId = delivery._id;

  const speed = parseInt(document.getElementById(`simSpeed-${deliveryId}`)?.value || '3');

  try {
    await api.post(`/api/driver/deliveries/${deliveryId}/simulate`, {
      speed,
      waypoints: routePoints
    });
    activeSimDeliveryId = deliveryId;
    simulationRunning = true;
    // Re-render so the SIM badge shows up
    renderActiveDeliveryCards(activeDeliveries);
    toast.success(`Simulation started for #${delivery.trackingId}. You can log out — server keeps driving.`);
  } catch (err) {
    toast.error('Simulation failed: ' + err.message);
  }
}

// Legacy wrapper
async function startSimulation() {
  if (activeDelivery) return startSimulationFor(activeDelivery._id);
  toast.warning('No active delivery selected');
}

async function stopSimulation() {
  try {
    await api.post('/api/driver/simulate/stop');
    activeSimDeliveryId = null;
    simulationRunning = false;
    renderActiveDeliveryCards(activeDeliveries);
    toast.success('Simulation stopped');
  } catch (err) {
    // ignore
  }
}

async function addCheckpoint() {
  if (!activeDelivery || !driverMarker) {
    toast.warning('No active delivery');
    return;
  }
  const pos = driverMarker.getLatLng();
  const desc = prompt('Checkpoint description (e.g., "Reached Delhi Hub"):') || 'Driver reached a checkpoint';
  if (socket) {
    socket.emit('delivery:checkpoint', {
      deliveryId: activeDelivery._id,
      description: desc,
      lat: pos.lat,
      lng: pos.lng
    });
  }
  toast.success(`📍 Checkpoint added: ${desc}`);
}

function recalculateRoute() {
  if (activeDelivery && driverMap) {
    buildRoute(activeDelivery);
    toast.info('🔄 Recalculating route...');
  } else {
    toast.warning('No active delivery to route');
  }
}

function logout() {
  stopSimulation();
  stopLocationSharing();
  if (socket) socket.disconnect();
  api.put('/api/driver/availability', { isOnline: false }).finally(() => {
    auth.clear();
    window.location.href = '/login.html';
  });
}
