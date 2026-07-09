

let driverUser = null;
let driverMap = null;
let routeControl = null;
let activeDelivery = null;
let allDeliveries = [];
let socket = null;
let simulationInterval = null;
let simRoutePoints = [];
let simCurrentIndex = 0;
let driverMarker = null;
let locationShareTimer = null;
let routePreparedForDeliveryId = null;
let simulationRunning = false;
let routeOverlay = null;

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
  const titles = { current: 'Current Delivery', queue: 'My Deliveries', map: 'Route Map' };
  document.getElementById('topbarTitle').textContent = titles[section] || section;
  if (section === 'map') initDriverMap();
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

// ─── ACTIVE DELIVERY ────────────────────────────────────────────
async function loadActiveDelivery() {
  try {
    const deliveries = await api.get('/api/driver/deliveries/active');
    const activeDeliveries = Array.isArray(deliveries) ? deliveries : (deliveries ? [deliveries] : []);
    activeDelivery = activeDeliveries[0] || null;

    if (!activeDelivery) {
      document.getElementById('noActiveDelivery').style.display = 'block';
      document.getElementById('activeDeliveryPanel').style.display = 'none';
      document.getElementById('topbarSub').textContent = 'No active delivery';
      return;
    }

    document.getElementById('noActiveDelivery').style.display = 'none';
    document.getElementById('activeDeliveryPanel').style.display = 'block';

    // Fill info
    document.getElementById('currentTrackingId').textContent = activeDelivery.trackingId;
    document.getElementById('currentCustomer').textContent = activeDelivery.user?.name || '—';
    document.getElementById('currentPackage').textContent = activeDelivery.packageDescription || '—';
    document.getElementById('currentWeight').textContent = activeDelivery.packageWeight || '—';
    document.getElementById('currentPickup').textContent = activeDelivery.pickup?.address || `${activeDelivery.pickup?.lat}, ${activeDelivery.pickup?.lng}`;
    document.getElementById('currentDropoff').textContent = activeDelivery.dropoff?.address || `${activeDelivery.dropoff?.lat}, ${activeDelivery.dropoff?.lng}`;
    const badgeContainer = document.getElementById('currentStatusBadgeContainer');
    if (badgeContainer) badgeContainer.innerHTML = fmt.statusBadge(activeDelivery.status);

    document.getElementById('topbarSub').textContent = activeDeliveries.length > 1
      ? `${activeDeliveries.length} active deliveries • #${activeDelivery.trackingId} — ${activeDelivery.packageDescription}`
      : `#${activeDelivery.trackingId} — ${activeDelivery.packageDescription}`;

    renderStatusFlow(activeDelivery.status);
    renderActionButton(activeDelivery.status);

    // Show sim controls if in transit
    const simEl = document.getElementById('simControls');
    if (activeDelivery.status === 'picked_up' || activeDelivery.status === 'in_transit') {
      simEl.style.display = 'block';
    } else {
      simEl.style.display = 'none';
    }

    // Init map if needed
    if (driverMap && activeDelivery.pickup && activeDelivery.dropoff) {
      buildRoute(activeDelivery);
    }

    if (activeDelivery.pickup && activeDelivery.dropoff) {
      void ensureSimulationRoute(activeDelivery);
    }
  } catch (err) {
    console.error('Load active delivery error:', err);
    document.getElementById('topbarSub').textContent = 'Unable to load active delivery';
  }
}
function renderStatusFlow(currentStatus) {
  const currentIdx = STATUS_STEPS.findIndex(s => s.key === currentStatus);
  const html = STATUS_STEPS.map((step, i) => {
    const isDone = i < currentIdx;
    const isActive = i === currentIdx;
    const circleClass = isDone ? 'done' : isActive ? 'active' : '';
    const labelClass = isDone ? 'done' : isActive ? 'active' : '';
    const connClass = i < currentIdx ? 'done' : '';

    return `
      <div class="status-step">
        <div class="step-node">
          <div class="step-circle ${circleClass}">${step.icon}</div>
          <div class="step-label ${labelClass}">${step.label}</div>
        </div>
        ${i < STATUS_STEPS.length - 1 ? `<div class="step-connector ${connClass}"></div>` : ''}
      </div>
    `;
  }).join('');

  document.getElementById('statusFlow').innerHTML = html;
}

