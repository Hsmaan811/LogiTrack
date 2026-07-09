/* ═══════════════════════════════════════
   LOGISTICS TRACKER — Shared Utilities
═══════════════════════════════════════ */

const BASE_URL = '';

// ─── API Helpers ─────────────────────────────────────────────
const api = {
  async request(method, path, body = null) {
    const token = localStorage.getItem('lt_token');
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }
    };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(BASE_URL + path, opts);
    
    let data;
    try { data = await res.json(); } catch { data = { message: 'Server error' }; }
    
    if (res.status === 401) {
      auth.clear();
      window.location.href = '/login.html';
      throw new Error('Session expired or user deleted');
    }
    
    if (!res.ok) throw new Error(data.message || 'Request failed');
    return data;
  },
  get: (path) => api.request('GET', path),
  post: (path, body) => api.request('POST', path, body),
  put: (path, body) => api.request('PUT', path, body),
  delete: (path) => api.request('DELETE', path)
};

// ─── Auth Helpers ─────────────────────────────────────────────
const auth = {
  getUser: () => {
    try { return JSON.parse(localStorage.getItem('lt_user')); } catch { return null; }
  },
  getToken: () => localStorage.getItem('lt_token'),
  save: (user, token) => {
    localStorage.setItem('lt_user', JSON.stringify(user));
    localStorage.setItem('lt_token', token);
  },
  clear: () => {
    localStorage.removeItem('lt_user');
    localStorage.removeItem('lt_token');
  },
  requireRole: (role) => {
    const user = auth.getUser();
    if (!user || !auth.getToken()) { window.location.href = '/login.html'; return null; }
    if (user.role !== role) { window.location.href = `/${user.role === 'admin' ? 'admin' : user.role === 'driver' ? 'driver' : 'user'}.html`; return null; }
    return user;
  }
};

// ─── Toast Notifications ──────────────────────────────────────
const toast = (() => {
  let container = null;
  const ensure = () => {
    if (!container) {
      container = document.createElement('div');
      container.className = 'toast-container';
      document.body.appendChild(container);
    }
    return container;
  };
  const show = (msg, type = 'info', duration = 4000) => {
    const icons = { success: '✓', error: '✕', warning: '!', info: 'i' };
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = `<span><strong>[${type.toUpperCase()}]</strong> ${msg}</span><span class="toast-close" onclick="this.parentElement.remove()">✕</span>`;
    ensure().appendChild(el);
    setTimeout(() => el.remove(), duration);
  };
  return {
    success: (m, d) => show(m, 'success', d),
    error: (m, d) => show(m, 'error', d),
    warning: (m, d) => show(m, 'warning', d),
    info: (m, d) => show(m, 'info', d)
  };
})();

// ─── Formatting Helpers ───────────────────────────────────────
const fmt = {
  date: (d) => {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  },
  datetime: (d) => {
    if (!d) return '—';
    return new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true });
  },
  timeAgo: (d) => {
    if (!d) return '';
    const diff = Date.now() - new Date(d).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return 'Just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  },
  initials: (name) => name ? name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) : '?',
  statusBadge: (status) => {
    const labels = {
      pending: 'Pending', assigned: 'Assigned', picked_up: 'Picked Up',
      in_transit: 'In Transit', out_for_delivery: 'Out for Delivery',
      delivered: 'Delivered', cancelled: 'Cancelled'
    };
    return `<span class="badge badge-${status}"><span class="dot"></span>${labels[status] || status}</span>`;
  },
  priorityBadge: (priority) => {
    const labels = { normal: '[ Normal ]', express: '[ Express ]', urgent: '[ Urgent ]' };
    return `<span class="badge badge-${priority}">${labels[priority] || priority}</span>`;
  },
  vehicleIcon: (type) => {
    const icons = { bike: 'Bike', van: 'Van', truck: 'Truck', car: 'Car' };
    return icons[type] || 'Truck';
  }
};

// ─── Modal Helpers ────────────────────────────────────────────
const modal = {
  open: (id) => {
    const el = document.getElementById(id);
    if (el) el.classList.add('open');
  },
  close: (id) => {
    const el = document.getElementById(id);
    if (el) el.classList.remove('open');
  },
  closeOnOverlay: (id) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', (e) => { if (e.target === el) el.classList.remove('open'); });
  }
};

// ─── Tab Navigation ───────────────────────────────────────────
const tabs = {
  init: (tabBtns, sections) => {
    tabBtns.forEach((btn, i) => {
      btn.addEventListener('click', () => {
        tabBtns.forEach(b => b.classList.remove('active'));
        sections.forEach(s => s.classList.remove('active'));
        btn.classList.add('active');
        sections[i]?.classList.add('active');
        btn.dataset.onactivate && window[btn.dataset.onactivate]?.();
      });
    });
  }
};

// ─── Socket.IO Setup ──────────────────────────────────────────
const createSocket = () => {
  const token = auth.getToken();
  if (!token || typeof io === 'undefined') return null;
  return io({ auth: { token } });
};

// ─── Sidebar Navigation ───────────────────────────────────────
const initSidebarNav = () => {
  document.querySelectorAll('[data-section]').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.section;
      document.querySelectorAll('[data-section]').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.page-section').forEach(s => s.classList.remove('active'));
      btn.classList.add('active');
      const section = document.getElementById(`section-${target}`);
      if (section) section.classList.add('active');
      if (window.onSectionChange) window.onSectionChange(target);
    });
  });
};

// ─── Avatar HTML ──────────────────────────────────────────────
const avatarHtml = (user, size = '') => {
  const color = user?.avatarColor || '#6366f1';
  const initials = fmt.initials(user?.name || '?');
  return `<div class="avatar ${size}" style="background:${color}">${initials}</div>`;
};
