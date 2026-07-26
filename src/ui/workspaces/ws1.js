/**
 * HelioTwin — Workspace 1: Urban Overview
 *
 * Drawing implementation uses MapLibre Markers for vertex dots
 * (DOM elements pinned to the map — zero dependency on GeoJSON sources).
 * The polygon preview uses the ht-draw-preview GeoJSON source when available.
 */

import { get, set, completeWorkspace, markStale, navigateTo } from '../../state.js';
import { setStudyArea, clearStudyArea, getBuildingsInArea, clearDrawPreview } from '../../mapEngine.js';
import { computeSiteStats } from '../../analysisEngine.js';
import { mountWorkspace } from '../workspaceRouter.js';

// ── draw state ────────────────────────────────────────────────────
let _drawing    = false;
let _vertices   = [];    // [[lng, lat], ...]
let _markers    = [];    // maplibregl.Marker instances (for vertex dots)
let _clickRef   = null;
let _moveRef    = null;
let _keyRef     = null;

// ── MOUNT ─────────────────────────────────────────────────────────

export function mountWS1(container) {
  container.innerHTML = `
    <div class="panel-header">
      <div class="panel-title">Urban Overview</div>
      <div class="panel-subtitle">Step 1 of 5 — Define study area</div>
    </div>
    <div class="panel-body">

      <div class="panel-section">
        <div class="section-label">Study Area</div>
        <div id="ws1-status" class="notice notice--info" style="margin-bottom:var(--sp-3)">
          No study area defined. Draw a boundary on the map to proceed.
        </div>

        <div class="btn-group" style="margin-bottom:var(--sp-2)">
          <button class="btn btn-primary" id="ws1-draw-btn">
            Draw Boundary
          </button>
          <button class="btn btn-secondary" id="ws1-clear-btn">Clear</button>
        </div>

        <!-- Active drawing controls -->
        <div id="ws1-draw-controls" style="display:none;margin-top:var(--sp-2)">
          <div style="border:1px solid var(--c-border);border-radius:var(--radius-sm);padding:var(--sp-3);background:var(--c-surface)">
            <div style="font-size:10px;color:var(--c-text-tertiary);text-transform:uppercase;letter-spacing:var(--ls-label);margin-bottom:var(--sp-2)">
              Drawing active
            </div>
            <div id="ws1-vcount-row" style="font-size:var(--text-sm);color:var(--c-text-secondary);margin-bottom:var(--sp-3)">
              Vertices: <strong id="ws1-vcount" style="font-family:var(--font-mono);color:var(--c-text-primary)">0</strong>
              <span style="color:var(--c-text-tertiary)"> (need 3 to finish)</span>
            </div>
            <div class="btn-group">
              <button class="btn btn-primary btn-sm" id="ws1-finish-btn" disabled>
                Finish
              </button>
              <button class="btn btn-secondary btn-sm" id="ws1-cancel-btn">
                Cancel
              </button>
            </div>
          </div>
        </div>
      </div>

      <div class="panel-section" id="ws1-stats-section" style="display:none">
        <div class="section-label">Site Summary</div>
        <div id="ws1-stats"></div>
      </div>

      <div class="panel-section">
        <div class="section-label">Site Location</div>
        <div class="metric-row">
          <span class="metric-label">Latitude</span>
          <span class="metric-value" id="ws1-lat">--</span>
        </div>
        <div class="metric-row">
          <span class="metric-label">Longitude</span>
          <span class="metric-value" id="ws1-lng">--</span>
        </div>
        <div class="metric-row">
          <span class="metric-label">Timezone</span>
          <span class="metric-value">Asia/Kolkata (UTC+5:30)</span>
        </div>
      </div>

    </div>
    <div class="proceed-btn-wrap">
      <button class="btn btn-primary btn-full" id="ws1-proceed-btn" disabled>
        Proceed to Sunlight Analysis →
      </button>
    </div>
  `;

  _refreshCoords();
  document.getElementById('ws1-draw-btn').addEventListener('click', _onDrawBtnClick);
  document.getElementById('ws1-clear-btn').addEventListener('click', _clearArea);
  document.getElementById('ws1-proceed-btn').addEventListener('click', _proceed);

  // Restore from state if user navigated back
  const existing = get('site.studyArea');
  if (existing) {
    setStudyArea(existing);
    _showStats(get('site.stats'));
    document.getElementById('ws1-proceed-btn').disabled = false;
    const s = get('site.stats');
    _setStatus('success',
      `Boundary defined — ${s?.buildingCount ?? '?'} buildings · ${s?.areaSqKm ?? '?'} km²`);
  }
}

