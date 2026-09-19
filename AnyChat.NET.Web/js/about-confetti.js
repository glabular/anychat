const UNLOCK_CLICKS = 7;
const UNLOCK_WINDOW_MS = 1500;
const MAX_PARTICLES = 1500;
const PARTICLES_PER_CORNER = 150;
const COLOR_VARS = [
  "--color-accent",
  "--color-ice",
  "--color-teal",
  "--color-orange",
  "--color-red",
];

/** @type {number[]} */
let recentClicks = [];
/** @type {HTMLCanvasElement | null} */
let canvas = null;
/** @type {CanvasRenderingContext2D | null} */
let ctx = null;
/** @type {ReturnType<typeof createParticle>[]} */
let particles = [];
/** @type {number | null} */
let rafId = null;
let unlocked = false;
let lastFrameMs = 0;

/**
 * Call on each About nav click. Unlocks after rapid clicks, then each click
 * spawns more confetti (up to the particle cap).
 */
export function noteAboutClick() {
  const now = performance.now();
  recentClicks = recentClicks.filter((t) => now - t <= UNLOCK_WINDOW_MS);
  recentClicks.push(now);

  if (!unlocked) {
    if (recentClicks.length < UNLOCK_CLICKS) {
      return;
    }
    unlocked = true;
  }

  spawnBurst();
}

function ensureCanvas() {
  if (canvas && ctx) {
    return;
  }

  canvas = document.createElement("canvas");
  canvas.className = "about-confetti-canvas";
  canvas.setAttribute("aria-hidden", "true");
  document.body.appendChild(canvas);
  ctx = canvas.getContext("2d");
  resizeCanvas();
  window.addEventListener("resize", resizeCanvas);
}

function resizeCanvas() {
  if (!canvas) {
    return;
  }

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = window.innerWidth;
  const h = window.innerHeight;
  canvas.width = Math.max(1, Math.floor(w * dpr));
  canvas.height = Math.max(1, Math.floor(h * dpr));
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function readColors() {
  const styles = getComputedStyle(document.documentElement);
  return COLOR_VARS.map((name) => styles.getPropertyValue(name).trim()).filter(
    Boolean
  );
}

/**
 * @param {number} x
 * @param {number} y
 * @param {1 | -1} inward
 * @param {string[]} colors
 */
function createParticle(x, y, inward, colors) {
  const color = colors[Math.floor(Math.random() * colors.length)] || "#377aff";

  const minInwardSpeed = 1.8;
  const inwardSpeedRange = 7.2;
  const sidewaysJitter = 3.2;
  const minUpSpeed = 5;
  const upSpeedRange = 13;
  const minWidth = 3;
  const widthRange = 8;
  const minHeight = 4;
  const heightRange = 12;
  const spinRange = 0.55;
  const minGravity = 0.12;
  const gravityRange = 0.18;
  const minDrag = 0.985;
  const dragRange = 0.012;
  const minDecay = 0.0025;
  const decayRange = 0.007;
  const spawnJitterX = 18;
  const spawnJitterY = 12;

  return {
    x: x + (Math.random() - 0.5) * spawnJitterX,
    y: y + (Math.random() - 0.5) * spawnJitterY,
    vx:
      inward * (minInwardSpeed + Math.random() * inwardSpeedRange) +
      (Math.random() - 0.5) * sidewaysJitter,
    vy: -(minUpSpeed + Math.random() * upSpeedRange),
    w: minWidth + Math.random() * widthRange,
    h: minHeight + Math.random() * heightRange,
    rotation: Math.random() * Math.PI * 2,
    spin: (Math.random() - 0.5) * spinRange,
    gravity: minGravity + Math.random() * gravityRange,
    drag: minDrag + Math.random() * dragRange,
    life: 1,
    decay: minDecay + Math.random() * decayRange,
    color,
  };
}

function spawnBurst() {
  ensureCanvas();
  if (!canvas || !ctx) {
    return;
  }

  const room = MAX_PARTICLES - particles.length;
  if (room <= 0) {
    return;
  }

  const colors = readColors();
  const w = window.innerWidth;
  const h = window.innerHeight;
  const burstScale = 0.75 + Math.random() * 0.5;
  const basePerCorner = Math.max(
    1,
    Math.min(
      Math.round(PARTICLES_PER_CORNER * burstScale),
      Math.floor(room / 2)
    )
  );
  // Slight left/right imbalance so bursts don't look mirrored.
  const leftBias = Math.floor((Math.random() - 0.5) * basePerCorner * 0.2);
  const leftCount = Math.max(1, basePerCorner + leftBias);
  const rightCount = Math.max(1, Math.min(room - leftCount, basePerCorner - leftBias));

  for (let i = 0; i < leftCount; i++) {
    particles.push(createParticle(8, h - 4, 1, colors));
  }
  for (let i = 0; i < rightCount; i++) {
    particles.push(createParticle(w - 8, h - 4, -1, colors));
  }

  if (rafId === null) {
    lastFrameMs = performance.now();
    rafId = requestAnimationFrame(tick);
  }
}

/**
 * @param {number} now
 */
function tick(now) {
  if (!canvas || !ctx) {
    rafId = null;
    return;
  }

  const dt = Math.min(32, now - lastFrameMs) / 16.67;
  lastFrameMs = now;

  ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

  const next = [];
  for (const p of particles) {
    p.vy += p.gravity * dt;
    p.vx *= p.drag;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.rotation += p.spin * dt;
    p.life -= p.decay * dt;

    if (p.life <= 0 || p.y > window.innerHeight + 40) {
      continue;
    }

    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rotation);
    ctx.globalAlpha = Math.max(0, Math.min(1, p.life));
    ctx.fillStyle = p.color;
    ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
    ctx.restore();

    next.push(p);
  }
  particles = next;

  if (particles.length === 0) {
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    rafId = null;
    unlocked = false;
    recentClicks = [];
    return;
  }

  rafId = requestAnimationFrame(tick);
}
