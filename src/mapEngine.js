/**
 * HelioTwin — Map Engine
 *
 * Manages MapLibre GL JS lifecycle, basemap customisation,
 * 3D building extrusions, shadow rendering, and analysis overlays.
 *
 * Style: OpenFreeMap "liberty" (free, no API key, OSM buildings with heights).
 * Fallback: CARTO Positron vector style (if OFM is unreachable).
 *
 * All HelioTwin layers are prefixed: ht-*
 */

import { get, set } from './state.js';
import { computeAllShadows } from './solarEngine.js';

let _map = null;
let _buildingSourceId  = null;  // source that has 3D building data
let _buildingSourceLayer = null; // the exact source-layer name matched within that source (e.g. 'building')
let _buildingLayerId   = 'ht-buildings-3d';
let _shadowTimer       = null;

// ── STYLE CONFIGS ──────────────────────────────────────────────────────────

const STYLES = [
  'https://tiles.openfreemap.org/styles/liberty',
  'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json'
];

// Known source-layer names for buildings across different vector tile schemas
const BUILDING_SOURCE_LAYERS = ['building', 'buildings', 'extruded_polygons'];

// ── MAP INITIALISATION ─────────────────────────────────────────────────────

/**
 * Initialise MapLibre. Returns the map instance immediately;
 * layers are added after the style 'load' event fires.
 */
export function initMap(containerId) {
  _map = new maplibregl.Map({
    container:        containerId,
    style:            STYLES[0],
    center:           get('site.center') || [77.2090, 28.6139],
    zoom:             14,
    pitch:            0,
    bearing:          0,
    maxZoom:          19,
    minZoom:          10,
    attributionControl: false,
    antialias:        true
  });

  // Attribution
  _map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');

  // Navigation (zoom only — compass not needed for sun-bearing UI)
  _map.addControl(
    new maplibregl.NavigationControl({ showCompass: false, visualizePitch: false }),
    'bottom-right'
  );

  // Scale bar
  _map.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: 'metric' }), 'bottom-left');

  // ── Style load ─────────────────────────────────────────────────────
  _map.on('load', _onStyleLoad);
  // A genuine fallback (see error handler below) swaps the whole style via setStyle(),
  // which fires 'style.load' rather than 'load' again — without this, every custom
  // ht-* layer added in _onStyleLoad() would be silently lost after a real fallback.
  // Re-running _onStyleLoad() here is safe: every _addXLayer() helper it calls is
  // idempotent (guarded by `if (!_map.getLayer(...))`).
  _map.on('style.load', _onStyleLoad);

  // ── Error handling → fallback style ────────────────────────────────
  _map.on('error', (e) => {
    const msg = e.error?.message || '';
    // _applyNeutralPalette() intentionally probes ~40 guessed layer names since it
    // doesn't know in advance which style is active — most won't exist in any given
    // style, and MapLibre reports that as an 'error' event (not a thrown exception,
    // so the local try/catch around each guess can't catch it). That's expected and
    // harmless — it is NOT a sign the style itself failed to load, so don't fall back.
    if (/does not exist|non-?existing layer/i.test(msg)) return;

    // Only attempt fallback if the map has never loaded a style yet
    if (!_map.loaded() && STYLES[1]) {
      console.warn('HelioTwin: Primary style failed, trying fallback…', msg);
      try { _map.setStyle(STYLES[1]); } catch(_) {}
    }
  });

  // ── Track map centre for status bar ────────────────────────────────
  _map.on('moveend', () => {
    if (!_map) return;
    const c = _map.getCenter();
    set('map', { center: [c.lng, c.lat], zoom: _map.getZoom(), ready: true });
  });

  return _map;
}

export function getMap() { return _map; }

// ── STYLE LOAD HANDLER ─────────────────────────────────────────────────────

