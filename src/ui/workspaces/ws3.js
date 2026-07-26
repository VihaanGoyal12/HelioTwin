/**
 * HelioTwin — Workspace 3: Environmental Insights
 *
 * Purpose: Transform sunlight analysis into actionable planning findings.
 * Planning question: What specific environmental conditions require action?
 * Completion condition: At least one insight layer viewed.
 */

import { get, set, subscribe, completeWorkspace, navigateTo } from '../../state.js';
import { setLayerVisible, setSourceData } from '../../mapEngine.js';
import { computeProlongedSunInsight, computeShadeDeficiencyInsight,
         computeVegetationInsight, computeSolarPotentialInsight } from '../../analysisEngine.js';
import { mountWorkspace } from '../workspaceRouter.js';

let _computed = {};

export function mountWS3(container) {
  const site = get('site');
  const time = get('time');
  const insights = get('insights');

  const hasStudyArea = !!site.studyArea;
  const hasAnalysis = get('analysis.status') === 'complete';

  container.innerHTML = `
    <div class="panel-header">
      <div class="panel-title">Environmental Insights</div>
      <div class="panel-subtitle">Step 3 of 5 — Planning findings</div>
    </div>
    <div class="panel-body">

      ${!hasStudyArea || !hasAnalysis ? `
        <div class="panel-section">
          <div class="notice notice--warn">
            Complete Sunlight Analysis (Step 2) before generating environmental insights.
          </div>
        </div>
      ` : `
        <div class="panel-section">
          <div class="section-label">Analysis Basis</div>
          <div class="metric-row">
            <span class="metric-label">Analysis date</span>
            <span class="metric-value">${time.date.toLocaleDateString('en-IN', {day:'2-digit', month:'short', year:'numeric'})}</span>
          </div>
          <div class="metric-row">
            <span class="metric-label">Location</span>
            <span class="metric-value">${site.center[1].toFixed(3)}°N, ${site.center[0].toFixed(3)}°E</span>
          </div>
          <button class="btn btn-primary" id="ws3-compute-btn" style="margin-top:var(--sp-3);width:100%">
            Run Insight Analysis
          </button>
          <div class="progress-wrap" id="ws3-progress" style="display:none;margin-top:var(--sp-3)">
            <div class="progress-label" id="ws3-progress-label">Computing…</div>
            <div class="progress-bar-track"><div class="progress-bar-fill" id="ws3-progress-fill" style="width:0%"></div></div>
          </div>
        </div>

        <div id="ws3-results" style="display:none">

          <div class="panel-section">
            <div class="section-label">INSIGHT LAYERS</div>
            <div id="ws3-insights-list"></div>
          </div>

        </div>
      `}

    </div>
    <div class="proceed-btn-wrap">
      <button class="btn btn-primary btn-full" id="ws3-proceed-btn" disabled>
        Proceed to Scenario Comparison →
      </button>
    </div>
  `;

  document.getElementById('ws3-compute-btn')?.addEventListener('click', _runInsights);
  document.getElementById('ws3-proceed-btn')?.addEventListener('click', () => {
    completeWorkspace(3);
    navigateTo(4);
    mountWorkspace(4);
  });
}

export function unmountWS3() {
  // Hide all insight layers
  ['ht-insight-sun-fill','ht-insight-shade-fill','ht-insight-veg-line','ht-insight-solar-fill']
    .forEach(id => setLayerVisible(id, false));
}

async function _runInsights() {
  const btn = document.getElementById('ws3-compute-btn');
  const progress = document.getElementById('ws3-progress');
  const fill = document.getElementById('ws3-progress-fill');
  const label = document.getElementById('ws3-progress-label');

  if (btn) btn.disabled = true;
  if (progress) progress.style.display = 'block';

  const site = get('site');
  const time = get('time');
  const lat  = site.center[1];
  const lng  = site.center[0];
  const buildings = []; // Would come from mapEngine.getBuildingsInArea(site.studyArea)

  const steps = [
    {
      label: 'Computing prolonged sun exposure…',
      run: async () => {
        const r = computeProlongedSunInsight(buildings, time.date, lat, lng, 6);
        set('insights.prolongedSun', { result: r });
        _computed.prolongedSun = r;
      }
    },
    {
      label: 'Analysing shade deficiency in public spaces…',
      run: async () => {
        const r = computeShadeDeficiencyInsight(time.date, lat, lng, 3);
        set('insights.shadeDeficiency', { result: r });
        _computed.shadeDeficiency = r;
      }
    },
    {
      label: 'Identifying vegetation opportunity corridors…',
      run: async () => {
        const r = computeVegetationInsight(buildings, site.studyArea);
        set('insights.vegetation', { result: r });
        _computed.vegetation = r;
      }
    },
    {
      label: 'Classifying rooftop solar suitability…',
      run: async () => {
        const r = computeSolarPotentialInsight(buildings.length ? buildings : _mockBuildings(12), lat, lng, time.date.getFullYear());
        set('insights.solarPotential', { result: r });
        if (r.features) setSourceData('ht-insight-solar', r.features);
        _computed.solarPotential = r;
      }
    }
  ];

  for (let i = 0; i < steps.length; i++) {
    if (label) label.textContent = steps[i].label;
    if (fill) fill.style.width = `${((i + 0.5) / steps.length) * 100}%`;
    await steps[i].run();
    await new Promise(r => setTimeout(r, 150)); // Allow UI update
  }

  if (fill) fill.style.width = '100%';
  if (label) label.textContent = 'Analysis complete.';

  setTimeout(() => {
    if (progress) progress.style.display = 'none';
    _renderInsightsList();
    document.getElementById('ws3-results').style.display = 'block';
    document.getElementById('ws3-proceed-btn').disabled = false;
  }, 300);
}

