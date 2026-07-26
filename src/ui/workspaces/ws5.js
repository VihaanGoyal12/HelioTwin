/**
 * HelioTwin — Workspace 5: Planning Report
 *
 * Purpose: Generate a structured, exportable planning summary.
 * Planning question: What should decision-makers conclude from this analysis?
 * Completion condition: Report exported.
 */

import { get, set, completeWorkspace } from '../../state.js';
import { buildReportData } from '../../analysisEngine.js';
import { exportPDF, exportCSV } from '../../exportService.js';

let _reportData = null;

export function mountWS5(container) {
  _reportData = buildReportData();
  const time = get('time');
  const site = get('site');
  const insights = get('insights');
  const scenario = get('scenario');

  const dateStr = time.date.toLocaleDateString('en-IN', {
    day: '2-digit', month: 'long', year: 'numeric'
  });

  container.innerHTML = `
    <div class="panel-header">
      <div class="panel-title">Planning Report</div>
      <div class="panel-subtitle">Step 5 of 5 — Export analysis summary</div>
    </div>
    <div class="panel-body">

      <div class="panel-section">
        <div class="section-label">Report Details</div>
        <div class="metric-row">
          <span class="metric-label">Reference number</span>
          <span class="metric-value" style="font-size:var(--text-xs)">${_reportData.reference}</span>
        </div>
        <div class="metric-row">
          <span class="metric-label">Analysis date</span>
          <span class="metric-value">${dateStr}</span>
        </div>
        <div class="metric-row">
          <span class="metric-label">Location</span>
          <span class="metric-value" style="font-size:11px">${_reportData.site.coordinates}</span>
        </div>
        <div class="metric-row">
          <span class="metric-label">Analysis window</span>
          <span class="metric-value">05:00–20:00 IST</span>
        </div>
      </div>

      <div class="panel-section">
        <div class="section-label">Sections Included</div>
        ${_buildSectionStatus(insights, scenario)}
      </div>

      <div class="panel-section">
        <div class="section-label">Key Findings Summary</div>
        ${_buildFindingsSummary(insights, scenario)}
      </div>

      <div class="panel-section">
        <div class="section-label">Planning Recommendations</div>
        <div style="font-size:var(--text-xs);color:var(--c-text-tertiary);margin-bottom:var(--sp-2)">
          Edit or supplement the auto-generated recommendations:
        </div>
        <textarea class="report-recommendations" id="ws5-recommendations" placeholder="Planning recommendations...">${_reportData.recommendations}</textarea>
      </div>

      <div class="panel-section">
        <div class="section-label">Methodology Note</div>
        <div style="font-size:var(--text-xs);color:var(--c-text-tertiary);line-height:1.6">
          Solar position computed using SunCalc.js (Meeus astronomical algorithms).
          Shadow projection: shadow_length = height / tan(altitude).
          Irradiance: Bouguer-Lambert clear-sky model. Building data: OpenStreetMap contributors.
          Analysis is indicative; detailed site surveys are required for planning submissions.
        </div>
      </div>

    </div>
    <div class="panel-footer">
      <div class="btn-group" style="margin-bottom:var(--sp-2)">
        <button class="btn btn-primary" id="ws5-export-pdf" style="flex:1">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          Export PDF
        </button>
        <button class="btn btn-secondary" id="ws5-export-csv">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/>
            <path d="M14 2v4a2 2 0 0 0 2 2h4"/>
            <path d="M8 13h2"/><path d="M8 17h2"/><path d="M14 13h2"/><path d="M14 17h2"/>
          </svg>
          CSV
        </button>
      </div>
      <div style="font-size:var(--text-xs);color:var(--c-text-tertiary);text-align:center">
        PDF includes all analysis sections and methodology notes.
      </div>
    </div>
  `;

  _bindWS5Events();
}

function _bindWS5Events() {
  document.getElementById('ws5-export-pdf')?.addEventListener('click', async () => {
    const btn = document.getElementById('ws5-export-pdf');
    if (btn) {
      btn.textContent = 'Generating PDF…';
      btn.disabled = true;
    }
    try {
      const recommendations = document.getElementById('ws5-recommendations')?.value || '';
      set('report.recommendations', recommendations);
      await exportPDF(_reportData, recommendations);
      completeWorkspace(5);
    } catch(e) {
      console.error('PDF export failed:', e);
    } finally {
      if (btn) {
        btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Export PDF`;
        btn.disabled = false;
      }
    }
  });

  document.getElementById('ws5-export-csv')?.addEventListener('click', () => {
    const recommendations = document.getElementById('ws5-recommendations')?.value || '';
    exportCSV({ ..._reportData, recommendations });
    completeWorkspace(5);
  });
}

function _buildSectionStatus(insights, scenario) {
  const sections = [
    { label: 'Site Information',       done: true },
    { label: 'Urban Context Summary',  done: !!get('site.stats') },
    { label: 'Sunlight Analysis',      done: get('analysis.status') === 'complete' },
    { label: 'Prolonged Sun Exposure', done: !!insights.prolongedSun.result },
    { label: 'Shade Deficiency',       done: !!insights.shadeDeficiency.result },
    { label: 'Vegetation Opportunity', done: !!insights.vegetation.result },
    { label: 'Solar Rooftop Potential',done: !!insights.solarPotential.result },
    { label: 'Scenario Comparison',    done: !!scenario.comparison },
    { label: 'Planning Recommendations',done: true },
  ];

  return sections.map(s => `
    <div class="metric-row">
      <span class="metric-label">${s.label}</span>
      <span class="metric-value ${s.done ? 'metric-value--positive' : 'metric-value--warning'}" style="font-size:var(--text-xs)">
        ${s.done ? '✓ Included' : '— Not completed'}
      </span>
    </div>
  `).join('');
}

function _buildFindingsSummary(insights, scenario) {
  const items = [];

  if (insights.prolongedSun.result) {
    const r = insights.prolongedSun.result;
    items.push(`<span style="color:var(--c-amber-600)">▪</span> ${r.dailySunHours} h/day direct exposure — ${r.excessHours} h above threshold`);
  }

  if (insights.shadeDeficiency.result) {
    const r = insights.shadeDeficiency.result;
    if (r.deficientSpaces > 0) {
      items.push(`<span style="color:var(--c-red-600)">▪</span> ${r.deficientSpaces} public spaces with insufficient shade coverage`);
    }
  }

  if (insights.vegetation.result) {
    const r = insights.vegetation.result;
    items.push(`<span style="color:var(--c-green-600)">▪</span> ${r.locationCount} vegetation opportunity corridors identified (${r.totalLengthM} m)`);
  }

  if (insights.solarPotential.result) {
    const r = insights.solarPotential.result;
    items.push(`<span style="color:var(--c-blue-600)">▪</span> ${r.tiered.High + r.tiered.Good} of ${r.totalBuildings} rooftops show Good/High solar suitability`);
  }

  if (scenario.comparison) {
    const d = scenario.comparison.delta;
    items.push(`<span style="color:var(--c-amber-600)">▪</span> Proposed scenario: +${d.shadowCoveragePct}pp shadow coverage, ${d.affectedNeighbours} affected neighbours`);
  }

  if (items.length === 0) {
    return `<div class="empty-state-body">Complete Environmental Insights and Scenario Comparison to generate findings summary.</div>`;
  }

  return items.map(i =>
    `<div style="font-size:var(--text-xs);color:var(--c-text-secondary);padding:var(--sp-1) 0;border-bottom:1px solid var(--c-border-subtle)">${i}</div>`
  ).join('');
}