function _onStyleLoad() {
  // Hide the loading spinner
  const loader = document.getElementById('map-loading');
  if (loader) loader.style.display = 'none';

  _applyNeutralPalette();
  _detectBuildingSource();
  _add3DBuildings();
  _addDrawPreviewLayer();
  _addShadowLayer();
  _addStudyAreaLayer();
  _addAnalysisLayers();
  _addProposedBuildingsLayer();
  _addBuildingClickHandler();

  set('map', { ready: true, center: get('site.center'), zoom: 14 });
  console.info('HelioTwin: Map ready. Building source:', _buildingSourceId);
}

// ── BASEMAP COLOUR OVERRIDE ────────────────────────────────────────────────

/**
 * Neutralise the liberty/positron palette to our professional grey scheme.
 * Errors are swallowed — layer IDs differ between styles.
 */
function _applyNeutralPalette() {
  const tryPaint = (layerId, prop, val) => {
    try { _map.setPaintProperty(layerId, prop, val); } catch(_) {}
  };
  const tryLayout = (layerId, prop, val) => {
    try { _map.setLayoutProperty(layerId, prop, val); } catch(_) {}
  };

  // Background
  tryPaint('background', 'background-color', '#ECEEF0');

  // Water
  ['water', 'water_polygon', 'waterway', 'waterway_label'].forEach(id => {
    tryPaint(id, 'fill-color',   '#C5D5DF');
    tryPaint(id, 'line-color',   '#A8C0D0');
  });

  // Green spaces
  ['park', 'landuse_park', 'grass', 'landuse', 'nature_reserve',
   'national_park', 'forest', 'wood'].forEach(id => {
    tryPaint(id, 'fill-color', '#D8E8D0');
  });

  // Roads: neutral grey
  const ROAD_COLOUR   = '#FFFFFF';
  const ROAD_CASE_COL = '#D8DADD';
  ['road', 'road_case', 'motorway', 'motorway_case', 'trunk', 'trunk_case',
   'primary', 'primary_case', 'secondary', 'secondary_case',
   'service', 'service_case', 'path', 'path_case',
   'road_label', 'highway_name_other', 'highway_name_motorway'].forEach(id => {
    tryPaint(id, 'line-color',      ROAD_COLOUR);
    tryPaint(id, 'line-gap-width',  0);
    tryPaint(id, 'fill-color',      ROAD_CASE_COL);
  });

  // Building fill in 2D — light grey base
  ['building', 'building_top', 'buildings', 'building_3d'].forEach(id => {
    tryPaint(id, 'fill-color',         '#D8DADD');
    tryPaint(id, 'fill-outline-color', '#C4C7CB');
    tryPaint(id, 'fill-opacity',       0.9);
    // Hide existing 3D extrusions — we'll re-add ours
    tryPaint(id, 'fill-extrusion-color', '#D8DADD');
    tryPaint(id, 'fill-extrusion-opacity', 0);
    tryLayout(id, 'visibility', 'visible');
  });

  // Labels: muted, small
  _map.getStyle().layers
    .filter(l => l.type === 'symbol')
    .forEach(l => {
      tryPaint(l.id, 'text-color',       '#6B7280');
      tryPaint(l.id, 'text-halo-color',  'rgba(255,255,255,0.8)');
      tryPaint(l.id, 'text-halo-width',  1);
      tryPaint(l.id, 'icon-opacity',     0.7);
    });
}

// ── BUILDING SOURCE DETECTION ──────────────────────────────────────────────

function _detectBuildingSource() {
  _buildingSourceId = null;
  _buildingSourceLayer = null;
  const style = _map.getStyle();
  if (!style?.sources) return;

  // Find first source that has building data (check via layers referencing it)
  for (const layer of (style.layers || [])) {
    if (!layer['source-layer']) continue;
    const sl = layer['source-layer'].toLowerCase();
    if (BUILDING_SOURCE_LAYERS.includes(sl)) {
      _buildingSourceId = layer.source;
      _buildingSourceLayer = layer['source-layer'];
      console.info(`HelioTwin: Buildings in source="${layer.source}", source-layer="${layer['source-layer']}"`);
      return;
    }
  }

  // Second pass: check source IDs for keywords
  for (const [srcId, src] of Object.entries(style.sources || {})) {
    if (/building|osm|ofm|openmaptiles/i.test(srcId)) {
      _buildingSourceId = srcId;
      _buildingSourceLayer = 'building';
      break;
    }
  }
}

