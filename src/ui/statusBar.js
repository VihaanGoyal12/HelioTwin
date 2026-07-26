/**
 * HelioTwin — Status Bar
 *
 * Fixed 32px strip at the bottom of the map.
 * Displays live solar position data, time, and coordinates.
 * Uses IBM Plex Mono for all numeric readouts.
 */

import { get, subscribe } from '../state.js';

export function initStatusBar() {
  const bar = document.getElementById('status-bar');
  bar.innerHTML = `
    <div class="status-item">
      <span class="status-dot" id="sun-status-dot"></span>
      <span class="status-label">SUN</span>
      <span class="status-value" id="sb-sun-status">--</span>
    </div>
    <div class="status-sep"></div>
    <div class="status-item">
      <span class="status-label">Az</span>
      <span class="status-value" id="sb-azimuth">---.-°</span>
    </div>
    <div class="status-item">
      <span class="status-label">Alt</span>
      <span class="status-value" id="sb-altitude">---.-°</span>
    </div>
    <div class="status-sep"></div>
    <div class="status-item">
      <span class="status-label">TIME</span>
      <span class="status-value" id="sb-time">--:--</span>
    </div>
    <div class="status-sep"></div>
    <div class="status-item">
      <span class="status-label">COORD</span>
      <span class="status-value" id="sb-coords">${formatCoord(28.6139, 77.2090)}</span>
    </div>
    <div class="status-sep"></div>
    <div class="status-item">
      <span class="status-label">WS</span>
      <span class="status-value" id="sb-workspace">Urban Overview</span>
    </div>
  `;

  subscribe('map', (m) => {
    const el = document.getElementById('sb-coords');
    if (el && m.center) el.textContent = formatCoord(m.center[1], m.center[0]);
  });

  subscribe('workspace.active', (ws) => {
    const names = {
      1: 'Urban Overview', 2: 'Sunlight Analysis',
      3: 'Environmental Insights', 4: 'Scenario Comparison', 5: 'Planning Report'
    };
    const el = document.getElementById('sb-workspace');
    if (el) el.textContent = names[ws] || '';
  });
}

export function updateStatusBar(solar) {
  const az  = document.getElementById('sb-azimuth');
  const alt = document.getElementById('sb-altitude');
  const dot = document.getElementById('sun-status-dot');
  const st  = document.getElementById('sb-sun-status');
  const tm  = document.getElementById('sb-time');

  if (az)  az.textContent  = `${solar.azimuthBearing?.toFixed(1) ?? '--.-'}°`;
  if (alt) alt.textContent = `${solar.altitudeDeg?.toFixed(1) ?? '--.-'}°`;

  if (solar.isDaytime) {
    dot?.classList.add('status-dot--day');
    dot?.classList.remove('status-dot--night');
    if (st) st.textContent = 'Daytime';
  } else {
    dot?.classList.add('status-dot--night');
    dot?.classList.remove('status-dot--day');
    if (st) st.textContent = 'Night';
  }

  // Time display
  const time = get('time');
  if (tm) {
    const h = String(time.hour).padStart(2, '0');
    const m = String(time.minute || 0).padStart(2, '0');
    tm.textContent = `${h}:${m} IST`;
  }
}

function formatCoord(lat, lng) {
  const latStr = `${Math.abs(lat).toFixed(4)}°${lat >= 0 ? 'N' : 'S'}`;
  const lngStr = `${Math.abs(lng).toFixed(4)}°${lng >= 0 ? 'E' : 'W'}`;
  return `${latStr} ${lngStr}`;
}