// ── DRAW BUTTON TOGGLE ────────────────────────────────────────────

function _onDrawBtnClick() {
  if (_drawing) {
    _cancelDrawing();
  } else {
    _startDrawing();
  }
}

// ── DRAWING ───────────────────────────────────────────────────────

function _startDrawing() {
  const map = window._helioMap;
  if (!map) {
    _setStatus('warn', 'Map not ready yet — please wait a moment and try again.');
    return;
  }

  _drawing  = true;
  _vertices = [];
  _markers  = [];

  map.doubleClickZoom.disable();
  document.body.classList.add('draw-mode');

  document.getElementById('ws1-draw-btn').textContent = '× Stop drawing';
  document.getElementById('ws1-draw-controls').style.display = 'block';
  _setStatus('info', 'Click on the map to place vertices. Press Finish when done.');
  _updateVCount();

  // Bind click → add vertex
  _clickRef = function(e) {
    if (!_drawing) return;
    const coord = [e.lngLat.lng, e.lngLat.lat];
    _vertices.push(coord);
    _addMarker(coord, map);
    _updateVCount();
    _updatePreviewLine();
  };

  // Bind mousemove → rubber-band line to cursor
  _moveRef = function(e) {
    if (!_drawing || _vertices.length === 0) return;
    _updatePreviewLine([e.lngLat.lng, e.lngLat.lat]);
  };

  // Bind Esc → cancel
  _keyRef = function(e) {
    if (e.key === 'Escape') _cancelDrawing();
  };

  map.on('click',     _clickRef);
  map.on('mousemove', _moveRef);
  document.addEventListener('keydown', _keyRef);

  document.getElementById('ws1-finish-btn').addEventListener('click', _finishDrawing);
  document.getElementById('ws1-cancel-btn').addEventListener('click', _cancelDrawing);
}

function _addMarker(coord, map) {
  // Create a styled DOM element — does not depend on any GeoJSON source/layer
  const el = document.createElement('div');
  el.style.cssText = [
    'width:12px', 'height:12px', 'border-radius:50%',
    'background:#2563EB', 'border:2px solid #fff',
    'box-shadow:0 0 0 1.5px #2563EB',
    'cursor:default', 'pointer-events:none'
  ].join(';');

  const m = new maplibregl.Marker({ element: el, anchor: 'center' })
    .setLngLat(coord)
    .addTo(map);
  _markers.push(m);
}

function _clearMarkers() {
  _markers.forEach(m => m.remove());
  _markers = [];
}

function _updateVCount() {
  const n   = _vertices.length;
  const el  = document.getElementById('ws1-vcount');
  const row = document.getElementById('ws1-vcount-row');
  if (el) el.textContent = n;
  if (row) {
    const hint = row.querySelector('span');
    if (hint) hint.textContent = n < 3 ? ` (need ${3 - n} more)` : ' ✓ ready to finish';
  }

  const btn = document.getElementById('ws1-finish-btn');
  if (btn) btn.disabled = n < 3;
}

function _updatePreviewLine(cursorCoord) {
  const map = window._helioMap;
  if (!map) return;

  // Try to use the ht-draw-preview GeoJSON source for the line preview
  try {
    const src = map.getSource('ht-draw-preview');
    if (!src) return;

    const pts = cursorCoord ? [..._vertices, cursorCoord] : _vertices;

    if (pts.length < 2) {
      src.setData({ type: 'FeatureCollection', features: [] });
    } else if (pts.length < 3) {
      src.setData({
        type: 'FeatureCollection',
        features: [{ type: 'Feature', properties: {},
          geometry: { type: 'LineString', coordinates: pts }
        }]
      });
    } else {
      src.setData({
        type: 'FeatureCollection',
        features: [{ type: 'Feature', properties: {},
          geometry: { type: 'Polygon', coordinates: [[...pts, pts[0]]] }
        }]
      });
    }
  } catch(err) {
    // Preview line failed — dots still show via Markers
    console.warn('HelioTwin: preview line update failed:', err.message);
  }
}