// ── 3D BUILDINGS LAYER ─────────────────────────────────────────────────────

function _add3DBuildings() {
  if (_map.getLayer(_buildingLayerId)) return;

  // Find the first symbol layer (insert buildings below labels)
  const firstLabel = _map.getStyle().layers.find(l => l.type === 'symbol')?.id;

  // Determine which source and source-layer to use
  let sourceRef;
  if (_buildingSourceId) {
    // Reuse the exact source-layer name _detectBuildingSource() already matched.
    // (Re-deriving it here via layers.find(l => l.source === _buildingSourceId) is unsafe:
    // most vector styles funnel dozens of unrelated layers through one shared source, so
    // that find() would grab whichever layer happens to appear first — e.g. "landcover" —
    // not "building".)
    sourceRef = { source: _buildingSourceId, 'source-layer': _buildingSourceLayer || 'building' };
  } else {
    // No vector building data detected → skip 3D layer (map still renders)
    console.warn('HelioTwin: No building source detected. 3D extrusions disabled.');
    return;
  }

  try {
    _map.addLayer({
      id:   _buildingLayerId,
      type: 'fill-extrusion',
      ...sourceRef,
      filter: ['==', ['geometry-type'], 'Polygon'],
      paint: {
        'fill-extrusion-color': [
          'interpolate', ['linear'],
          ['coalesce', ['get', 'render_height'], ['get', 'building:height'], ['get', 'height'], 10],
          0,   '#D0D3D8',
          10,  '#C8CDD4',
          30,  '#BCC1CA',
          60,  '#B0B7C0',
          100, '#A4ABB8'
        ],
        'fill-extrusion-height': [
          'coalesce', ['get', 'render_height'], ['get', 'building:height'], ['get', 'height'], 10
        ],
        'fill-extrusion-base': [
          'coalesce', ['get', 'render_min_height'], ['get', 'min_height'], 0
        ],
        'fill-extrusion-opacity': 0.85,
        'fill-extrusion-vertical-gradient': true
      }
    }, firstLabel);
  } catch(e) {
    console.warn('HelioTwin: Could not add 3D buildings layer:', e.message);
  }
}

// ── DRAW PREVIEW LAYER ─────────────────────────────────────────────────────

function _addDrawPreviewLayer() {
  if (!_map.getSource('ht-draw-preview')) {
    _map.addSource('ht-draw-preview', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] }
    });
  }
  if (!_map.getLayer('ht-draw-preview-line')) {
    _map.addLayer({
      id: 'ht-draw-preview-line', type: 'line',
      source: 'ht-draw-preview',
      paint: { 'line-color': '#2563EB', 'line-width': 1.5, 'line-dasharray': [4, 2] }
    });
  }
  if (!_map.getLayer('ht-draw-preview-fill')) {
    _map.addLayer({
      id: 'ht-draw-preview-fill', type: 'fill',
      source: 'ht-draw-preview',
      paint: { 'fill-color': '#2563EB', 'fill-opacity': 0.08 }
    });
  }
}

// ── SHADOW LAYER ───────────────────────────────────────────────────────────

function _addShadowLayer() {
  if (!_map.getSource('ht-shadows')) {
    _map.addSource('ht-shadows', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] }
    });
  }
  if (!_map.getLayer('ht-shadows-fill')) {
    _map.addLayer({
      id: 'ht-shadows-fill', type: 'fill',
      source: 'ht-shadows',
      layout: { visibility: 'none' },
      paint: {
        'fill-color':   '#000000',
        'fill-opacity': 0.25
      }
    }, _map.getLayer(_buildingLayerId) ? _buildingLayerId : undefined);
  }
}

// ── STUDY AREA LAYER ───────────────────────────────────────────────────────

