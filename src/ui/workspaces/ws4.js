/**
 * HelioTwin — Workspace 4: Scenario Comparison
 *
 * Purpose: Compare baseline vs proposed development's environmental impact.
 * Planning question: How does the proposed development change sunlight conditions?
 * Completion condition: Comparison run.
 */

import { get, set, subscribe, completeWorkspace, navigateTo } from '../../state.js';
import { setLayerVisible, setSourceData, setProposedBuildings } from '../../mapEngine.js';
import { computeScenarioComparison } from '../../analysisEngine.js';
import { mountWorkspace } from '../workspaceRouter.js';

let _addedBuildings = [];
let _removedBuildings = [];
let _drawingBuilding = false;
let _drawStart = null;

export function mountWS4(container) {
  const scenario = get('scenario');

  container.innerHTML = `
    <div class="panel-header">
      <div class="panel-title">Scenario Comparison</div>
      <div class="panel-subtitle">Step 4 of 5 — Baseline vs Proposed</div>
    </div>
    <div class="panel-body">

      <div class="panel-section">
        <div class="section-label">Display Mode</div>
        <div class="scenario-mode-tabs">
          <button class="scenario-tab scenario-tab--active" data-mode="baseline" id="tab-baseline">Baseline</button>
          <button class="scenario-tab" data-mode="proposed" id="tab-proposed">Proposed</button>
          <button class="scenario-tab" data-mode="overlay" id="tab-overlay">Overlay</button>
        </div>
      </div>

      <div class="panel-section">
        <div class="section-label">Scenario B — Proposed Modifications</div>
        <div class="btn-group" style="margin-bottom:var(--sp-3)">
          <button class="btn btn-secondary btn-sm" id="ws4-add-building-btn">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Add building
          </button>
          <button class="btn btn-secondary btn-sm" id="ws4-clear-scenario-btn">Clear all</button>
        </div>

        <div id="ws4-height-input" style="display:none" class="notice notice--info">
          <div style="margin-bottom:var(--sp-2)">Building height (metres):</div>
          <div style="display:flex;gap:var(--sp-2);align-items:center">
            <input type="number" class="form-input form-input--mono" id="ws4-height-val"
              value="24" min="3" max="200" style="width:80px">
            <button class="btn btn-primary btn-sm" id="ws4-confirm-height">Confirm</button>
            <button class="btn btn-secondary btn-sm" id="ws4-cancel-height">Cancel</button>
          </div>
        </div>

        <div id="ws4-added-list">
          <div class="empty-state" style="padding:var(--sp-3)">
            <div class="empty-state-body">No proposed buildings added.<br>Draw a rectangle on the map to add a building.</div>
          </div>
        </div>
      </div>

      <div class="panel-section">
        <button class="btn btn-primary btn-full" id="ws4-run-comparison" style="margin-bottom:var(--sp-2)">
          Run Comparison Analysis
        </button>
        <div class="progress-wrap" id="ws4-progress" style="display:none">
          <div class="progress-label" id="ws4-progress-label">Projecting shadows for 48 time steps…</div>
          <div class="progress-bar-track"><div class="progress-bar-fill" id="ws4-progress-fill" style="width:0%"></div></div>
        </div>
      </div>

      <div id="ws4-results" style="display:none">
        <div class="panel-section">
          <div class="section-label">Shadow Coverage Comparison</div>
          <div class="compare-row" style="border-bottom:none">
            <span style="font-size:var(--text-xs);color:var(--c-text-tertiary)">Metric</span>
            <span style="font-size:var(--text-xs);color:var(--c-text-tertiary);text-align:center">Baseline</span>
            <span style="font-size:var(--text-xs);color:var(--c-text-tertiary);text-align:right">Δ Change</span>
          </div>
          <div id="ws4-comparison-table"></div>
        </div>

        <div class="panel-section">
          <div class="section-label">Affected Neighbours</div>
          <div id="ws4-neighbour-impact"></div>
        </div>

        <div class="panel-section">
          <div class="section-label">Planning Implications</div>
          <div id="ws4-implications" style="font-size:var(--text-xs);color:var(--c-text-secondary);line-height:1.6"></div>
        </div>
      </div>

    </div>
    <div class="proceed-btn-wrap">
      <button class="btn btn-primary btn-full" id="ws4-proceed-btn" disabled>
        Proceed to Planning Report →
      </button>
    </div>
  `;

  _addedBuildings = scenario.addedBuildings || [];
  _removedBuildings = scenario.removedBuildings || [];
  _updateAddedList();
  _bindWS4Events();

  if (scenario.comparison) _renderComparison(scenario.comparison);
}