async function _finishDrawing() {
  if (!_drawing || _vertices.length < 3) return;

  // Capture the vertices BEFORE _stopListeners() clears _vertices as part of its cleanup —
  // otherwise the polygon below is built from an already-emptied array.
  const verts = [..._vertices];

  _stopListeners();
  _drawing = false;

  // Clear markers + preview line
  _clearMarkers();
  clearDrawPreview();
  document.getElementById('ws1-draw-controls').style.display = 'none';
  document.getElementById('ws1-draw-btn').textContent = 'Redraw Boundary';

  // Build closed polygon
  const polygon = { type: 'Polygon', coordinates: [[...verts, verts[0]]] };
  set('site.studyArea', polygon);
  setStudyArea(polygon);

  // getBuildingsInArea sweeps a grid of camera positions across the drawn area
  // to find buildings — let the user know progress rather than the UI looking stalled.
  _setStatus('info', 'Analysing buildings in study area…');

  // Stats
  const buildings = await getBuildingsInArea(polygon, (done, total) => {
    if (total > 1) _setStatus('info', `Analysing buildings in study area… (${done}/${total})`);
  });
  const stats     = computeSiteStats(buildings, polygon);
  set('site.stats', stats);
  _showStats(stats);
  markStale(1);

  _setStatus('success',
    `Boundary defined — ${verts.length} vertices · ${stats.buildingCount} buildings · ${stats.areaSqKm} km²`);
  document.getElementById('ws1-proceed-btn').disabled = false;
}

function _cancelDrawing() {
  if (!_drawing) return;
  _stopListeners();
  _drawing  = false;
  _clearMarkers();
  clearDrawPreview();

  document.getElementById('ws1-draw-controls').style.display = 'none';
  document.getElementById('ws1-draw-btn').textContent = 'Draw Boundary';

  if (!get('site.studyArea')) {
    _setStatus('info', 'Drawing cancelled. No boundary defined.');
  }
}

function _stopListeners() {
  const map = window._helioMap;
  if (map) {
    if (_clickRef) map.off('click',     _clickRef);
    if (_moveRef)  map.off('mousemove', _moveRef);
    map.doubleClickZoom.enable();
  }
  if (_keyRef) document.removeEventListener('keydown', _keyRef);
  _clickRef = _moveRef = _keyRef = null;
  document.body.classList.remove('draw-mode');
  _vertices = [];
}

function _clearArea() {
  _cancelDrawing();
  _clearMarkers();
  set('site.studyArea', null);
  set('site.stats', null);
  clearStudyArea();
  clearDrawPreview();

  const s = document.getElementById('ws1-stats-section');
  if (s) s.style.display = 'none';
  document.getElementById('ws1-proceed-btn').disabled = true;
  document.getElementById('ws1-draw-btn').textContent = 'Draw Boundary';
  _setStatus('info', 'Study area cleared. Draw a new boundary to proceed.');
  markStale(1);
}

function _proceed() {
  completeWorkspace(1);
  navigateTo(2);
  mountWorkspace(2);
}

// ── HELPERS ───────────────────────────────────────────────────────

function _setStatus(type, msg) {
  const el = document.getElementById('ws1-status');
  if (el) { el.className = `notice notice--${type}`; el.textContent = msg; }
}

function _refreshCoords() {
  const c   = get('site.center') || [77.209, 28.6139];
  const lat = document.getElementById('ws1-lat');
  const lng = document.getElementById('ws1-lng');
  if (lat) lat.textContent = `${Math.abs(c[1]).toFixed(4)}° ${c[1] >= 0 ? 'N' : 'S'}`;
  if (lng) lng.textContent = `${Math.abs(c[0]).toFixed(4)}° ${c[0] >= 0 ? 'E' : 'W'}`;
}

function _showStats(stats) {
  if (!stats) return;
  const sec = document.getElementById('ws1-stats-section');
  const box = document.getElementById('ws1-stats');
  if (!sec || !box) return;
  sec.style.display = 'block';
  box.innerHTML = `
    <div class="metric-row">
      <span class="metric-label">Study area</span>
      <span class="metric-value">${stats.areaSqKm}<span class="metric-unit"> km²</span></span>
    </div>
    <div class="metric-row">
      <span class="metric-label">Buildings detected</span>
      <span class="metric-value">${stats.buildingCount}</span>
    </div>
    <div class="metric-row">
      <span class="metric-label">Average height</span>
      <span class="metric-value">${stats.avgHeight}<span class="metric-unit"> m</span></span>
    </div>
    <div class="metric-row">
      <span class="metric-label">Tallest structure</span>
      <span class="metric-value">${stats.maxHeight}<span class="metric-unit"> m</span></span>
    </div>
    <div class="metric-row">
      <span class="metric-label">Green cover (est.)</span>
      <span class="metric-value">${stats.greenCover}<span class="metric-unit"> %</span></span>
    </div>
  `;
}