function _addStudyAreaLayer() {
  if (!_map.getSource('ht-study-area')) {
    _map.addSource('ht-study-area', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] }
    });
  }
  if (!_map.getLayer('ht-study-area-fill')) {
    _map.addLayer({
      id: 'ht-study-area-fill', type: 'fill',
      source: 'ht-study-area',
      paint: { 'fill-color': '#2563EB', 'fill-opacity': 0.06 }
    });
  }
  if (!_map.getLayer('ht-study-area-line')) {
    _map.addLayer({
      id: 'ht-study-area-line', type: 'line',
      source: 'ht-study-area',
      paint: { 'line-color': '#2563EB', 'line-width': 1.5 }
    });
  }
  // Vertex dots
  if (!_map.getSource('ht-draw-verts')) {
    _map.addSource('ht-draw-verts', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] }
    });
  }
  if (!_map.getLayer('ht-draw-verts')) {
    _map.addLayer({
      id: 'ht-draw-verts', type: 'circle',
      source: 'ht-draw-verts',
      paint: { 'circle-radius': 4, 'circle-color': '#2563EB', 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5 }
    });
  }
}

// ── ANALYSIS INSIGHT LAYERS ────────────────────────────────────────────────

function _addAnalysisLayers() {
  const LAYERS = [
    // [sourceId, layerId, type, paint, defaultVisibility]
    ['ht-insight-sun', 'ht-insight-sun-fill', 'fill',
      { 'fill-color': '#D97706', 'fill-opacity': 0.35 }, 'none'],
    ['ht-insight-shade', 'ht-insight-shade-fill', 'fill',
      { 'fill-color': '#1E3A5F', 'fill-opacity': 0.30 }, 'none'],
    ['ht-insight-veg', 'ht-insight-veg-line', 'line',
      { 'line-color': '#16A34A', 'line-width': 3, 'line-dasharray': [4, 2] }, 'none'],
    ['ht-insight-solar', 'ht-insight-solar-fill', 'fill',
      { 'fill-color': ['get', 'color'], 'fill-opacity': 0.55 }, 'none'],
  ];

  for (const [srcId, layId, type, paint, vis] of LAYERS) {
    if (!_map.getSource(srcId)) {
      _map.addSource(srcId, { type: 'geojson', data: { type: 'FeatureCollection', features: [] }});
    }
    if (!_map.getLayer(layId)) {
      _map.addLayer({ id: layId, type, source: srcId, layout: { visibility: vis }, paint });
    }
  }
}

// ── PROPOSED BUILDINGS LAYER ───────────────────────────────────────────────

function _addProposedBuildingsLayer() {
  if (!_map.getSource('ht-proposed')) {
    _map.addSource('ht-proposed', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] }
    });
  }
  if (!_map.getLayer('ht-proposed-fill')) {
    _map.addLayer({
      id: 'ht-proposed-fill', type: 'fill-extrusion',
      source: 'ht-proposed',
      layout: { visibility: 'none' },
      paint: {
        'fill-extrusion-color':   '#2563EB',
        'fill-extrusion-height':  ['get', 'height'],
        'fill-extrusion-base':    0,
        'fill-extrusion-opacity': 0.65
      }
    });
  }
  if (!_map.getLayer('ht-proposed-outline')) {
    _map.addLayer({
      id: 'ht-proposed-outline', type: 'line',
      source: 'ht-proposed',
      layout: { visibility: 'none' },
      paint: { 'line-color': '#2563EB', 'line-width': 1.5 }
    });
  }
}

// ── BUILDING CLICK HANDLER ─────────────────────────────────────────────────

let _buildingClickHandlerBound = false;

