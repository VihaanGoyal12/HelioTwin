/**
 * HelioTwin — Workspace 2: Sunlight Analysis
 *
 * Purpose: Analyse how sunlight moves across the study area across time.
 * Planning question: How does sunlight behave on this site across the day?
 * Completion condition: Analysis run for at least one period.
 */

import { get, set, subscribe, completeWorkspace, markStale, navigateTo } from '../../state.js';
import { updateShadows, setLayerVisible, setSourceData } from '../../mapEngine.js';
import { getSunData, formatTime, formatDuration,
         computeHourlyExposure, computeSeasonalSunlight, getDailySunProfile } from '../../solarEngine.js';
import { mountWorkspace } from '../workspaceRouter.js';

let _animFrame = null;
let _animHour = 6;
let _chart = null;
let _unsubSolar = null;
let _drawingZone = false;
let _zoneVertices = [];

export function mountWS2(container) {
  const time = get('time');
  const solar = get('solar');
  const site = get('site');

  const dateVal = time.date.toISOString().split('T')[0];
  const hourVal = time.hour;

  container.innerHTML = `
    <div class="panel-header">
      <div class="panel-title">Sunlight Analysis</div>
      <div class="panel-subtitle">Step 2 of 5 — Date, time &amp; exposure</div>
    </div>
    <div class="panel-body">

      <div class="panel-section">
        <div class="section-label">Analysis Date</div>
        <div class="form-field">
          <select class="form-select" id="ws2-date-preset">
            <option value="">Custom date…</option>
            <option value="solstice-summer">Summer Solstice — 21 Jun ${time.date.getFullYear()}</option>
            <option value="equinox-spring">Spring Equinox — 20 Mar ${time.date.getFullYear()}</option>
            <option value="equinox-autumn">Autumn Equinox — 23 Sep ${time.date.getFullYear()}</option>
            <option value="solstice-winter">Winter Solstice — 21 Dec ${time.date.getFullYear()}</option>
          </select>
        </div>
      </div>

      <div class="panel-section">
        <div class="section-label">Time of Day</div>
        <div class="slider-container">
          <div class="slider-value" id="ws2-time-display">${_fmtHour(hourVal)}</div>
          <input type="range" class="time-slider" id="ws2-time-slider"
            min="0" max="23" step="1" value="${hourVal}">
          <div class="slider-labels">
            <span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>23:00</span>
          </div>
        </div>
        <div style="margin-top:var(--sp-2)">
          <button class="btn btn-secondary btn-sm" id="ws2-play-btn">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>
            Play day sweep
          </button>
        </div>
      </div>

      <div class="panel-section">
        <div class="section-label">Sun Position</div>
        <div id="ws2-sun-position">
          <div class="metric-row">
            <span class="metric-label">Azimuth (compass bearing)</span>
            <span class="metric-value" id="ws2-az">---.-<span class="metric-unit">°</span></span>
          </div>
          <div class="metric-row">
            <span class="metric-label">Altitude above horizon</span>
            <span class="metric-value" id="ws2-alt">---.-<span class="metric-unit">°</span></span>
          </div>
          <div class="metric-row">
            <span class="metric-label">Sunlight status</span>
            <span class="metric-value" id="ws2-status">--</span>
          </div>
        </div>
      </div>

      <div class="panel-section">
        <div class="section-label">Day Summary</div>
        <div id="ws2-day-summary">
          <div class="metric-row">
            <span class="metric-label">Sunrise</span>
            <span class="metric-value" id="ws2-sunrise">--:--</span>
          </div>
          <div class="metric-row">
            <span class="metric-label">Solar noon</span>
            <span class="metric-value" id="ws2-noon">--:--</span>
          </div>
          <div class="metric-row">
            <span class="metric-label">Sunset</span>
            <span class="metric-value" id="ws2-sunset">--:--</span>
          </div>
          <div class="metric-row">
            <span class="metric-label">Day length</span>
            <span class="metric-value" id="ws2-daylength">-- h --m</span>
          </div>
          <div class="metric-row">
            <span class="metric-label">Shadow ratio at noon</span>
            <span class="metric-value" id="ws2-shadow-ratio">× --</span>
          </div>
        </div>
      </div>

      <div class="panel-section" id="ws2-exposure-section">
        <div class="section-label">Exposure Analysis
          <button class="btn btn-ghost btn-sm" id="ws2-draw-zone-btn" style="margin-left:auto">
            + Draw zone
          </button>
        </div>
        <div id="ws2-zone-status" class="empty-state">
          <div class="empty-state-title">No analysis zone defined</div>
          <div class="empty-state-body">Draw an analysis zone on the map to compute direct sunlight duration and seasonal comparison for that area.</div>
        </div>
        <div id="ws2-exposure-results" style="display:none">
          <div class="metric-row">
            <span class="metric-label">Daily Solar Exposure</span>
            <span class="metric-value" id="ws2-exp-hours">-- <span class="metric-unit">h/day</span></span>
          </div>
          <div class="chart-title" style="margin-top:var(--sp-3)">Hourly Direct Exposure (%)</div>
          <div class="chart-wrap">
            <canvas id="ws2-exposure-chart"></canvas>
          </div>
          <div class="chart-title" style="margin-top:var(--sp-3)">Seasonal Comparison</div>
          <div class="chart-wrap">
            <canvas id="ws2-seasonal-chart"></canvas>
          </div>
        </div>
      </div>

    </div>
    <div class="proceed-btn-wrap">
      <button class="btn btn-primary btn-full" id="ws2-proceed-btn" disabled>
        Proceed to Environmental Insights →
      </button>
    </div>
  `;

  // Enable shadows
  setLayerVisible('ht-shadows-fill', true);
  set('layers.shadows', { visible: true });

  _updateSolarDisplay();
  _bindWS2Events();

  // Restore from state if the user navigated back after already completing the zone analysis
  if (get('analysis.status') === 'complete') {
    const proceedBtn = document.getElementById('ws2-proceed-btn');
    if (proceedBtn) proceedBtn.disabled = false;
  }
}

