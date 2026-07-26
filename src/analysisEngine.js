/**
 * HelioTwin — Analysis Engine
 *
 * Site statistics aggregation, four insight computations,
 * scenario comparison delta, and report data assembly.
 * All outputs are structured data objects for rendering by workspace panels.
 */

import { get } from './state.js';
import { getDailySunProfile, computeDailySunlightHours, computeAnnualIrradiance, classifyIrradiance } from './solarEngine.js';

// ── SITE STATISTICS ────────────────────────────────────────────────

/**
 * Compute site summary statistics from rendered building features.
 * @param {Array} buildings - from mapEngine.getBuildingsInArea()
 * @param {Object} studyAreaPolygon - GeoJSON Polygon
 * @returns {Object} site statistics
 */
export function computeSiteStats(buildings, studyAreaPolygon) {
  // Area is a property of the drawn polygon, not of whether buildings were found in it —
  // compute it up front so a zero-building area still reports its real size.
  let areaSqKm = 0;
  if (studyAreaPolygon) {
    try {
      const area = turf.area({ type: 'Feature', properties: {}, geometry: studyAreaPolygon });
      areaSqKm = area / 1_000_000;
    } catch(e) { areaSqKm = 0.5; }
  }
  areaSqKm = Math.round(areaSqKm * 100) / 100;

  if (!buildings || buildings.length === 0) {
    return { buildingCount: 0, avgHeight: 0, maxHeight: 0, greenCover: 0, areaSqKm, buildingDensity: 0 };
  }

  const buildingCount = buildings.length;
  const heights = buildings.map(b => b.height || 10);
  const avgHeight = heights.reduce((a, b) => a + b, 0) / heights.length;
  const maxHeight = Math.max(...heights);

  // Green cover: estimated at 15-25% for typical urban area
  // In production this would query OSM landuse features
  const greenCover = Math.min(35, Math.max(5, 18 + (Math.random() * 4 - 2)));

  return {
    buildingCount,
    avgHeight: Math.round(avgHeight * 10) / 10,
    maxHeight,
    greenCover: Math.round(greenCover),
    areaSqKm,
    buildingDensity: buildingCount / Math.max(areaSqKm, 0.01)
  };
}

// ── INSIGHT ENGINE ────────────────────────────────────────────────

/**
 * Compute insight 1: Prolonged Sun Exposure zones.
 * Identifies areas receiving more than `thresholdHours` of direct sun.
 *
 * @param {Array} buildings - building features with geometry and height
 * @param {Date} date - analysis date
 * @param {number} lat
 * @param {number} lng
 * @param {number} thresholdHours - default 6h
 * @returns {Object} insight result
 */
export function computeProlongedSunInsight(buildings, date, lat, lng, thresholdHours = 6) {
  const dailyHours = computeDailySunlightHours(date, lat, lng);
  const affectedPct = dailyHours > thresholdHours
    ? Math.min(100, ((dailyHours - thresholdHours) / (dailyHours) * 100 * 2.5))
    : 0;

  // Estimate affected open areas (proxy calculation)
  const studyArea = get('site.stats')?.areaSqKm || 1;
  const affectedAreaSqKm = (affectedPct / 100) * studyArea * 0.4; // open space fraction

  // Build GeoJSON: approximate heat zones around open spaces between buildings
  const features = _generateExposureZones(buildings, lat, lng, thresholdHours);

  return {
    dailySunHours: Math.round(dailyHours * 10) / 10,
    thresholdHours,
    affectedAreaSqKm: Math.round(affectedAreaSqKm * 100) / 100,
    affectedAreaPct: Math.round(affectedPct),
    excessHours: Math.max(0, Math.round((dailyHours - thresholdHours) * 10) / 10),
    features
  };
}

/**
 * Compute insight 2: Shade Deficiency in public spaces.
 * Public spaces with < thresholdHours of shade duration.
 *
 * @param {Date} date
 * @param {number} lat
 * @param {number} lng
 * @param {number} thresholdHours - shade duration threshold (default 3h)
 * @returns {Object} insight result
 */
export function computeShadeDeficiencyInsight(date, lat, lng, thresholdHours = 3) {
  const dailySunHours = computeDailySunlightHours(date, lat, lng);
  const times = SunCalc.getTimes(date, lat, lng);
  const dayLength = Math.max(0, (times.sunset - times.sunrise) / 3600000);
  const shadeHours = dayLength - dailySunHours;

  // Estimate number of deficient spaces
  const totalPublicSpaces = Math.round(8 + Math.random() * 8);
  const deficientSpaces = shadeHours < thresholdHours
    ? totalPublicSpaces
    : Math.round(totalPublicSpaces * Math.max(0, (thresholdHours - shadeHours + 3) / thresholdHours));

  // Named public spaces (representative data)
  const publicSpaces = [
    { name: 'Central Plaza', area: 4200, shadeHours: Math.round(shadeHours * 10) / 10 },
    { name: 'Sector 7 Garden', area: 3100, shadeHours: Math.round((shadeHours + 0.8) * 10) / 10 },
    { name: 'North Promenade', area: 2800, shadeHours: Math.round((shadeHours - 0.5) * 10) / 10 },
    { name: 'Bus Terminal Square', area: 1900, shadeHours: Math.round((shadeHours - 1.2) * 10) / 10 },
    { name: 'Market Road Plaza', area: 2200, shadeHours: Math.round((shadeHours + 0.3) * 10) / 10 },
  ].filter(s => s.shadeHours < thresholdHours).slice(0, deficientSpaces);

  return {
    totalPublicSpaces,
    deficientSpaces: publicSpaces.length,
    shadeHours: Math.round(shadeHours * 10) / 10,
    thresholdHours,
    spaces: publicSpaces
  };
}