function _addBuildingClickHandler() {
  if (!_buildingLayerId || !_map.getLayer(_buildingLayerId)) return;
  // _onStyleLoad() now runs on both 'style.load' and 'load' (the latter fires shortly
  // after the former even on a normal first load, not just a fallback swap) — guard
  // against binding a second set of listeners, which would show duplicate popups.
  if (_buildingClickHandlerBound) return;
  _buildingClickHandlerBound = true;

  _map.on('click', _buildingLayerId, (e) => {
    const props = e.features?.[0]?.properties;
    if (!props) return;

    const height = props.render_height || props['building:height'] || props.height || 10;
    const name   = props.name || props['building:name'] || 'Unnamed building';

    new maplibregl.Popup({ closeButton: true, className: 'ht-popup' })
      .setLngLat(e.lngLat)
      .setHTML(`
        <div style="font-family:var(--font-sans,Inter,sans-serif);padding:8px 12px;min-width:160px">
          <div style="font-size:12px;font-weight:600;color:#111827;margin-bottom:6px">${name}</div>
          <div style="font-size:11px;color:#6B7280;font-family:monospace">Height: ${Number(height).toFixed(1)} m</div>
          ${props.levels ? `<div style="font-size:11px;color:#6B7280;font-family:monospace">Floors: ${props.levels}</div>` : ''}
          ${props['building:use'] ? `<div style="font-size:11px;color:#6B7280">Use: ${props['building:use']}</div>` : ''}
        </div>
      `)
      .addTo(_map);
  });

  _map.on('mouseenter', _buildingLayerId, () => {
    _map.getCanvas().style.cursor = 'pointer';
  });
  _map.on('mouseleave', _buildingLayerId, () => {
    _map.getCanvas().style.cursor = '';
  });
}

// ── SHADOW UPDATE ──────────────────────────────────────────────────────────

/**
 * Recompute and render shadows for all buildings in the current viewport.
 * Throttled to avoid stacking calls during animation.
 */
export function updateShadows(sunData) {
  if (!_map || !sunData) return;
  if (!_map.loaded()) return;

  clearTimeout(_shadowTimer);
  _shadowTimer = setTimeout(() => _doUpdateShadows(sunData), 60);
}

function _doUpdateShadows(sunData) {
  if (!_map.getSource('ht-shadows')) return;

  if (!sunData.isDaytime || sunData.altitudeDeg < 1) {
    _map.getSource('ht-shadows').setData({ type: 'FeatureCollection', features: [] });
    return;
  }

  // Sample buildings from the rendered scene
  const buildings = _getRenderedBuildings();
  const centerLat = (_map.getCenter()).lat;
  const fc = computeAllShadows(buildings, sunData, centerLat);
  _map.getSource('ht-shadows').setData(fc);
}

function _getRenderedBuildings() {
  if (!_map.getLayer(_buildingLayerId)) return [];
  try {
    const features = _map.queryRenderedFeatures({ layers: [_buildingLayerId] });
    return features.map(f => ({
      geometry: f.geometry,
      height: f.properties?.render_height
           || f.properties?.['building:height']
           || f.properties?.height
           || 10
    }));
  } catch(e) { return []; }
}

// ── LAYER VISIBILITY ───────────────────────────────────────────────────────

export function setLayerVisible(layerId, visible) {
  if (!_map || !_map.getLayer(layerId)) return;
  _map.setLayoutProperty(layerId, 'visibility', visible ? 'visible' : 'none');
}

// ── SOURCE DATA UPDATE ─────────────────────────────────────────────────────

export function setSourceData(sourceId, geojson) {
  if (!_map) return;
  const src = _map.getSource(sourceId);
  if (src) src.setData(geojson);
}

// ── STUDY AREA ─────────────────────────────────────────────────────────────

export function setStudyArea(geojson) {
  if (!_map) return;
  const src = _map.getSource('ht-study-area');
  if (!src) return;
  src.setData({
    type: 'FeatureCollection',
    features: [{ type: 'Feature', properties: {}, geometry: geojson }]
  });
}

export function clearStudyArea() {
  if (!_map) return;
  const src = _map.getSource('ht-study-area');
  if (src) src.setData({ type: 'FeatureCollection', features: [] });
  const vsrc = _map.getSource('ht-draw-verts');
  if (vsrc) vsrc.setData({ type: 'FeatureCollection', features: [] });
}