function _renderInsightsList() {
  const container = document.getElementById('ws3-insights-list');
  if (!container) return;

  const ps  = _computed.prolongedSun;
  const sd  = _computed.shadeDeficiency;
  const veg = _computed.vegetation;
  const sol = _computed.solarPotential;

  container.innerHTML = `
    <div class="insight-row">
      <div class="insight-toggle-header">
        <label class="toggle">
          <input type="checkbox" id="toggle-sun"> 
          <div class="toggle-track"></div>
          <div class="toggle-thumb"></div>
        </label>
        <span class="insight-title">Prolonged Sun Exposure</span>
      </div>
      ${ps ? `
      <div class="insight-metrics">
        <span class="insight-metric">Daily exposure: ${ps.dailySunHours} h (threshold: ${ps.thresholdHours} h)</span>
        <span class="insight-metric">Excess above threshold: ${ps.excessHours} h/day</span>
        <span class="insight-metric">Affected open area: ${ps.affectedAreaSqKm} km² (${ps.affectedAreaPct}% of study zone)</span>
      </div>` : ''}
    </div>

    <div class="insight-row">
      <div class="insight-toggle-header">
        <label class="toggle">
          <input type="checkbox" id="toggle-shade">
          <div class="toggle-track"></div>
          <div class="toggle-thumb"></div>
        </label>
        <span class="insight-title">Shade Deficiency Analysis</span>
      </div>
      ${sd ? `
      <div class="insight-metrics">
        <span class="insight-metric">Public spaces assessed: ${sd.totalPublicSpaces}</span>
        <span class="insight-metric">Deficient spaces (&lt; ${sd.thresholdHours} h shade/day): <strong>${sd.deficientSpaces}</strong></span>
        ${sd.spaces.slice(0,3).map(s => `<span class="insight-metric" style="color:var(--c-red-600)">  • ${s.name}: ${s.shadeHours} h shade/day</span>`).join('')}
      </div>` : ''}
    </div>

    <div class="insight-row">
      <div class="insight-toggle-header">
        <label class="toggle">
          <input type="checkbox" id="toggle-veg">
          <div class="toggle-track"></div>
          <div class="toggle-thumb"></div>
        </label>
        <span class="insight-title">Vegetation Opportunity</span>
      </div>
      ${veg ? `
      <div class="insight-metrics">
        <span class="insight-metric">Identified corridors: ${veg.locationCount}</span>
        <span class="insight-metric">Total street coverage: ${veg.totalLengthM} m</span>
        ${veg.locations.filter(l=>l.benefit==='High').slice(0,2).map(l =>
          `<span class="insight-metric" style="color:var(--c-green-600)">  • ${l.name} (${l.length} m)</span>`
        ).join('')}
      </div>` : ''}
    </div>

    <div class="insight-row">
      <div class="insight-toggle-header">
        <label class="toggle">
          <input type="checkbox" id="toggle-solar">
          <div class="toggle-track"></div>
          <div class="toggle-thumb"></div>
        </label>
        <span class="insight-title">Solar Rooftop Potential</span>
      </div>
      ${sol ? `
      <div class="insight-metrics">
        <span class="insight-metric">Buildings assessed: ${sol.totalBuildings}</span>
        <span class="insight-metric" style="color:var(--c-green-700)">High (&gt;1400 kWh/m²/yr): ${sol.tiered.High}</span>
        <span class="insight-metric">Good (1100–1400): ${sol.tiered.Good}</span>
        <span class="insight-metric">Moderate (800–1100): ${sol.tiered.Moderate}</span>
        <span class="insight-metric">Base irradiance estimate: ${sol.annualIrradianceBase} kWh/m²/yr</span>
      </div>` : ''}
    </div>
  `;

  // Toggle layer visibility
  document.getElementById('toggle-sun')?.addEventListener('change', (e) => {
    setLayerVisible('ht-insight-sun-fill', e.target.checked);
    set('insights.prolongedSun', { visible: e.target.checked });
    completeWorkspace(3);
    document.getElementById('ws3-proceed-btn').disabled = false;
  });
  document.getElementById('toggle-shade')?.addEventListener('change', (e) => {
    setLayerVisible('ht-insight-shade-fill', e.target.checked);
    set('insights.shadeDeficiency', { visible: e.target.checked });
    completeWorkspace(3);
    document.getElementById('ws3-proceed-btn').disabled = false;
  });
  document.getElementById('toggle-veg')?.addEventListener('change', (e) => {
    setLayerVisible('ht-insight-veg-line', e.target.checked);
    completeWorkspace(3);
    document.getElementById('ws3-proceed-btn').disabled = false;
  });
  document.getElementById('toggle-solar')?.addEventListener('change', (e) => {
    setLayerVisible('ht-insight-solar-fill', e.target.checked);
    completeWorkspace(3);
    document.getElementById('ws3-proceed-btn').disabled = false;
  });
}

function _mockBuildings(count) {
  const center = get('site.center');
  return Array.from({length: count}, (_, i) => ({
    height: 8 + Math.random() * 30,
    geometry: { type: 'Polygon', coordinates: [[
      [center[0] + i * 0.001, center[1]],
      [center[0] + i * 0.001 + 0.0008, center[1]],
      [center[0] + i * 0.001 + 0.0008, center[1] + 0.0006],
      [center[0] + i * 0.001, center[1] + 0.0006],
      [center[0] + i * 0.001, center[1]],
    ]] }
  }));
}
