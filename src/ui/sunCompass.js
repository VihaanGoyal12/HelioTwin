/**
 * HelioTwin — Sun Compass Overlay
 *
 * Small canvas widget in the top-right of the map viewport.
 * Renders: azimuth ring with sun direction indicator, altitude arc.
 * Purely informational — not interactive.
 */

export function initSunCompass() {
  const overlays = document.getElementById('map-overlays');
  const div = document.createElement('div');
  div.className = 'sun-compass';
  div.id = 'sun-compass';
  div.innerHTML = `
    <canvas class="sun-compass-canvas" id="sun-compass-canvas" width="72" height="72"></canvas>
    <div class="sun-compass-values">
      <div class="sun-compass-row">
        <span class="sun-compass-key">Az</span>
        <span class="sun-compass-val" id="sc-az">---°</span>
      </div>
      <div class="sun-compass-row">
        <span class="sun-compass-key">Alt</span>
        <span class="sun-compass-val" id="sc-alt">---°</span>
      </div>
      <div class="sun-compass-row">
        <span class="sun-compass-key">Status</span>
        <span class="sun-compass-val" id="sc-status">--</span>
      </div>
    </div>
  `;
  overlays.appendChild(div);
}

export function updateSunCompass(solar) {
  const canvas = document.getElementById('sun-compass-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = 72, H = 72, cx = W/2, cy = H/2, R = 28;

  ctx.clearRect(0, 0, W, H);

  // Background circle
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fillStyle = '#F4F5F6';
  ctx.fill();
  ctx.strokeStyle = '#D1D5DB';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Cardinal labels
  ctx.fillStyle = '#9CA3AF';
  ctx.font = '8px Inter, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('N', cx, cy - R + 7);
  ctx.fillText('S', cx, cy + R - 7);
  ctx.fillText('E', cx + R - 7, cy);
  ctx.fillText('W', cx - R + 7, cy);

  // Cross hairs
  ctx.beginPath();
  ctx.strokeStyle = '#E5E7EB';
  ctx.lineWidth = 0.5;
  ctx.moveTo(cx, cy - R + 2); ctx.lineTo(cx, cy + R - 2);
  ctx.moveTo(cx - R + 2, cy); ctx.lineTo(cx + R - 2, cy);
  ctx.stroke();

  // Sun direction indicator
  if (solar && solar.isDaytime) {
    const azBearing = solar.azimuthBearing ?? 0;
    const azRad = (azBearing - 90) * Math.PI / 180; // canvas: 0 = east
    // Convert compass bearing to canvas angle (0 = North = top)
    const canvasAngle = (azBearing - 90) * Math.PI / 180;

    const sunX = cx + (R - 6) * Math.cos(canvasAngle);
    const sunY = cy + (R - 6) * Math.sin(canvasAngle);

    // Direction line
    ctx.beginPath();
    ctx.strokeStyle = '#D97706';
    ctx.lineWidth = 1.5;
    ctx.moveTo(cx, cy);
    ctx.lineTo(sunX, sunY);
    ctx.stroke();

    // Sun dot
    ctx.beginPath();
    ctx.arc(sunX, sunY, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#D97706';
    ctx.fill();

    // Altitude arc (inner, orange, proportional to altitude)
    if (solar.altitudeDeg != null) {
      const altFraction = Math.max(0, Math.min(1, solar.altitudeDeg / 90));
      const arcR = 8;
      ctx.beginPath();
      ctx.arc(cx, cy, arcR, -Math.PI/2, -Math.PI/2 + altFraction * Math.PI, false);
      ctx.strokeStyle = '#D97706';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  } else {
    // Night: moon symbol
    ctx.beginPath();
    ctx.arc(cx, cy, 6, 0, Math.PI * 2);
    ctx.fillStyle = '#9CA3AF';
    ctx.fill();
  }

  // Update text
  const azEl  = document.getElementById('sc-az');
  const altEl = document.getElementById('sc-alt');
  const stEl  = document.getElementById('sc-status');

  if (azEl)  azEl.textContent  = solar ? `${solar.azimuthBearing?.toFixed(0) ?? '--'}°` : '---°';
  if (altEl) altEl.textContent = solar ? `${solar.altitudeDeg?.toFixed(1) ?? '--'}°` : '---°';
  if (stEl)  stEl.textContent  = solar?.isDaytime ? 'Daytime' : 'Night';
}
