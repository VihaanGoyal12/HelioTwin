/**
 * HelioTwin — Workflow Rail
 *
 * The left navigation rail shows all 5 workspaces with their
 * status: active, complete, locked, or stale.
 * Clicking unlocks accessible workspaces and mounts their panel.
 */

import { get, set, subscribe, navigateTo } from '../state.js';
import { mountWorkspace } from './workspaceRouter.js';

// SVG icons (Lucide, 20px, 1.5px stroke)
const ICONS = {
  map:     `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21"/><line x1="9" y1="3" x2="9" y2="18"/><line x1="15" y1="6" x2="15" y2="21"/></svg>`,
  sun:     `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/></svg>`,
  leaf:    `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"/><path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/></svg>`,
  compare: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m18 8 4 4-4 4"/><path d="m6 8-4 4 4 4"/><path d="M2 12h20"/></svg>`,
  file:    `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/><line x1="8" y1="9" x2="10" y2="9"/></svg>`,
  settings:`<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>`,
  lock:    `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`,
  check:   `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
  warn:    `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`
};

const WORKSPACES = [
  { id: 1, label: 'Urban Overview',         icon: 'map',     desc: 'Site context' },
  { id: 2, label: 'Sunlight Analysis',       icon: 'sun',     desc: 'Shadow & exposure' },
  { id: 3, label: 'Environmental Insights',  icon: 'leaf',    desc: 'Planning findings' },
  { id: 4, label: 'Scenario Comparison',     icon: 'compare', desc: 'Impact assessment' },
  { id: 5, label: 'Planning Report',         icon: 'file',    desc: 'Export summary' },
];

export function initRail() {
  const rail = document.getElementById('workflow-rail');
  rail.innerHTML = `
    <div class="rail-header">
      <div class="rail-logo-mark">HT</div>
      <span class="rail-app-name">HelioTwin</span>
    </div>
    <nav class="rail-nav" id="rail-nav"></nav>
    <div class="rail-divider"></div>
    <div class="rail-footer">
      <div class="rail-item" id="rail-settings">
        <div class="rail-item-icon">${ICONS.settings}</div>
        <div class="rail-item-content">
          <span class="rail-item-label">Settings</span>
        </div>
      </div>
    </div>
  `;

  _renderItems();

  // Re-render on state change
  subscribe('workspace', () => _renderItems());
}

function _renderItems() {
  const nav = document.getElementById('rail-nav');
  if (!nav) return;

  const status = get('workspace.status');
  const active = get('workspace.active');

  nav.innerHTML = WORKSPACES.map(ws => {
    const s = status[ws.id];
    const isActive = ws.id === active;
    const isLocked = s === 'locked';
    const isComplete = s === 'complete';
    const isStale = s === 'stale';

    let statusIcon = '';
    let statusText = '';
    if (isLocked)   { statusIcon = ICONS.lock;  statusText = 'Locked'; }
    else if (isComplete) { statusIcon = ICONS.check; statusText = 'Complete'; }
    else if (isStale)    { statusIcon = ICONS.warn;  statusText = 'Stale — re-run'; }
    else if (isActive)   { statusText = 'Active'; }

    const classes = [
      'rail-item',
      isActive   ? 'rail-item--active'   : '',
      isLocked   ? 'rail-item--locked'   : '',
      isComplete ? 'rail-item--complete' : '',
      isStale    ? 'rail-item--stale'    : '',
    ].filter(Boolean).join(' ');

    return `
      <div class="${classes}" data-ws="${ws.id}" title="${ws.label}">
        <div class="rail-item-icon">${ICONS[ws.icon]}</div>
        <div class="rail-item-content">
          <span class="rail-item-label">${ws.label}</span>
          <span class="rail-item-status">${statusIcon} ${statusText}</span>
        </div>
      </div>
    `;
  }).join('');

  // Attach click handlers
  nav.querySelectorAll('.rail-item[data-ws]').forEach(el => {
    el.addEventListener('click', () => {
      const wsId = parseInt(el.dataset.ws);
      if (navigateTo(wsId)) {
        mountWorkspace(wsId);
      }
    });
  });
}