export function unmountWS2() {
  if (_animFrame) { cancelAnimationFrame(_animFrame); _animFrame = null; }
  if (_unsubSolar) { _unsubSolar(); _unsubSolar = null; }
  if (_chart) { _chart.destroy(); _chart = null; }
  setLayerVisible('ht-shadows-fill', false);
}

function _bindWS2Events() {
  const slider = document.getElementById('ws2-time-slider');
  const playBtn = document.getElementById('ws2-play-btn');
  const datePreset = document.getElementById('ws2-date-preset');
  const drawZoneBtn = document.getElementById('ws2-draw-zone-btn');
  const proceedBtn = document.getElementById('ws2-proceed-btn');

  slider?.addEventListener('input', (e) => {
    const h = parseInt(e.target.value);
    set('time', { hour: h, minute: 0 });
    const el = document.getElementById('ws2-time-display');
    if (el) el.textContent = _fmtHour(h);
    _updateSolarDisplay();
  });

  datePreset?.addEventListener('change', (e) => {
    const year = get('time').date.getFullYear();
    const presets = {
      'solstice-summer': new Date(year, 5, 21),
      'equinox-spring':  new Date(year, 2, 20),
      'equinox-autumn':  new Date(year, 8, 23),
      'solstice-winter': new Date(year, 11, 21),
    };
    if (presets[e.target.value]) {
      set('time', { date: presets[e.target.value] });
      _updateSolarDisplay();
    }
  });

  playBtn?.addEventListener('click', () => _toggleAnimation(playBtn));
  drawZoneBtn?.addEventListener('click', _startZoneDrawing);
  proceedBtn?.addEventListener('click', () => {
    completeWorkspace(2);
    navigateTo(3);
    mountWorkspace(3);
  });
}