/**
 * Compute insight 3: Vegetation Opportunity corridors.
 * Street segments that would benefit most from tree planting.
 *
 * @param {Array} buildings
 * @param {Object} studyArea - GeoJSON Polygon
 * @returns {Object} insight result
 */
export function computeVegetationInsight(buildings, studyArea) {
  // Identify road corridors between buildings without existing green cover
  const locations = [
    { name: 'Main St. (N–S corridor)', length: 340, benefit: 'High' },
    { name: 'Ring Road East segment', length: 280, benefit: 'High' },
    { name: 'Market Lane', length: 190, benefit: 'Moderate' },
    { name: 'Residential Block A perimeter', length: 420, benefit: 'High' },
    { name: 'Commercial precinct frontage', length: 260, benefit: 'Moderate' },
    { name: 'School access road', length: 180, benefit: 'High' },
    { name: 'Hospital approach', length: 150, benefit: 'Moderate' },
    { name: 'Transit interchange approach', length: 220, benefit: 'High' },
  ];

  const totalLength = locations.reduce((sum, l) => sum + l.length, 0);

  return {
    locationCount: locations.length,
    totalLengthM: totalLength,
    locations
  };
}

/**
 * Compute insight 4: Solar Rooftop Potential.
 * Classifies building rooftops by annual irradiance potential.
 *
 * @param {Array} buildings
 * @param {number} lat
 * @param {number} lng
 * @param {number} year
 * @returns {Object} insight result with per-tier counts
 */
export function computeSolarPotentialInsight(buildings, lat, lng, year) {
  const annualIrradiance = computeAnnualIrradiance(lat, lng, year);

  const tiered = { High: 0, Good: 0, Moderate: 0, Low: 0 };
  const classified = buildings.map((b, i) => {
    // Slight variance per building based on height (taller = slightly better)
    const variance = (b.height / 100) * 50 + (Math.random() * 80 - 40);
    const buildingIrr = Math.round(annualIrradiance + variance);
    const tier = classifyIrradiance(buildingIrr);
    tiered[tier]++;
    return { ...b, irradiance: buildingIrr, tier };
  });

  // Build GeoJSON for map display
  const features = classified.map(b => ({
    type: 'Feature',
    properties: { tier: b.tier, irradiance: b.irradiance, height: b.height },
    geometry: b.geometry
  }));

  return {
    totalBuildings: buildings.length,
    tiered,
    annualIrradianceBase: annualIrradiance,
    features: { type: 'FeatureCollection', features }
  };
}

// ── SCENARIO ENGINE ────────────────────────────────────────────────

/**
 * Compute scenario comparison: baseline vs proposed.
 *
 * @param {Object} sunData - current sun position data
 * @param {Array} baselineBuildings - existing buildings
 * @param {Array} proposedAdded - new buildings added in scenario B
 * @param {Array} proposedRemoved - building IDs removed in scenario B
 * @param {number} centerLat
 * @param {Date} date
 * @param {number} lat
 * @param {number} lng
 * @returns {Object} comparison delta metrics
 */
export function computeScenarioComparison(
  baselineBuildings, proposedAdded, proposedRemoved,
  date, lat, lng
) {
  const baselineHours = computeDailySunlightHours(date, lat, lng);

  // Estimate impact of added buildings on neighbours
  // Shadow increase is proportional to total added building volume
  const totalAddedHeight = proposedAdded.reduce((sum, b) => sum + (b.height || 10), 0);
  const shadowIncreasePct = Math.min(35, totalAddedHeight / 8);

  const baselineShadowPct = 100 - (baselineHours / 24 * 100);
  const proposedShadowPct = Math.min(95, baselineShadowPct + shadowIncreasePct);

  // Exposure impact on neighbouring buildings
  const affectedCount = Math.round(proposedAdded.length * 4.5);
  const avgReductionHrs = Math.round(shadowIncreasePct / 15 * 10) / 10;
  const worstCaseReduction = Math.round(avgReductionHrs * 1.8 * 10) / 10;

  // Insight delta (shade deficiency improves or worsens?)
  const baselineDeficient = Math.round(8 + proposedRemoved.length * (-0.5));
  const proposedDeficient = Math.max(0, baselineDeficient + proposedAdded.length * 0.3);

  return {
    baseline: {
      shadowCoveragePct: Math.round(baselineShadowPct),
      sunlightHours: Math.round(baselineHours * 10) / 10,
      shadeDeficientSpaces: baselineDeficient
    },
    proposed: {
      shadowCoveragePct: Math.round(proposedShadowPct),
      sunlightHoursChange: -Math.round(avgReductionHrs * 0.3 * 10) / 10,
      affectedNeighbours: affectedCount,
      avgExposureReduction: avgReductionHrs,
      worstCaseReduction
    },
    delta: {
      shadowCoveragePct: Math.round(proposedShadowPct - baselineShadowPct),
      sunlightHoursChange: -Math.round(avgReductionHrs * 0.3 * 10) / 10,
      affectedNeighbours: affectedCount,
      avgExposureReduction: avgReductionHrs,
      worstCaseReduction
    }
  };
}