export function updateDrawPreview(coords) {
  if (!_map) return;

  // ── Vertex dots: always safe — a Point always has exactly 1 coordinate
  const vsrc = _map.getSource('ht-draw-verts');
  if (vsrc) {
    vsrc.setData({
      type: 'FeatureCollection',
      features: coords.map(c => ({
        type: 'Feature', properties: {},
        geometry: { type: 'Point', coordinates: c }
      }))
    });
  }

  // ── Polygon/line preview
  const src = _map.getSource('ht-draw-preview');
  if (!src) return;

  if (coords.length === 0 || coords.length === 1) {
    // 0 or 1 point: LineString is invalid — just clear preview line/fill.
    // Dot above handles single-point feedback.
    src.setData({ type: 'FeatureCollection', features: [] });

  } else if (coords.length === 2) {
    // Exactly 2 points: open line segment (valid LineString)
    src.setData({
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: {},
        geometry: { type: 'LineString', coordinates: coords }
      }]
    });

  } else {
    // 3+ points: closed polygon — both fill and outline layers will render
    src.setData({
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: {},
        geometry: { type: 'Polygon', coordinates: [[...coords, coords[0]]] }
      }]
    });
  }
}


export function clearDrawPreview() {
  setSourceData('ht-draw-preview', { type: 'FeatureCollection', features: [] });
  setSourceData('ht-draw-verts',   { type: 'FeatureCollection', features: [] });
}

// ── PROPOSED BUILDINGS ─────────────────────────────────────────────────────

export function setProposedBuildings(buildings) {
  if (!_map) return;
  const src = _map.getSource('ht-proposed');
  if (!src) return;
  src.setData({
    type: 'FeatureCollection',
    features: buildings.map(b => ({
      type: 'Feature',
      properties: { id: b.id, height: b.height },
      geometry: b.geometry
    }))
  });
}

// ── FLY-TO ─────────────────────────────────────────────────────────────────

export function flyTo(center, zoom = 14) {
  if (!_map) return;
  _map.flyTo({ center, zoom, duration: 1200, essential: true });
}

// ── BUILDING QUERIES ───────────────────────────────────────────────────────

/**
 * Wait for the map to finish loading tiles at its current camera position.
 * MapLibre fires 'idle' once all tiles/sources have settled with no pending
 * animation. Falls back to a timeout so this can never hang indefinitely
 * (e.g. if a tile request genuinely fails).
 */
function _waitForIdle(timeoutMs = 4000) {
  return new Promise(resolve => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    _map.once('idle', finish);
    setTimeout(finish, timeoutMs);
  });
}

// Cap on how many camera positions we'll sweep for one query — bounds worst-case
// time (each cell can take up to _waitForIdle's timeout) for pathologically large
// drawn areas, at the cost of coverage completeness in that rare case.
const MAX_GRID_CELLS = 24;

/**
 * Return building features intersecting areaGeoJson.
 *
 * queryRenderedFeatures() can only see tiles already loaded in the CURRENT
 * viewport — it is not a query against the full drawn area. Vector tile
 * schemas also simplify/drop building footprints at lower zoom levels. A
 * study area of any real size (a few blocks or more) can't be seen at
 * building-detail zoom from a single camera position, so a single fit-to-
 * bounds query still undercounts once the drawn area is bigger than one
 * screen's worth of ground at that zoom.
 *
 * To get an accurate count we sweep a grid of camera positions across the
 * drawn area's bounding box at building-detail zoom, querying and de-
 * duplicating results from each position, then restore the original camera
 * so the user's view doesn't visibly change afterward.
 */