function _updateSolarDisplay() {
  const time = get('time');
  const site = get('site');
  const center = site.center;

  const sunData = getSunData(time.date, center[1], center[0], time.hour, time.minute || 0);

  // Update state
  set('solar', {
    azimuthBearing: sunData.azimuthBearing,
    azimuthRad: sunData.azimuthRad,
    altitudeDeg: sunData.altitudeDeg,
    altitudeRad: sunData.altitudeRad,
    isDaytime: sunData.isDaytime,
    sunrise: sunData.sunrise,
    sunset: sunData.sunset,
    noon: sunData.solarNoon,
    dayLengthHrs: sunData.dayLengthHrs,
    shadowRatio: sunData.shadowRatio
  });

  // Update shadow layer
  updateShadows(sunData);

  // Update panel
  const az  = document.getElementById('ws2-az');
  const alt = document.getElementById('ws2-alt');
  const st  = document.getElementById('ws2-status');
  if (az)  az.innerHTML = `${sunData.azimuthBearing.toFixed(1)}<span class="metric-unit">°</span>`;
  if (alt) alt.innerHTML = `${sunData.altitudeDeg.toFixed(1)}<span class="metric-unit">°</span>`;
  if (st)  st.textContent = sunData.isDaytime ? 'Direct sunlight' : 'Below horizon';
  if (st)  st.style.color = sunData.isDaytime ? 'var(--c-text-primary)' : 'var(--c-text-tertiary)';

  // Day summary
  _setEl('ws2-sunrise',      formatTime(sunData.sunrise));
  _setEl('ws2-noon',         formatTime(sunData.solarNoon));
  _setEl('ws2-sunset',       formatTime(sunData.sunset));
  _setEl('ws2-daylength',    formatDuration(sunData.dayLengthHrs));
  _setEl('ws2-shadow-ratio', sunData.shadowRatio ? `× ${sunData.shadowRatio}` : 'N/A (night)');
}

