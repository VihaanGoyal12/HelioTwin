/**
 * HelioTwin — Solar Engine
 *
 * All solar position, shadow geometry, exposure computation,
 * and irradiance modelling. Uses SunCalc.js (global `SunCalc`).
 *
 * Algorithm references:
 * - Sun position: Meeus, Astronomical Algorithms (via SunCalc)
 * - Shadow projection: standard zenith angle / tangent formula
 * - Irradiance: Bouguer-Lambert simplified clear-sky model
 */

// ── SUN POSITION ─────────────────────────────────────────────────────────

/**
 * Compute sun position and day summary for a given location and time.
 * @param {Date} date
 * @param {number} lat - decimal degrees
 * @param {number} lng - decimal degrees
 * @param {number} hour - 0..23
 * @param {number} minute - 0..59
 * @returns {Object} position data
 */
export function getSunData(date, lat, lng, hour, minute) {
  const dt = new Date(date);
  dt.setHours(hour, minute, 0, 0);

  const pos   = SunCalc.getPosition(dt, lat, lng);
  const times = SunCalc.getTimes(dt, lat, lng);

  const altitudeDeg = pos.altitude * 180 / Math.PI;

  // SunCalc azimuth: measured from South, positive towards West.
  // Convert to compass bearing (North = 0°, East = 90°, South = 180°, West = 270°)
  const azimuthBearing = ((pos.azimuth * 180 / Math.PI) + 180 + 360) % 360;

  const isDaytime = pos.altitude > 0;

  const dayLengthMs = times.sunset - times.sunrise;
  const dayLengthHrs = Math.max(0, dayLengthMs / 3_600_000);

  const shadowRatio = altitudeDeg > 0.5
    ? (1 / Math.tan(pos.altitude)).toFixed(2)
    : null;

  return {
    azimuthRad:    pos.azimuth,
    azimuthBearing,
    altitudeRad:   pos.altitude,
    altitudeDeg,
    isDaytime,
    datetime:      dt,
    sunrise:       times.sunrise,
    sunset:        times.sunset,
    solarNoon:     times.solarNoon,
    dayLengthHrs,
    shadowRatio,
    nadir:         times.nadir
  };
}

/**
 * Format a Date to HH:MM string.
 */
export function formatTime(date) {
  if (!date || isNaN(date)) return '--:--';
  return date.toLocaleTimeString('en-IN', {
    hour: '2-digit', minute: '2-digit', hour12: false
  });
}

/**
 * Format a decimal hours value to "Xh Ym" string.
 */
export function formatDuration(hours) {
  if (!hours) return '--';
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return `${h}h ${m}m`;
}

// ── SHADOW GEOMETRY ───────────────────────────────────────────────────────

/**
 * Compute shadow polygon for a single building at a given sun position.
 *
 * Algorithm:
 *   shadow_length = height / tan(altitude)
 *   shadow_bearing = (sun_bearing + 180) % 360
 *
 * Each vertex is displaced by shadow_length in shadow_bearing direction.
 * The convex hull of original + displaced vertices forms the shadow polygon.
 *
 * @param {Array} coordinates - GeoJSON ring [[lng,lat], ...]
 * @param {number} height - building height in metres
 * @param {number} altitudeRad - sun altitude in radians
 * @param {number} azimuthRad - SunCalc azimuth in radians
 * @param {number} lat - latitude for longitudinal scale correction
 * @returns {Array|null} closed ring, or null if sun below horizon
 */
export function computeShadowPolygon(coordinates, height, altitudeRad, azimuthRad, lat) {
  if (altitudeRad <= 0.01) return null;
  if (height < 1) return null;

  const shadowLength = height / Math.tan(altitudeRad); // metres
  if (shadowLength > 5000) return null; // Cap at 5 km for very low sun angles

  // Convert SunCalc azimuth → compass bearing
  const sunBearing = ((azimuthRad * 180 / Math.PI) + 180 + 360) % 360;
  // Shadow is cast in the direction opposite to the sun
  const shadowBearing = (sunBearing + 180) % 360;
  const shadowBearingRad = shadowBearing * Math.PI / 180;

  // Metres per degree, corrected for latitude
  const latRad = lat * Math.PI / 180;
  const metersPerDegLat = 110_540;
  const metersPerDegLng = 111_320 * Math.cos(latRad);

  const dLat = shadowLength * Math.cos(shadowBearingRad) / metersPerDegLat;
  const dLng = shadowLength * Math.sin(shadowBearingRad) / metersPerDegLng;

  const displaced = coordinates.map(([lng, la]) => [lng + dLng, la + dLat]);
  const allPoints = [...coordinates, ...displaced];
  const hull = _convexHull(allPoints);

  if (hull.length < 3) return null;
  return [...hull, hull[0]]; // Close the ring
}

/**
 * Compute shadows for an array of building feature objects.
 * @param {Array} buildings - [{geometry, height}]
 * @param {Object} sunData - from getSunData()
 * @param {number} centerLat - for scale correction
 * @returns {Object} GeoJSON FeatureCollection
 */