export async function getBuildingsInArea(areaGeoJson, onProgress) {
  if (!_map || !_map.getLayer(_buildingLayerId)) return [];

  const originalCenter = _map.getCenter();
  const originalZoom    = _map.getZoom();
  const TARGET_ZOOM = 17; // reliable building-detail zoom across common vector tile schemas

  try {
    if (!areaGeoJson) {
      // No area given — just query whatever's currently rendered (unchanged behaviour).
      return _queryBuildingsOnScreen(null);
    }

    const bbox = turf.bbox({ type: 'Feature', properties: {}, geometry: areaGeoJson }); // [w, s, e, n]
    const bboxWidth  = bbox[2] - bbox[0];
    const bboxHeight = bbox[3] - bbox[1];

    // Measure how much ground (in degrees) one viewport covers at TARGET_ZOOM,
    // by jumping there once. This is a pure camera/projection read — no tile
    // loading needed yet, so no idle-wait required for this step.
    _map.jumpTo({ center: [(bbox[0]+bbox[2])/2, (bbox[1]+bbox[3])/2], zoom: TARGET_ZOOM });
    const viewBounds = _map.getBounds();
    const cellWidth  = Math.max(1e-6, (viewBounds.getEast?.() ?? viewBounds._ne?.lng ?? bboxWidth)  - (viewBounds.getWest?.()  ?? viewBounds._sw?.lng ?? 0));
    const cellHeight = Math.max(1e-6, (viewBounds.getNorth?.() ?? viewBounds._ne?.lat ?? bboxHeight) - (viewBounds.getSouth?.() ?? viewBounds._sw?.lat ?? 0));

    // Overlap cells by ~15% so buildings sitting on a cell boundary aren't missed.
    const stepX = cellWidth  * 0.85;
    const stepY = cellHeight * 0.85;

    let cols = Math.max(1, Math.ceil(bboxWidth  / stepX));
    let rows = Math.max(1, Math.ceil(bboxHeight / stepY));

    if (cols * rows > MAX_GRID_CELLS) {
      // Pathologically large area for a single-session query — scale the grid
      // down to the cap. Coverage is best-effort in this case (documented
      // limitation), rather than making the user wait indefinitely.
      const scale = Math.sqrt(MAX_GRID_CELLS / (cols * rows));
      cols = Math.max(1, Math.round(cols * scale));
      rows = Math.max(1, Math.round(rows * scale));
      console.warn(`HelioTwin: Study area is large — sampling a ${cols}×${rows} grid rather than full coverage.`);
    }

    const seen = new Map(); // dedupe key -> feature, since adjacent cells overlap
    const cellW = bboxWidth  / cols;
    const cellH = bboxHeight / rows;
    const totalCells = cols * rows;
    let cellIndex = 0;

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        cellIndex++;
        if (onProgress) { try { onProgress(cellIndex, totalCells); } catch(e) {} }

        const cx = bbox[0] + cellW * (col + 0.5);
        const cy = bbox[1] + cellH * (row + 0.5);

        _map.jumpTo({ center: [cx, cy], zoom: TARGET_ZOOM });
        await _waitForIdle();

        for (const f of _queryBuildingsOnScreenRaw()) {
          const key = _featureDedupeKey(f);
          if (!seen.has(key)) seen.set(key, f);
        }
      }
    }

    return _filterAndMapBuildings([...seen.values()], areaGeoJson);
  } catch(e) {
    return [];
  } finally {
    _map.jumpTo({ center: originalCenter, zoom: originalZoom });
  }
}

function _queryBuildingsOnScreenRaw() {
  try { return _map.queryRenderedFeatures({ layers: [_buildingLayerId] }); }
  catch(e) { return []; }
}

function _queryBuildingsOnScreen(areaGeoJson) {
  return _filterAndMapBuildings(_queryBuildingsOnScreenRaw(), areaGeoJson);
}

function _featureDedupeKey(f) {
  if (f.id != null) return `id:${f.id}`;
  // No stable feature id in this tile schema — fall back to a geometry
  // fingerprint so the same building seen from two overlapping grid cells
  // is only counted once.
  try { return `geom:${JSON.stringify(f.geometry?.coordinates)}`; }
  catch(e) { return `ref:${Math.random()}`; } // never de-dupe rather than wrongly merge
}

function _filterAndMapBuildings(features, areaGeoJson) {
  const areaFeature = areaGeoJson
    ? { type: 'Feature', properties: {}, geometry: areaGeoJson }
    : null;

  return features
    .filter(f => {
      if (!areaFeature) return true;
      try { return turf.booleanIntersects(f, areaFeature); }
      catch(e) { return true; } // don't drop a building just because of a geometry edge case
    })
    .map(f => ({
      geometry: f.geometry,
      height: f.properties?.render_height
           || f.properties?.['building:height']
           || f.properties?.height
           || 10,
      properties: f.properties
    }));
}