function renderActionButton(status) {
  const btn = document.getElementById('nextActionBtn');
  if (status === 'delivered' || status === 'cancelled') {
    btn.disabled = true;
    btn.innerHTML = '✅ Delivery Complete';
    return;
  }
  const action = NEXT_ACTION_LABELS[status];
  if (action) {
    btn.disabled = false;
    btn.innerHTML = `<span>${action.emoji}</span> ${action.label}`;
  }
}

// ─── ADVANCE STATUS ──────────────────────────────────────────────
async function advanceDeliveryStatus() {
  if (!activeDelivery) return;
  const btn = document.getElementById('nextActionBtn');
  btn.disabled = true;
  btn.innerHTML = '<span>⏳</span> Updating...';

  try {
    const updated = await api.put(`/api/driver/deliveries/${activeDelivery._id}/status`, {});
    activeDelivery = updated;
    toast.success(`Status updated: ${updated.status.replace('_', ' ')} ✅`);
    if (updated.status === 'delivered' || updated.status === 'cancelled') {
      stopSimulation();
    }
    await loadActiveDelivery();
    await loadAllDeliveries();
  } catch (err) {
    toast.error(err.message);
    btn.disabled = false;
    renderActionButton(activeDelivery.status);
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

function estimateDistanceKm(start, end) {
  const toRad = (value) => (value * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const dLat = toRad(end.lat - start.lat);
  const dLng = toRad(end.lng - start.lng);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(start.lat)) * Math.cos(toRad(end.lat)) * Math.sin(dLng / 2) ** 2;
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function ensureSimulationRoute(delivery) {
  if (!delivery || !delivery.pickup || !delivery.dropoff) return;
  if (routePreparedForDeliveryId === delivery._id && simRoutePoints.length) return;

  const fallbackPoints = getSimulationPoints(delivery);
  if (!fallbackPoints.length) return;

  routePreparedForDeliveryId = delivery._id;
  simRoutePoints = fallbackPoints;
  simCurrentIndex = 0;

  const distanceKm = estimateDistanceKm(delivery.pickup, delivery.dropoff);
  const durationMin = Math.max(1, Math.round((distanceKm / 30) * 60));

  try {
    await api.put(`/api/driver/deliveries/${delivery._id}/route`, {
      waypoints: fallbackPoints,
      distance: `${distanceKm.toFixed(1)} km`,
      duration: `${durationMin} min`
    });
  } catch (err) {
    console.warn('Fallback route save failed:', err.message);
  }
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

async function buildRoute(delivery) {
  if (!driverMap) return;

  void ensureSimulationRoute(delivery);

  if (routeControl) {
    driverMap.removeControl(routeControl);
    routeControl = null;
  }

  if (routeOverlay) {
    driverMap.removeLayer(routeOverlay);
    routeOverlay = null;
  }

  const cachedWaypoints = Array.isArray(delivery.routeWaypoints) ? delivery.routeWaypoints : [];
  if (cachedWaypoints.length > 1) {
    routeOverlay = L.polyline(cachedWaypoints.map(p => [p.lat, p.lng]), {
      color: '#6366f1',
      weight: 5,
      opacity: 0.85
    }).addTo(driverMap);

    if (delivery.estimatedDistance) document.getElementById('routeDistance').textContent = delivery.estimatedDistance;
    if (delivery.estimatedDuration) document.getElementById('routeDuration').textContent = delivery.estimatedDuration;

    simRoutePoints = cachedWaypoints;
    simCurrentIndex = 0;
    routePreparedForDeliveryId = delivery._id;
    addDriverMarker([delivery.pickup.lat, delivery.pickup.lng]);
    return;
  }

  const pickup = [delivery.pickup.lat, delivery.pickup.lng];
  const dropoff = [delivery.dropoff.lat, delivery.dropoff.lng];

  routeControl = L.Routing.control({
    router: L.Routing.osrmv1({
      serviceUrl: 'https://routing.openstreetmap.de/routed-car/route/v1'
    }),
    waypoints: [L.latLng(...pickup), L.latLng(...dropoff)],
    routeWhileDragging: false,
    addWaypoints: false,
    createMarker: function(i, wp) {
      const icon = L.divIcon({
        className: '',
        html: `<div style="
          width:36px;height:36px;border-radius:50%;
          background:${i === 0 ? '#10b981' : '#ef4444'};
          border:3px solid white;
          display:flex;align-items:center;justify-content:center;
          color:white;font-size:16px;
          box-shadow:0 2px 10px rgba(0,0,0,0.4);
        ">${i === 0 ? '📍' : '🏁'}</div>`,
        iconSize: [36, 36], iconAnchor: [18, 18]
      });
      return L.marker(wp.latLng, { icon })
        .bindPopup(i === 0 ? `<b>Pickup</b><br>${delivery.pickup.address || ''}` : `<b>Dropoff</b><br>${delivery.dropoff.address || ''}`);
    },
    lineOptions: {
      styles: [{ color: '#6366f1', weight: 5, opacity: 0.8 }]
    },
    show: false,
    fitSelectedRoutes: true,
    collapsible: true
  }).addTo(driverMap);

  routeControl.on('routesfound', async function(e) {
    const routes = e.routes;
    if (routes.length) {
      const r = routes[0];
      const dist = (r.summary.totalDistance / 1000).toFixed(1) + ' km';
      const dur = Math.round(r.summary.totalTime / 60) + ' min';
      document.getElementById('routeDistance').textContent = dist;
      document.getElementById('routeDuration').textContent = dur;

      const tempPoints = r.coordinates.map(c => [c.lat, c.lng]);

      // Save route to server — thin to max 300 waypoints (smoother simulation)
      const step = Math.max(1, Math.floor(tempPoints.length / 300));
      const thinWaypoints = tempPoints.filter((_, i) => i % step === 0);
      try {
        await api.put(`/api/driver/deliveries/${delivery._id}/route`, {
          waypoints: thinWaypoints.map(p => ({ lat: p[0], lng: p[1] })),
          distance: dist,
          duration: dur
        });
        
        // Store for simulation AFTER successful save to prevent race condition
        simRoutePoints = tempPoints;
        simCurrentIndex = 0;
        routePreparedForDeliveryId = delivery._id;
      } catch (err) {
        console.error('Failed to save route to backend:', err);
      }
    }
  });

  routeControl.on('routingerror', function() {
    console.warn('OSRM route unavailable, using fallback route');
  });

  // Add driver marker
  addDriverMarker(pickup);
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

// ─── SIMULATION ──────────────────────────────────────────────────
async function startSimulation() {
  if (!activeDelivery) {
    toast.warning('No active delivery to simulate');
    return;
  }

  setSimulationRunningUI(false);
  toast.info('Preparing simulation route...');
  await ensureSimulationRoute(activeDelivery);

  if (!simRoutePoints.length) {
    toast.error('Route could not be prepared. Check pickup/dropoff coordinates.');
    return;
  }

  setSimulationRunningUI(true);
  toast.info('Starting backend simulation — truck moving along route');

  try {
    const speed = parseInt(document.getElementById('simSpeed').value) || 3;
    await api.post(`/api/driver/deliveries/${activeDelivery._id}/simulate`, { speed });
    simulationRunning = true;
    setSimulationRunningUI(true);
    toast.success('Simulation running on server. You can safely close this tab or logout.');
  } catch (err) {
    simulationRunning = false;
    setSimulationRunningUI(false);
    toast.error('Simulation failed to start: ' + err.message);
  }
}

async function stopSimulation() {
  try {
    await api.post('/api/driver/simulate/stop');
    simulationRunning = false;
    setSimulationRunningUI(false);
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