export function unmountWS4() {
  setLayerVisible('ht-proposed-fill', false);
  setLayerVisible('ht-proposed-outline', false);
  document.body.classList.remove('draw-mode');
}

function _bindWS4Events() {
  document.getElementById('ws4-add-building-btn')?.addEventListener('click', _startBuildingDraw);
  document.getElementById('ws4-clear-scenario-btn')?.addEventListener('click', _clearScenario);
  document.getElementById('ws4-run-comparison')?.addEventListener('click', _runComparison);
  document.getElementById('ws4-proceed-btn')?.addEventListener('click', () => {
    completeWorkspace(4);
    navigateTo(5);
    mountWorkspace(5);
  });

  // Display mode tabs
  document.querySelectorAll('.scenario-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.scenario-tab').forEach(t => t.classList.remove('scenario-tab--active'));
      tab.classList.add('scenario-tab--active');
      const mode = tab.dataset.mode;
      set('scenario.displayMode', mode);
      _applyDisplayMode(mode);
    });
  });
}

function _startBuildingDraw() {
  _drawingBuilding = true;
  _drawStart = null;
  document.body.classList.add('draw-mode');

  const map = window._helioMap;
  if (!map) return;

  function onMouseDown(e) {
    _drawStart = [e.lngLat.lng, e.lngLat.lat];
  }

  function onMouseMove(e) {
    if (!_drawStart) return;
    const end = [e.lngLat.lng, e.lngLat.lat];
    map.getSource('ht-draw-preview')?.setData({
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: {},
        geometry: { type: 'Polygon', coordinates: [[
          _drawStart, [end[0], _drawStart[1]],
          end, [_drawStart[0], end[1]], _drawStart
        ]]
      }}]
    });
  }

  function onMouseUp(e) {
    if (!_drawStart) return;
    const end = [e.lngLat.lng, e.lngLat.lat];
    map.off('mousedown', onMouseDown);
    map.off('mousemove', onMouseMove);
    map.off('mouseup', onMouseUp);
    map.getSource('ht-draw-preview')?.setData({ type: 'FeatureCollection', features: [] });
    document.body.classList.remove('draw-mode');
    _drawingBuilding = false;

    const polygon = {
      type: 'Polygon',
      coordinates: [[
        _drawStart, [end[0], _drawStart[1]],
        end, [_drawStart[0], end[1]], _drawStart
      ]]
    };

    // Show height input
    const heightInput = document.getElementById('ws4-height-input');
    if (heightInput) {
      heightInput.style.display = 'block';
      document.getElementById('ws4-confirm-height')?.addEventListener('click', () => {
        const h = parseFloat(document.getElementById('ws4-height-val')?.value) || 24;
        heightInput.style.display = 'none';
        _addBuilding(polygon, h);
      }, { once: true });
      document.getElementById('ws4-cancel-height')?.addEventListener('click', () => {
        heightInput.style.display = 'none';
      }, { once: true });
    }
    _drawStart = null;
  }

  map.on('mousedown', onMouseDown);
  map.on('mousemove', onMouseMove);
  map.on('mouseup', onMouseUp);
}

function _addBuilding(polygon, height) {
  const id = `proposed-${Date.now()}`;
  _addedBuildings.push({ id, geometry: polygon, height });
  set('scenario.addedBuildings', _addedBuildings);
  setProposedBuildings(_addedBuildings);
  setLayerVisible('ht-proposed-fill', true);
  setLayerVisible('ht-proposed-outline', true);
  _updateAddedList();
}

function _clearScenario() {
  _addedBuildings = [];
  _removedBuildings = [];
  set('scenario', { addedBuildings: [], removedBuildings: [], comparison: null });
  setProposedBuildings([]);
  setLayerVisible('ht-proposed-fill', false);
  setLayerVisible('ht-proposed-outline', false);
  _updateAddedList();
  document.getElementById('ws4-results').style.display = 'none';
  document.getElementById('ws4-proceed-btn').disabled = true;
}

function _updateAddedList() {
  const container = document.getElementById('ws4-added-list');
  if (!container) return;

  if (_addedBuildings.length === 0) {
    container.innerHTML = `<div class="empty-state" style="padding:var(--sp-3)"><div class="empty-state-body">No proposed buildings added.<br>Draw a rectangle on the map to add a building.</div></div>`;
    return;
  }

  container.innerHTML = _addedBuildings.map((b, i) => `
    <div class="metric-row">
      <span class="metric-label">Building ${i+1}</span>
      <span class="metric-value">${b.height}<span class="metric-unit"> m height</span></span>
    </div>
  `).join('');
}