export function computeAllShadows(buildings, sunData, centerLat) {
  if (!sunData.isDaytime) {
    return { type: 'FeatureCollection', features: [] };
  }

  const features = [];

  for (const building of buildings) {
    if (!building.geometry?.coordinates) continue;

    const coords = building.geometry.type === 'Polygon'
      ? building.geometry.coordinates[0]
      : building.geometry.coordinates?.[0]?.[0];

    if (!coords || coords.length < 3) continue;

    const ring = computeShadowPolygon(
      coords,
      building.height || 10,
      sunData.altitudeRad,
      sunData.azimuthRad,
      centerLat
    );

    if (ring) {
      features.push({
        type: 'Feature',
        properties: { height: building.height },
        geometry: { type: 'Polygon', coordinates: [ring] }
      });
    }
  }

  return { type: 'FeatureCollection', features };
}

// ── EXPOSURE COMPUTATION ──────────────────────────────────────────────────

/**
 * Sample sun position at 30-minute intervals across a full day.
 * @param {Date} date
 * @param {number} lat
 * @param {number} lng
 * @returns {Array} [{hour, minute, timeLabel, altitudeDeg, isDaytime}]
 */
export function getDailySunProfile(date, lat, lng) {
  const profile = [];
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += 30) {
      const dt = new Date(date);
      dt.setHours(h, m, 0, 0);
      const pos = SunCalc.getPosition(dt, lat, lng);
      profile.push({
        hour: h,
        minute: m,
        timeLabel: `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`,
        altitudeDeg: pos.altitude * 180 / Math.PI,
        isDaytime: pos.altitude > 0
      });
    }
  }
  return profile;
}

/**
 * Count total sunlight hours in a day (altitude > 0°).
 * Samples at 30-minute intervals.
 */
export function computeDailySunlightHours(date, lat, lng) {
  const profile = getDailySunProfile(date, lat, lng);
  return profile.filter(p => p.isDaytime).length * 0.5;
}

/**
 * Compute seasonal sunlight hours for summer solstice, spring equinox,
 * and winter solstice of a given year.
 */
export function computeSeasonalSunlight(year, lat, lng) {
  return {
    summer:  computeDailySunlightHours(new Date(year, 5, 21),  lat, lng),
    equinox: computeDailySunlightHours(new Date(year, 2, 20),  lat, lng),
    winter:  computeDailySunlightHours(new Date(year, 11, 21), lat, lng)
  };
}

/**
 * Compute hourly direct exposure (0–100%) for each hour of the day.
 * Based on sin(altitude) to account for oblique angle.
 * @returns {Array<number>} 24 values
 */
export function computeHourlyExposure(date, lat, lng) {
  const result = [];
  for (let h = 0; h < 24; h++) {
    const dt = new Date(date);
    dt.setHours(h, 0, 0, 0);
    const pos = SunCalc.getPosition(dt, lat, lng);
    result.push(pos.altitude > 0
      ? Math.round(Math.sin(pos.altitude) * 100)
      : 0
    );
  }
  return result;
}

// ── IRRADIANCE MODEL ──────────────────────────────────────────────────────

/**
 * Simplified clear-sky Global Horizontal Irradiance (GHI).
 * Bouguer-Lambert model: GHI = I₀ × sin(alt) × 0.7^(1/sin(alt))
 * where I₀ = 1361 W/m² (solar constant).
 *
 * @param {number} altitudeRad - sun altitude in radians
 * @returns {number} GHI in W/m²
 */
export function clearSkyGHI(altitudeRad) {
  if (altitudeRad <= 0) return 0;
  const sinAlt = Math.sin(altitudeRad);
  return 1361 * sinAlt * Math.pow(0.7, 1 / sinAlt);
}

/**
 * Estimate annual solar potential (kWh/m²/year).
 * Samples one day per month (15th), integrates GHI at 30-minute intervals.
 */
export function computeAnnualIrradiance(lat, lng, year) {
  let totalWh = 0;
  for (let month = 0; month < 12; month++) {
    const date = new Date(year, month, 15);
    for (let h = 0; h < 24; h++) {
      for (let m = 0; m < 60; m += 30) {
        const dt = new Date(date);
        dt.setHours(h, m, 0, 0);
        const pos = SunCalc.getPosition(dt, lat, lng);
        if (pos.altitude > 0) {
          totalWh += clearSkyGHI(pos.altitude) * 0.5; // 0.5h slot
        }
      }
    }
  }
  // Scale 12 sampled days → full year
  return Math.round((totalWh * 365) / (12 * 1000));
}

/**
 * Classify annual irradiance into solar suitability tier.
 */
export function classifyIrradiance(kwhPerYear) {
  if (kwhPerYear < 800)  return 'Low';
  if (kwhPerYear < 1100) return 'Moderate';
  if (kwhPerYear < 1400) return 'Good';
  return 'High';
}

// ── GEOMETRY UTILITIES ────────────────────────────────────────────────────

/**
 * Graham scan convex hull for 2D points [x, y].
 * Used to compute shadow polygon from building footprint + displaced copy.
 */
function _convexHull(points) {
  if (points.length < 3) return points;
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const lower = [], upper = [];

  for (const p of sorted) {
    while (lower.length >= 2 && _cross(lower[lower.length-2], lower[lower.length-1], p) <= 0)
      lower.pop();
    lower.push(p);
  }
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && _cross(upper[upper.length-2], upper[upper.length-1], p) <= 0)
      upper.pop();
    upper.push(p);
  }
  upper.pop(); lower.pop();
  return lower.concat(upper);
}

function _cross(O, A, B) {
  return (A[0] - O[0]) * (B[1] - O[1]) - (A[1] - O[1]) * (B[0] - O[0]);
}
