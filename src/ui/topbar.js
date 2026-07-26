/**
 * HelioTwin — Topbar
 *
 * Location search (Nominatim geocoder), analysis date picker,
 * and export button. Always visible regardless of workspace.
 */

import { get, set } from '../state.js';
import { flyTo } from '../mapEngine.js';
import { navigateTo } from '../state.js';

let _searchDebounce = null;

export function initTopbar() {
  const topbar = document.getElementById('topbar');
  topbar.innerHTML = `
    <div class="topbar-search">
      <span class="topbar-search-icon">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>
        </svg>
      </span>
      <input type="text" id="location-search" placeholder="Search location…" autocomplete="off">
      <div class="topbar-search-results" id="search-results"></div>
    </div>

    <div class="topbar-sep"></div>

    <div class="topbar-date">
      <label for="analysis-date">DATE</label>
      <input type="date" id="analysis-date" value="${_todayISO()}">
    </div>

    <div class="topbar-spacer"></div>

    <span style="font-size:10px;color:var(--c-text-tertiary);letter-spacing:0.04em;font-family:var(--font-mono)">
      New Delhi, India &nbsp;·&nbsp; IST (UTC+5:30)
    </span>

    <div class="topbar-sep"></div>

    <button class="topbar-export-btn" id="topbar-export-btn">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
        <polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
      </svg>
      Export Report
    </button>
  `;

  _bindEvents();
}

function _bindEvents() {
  const searchInput = document.getElementById('location-search');
  const dateInput   = document.getElementById('analysis-date');
  const exportBtn   = document.getElementById('topbar-export-btn');

  // Geocoder — Nominatim
  searchInput.addEventListener('input', (e) => {
    clearTimeout(_searchDebounce);
    const q = e.target.value.trim();
    if (q.length < 3) { _hideResults(); return; }
    _searchDebounce = setTimeout(() => _doSearch(q), 400);
  });
  searchInput.addEventListener('blur', () => setTimeout(_hideResults, 200));

  // Analysis date
  dateInput.addEventListener('change', (e) => {
    const d = new Date(e.target.value + 'T12:00:00');
    if (!isNaN(d)) set('time', { date: d });
  });

  // Export → navigate to WS5 via dynamic import
  exportBtn.addEventListener('click', () => {
    import('./workspaceRouter.js').then(r => {
      if (navigateTo(5)) r.mountWorkspace(5);
    });
  });
}

async function _doSearch(query) {
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=5&addressdetails=1`;
    const res  = await fetch(url, { headers: { 'Accept-Language': 'en' } });
    const data = await res.json();
    _showResults(data);
  } catch(e) { _hideResults(); }
}

function _showResults(results) {
  const container = document.getElementById('search-results');
  if (!container) return;

  if (!results.length) {
    container.innerHTML = `<div class="search-result-item" style="color:var(--c-text-tertiary)">No results found</div>`;
    container.classList.add('visible');
    return;
  }

  container.innerHTML = results.map(r => {
    const parts = r.display_name.split(',');
    const name  = parts[0].trim();
    const sub   = parts.slice(1, 3).join(',').trim();
    return `
      <div class="search-result-item" data-lat="${r.lat}" data-lng="${r.lon}">
        <div class="search-result-name">${name}</div>
        <div class="search-result-sub">${sub}</div>
      </div>`;
  }).join('');
  container.classList.add('visible');

  container.querySelectorAll('.search-result-item[data-lat]').forEach(el => {
    el.addEventListener('click', () => {
      const lat = parseFloat(el.dataset.lat);
      const lng = parseFloat(el.dataset.lng);
      set('site', { center: [lng, lat] });
      flyTo([lng, lat], 14);
      document.getElementById('location-search').value = el.querySelector('.search-result-name').textContent;
      _hideResults();
    });
  });
}

function _hideResults() {
  const c = document.getElementById('search-results');
  if (c) { c.classList.remove('visible'); c.innerHTML = ''; }
}

function _todayISO() {
  return new Date().toISOString().split('T')[0];
}