async function _runComparison() {
  const btn = document.getElementById('ws4-run-comparison');
  const progress = document.getElementById('ws4-progress');
  const fill = document.getElementById('ws4-progress-fill');
  const label = document.getElementById('ws4-progress-label');

  if (btn) btn.disabled = true;
  if (progress) progress.style.display = 'block';

  // Simulate step-by-step progress
  const steps = [
    'Projecting baseline shadows (24 time steps)…',
    'Projecting proposed shadows (24 time steps)…',
    'Computing shadow coverage delta…',
    'Analysing exposure impact on neighbours…',
    'Comparing insight layer changes…'
  ];

  for (let i = 0; i < steps.length; i++) {
    if (label) label.textContent = steps[i];
    if (fill) fill.style.width = `${((i + 1) / steps.length) * 100}%`;
    await new Promise(r => setTimeout(r, 200));
  }

  const time = get('time');
  const site = get('site');
  const result = computeScenarioComparison(
    [], _addedBuildings, _removedBuildings,
    time.date, site.center[1], site.center[0]
  );

  set('scenario.comparison', result);

  if (progress) progress.style.display = 'none';
  if (btn) { btn.disabled = false; btn.textContent = 'Re-run Comparison'; }

  _renderComparison(result);
  completeWorkspace(4);
  document.getElementById('ws4-proceed-btn').disabled = false;
}

function _renderComparison(result) {
  const table = document.getElementById('ws4-comparison-table');
  const neighbours = document.getElementById('ws4-neighbour-impact');
  const implications = document.getElementById('ws4-implications');
  const results = document.getElementById('ws4-results');

  if (!table) return;
  if (results) results.style.display = 'block';

  const d = result.delta;
  const b = result.baseline;
  const p = result.proposed;

  const deltaClass = (val, negGood = false) => {
    if (val === 0) return '';
    const positive = val > 0;
    return (positive !== negGood) ? 'compare-delta--up' : 'compare-delta--down';
  };
  const sign = v => v > 0 ? `+${v}` : `${v}`;

  table.innerHTML = `
    <div class="compare-row">
      <span class="compare-label">Shadow coverage</span>
      <span class="compare-val">${b.shadowCoveragePct}%</span>
      <span class="compare-delta ${deltaClass(d.shadowCoveragePct, false)}">${sign(d.shadowCoveragePct)} pp</span>
    </div>
    <div class="compare-row">
      <span class="compare-label">Daily sunlight (h)</span>
      <span class="compare-val">${b.sunlightHours} h</span>
      <span class="compare-delta ${deltaClass(d.sunlightHoursChange, true)}">${sign(d.sunlightHoursChange)} h</span>
    </div>
    <div class="compare-row">
      <span class="compare-label">Shade-deficient spaces</span>
      <span class="compare-val">${b.shadeDeficientSpaces}</span>
      <span class="compare-delta ${deltaClass(p.shadeDeficientSpaces - b.shadeDeficientSpaces, false)}">${sign(p.shadeDeficientSpaces - b.shadeDeficientSpaces)}</span>
    </div>
  `;

  if (neighbours) {
    neighbours.innerHTML = `
      <div class="metric-row">
        <span class="metric-label">Affected structures</span>
        <span class="metric-value metric-value--warning">${d.affectedNeighbours}</span>
      </div>
      <div class="metric-row">
        <span class="metric-label">Avg. exposure reduction</span>
        <span class="metric-value">−${d.avgExposureReduction}<span class="metric-unit"> h/day</span></span>
      </div>
      <div class="metric-row">
        <span class="metric-label">Worst-case reduction</span>
        <span class="metric-value metric-value--critical">−${d.worstCaseReduction}<span class="metric-unit"> h/day</span></span>
      </div>
    `;
  }

  if (implications) {
    const severity = d.shadowCoveragePct > 20 ? 'significant' : d.shadowCoveragePct > 10 ? 'moderate' : 'minor';
    implications.textContent = `The proposed development introduces ${severity} shadow impact. Shadow coverage increases by ${d.shadowCoveragePct} percentage points relative to baseline. ${d.affectedNeighbours} neighbouring structures are affected, with an average daily solar exposure reduction of ${d.avgExposureReduction} h. ${ d.worstCaseReduction > 2 ? 'A detailed daylight assessment is recommended prior to planning submission.' : 'Impact is within typical planning tolerance.'}` ;
  }
}

function _applyDisplayMode(mode) {
  setLayerVisible('ht-proposed-fill', mode === 'proposed' || mode === 'overlay');
  setLayerVisible('ht-proposed-outline', mode === 'proposed' || mode === 'overlay');
}
