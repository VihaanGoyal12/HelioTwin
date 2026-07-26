/**
 * HelioTwin — UI Layout
 *
 * Constructs the application DOM shell and mounts
 * all persistent UI regions: topbar, status bar, map overlays.
 */

import { get, set, subscribe } from '../state.js';
import { getSunData, formatTime, formatDuration } from '../solarEngine.js';
import { initRail } from './rail.js';
import { initTopbar } from './topbar.js';
import { initStatusBar, updateStatusBar } from './statusBar.js';
import { initSunCompass, updateSunCompass } from './sunCompass.js';

export function initLayout() {
  initRail();
  initTopbar();
  initStatusBar();
  initSunCompass();

  // Subscribe to solar updates to refresh status bar and sun compass
  subscribe('solar', (solar) => {
    updateStatusBar(solar);
    updateSunCompass(solar);
  });

  subscribe('time', () => {
    _recomputeSolar();
  });

  // Initial solar computation
  _recomputeSolar();
}

function _recomputeSolar() {
  const site = get('site');
  const time = get('time');
  const sunData = getSunData(
    time.date,
    site.center[1],
    site.center[0],
    time.hour,
    time.minute || 0
  );
  set('solar', {
    azimuth: sunData.azimuthRad,
    azimuthBearing: sunData.azimuthBearing,
    altitude: sunData.altitudeRad,
    altitudeDeg: sunData.altitudeDeg,
    isDaytime: sunData.isDaytime,
    sunrise: sunData.sunrise,
    sunset: sunData.sunset,
    noon: sunData.solarNoon,
    dayLengthHrs: sunData.dayLengthHrs,
    shadowRatio: sunData.shadowRatio
  });
}