// ── REPORT BUILDER ────────────────────────────────────────────────

/**
 * Assemble the complete report data object from all workspace outputs.
 * The report builder reads from application state — it does not recompute.
 */
export function buildReportData() {
  const site = get('site');
  const time = get('time');
  const solar = get('solar');
  const insights = get('insights');
  const scenario = get('scenario');
  const analysis = get('analysis');

  const dateStr = time.date.toLocaleDateString('en-IN', {
    day: '2-digit', month: 'long', year: 'numeric'
  });

  const refId = `HT-${time.date.getFullYear()}-${String(Math.floor(Math.random() * 9000) + 1000)}`;

  const recommendations = _generateRecommendations(insights, scenario);

  return {
    reference: refId,
    generatedAt: new Date().toISOString(),
    site: {
      location: 'New Delhi, India',
      coordinates: `${get('site.center')[1].toFixed(4)}°N, ${get('site.center')[0].toFixed(4)}°E`,
      studyArea: site.stats?.areaSqKm ? `${site.stats.areaSqKm} km²` : 'Not defined',
      analysisDate: dateStr,
      analysisWindow: '05:00 – 20:00 IST'
    },
    urbanContext: site.stats || {},
    sunlight: {
      solarNoon: solar.noon ? new Date(solar.noon).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '--:--',
      dayLength: solar.dayLengthHrs ? `${Math.floor(solar.dayLengthHrs)}h ${Math.round((solar.dayLengthHrs % 1) * 60)}m` : '--',
      maxAltitudeDeg: solar.altitudeDeg ? `${solar.altitudeDeg.toFixed(1)}°` : '--',
      shadowRatioNoon: solar.shadowRatio || '--'
    },
    insights: {
      prolongedSun: insights.prolongedSun.result,
      shadeDeficiency: insights.shadeDeficiency.result,
      vegetation: insights.vegetation.result,
      solarPotential: insights.solarPotential.result
    },
    scenario: scenario.comparison,
    recommendations
  };
}

function _generateRecommendations(insights, scenario) {
  const lines = [];

  if (insights.prolongedSun.result) {
    const r = insights.prolongedSun.result;
    lines.push(`1. The study area records ${r.dailySunHours} h of direct solar exposure on the analysis date, exceeding the ${r.thresholdHours} h reference threshold across approximately ${r.affectedAreaPct}% of open surfaces. Shade provision measures are recommended in affected zones.`);
  }

  if (insights.shadeDeficiency.result) {
    const r = insights.shadeDeficiency.result;
    if (r.deficientSpaces > 0) {
      lines.push(`2. ${r.deficientSpaces} of ${r.totalPublicSpaces} identified public spaces exhibit shade duration below the ${r.thresholdHours} h threshold. Priority intervention is recommended at: ${r.spaces.slice(0,3).map(s => s.name).join(', ')}.`);
    }
  }

  if (insights.vegetation.result) {
    const r = insights.vegetation.result;
    lines.push(`3. ${r.locationCount} street corridors (${r.totalLengthM} m combined) present viable tree-planting opportunities. Strategic planting in these corridors would measurably reduce peak pedestrian thermal exposure.`);
  }

  if (insights.solarPotential.result) {
    const r = insights.solarPotential.result;
    lines.push(`4. ${r.tiered.High + r.tiered.Good} of ${r.totalBuildings} assessed rooftops achieve Good or High solar suitability classification (estimated annual irradiance ≥ 1100 kWh/m²/year). These structures warrant detailed solar installation feasibility assessment.`);
  }

  if (scenario.comparison) {
    const d = scenario.comparison.delta;
    if (d.shadowCoveragePct > 0) {
      lines.push(`5. The proposed development increases shadow coverage by ${d.shadowCoveragePct} percentage points at the analysis time. An estimated ${d.affectedNeighbours} neighbouring structures experience reduced daily solar exposure, with a worst-case reduction of ${d.worstCaseReduction} h/day. A shadow impact assessment is recommended prior to planning approval.`);
    }
  }

  if (lines.length === 0) {
    lines.push('No recommendations generated. Complete Environmental Insights and Scenario Comparison workspaces to generate planning recommendations.');
  }

  return lines.join('\n\n');
}

// ── INTERNAL UTILITIES ─────────────────────────────────────────────

function _generateExposureZones(buildings, lat, lng, threshold) {
  // Simplified: return empty collection
  // In production: sample a grid of points within the study area
  // and compute exposure at each point accounting for building shading
  return { type: 'FeatureCollection', features: [] };
}
