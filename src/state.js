/**
 * HelioTwin — Central State Store & Workspace State Machine
 *
 * Architecture:
 * - A single reactive state object drives all UI
 * - Subscribers register for specific state keys
 * - The state machine enforces workspace progression rules:
 *   locked → active → complete, with stale transitions
 */

// ── INITIAL STATE ────────────────────────────────────────────────
const _state = {
  // Workspace progression
  workspace: {
    active: 1,
    status: { 1: 'active', 2: 'locked', 3: 'locked', 4: 'locked', 5: 'locked' }
  },

  // Site / study area
  site: {
    studyArea: null,      // GeoJSON Polygon
    center: [77.2090, 28.6139],  // New Delhi default
    timezone: 'Asia/Kolkata',
    stats: null           // { buildingCount, avgHeight, greenCover, roadLength, areaSqKm }
  },

  // Time control
  time: {
    date: (() => {
      const d = new Date();
      return d;
    })(),
    hour: 12,
    minute: 0,
    isAnimating: false
  },

  // Solar position (computed from SunCalc, updated on time change)
  solar: {
    azimuth: 0,       // radians
    altitude: 0,      // radians
    isDaytime: false,
    sunrise: null,
    sunset: null,
    noon: null,
    dayLength: 0      // hours
  },

  // Layers visibility
  layers: {
    buildings3d:     { visible: true,  opacity: 1.0 },
    shadows:         { visible: false, opacity: 1.0 },
    studyArea:       { visible: false, opacity: 1.0 },
    exposureHeatmap: { visible: false, opacity: 0.75 },
    insightSun:      { visible: false, opacity: 0.75 },
    insightShade:    { visible: false, opacity: 0.75 },
    insightVeg:      { visible: false, opacity: 0.75 },
    insightSolar:    { visible: false, opacity: 0.75 }
  },

  // Drawing tool
  drawing: {
    active: false,
    type: null,         // 'study-area' | 'building'
    vertices: [],
    preview: null
  },

  // Analysis results
  analysis: {
    status: 'idle',     // 'idle' | 'computing' | 'complete' | 'error'
    progress: { label: '', pct: 0 },
    exposureGrid: null, // Array of { center: [lng,lat], hours: Number }
    analysisDate: null,
    analysisZone: null  // GeoJSON Polygon of analysis zone
  },

  // Insight layer thresholds and results
  insights: {
    prolongedSun:    { threshold: 6,  result: null, visible: false },
    shadeDeficiency: { threshold: 3,  result: null, visible: false },
    vegetation:      { result: null,  visible: false },
    solarPotential:  { result: null,  visible: false }
  },

  // Scenario comparison
  scenario: {
    addedBuildings: [],      // [{ id, geometry: GeoJSON Polygon, height }]
    removedBuildings: [],    // [buildingId]
    comparison: null,        // { shadowDelta, exposureDelta, ... }
    displayMode: 'baseline'  // 'baseline' | 'proposed' | 'overlay'
  },

  // Report
  report: {
    reference: '',
    recommendations: '',
    generated: null
  },

  // Map state
  map: {
    ready: false,
    pitch: 0,
    zoom: 14,
    center: [77.2090, 28.6139]
  }
};

// ── SUBSCRIBERS ──────────────────────────────────────────────────
const _subs = {};

/**
 * Subscribe to changes on a dot-path key.
 * @param {string} key - e.g. 'solar' or 'workspace.active'
 * @param {Function} cb - called with (newValue, key)
 * @returns {Function} unsubscribe
 */
export function subscribe(key, cb) {
  if (!_subs[key]) _subs[key] = [];
  _subs[key].push(cb);
  return () => { _subs[key] = _subs[key].filter(f => f !== cb); };
}

/**
 * Notify all subscribers for a given key.
 */
function _notify(key) {
  const val = get(key);
  (_subs[key] || []).forEach(cb => cb(val, key));
  // Also notify wildcard '*' subscribers
  (_subs['*'] || []).forEach(cb => cb(val, key));
}

/**
 * Get state value at a dot-path key.
 */
export function get(key) {
  if (!key) return _state;
  return key.split('.').reduce((obj, k) => (obj != null ? obj[k] : undefined), _state);
}

/**
 * Update a leaf value or an object at a dot-path key.
 * Merges objects; replaces primitives.
 */
export function set(key, value) {
  const keys = key.split('.');
  const last = keys.pop();
  const parent = keys.reduce((obj, k) => obj[k], _state);
  if (typeof value === 'object' && value !== null && !Array.isArray(value) &&
      typeof parent[last] === 'object' && parent[last] !== null) {
    Object.assign(parent[last], value);
  } else {
    parent[last] = value;
  }
  _notify(key);
  // Notify parent keys too
  for (let i = 1; i <= keys.length; i++) {
    _notify(keys.slice(0, i).join('.'));
  }
}

// ── WORKSPACE STATE MACHINE ───────────────────────────────────────

const WORKSPACE_ORDER = [1, 2, 3, 4, 5];

/**
 * Unlock the next workspace after completing the current one.
 * @param {number} completedWs - workspace number that was just completed
 */
export function completeWorkspace(completedWs) {
  const status = { ...get('workspace.status') };
  status[completedWs] = 'complete';
  // Unlock next workspace
  if (completedWs < 5) {
    if (status[completedWs + 1] === 'locked') {
      status[completedWs + 1] = 'active';
    }
  }
  set('workspace.status', status);
  _notify('workspace');
}

/**
 * Mark a workspace as stale (upstream data changed).
 * All downstream workspaces from `fromWs` are marked stale.
 */
export function markStale(fromWs) {
  const status = { ...get('workspace.status') };
  for (let ws = fromWs + 1; ws <= 5; ws++) {
    if (status[ws] === 'complete') status[ws] = 'stale';
  }
  set('workspace.status', status);
  _notify('workspace');
}

/**
 * Navigate to a workspace (only if not locked).
 */
export function navigateTo(ws) {
  const status = get('workspace.status');
  if (status[ws] === 'locked') return false;
  set('workspace.active', ws);
  _notify('workspace');
  return true;
}

/**
 * Check if a workspace is accessible.
 */
export function isAccessible(ws) {
  const status = get('workspace.status');
  return status[ws] !== 'locked';
}
