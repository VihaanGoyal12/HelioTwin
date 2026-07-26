/**
 * HelioTwin — Application Bootstrap
 *
 * Initialisation order:
 * 1. State: set initial time
 * 2. UI chrome: rail, topbar, status bar, sun compass
 * 3. Map: create MapLibre instance (style loads asynchronously)
 * 4. Solar: compute initial solar position and subscribe to time changes
 * 5. Map ready: workspace 1 mounted after map 'load' event fires
 */

import { get, set, subscribe, navigateTo } from './state.js';
import { initMap, getMap, updateShadows }   from './mapEngine.js';
import { getSunData }                        from './solarEngine.js';
import { initTopbar }                        from './ui/topbar.js';
import { initRail }                          from './ui/rail.js';
import { initStatusBar, updateStatusBar }    from './ui/statusBar.js';
import { initSunCompass, updateSunCompass }  from './ui/sunCompass.js';
import { mountWorkspace }                    from './ui/workspaceRouter.js';

// ─────────────────────────────────────────────────────────────────────────────

async function init() {
  // 1. State — current time
  const now = new Date();
  set('time', {
    date:   now,
    hour:   now.getHours(),
    minute: now.getMinutes()
  });

  // 2. UI chrome (synchronous, no map dependency)
  initRail();
  initTopbar();
  initStatusBar();
  initSunCompass();

  // 3. Map (async: style fetched from network)
  const map = initMap('map');
  window._helioMap = map;

  // 4. Solar changes → refresh status bar + sun compass + live shadows
  //    (subscribe BEFORE the first computation below, so the initial value isn't emitted to no one)
  subscribe('solar', (solar) => {
    updateStatusBar(solar);
    updateSunCompass(solar);
    if (get('layers.shadows.visible')) updateShadows(solar);
  });

  // 5. Solar: compute now, then keep in sync with time changes
  _recomputeSolar();
  subscribe('time', _recomputeSolar);

  // 6. After map style loads, mount workspace 1.
  //    mapEngine sets { ready: true } via set('map', {...}), which fires 'map' subscribers.
  let _ws1Mounted = false;
  subscribe('map', (mapState) => {
    if (!mapState?.ready || _ws1Mounted) return;
    _ws1Mounted = true;
    navigateTo(1);
    mountWorkspace(1);
  });

  // Resize
  window.addEventListener('resize', () => getMap()?.resize());
}

// ─────────────────────────────────────────────────────────────────────────────

function _recomputeSolar() {
  const time = get('time');
  const site = get('site');
  if (!time?.date || !site?.center) return;

  const sun = getSunData(
    time.date,
    site.center[1],
    site.center[0],
    time.hour    ?? new Date().getHours(),
    time.minute  ?? 0
  );

  set('solar', {
    azimuthRad:     sun.azimuthRad,
    azimuthBearing: sun.azimuthBearing,
    altitudeRad:    sun.altitudeRad,
    altitudeDeg:    sun.altitudeDeg,
    isDaytime:      sun.isDaytime,
    sunrise:        sun.sunrise,
    sunset:         sun.sunset,
    noon:           sun.solarNoon,
    dayLengthHrs:   sun.dayLengthHrs,
    shadowRatio:    sun.shadowRatio
  });
}

// ─────────────────────────────────────────────────────────────────────────────

init().catch(err => {
  console.error('[HelioTwin] Bootstrap failed:', err);
  // Show a visible error so the user knows something went wrong
  const panel = document.getElementById('workspace-panel');
  if (panel) {
    panel.innerHTML = `
      <div style="padding:24px;font-family:monospace;font-size:12px;color:#DC2626">
        <strong>Initialisation error</strong><br><br>
        ${err?.message || String(err)}<br><br>
        Open the browser console for the full stack trace.
      </div>`;
  }
});
