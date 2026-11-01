// DEBUG: hardware acceleration badge + performance switches.
//
// URL switches (combine freely, e.g. ?debug&dpr=1&bh=0):
//   ?debug        show live fps / frame time / resolution in the badge
//   ?dpr=<n>      override the render pixel ratio (default: device, max 2)
//   ?fps=<n>      cap the background frame rate (default: 120)
//   ?aa=0         disable WebGL antialiasing
//   ?bh=0         hide the black hole
//   ?bhscale=<n>  pin the black hole's resolution scale (0..1), no adapting
//   ?stars=0      hide the stars
//   ?vignette=0   remove the CSS vignette overlay
//   ?meteors=0    disable shooting stars
//   ?meteorgap=<s> average seconds between shooting stars (default: ~16)
//   ?hero=0       stop the hero word animation

export const params = new URLSearchParams(location.search);
export const DEBUG = params.has('debug');

// ?name=1.5 -> 1.5; missing or invalid -> fallback
export function numberParam(name, fallback) {
    const value = parseFloat(params.get(name));
    return Number.isFinite(value) ? value : fallback;
}

// ?name=0 / false / off / no -> false; missing -> fallback
export function flagParam(name, fallback = true) {
    if (!params.has(name)) return fallback;
    return !['0', 'false', 'off', 'no'].includes(params.get(name).toLowerCase());
}

// Renderers browsers fall back to when there's no usable GPU
const SOFTWARE_RENDERERS = /swiftshader|llvmpipe|softpipe|software|basic render|lavapipe/i;

function detectAcceleration() {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) return { enabled: false, renderer: 'WebGL unavailable' };

    // Unmasked name needs this extension; some browsers (Firefox) expose it via RENDERER already
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = info
        ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL)
        : gl.getParameter(gl.RENDERER);

    // Free the context right away, browsers cap how many can be alive
    gl.getExtension('WEBGL_lose_context')?.loseContext();

    return { enabled: !SOFTWARE_RENDERERS.test(renderer), renderer };
}

const { enabled, renderer } = detectAcceleration();
const message = `DEBUG: Hardware Acceleration is ${enabled ? 'Enabled' : 'Disabled'}`;

console.log(`${message} (${renderer})`);

const badge = document.createElement('div');
badge.className = 'debug-badge';
badge.classList.add(enabled ? 'debug-badge--ok' : 'debug-badge--off');
badge.textContent = message;
badge.title = renderer;
document.body.appendChild(badge);

if (!flagParam('vignette')) {
    document.documentElement.classList.add('no-vignette');
}

// Live stats (only with ?debug)
const stats = document.createElement('div');
if (DEBUG) {
    stats.className = 'debug-stats';
    badge.append(stats);
    stats.textContent = renderer;
}

let renderInfo = '';
let frames = 0;
let worst = 0;
let lastFrame = 0;
let windowStart = 0;

// Extra line shown under the fps (resolution, pixel ratio, ...)
export function setRenderInfo(text) {
    renderInfo = text;
}

// Call once per *rendered* frame with the rAF timestamp
export function reportFrame(time) {
    if (!DEBUG) return;

    if (lastFrame) worst = Math.max(worst, time - lastFrame);
    lastFrame = time;
    frames++;

    windowStart ||= time;
    const elapsed = time - windowStart;
    if (elapsed < 500) return;

    const fps = frames * 1000 / elapsed;
    stats.textContent =
        `${fps.toFixed(0)} fps · ${(elapsed / frames).toFixed(1)} ms avg · ${worst.toFixed(1)} ms worst\n` +
        `${renderInfo}\n${renderer}`;

    frames = 0;
    worst = 0;
    windowStart = time;
}