function _toggleAnimation(btn) {
  if (_animFrame) {
    cancelAnimationFrame(_animFrame);
    _animFrame = null;
    btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg> Play day sweep`;
    return;
  }

  // Start from sunrise
  const solar = get('solar');
  _animHour = solar.sunrise ? new Date(solar.sunrise).getHours() : 5;

  btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg> Pause`;

  let lastTime = performance.now();
  const SPEED = 800; // ms per hour

  function tick(now) {
    const dt = now - lastTime;
    if (dt >= SPEED) {
      lastTime = now;
      _animHour = (_animHour + 1) % 24;
      set('time', { hour: _animHour, minute: 0 });
      const slider = document.getElementById('ws2-time-slider');
      if (slider) slider.value = _animHour;
      const disp = document.getElementById('ws2-time-display');
      if (disp) disp.textContent = _fmtHour(_animHour);
      _updateSolarDisplay();

      // Stop after sunset + 2h
      const solar = get('solar');
      if (solar.sunset) {
        const sunsetHr = new Date(solar.sunset).getHours() + 2;
        if (_animHour > sunsetHr) {
          cancelAnimationFrame(_animFrame);
          _animFrame = null;
          if (btn) btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg> Play day sweep`;
          return;
        }
      }
    }
    _animFrame = requestAnimationFrame(tick);
  }
  _animFrame = requestAnimationFrame(tick);
}

function _startZoneDrawing() {
  // Simple polygon drawing for analysis zone
  _drawingZone = true;
  _zoneVertices = [];
  document.body.classList.add('draw-mode');

  const zoneStatus = document.getElementById('ws2-zone-status');
  if (zoneStatus) {
    zoneStatus.innerHTML = `<div class="notice notice--info">Click on map to define zone vertices. Double-click to finish.</div>`;
  }

  const map = window._helioMap;
  if (!map) return;

  function addVertex(e) {
    if (!_drawingZone) return;
    _zoneVertices.push([e.lngLat.lng, e.lngLat.lat]);
  }

  function finishZone(e) {
    map.off('click', addVertex);
    map.off('dblclick', finishZone);
    document.body.classList.remove('draw-mode');
    _drawingZone = false;

    if (_zoneVertices.length < 3) return;

    const polygon = {
      type: 'Polygon',
      coordinates: [[..._zoneVertices, _zoneVertices[0]]]
    };
    set('analysis.analysisZone', polygon);
    _computeZoneExposure(polygon);
  }

  map.on('click', addVertex);
  map.once('dblclick', finishZone);
}

function _computeZoneExposure(zone) {
  const time = get('time');
  const site = get('site');
  const c = zone.coordinates[0].reduce((acc, p) => [acc[0] + p[0], acc[1] + p[1]], [0, 0]);
  const centroid = [c[0] / zone.coordinates[0].length, c[1] / zone.coordinates[0].length];

  const hourlyExp = computeHourlyExposure(time.date, centroid[1], centroid[0]);
  const totalHours = hourlyExp.filter(v => v > 0).length;
  const seasonal = computeSeasonalSunlight(time.date.getFullYear(), centroid[1], centroid[0]);

  _setEl('ws2-exp-hours', `${totalHours.toFixed(1)} <span class="metric-unit">h/day</span>`);
  document.getElementById('ws2-zone-status').style.display = 'none';
  document.getElementById('ws2-exposure-results').style.display = 'block';

  _renderExposureChart(hourlyExp);
  _renderSeasonalChart(seasonal);

  // Store in state
  set('analysis', { status: 'complete', analysisDate: time.date });

  const proceedBtn = document.getElementById('ws2-proceed-btn');
  if (proceedBtn) proceedBtn.disabled = false;
}

function _renderExposureChart(hourlyData) {
  const canvas = document.getElementById('ws2-exposure-chart');
  if (!canvas) return;
  if (_chart) { _chart.destroy(); }

  _chart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: Array.from({length: 24}, (_, i) => `${String(i).padStart(2,'0')}:00`),
      datasets: [{
        data: hourlyData,
        backgroundColor: hourlyData.map(v => v > 50 ? '#D97706' : v > 0 ? '#FCD34D' : '#E5E7EB'),
        borderWidth: 0,
        borderRadius: 1
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: {
        callbacks: { label: ctx => `${ctx.raw}% direct exposure` }
      }},
      scales: {
        x: { ticks: { font: { family: 'IBM Plex Mono', size: 9 }, color: '#9CA3AF',
            maxTicksLimit: 8, maxRotation: 0 }, grid: { display: false } },
        y: { ticks: { font: { family: 'IBM Plex Mono', size: 9 }, color: '#9CA3AF' },
            grid: { color: '#E5E7EB' }, max: 100, title: { display: false }}
      }
    }
  });
}

function _renderSeasonalChart(seasonal) {
  const canvas = document.getElementById('ws2-seasonal-chart');
  if (!canvas) return;

  new Chart(canvas, {
    type: 'bar',
    data: {
      labels: ['Summer Solstice\n21 Jun', 'Spring Equinox\n20 Mar', 'Winter Solstice\n21 Dec'],
      datasets: [{
        data: [seasonal.summer, seasonal.equinox, seasonal.winter],
        backgroundColor: ['#D97706', '#FCD34D', '#BFDBFE'],
        borderWidth: 0,
        borderRadius: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: {
        callbacks: { label: ctx => `${ctx.raw.toFixed(1)} h solar exposure/day` }
      }},
      scales: {
        x: { ticks: { font: { family: 'IBM Plex Mono', size: 9 }, color: '#9CA3AF' },
            grid: { display: false } },
        y: { ticks: { font: { family: 'IBM Plex Mono', size: 9 }, color: '#9CA3AF' },
            grid: { color: '#E5E7EB' },
            title: { display: true, text: 'h/day', font: { size: 9 }, color: '#9CA3AF' }}
      }
    }
  });
}

function _setEl(id, html) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = html;
}

function _fmtHour(h) {
  return `${String(h).padStart(2,'0')}:00`;
}
