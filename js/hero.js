// Hero word switcher, drawn on a <canvas>.
// NOTE: The CSS version (scrolling text clipped by a mask) jittered: masks over
// moving text get re-rasterized and snapped to the pixel grid every frame.
// Drawing it ourselves gives sub-pixel motion and a fade that works over the
// transparent background for free.

import { flagParam } from './debug.js';

const canvas = document.querySelector('.hero-switcher');
const ctx = canvas.getContext('2d');

const WORDS = canvas.dataset.words.split(',').map(w => w.trim());
const HOLD_MS = 2500;  // time each word stays still
const SWAP_MS = 800;   // time spent scrolling to the next word
const FADE = 0.15;     // fraction of the height faded out at top and bottom
const CYCLE_MS = (HOLD_MS + SWAP_MS) * WORDS.length;

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const animate = flagParam('hero'); // ?hero=0 (see js/debug.js)

let width = 0;
let height = 0;
let baseline = 0;
let font = '';
let color = '';
let letterSpacing = '';
let lastKey = '';
let startTime = null;

// Zero-size inline-block next to the canvas: its bottom edge sits exactly on
// the line's baseline, so we can read where the DOM puts "Building"/"Systems".
const baselineProbe = document.createElement('span');
baselineProbe.setAttribute('aria-hidden', 'true');
baselineProbe.style.cssText = 'display: inline-block; width: 0; height: 0; vertical-align: baseline;';
canvas.after(baselineProbe);

const ease = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

function measure() {
    // Match the surrounding "Building ... Systems" text exactly.
    const style = getComputedStyle(canvas.parentElement);
    const fontSize = parseFloat(style.fontSize);
    const lineHeight = parseFloat(style.lineHeight) || fontSize * 1.2;

    font = `${style.fontWeight} ${fontSize}px ${style.fontFamily}`;
    color = style.color;
    letterSpacing = style.letterSpacing === 'normal' ? '0px' : style.letterSpacing;

    ctx.font = font;
    ctx.letterSpacing = letterSpacing;
    width = Math.ceil(Math.max(...WORDS.map(w => ctx.measureText(w).width)));
    height = lineHeight;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    // Resizing the canvas resets the context state.
    // NOTE: Fixes the words sitting a pixel or so off the surrounding text: the
    // backing store is rounded to whole pixels, so scale by the *actual* ratio
    // instead of dpr, or everything drawn is slightly stretched.
    ctx.setTransform(canvas.width / width, 0, 0, canvas.height / height, 0, 0);

    // NOTE: Fixes the baseline being a few pixels off in some browsers. It used
    // to be derived from the font metrics (half-leading + ascent), but browsers
    // don't agree on which metrics the DOM uses; measure the real one instead.
    baseline = baselineProbe.getBoundingClientRect().bottom - canvas.getBoundingClientRect().top;

    lastKey = '';
}

function draw(index, progress) {
    const key = `${index}:${progress}`;
    if (key === lastKey) return; // nothing moved (holding on a word)
    lastKey = key;

    const offset = progress * height;

    ctx.clearRect(0, 0, width, height);
    ctx.globalCompositeOperation = 'source-over';
    ctx.font = font;
    ctx.letterSpacing = letterSpacing;
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';

    ctx.fillText(WORDS[index], width / 2, baseline - offset);
    if (progress > 0) {
        ctx.fillText(WORDS[(index + 1) % WORDS.length], width / 2, baseline + height - offset);
    }

    // Fade the top/bottom edges by erasing alpha, so the background shows through.
    const fade = ctx.createLinearGradient(0, 0, 0, height);
    fade.addColorStop(0, 'rgba(0,0,0,0)');
    fade.addColorStop(FADE, 'rgba(0,0,0,1)');
    fade.addColorStop(1 - FADE, 'rgba(0,0,0,1)');
    fade.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalCompositeOperation = 'destination-in';
    ctx.fillStyle = fade;
    ctx.fillRect(0, 0, width, height);
    ctx.globalCompositeOperation = 'source-over';
}

function frame(time) {
    if (reducedMotion.matches || !animate) {
        draw(0, 0);
        return;
    }
    requestAnimationFrame(frame);

    // Time-based, so dropped frames skip ahead instead of slowing down.
    startTime ??= time;
    const t = (time - startTime) % CYCLE_MS;
    const index = Math.floor(t / (HOLD_MS + SWAP_MS));
    const phase = t % (HOLD_MS + SWAP_MS);
    const progress = phase < HOLD_MS ? 0 : ease((phase - HOLD_MS) / SWAP_MS);

    draw(index, progress);
}

function start() {
    measure();
    requestAnimationFrame(frame);
}

window.addEventListener('resize', () => {
    measure();
    if (reducedMotion.matches || !animate) draw(0, 0);
});
reducedMotion.addEventListener('change', () => requestAnimationFrame(frame));

// Wait for the header font, otherwise we'd measure/draw with the fallback.
const heroStyle = getComputedStyle(canvas.parentElement);
document.fonts.load(`${heroStyle.fontWeight} 1em ${heroStyle.fontFamily}`)
    .catch(() => {})
    .then(() => document.fonts.ready)
    .then(start);
