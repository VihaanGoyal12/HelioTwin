/**
 * HelioTwin — Workspace Router
 *
 * Mounts and unmounts workspace panels when the user
 * navigates between workspaces.
 */

import { mountWS1 } from './workspaces/ws1.js';
import { mountWS2, unmountWS2 } from './workspaces/ws2.js';
import { mountWS3, unmountWS3 } from './workspaces/ws3.js';
import { mountWS4, unmountWS4 } from './workspaces/ws4.js';
import { mountWS5 } from './workspaces/ws5.js';

let _currentWS = null;
let _unmounters = {};

export function mountWorkspace(ws) {
  // Unmount current workspace cleanly
  if (_currentWS && _unmounters[_currentWS]) {
    try { _unmounters[_currentWS](); } catch(e) {}
  }

  _currentWS = ws;

  const panel = document.getElementById('workspace-panel');
  panel.innerHTML = '';
  panel.style.opacity = '0';

  switch (ws) {
    case 1: mountWS1(panel); break;
    case 2: mountWS2(panel); break;
    case 3: mountWS3(panel); break;
    case 4: mountWS4(panel); break;
    case 5: mountWS5(panel); break;
  }

  // Fade in
  requestAnimationFrame(() => {
    panel.style.transition = 'opacity 120ms ease-out';
    panel.style.opacity = '1';
  });

  // Register unmounters
  _unmounters = { 2: unmountWS2, 3: unmountWS3, 4: unmountWS4 };
}

export function getCurrentWorkspace() {
  return _currentWS;
}
