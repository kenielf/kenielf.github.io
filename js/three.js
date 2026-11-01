import { flagParam, numberParam, reportFrame, setRenderInfo } from './debug.js';

// Scene
const scene = new THREE.Scene();

// Camera
const camera = new THREE.PerspectiveCamera(
    75,
    window.innerWidth / window.innerHeight,
    0.1,
    2000
);

// Base (anchored) camera position
const cameraBasePosition = new THREE.Vector3(0, 0, 5);
camera.position.copy(cameraBasePosition);

// Renderer
const renderer = new THREE.WebGLRenderer({
    antialias: flagParam('aa'),
    alpha: true // allows CSS background to show through
});
// capped: the black hole is ray traced per pixel, 3x screens would triple the cost
// ?dpr=<n> overrides it (see js/debug.js), handy to check if we're fill-rate bound
renderer.setPixelRatio(numberParam('dpr', Math.min(window.devicePixelRatio, 2)));
renderer.setSize(window.innerWidth, window.innerHeight);

document.getElementById('background').appendChild(renderer.domElement);

// Frame rate cap; ?fps=<n> overrides it (see js/debug.js)
const FPS = numberParam('fps', 120);
const FRAME_TIME = 1000 / FPS;

// Shaders
// GLSL lives in shaders/ as plain files. Shared pieces are registered as
// three.js shader chunks so shaders can `#include <name>` them, and JS-side
// constants reach the shaders through each material's `defines`.
async function loadShader(name) {
    const response = await fetch(`shaders/${name}`);
    if (!response.ok) {
        throw new Error(`Failed to load shader ${name}: ${response.status}`);
    }
    return response.text();
}

const [
    noiseChunk,
    starDriftParsChunk,
    starDriftChunk,
    starLensParsChunk,
    starLensChunk,
    blackHoleVertexShader,
    blackHoleFragmentShader,
    bloomVertexShader,
    bloomFragmentShader,
    compositeVertexShader,
    compositeFragmentShader,
    meteorVertexShader,
    meteorFragmentShader
] = await Promise.all([
    'noise.glsl',
    'star_drift_pars.vert',
    'star_drift.vert',
    'star_lens_pars.vert',
    'star_lens.vert',
    'blackhole.vert',
    'blackhole.frag',
    'bloom.vert',
    'bloom.frag',
    'composite.vert',
    'composite.frag',
    'meteor.vert',
    'meteor.frag'
].map(loadShader));

THREE.ShaderChunk.bh_noise = noiseChunk;
THREE.ShaderChunk.star_drift_pars_vertex = starDriftParsChunk;
THREE.ShaderChunk.star_drift_vertex = starDriftChunk;
THREE.ShaderChunk.star_lens_pars_vertex = starLensParsChunk;
THREE.ShaderChunk.star_lens_vertex = starLensChunk;

// `defines` values are pasted into GLSL as-is: floats need a decimal point
const glslFloat = (value) => value.toFixed(6);

function createStarTexture() {
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');

    ctx.clearRect(0, 0, size, size);
    ctx.translate(size / 2, size / 2);

    const rOuter = size * 0.48;
    const rInner = size * 0.05;

    // NOTE: Fixes stars shimmering/flickering while they move.
    // Spikes fade out towards the tips: the thinnest part is what aliases
    // (shimmers) when drawn at a few pixels, so keep it faint.
    const spikeFade = ctx.createRadialGradient(0, 0, 0, 0, 0, rOuter);
    spikeFade.addColorStop(0.0, 'rgba(255, 255, 255, 1)');
    spikeFade.addColorStop(0.3, 'rgba(255, 255, 255, 0.6)');
    spikeFade.addColorStop(1.0, 'rgba(255, 255, 255, 0)');

    ctx.fillStyle = spikeFade;
    ctx.beginPath();

    for (let i = 0; i < 4; i++) {
        ctx.lineTo(0, -rOuter);
        ctx.rotate(Math.PI / 4);
        ctx.lineTo(0, -rInner);
        ctx.rotate(Math.PI / 4);
    }

    ctx.closePath();
    ctx.fill();

    // Soft core so the star's brightness doesn't hinge on sub-pixel spikes
    const core = ctx.createRadialGradient(0, 0, 0, 0, 0, size * 0.14);
    core.addColorStop(0.0, 'rgba(255, 255, 255, 1)');
    core.addColorStop(0.4, 'rgba(255, 255, 255, 0.5)');
    core.addColorStop(1.0, 'rgba(255, 255, 255, 0)');

    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(0, 0, size * 0.14, 0, Math.PI * 2);
    ctx.fill();

    // NOTE: Fixes stars shimmering (mipmaps were disabled to keep the spikes sharp).
    // Mipmaps (on by default) keep the tiny sprites temporally stable
    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;

    return texture;
}

// Particles
// Stars live on a distant shell (well behind the black hole) so the event
// horizon cuts them off instead of them drifting in front of it.
const STAR_SHELL_MIN = 600;
const STAR_SHELL_MAX = 1200;

const starTexture = createStarTexture();

// Star colors, as seen by the human eye from space, from:
//   J.-V. Harre & R. Heller (2021), "Digital color codes of stars",
//   Astronomische Nachrichten. doi:10.1002/asna.202113868, arXiv:2101.06254
// Hex codes are taken verbatim from their Table 5 (solar metallicity main
// sequence stars, PHOENIX/TLUSTY model spectra); a few rows per spectral class.
// Per the paper there are no yellow, green, cyan or purple stars, and "red"
// dwarfs actually look orange.
//
// The weights (how common each class is on screen) are NOT from the paper,
// they're aesthetic. Real star counts are dominated by faint M dwarfs.
const STAR_PALETTE = [
    { weight: 6,  colors: ['#5b7bff', '#6484ff', '#6988ff'] }, // O5V, B2V, B5V
    { weight: 18, colors: ['#7d99ff', '#87a1ff', '#9ab0ff'] }, // A0V, A2V, A6V
    { weight: 30, colors: ['#ccd2ff', '#dddeff', '#fff4fe'] }, // F2V, F5V, F9V
    { weight: 20, colors: ['#ffede6', '#ffe8d7', '#ffe5cf'] }, // G2V, G6V, G8V
    { weight: 14, colors: ['#ffdec0', '#ffc797', '#ffb177'] }, // K0V, K3V, K5V
    { weight: 8,  colors: ['#ffa25a', '#ffa24c', '#ff842d'] }  // M0V, M4V, M9V
];
const STAR_PALETTE_TOTAL = STAR_PALETTE.reduce((sum, entry) => sum + entry.weight, 0);

function pickStarColor(color) {
    let roll = Math.random() * STAR_PALETTE_TOTAL;
    const entry = STAR_PALETTE.find((candidate) => (roll -= candidate.weight) < 0)
        ?? STAR_PALETTE[STAR_PALETTE.length - 1];

    // hex codes are sRGB; THREE.Color converts them to the linear working space
    return color.set(entry.colors[Math.floor(Math.random() * entry.colors.length)]);
}

// A fraction of the stars wander on their own across the shell. Their
// "velocity" is stored as a rotation axis (perpendicular to the star's
// position, so the motion is tangent to the shell) plus an angular speed.
const STAR_DRIFT_FRACTION = 1 / 16;
const STAR_DRIFT_SPEED_MIN = 0.002; // radians per second
const STAR_DRIFT_SPEED_MAX = 0.012;

const starUniforms = {
    uTime:         { value: 0 },
    // gravitational lensing by the black hole (updated in updateBlackHole)
    uLensCenter:   { value: new THREE.Vector2() },
    uLensEinstein: { value: 0 },
    uLensAspect:   { value: 1 }
};

function createStarLayer(count, size, opacity) {
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const drift = new Float32Array(count * 4); // xyz: axis, w: angular speed (0 = static)
    const direction = new THREE.Vector3();
    const axis = new THREE.Vector3();
    const color = new THREE.Color();

    for (let i = 0; i < count; i++) {
        const i3 = i * 3;

        direction.randomDirection()
            .multiplyScalar(THREE.MathUtils.lerp(STAR_SHELL_MIN, STAR_SHELL_MAX, Math.random()));
        positions[i3]     = direction.x;
        positions[i3 + 1] = direction.y;
        positions[i3 + 2] = direction.z;

        if (Math.random() < STAR_DRIFT_FRACTION) {
            // random axis perpendicular to the position = random tangent velocity
            axis.randomDirection().cross(direction).normalize();
            const i4 = i * 4;
            drift[i4]     = axis.x;
            drift[i4 + 1] = axis.y;
            drift[i4 + 2] = axis.z;
            drift[i4 + 3] = THREE.MathUtils.lerp(STAR_DRIFT_SPEED_MIN, STAR_DRIFT_SPEED_MAX, Math.random());
        }

        pickStarColor(color);

        colors[i3]     = color.r;
        colors[i3 + 1] = color.g;
        colors[i3 + 2] = color.b;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('aDrift', new THREE.BufferAttribute(drift, 4));

    // Lensing splits every star into two images (see shaders/star_lens.vert),
    // so the same geometry is drawn twice: primary and secondary image.
    const layer = new THREE.Group();
    layer.add(new THREE.Points(geometry, createStarMaterial(size, opacity, false)));
    layer.add(new THREE.Points(geometry, createStarMaterial(size, opacity, true)));
    return layer;
}

function createStarMaterial(size, opacity, secondaryImage) {
    const material = new THREE.PointsMaterial({
        map: starTexture,
        transparent: true,
        size,                   // in pixels, distance doesn't matter this far out
        opacity,
        sizeAttenuation: false,
        vertexColors: true,
        depthWrite: false,
        // NOTE: Fixes cyan specks where stars overlap the bright disk.
        // additive, but alpha grows as much as color does, so the (premultiplied)
        // canvas never ends up with color > alpha, which composites as garbage
        blending: THREE.CustomBlending,
        blendSrc: THREE.SrcAlphaFactor,
        blendDst: THREE.OneFactor,
        blendSrcAlpha: THREE.OneFactor,
        blendDstAlpha: THREE.OneFactor
    });

    if (secondaryImage) {
        material.defines = { LENS_SECONDARY: '' };
    }

    // Drift (rotate around each star's own axis) and lensing, on the GPU
    material.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, starUniforms);
        shader.vertexShader = shader.vertexShader
            .replace('#include <common>', '#include <common>\n#include <star_drift_pars_vertex>\n#include <star_lens_pars_vertex>')
            .replace('#include <begin_vertex>', '#include <begin_vertex>\n#include <star_drift_vertex>')
            .replace('#include <fog_vertex>', '#include <fog_vertex>\n#include <star_lens_vertex>');
    };

    return material;
}

// Only a slice of the shell is ever on screen, hence the higher counts
const particles = new THREE.Group();
particles.add(createStarLayer(6000, 6, 0.6));   // faint background dust
particles.add(createStarLayer(400, 14, 0.9));   // a few bright stars
particles.visible = flagParam('stars');
scene.add(particles);

// Slow drift of the whole sky around a slightly tilted axis
const STAR_SPIN_SPEED = (Math.PI * 2) / (15 * 60); // one full turn every 15 minutes
const STAR_AXIS_TILT = 0.35;                       // radians

// Black hole
// Ray traced Schwarzschild black hole. Every pixel of a camera-facing quad
// traces a light ray backwards through curved spacetime, so the shadow, the
// lensed far side of the disk, the photon ring, doppler beaming and
// gravitational redshift all come out of the physics instead of being painted.
//
// Units: Schwarzschild radius Rs = 1 (event horizon at r = 1, photon sphere
// at r = 1.5, shadow radius = 3√3/2 ≈ 2.6, innermost stable orbit at r = 3).
// NOTE: Black hole center in NDC (-1..1, y up): landscape sits at 75% width, mid
// height; portrait ("vertical" screens) puts it at 75% width, 25% from the top
// (above "About Me", see .hero in hero.css)
const portraitQuery = window.matchMedia('(orientation: portrait)');
const BH_ANCHOR_LANDSCAPE = { x: 0.5, y: 0.0 };
const BH_ANCHOR_PORTRAIT = { x: 0.5, y: 0.5 };
// How far (in Rs) the visible black hole reaches above/below its center: the
// lensed far side of the disk arcs over the shadow, and the disk's density
// fades out around here (see blackhole.frag)
const BH_VISUAL_HALF_HEIGHT = 8.0;
const BH_SHADOW_SIZE = 0.5;       // max on-screen shadow radius, in world units
const BH_DISK_INNER = 3.0;        // ISCO
const BH_DISK_OUTER = 12.0;
const BH_DISK_TILT = 0.17;        // radians the camera sits above the disk plane
const BH_DISK_ROLL = 0.18;        // slight roll so it doesn't look too static
const BH_DISK_TEMPERATURE = 5200; // kelvin at the hottest point of the disk
const BH_BEAMING = 3.0;           // intensity ∝ g^BH_BEAMING (3 = physical for a fixed band)
const BH_EXPOSURE = 1.6;
const BH_EDGE_SOFTNESS = 0.05;    // extra blur on the shadow edge, in Rs
const BH_BLOOM = 1.0;             // strength of the soft glow around the disk
const BH_INTRO_TIME = 2.5;        // seconds to fade in
const BH_LENS_STRENGTH = 1.0;     // scales the stars' Einstein radius (1 = physical)
const BH_SHADOW_RADIUS = 1.5 * Math.sqrt(3); // critical impact parameter
const BH_BOUND = BH_DISK_OUTER + 1.0;        // rays outside this sphere aren't traced
// NOTE: Fixes the disk glow being clipped by a hard vertical edge on the right.
const BH_QUAD_HALF = BH_BOUND * 1.6;         // covers the bound sphere's (off-axis, stretched) projection

const blackHole = new THREE.Group();
blackHole.visible = flagParam('bh');
scene.add(blackHole);

// Frame the disk lives in (disk = local xz plane). Tilted towards the camera
// and rolled about the view axis; only used to build the world -> disk matrix.
const diskFrame = new THREE.Object3D();
diskFrame.rotation.order = 'ZYX';
diskFrame.rotation.set(BH_DISK_TILT, 0, BH_DISK_ROLL);
blackHole.add(diskFrame);

const blackHoleUniforms = {
    uTime:        { value: 0 },
    uIntro:       { value: 0 },
    uWorldToDisk: { value: new THREE.Matrix4() },
    uPixelAngle:  { value: 0.001 } // radians covered by one drawing-buffer pixel
};

const blackHoleQuad = new THREE.Mesh(
    new THREE.PlaneGeometry(2 * BH_QUAD_HALF, 2 * BH_QUAD_HALF),
    new THREE.ShaderMaterial({
        uniforms: blackHoleUniforms,
        vertexShader: blackHoleVertexShader,
        fragmentShader: blackHoleFragmentShader,
        defines: {
            R_IN: glslFloat(BH_DISK_INNER),
            R_OUT: glslFloat(BH_DISK_OUTER),
            R_BOUND: glslFloat(BH_BOUND),
            B_CRIT: glslFloat(BH_SHADOW_RADIUS),
            TEMPERATURE: glslFloat(BH_DISK_TEMPERATURE),
            BEAMING: glslFloat(BH_BEAMING),
            EXPOSURE: glslFloat(BH_EXPOSURE),
            EDGE_SOFTNESS: glslFloat(BH_EDGE_SOFTNESS)
        },
        extensions: { derivatives: true },
        transparent: true,
        depthTest: false,
        depthWrite: false,
        // premultiplied "over": light adds, shadow/disk cover the stars behind
        blending: THREE.CustomBlending,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneMinusSrcAlphaFactor
    })
);
blackHoleQuad.renderOrder = 1;
blackHole.add(blackHoleQuad);

// Soft glow standing in for bloom: hugs the disk's on-screen ellipse and,
// like the disk, is much brighter on the approaching (left) side.
const BLOOM_HALF = BH_DISK_OUTER * 2.0;
const blackHoleBloom = new THREE.Mesh(
    new THREE.PlaneGeometry(2 * BLOOM_HALF, 2 * BLOOM_HALF),
    new THREE.ShaderMaterial({
        uniforms: {
            uIntro: blackHoleUniforms.uIntro,
            uBloom: { value: BH_BLOOM }
        },
        vertexShader: bloomVertexShader,
        fragmentShader: bloomFragmentShader,
        defines: {
            DISK_INNER: glslFloat(BH_DISK_INNER),
            DISK_OUTER: glslFloat(BH_DISK_OUTER),
            ROLL: glslFloat(BH_DISK_ROLL),
            FLATTEN: glslFloat(Math.sin(BH_DISK_TILT))
        },
        transparent: true,
        depthTest: false,
        depthWrite: false,
        // premultiplied additive
        blending: THREE.CustomBlending,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneFactor
    })
);
blackHoleBloom.renderOrder = 2;
blackHole.add(blackHoleBloom);

// Adaptive black hole resolution
// NOTE: Fixes Firefox mobile dropping to 30-40 fps (Chrome holds 60 on the same phone).
// The ray traced quad is by far the most expensive draw. When the frame rate
// stays low, it's rendered into a smaller offscreen target and upscaled
// (the disk is soft, so it hides well); stars and bloom stay full resolution.
// It only steps down after a sustained slump, and a level that failed isn't
// retried (until a resize), so it can't oscillate between two levels.
const BH_LAYER = 1;                           // camera layer of the offscreen pass
const BH_SCALES = [1, 0.8, 0.65, 0.5, 0.35];  // resolution levels (1 = rendered directly)
const BH_MIN_FPS = Math.min(50, FPS * 0.9);   // sustained below this -> step down (~40% of 120)
const BH_UPGRADE_FPS = Math.min(57, FPS * 0.95); // sustained at/above this -> try a step up
const BH_SAMPLE_MS = 2000;                    // length of each measurement
const BH_SETTLE_MS = 1000;                    // ignored after start/changes (shader warm-up, resize)
const BH_STALL_MS = 250;                      // a gap this long (hidden tab, hitch) restarts the sample

// ?bhscale=<n> pins the scale and disables adaptation (see js/debug.js)
const forcedBlackHoleScale = numberParam('bhscale', NaN);
let blackHoleLevel = 0;
const failedBlackHoleLevels = new Set();
const blackHoleSample = { start: 0, frames: 0, last: 0, settleUntil: -1 };

const blackHoleTarget = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false });

const blackHoleComposite = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.ShaderMaterial({
        uniforms: { uTexture: { value: blackHoleTarget.texture } },
        vertexShader: compositeVertexShader,
        fragmentShader: compositeFragmentShader,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        // same premultiplied "over" as the quad itself
        blending: THREE.CustomBlending,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneMinusSrcAlphaFactor
    })
);
blackHoleComposite.frustumCulled = false;
blackHoleComposite.renderOrder = blackHoleQuad.renderOrder; // between the stars and the bloom
blackHoleComposite.visible = false;
scene.add(blackHoleComposite);

function blackHoleScale() {
    return Number.isFinite(forcedBlackHoleScale)
        ? forcedBlackHoleScale
        : BH_SCALES[blackHoleLevel];
}

// Sizes the offscreen target and moves the quad in/out of the offscreen pass
function applyBlackHoleScale() {
    const scale = blackHoleScale();
    const buffer = renderer.getDrawingBufferSize(new THREE.Vector2());
    const offscreen = scale < 1;

    blackHoleQuad.layers.set(offscreen ? BH_LAYER : 0);
    blackHoleComposite.visible = offscreen && blackHole.visible;
    if (offscreen) {
        blackHoleTarget.setSize(
            Math.max(1, Math.round(buffer.x * scale)),
            Math.max(1, Math.round(buffer.y * scale))
        );
    }

    // the shader's anti-aliasing works in the pixels it's actually drawn at
    blackHoleUniforms.uPixelAngle.value =
        2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / (buffer.y * scale);

    setRenderInfo(`${buffer.x}×${buffer.y} @ ${renderer.getPixelRatio()}x · black hole ${scale}x`);
}

function setBlackHoleLevel(level, time) {
    blackHoleLevel = level;
    applyBlackHoleScale();
    blackHoleSample.start = 0;
    blackHoleSample.settleUntil = time + BH_SETTLE_MS;
}

// Call once per rendered frame
function adaptBlackHole(time) {
    if (Number.isFinite(forcedBlackHoleScale) || !blackHole.visible) return;

    const sample = blackHoleSample;
    const gap = time - sample.last;
    sample.last = time;

    if (sample.settleUntil < 0) sample.settleUntil = time + BH_SETTLE_MS;
    if (time < sample.settleUntil || gap > BH_STALL_MS) {
        sample.start = 0;
        return;
    }
    if (!sample.start) {
        sample.start = time;
        sample.frames = 0;
        return;
    }

    sample.frames++;
    const elapsed = time - sample.start;
    if (elapsed < BH_SAMPLE_MS) return;

    const fps = sample.frames * 1000 / elapsed;
    sample.start = 0;

    if (fps < BH_MIN_FPS && blackHoleLevel < BH_SCALES.length - 1) {
        failedBlackHoleLevels.add(blackHoleLevel);
        setBlackHoleLevel(blackHoleLevel + 1, time);
    } else if (fps >= BH_UPGRADE_FPS && blackHoleLevel > 0
        && !failedBlackHoleLevels.has(blackHoleLevel - 1)) {
        setBlackHoleLevel(blackHoleLevel - 1, time);
    }
}

// Shooting stars
// Rare streaks drawn in screen space (CSS px): a strong, wide head with a
// weak, long tail. The head flares up towards the end and is at its brightest
// just before it fades away. They're far behind the black hole: its shadow
// covers them and they're lensed like the stars (see shaders/meteor.frag).
const METEOR_POOL = 2;                   // at most this many at once
const METEOR_GAP = numberParam('meteorgap', NaN); // ?meteorgap=<s> forces the average gap (testing)
const METEOR_GAP_MIN = Number.isFinite(METEOR_GAP) ? METEOR_GAP * 0.5 : 8;  // seconds
const METEOR_GAP_MAX = Number.isFinite(METEOR_GAP) ? METEOR_GAP * 1.5 : 25;
const METEOR_DURATION = [0.5, 1.2];      // seconds on screen
const METEOR_TRAVEL = [0.15, 0.4];       // distance covered, fraction of the screen diagonal
const METEOR_TAIL = [0.03, 0.12];        // max tail length, fraction of the screen diagonal
const METEOR_WIDTH = [1.6, 2.8];         // head glow radius, CSS px
const METEOR_ANGLE = [15, 50];           // degrees below the horizon
const METEOR_PEAK = 0.85;                // point of the flight where the head is brightest

const meteorsEnabled = flagParam('meteors')
    && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const randomIn = ([min, max]) => THREE.MathUtils.lerp(min, max, Math.random());

const meteorGeometry = new THREE.PlaneGeometry(1, 1);
const meteors = [];

for (let i = 0; i < METEOR_POOL; i++) {
    const uniforms = {
        uHead:       { value: new THREE.Vector2() },
        uDir:        { value: new THREE.Vector2() },
        uLength:     { value: 0 },
        uWidth:      { value: 2 },
        uBrightness: { value: 0 },
        uViewport:   { value: new THREE.Vector2(1, 1) },
        uBox:        { value: new THREE.Vector4() },
        // same lens as the stars
        uLensCenter:   starUniforms.uLensCenter,
        uLensEinstein: starUniforms.uLensEinstein,
        uLensAspect:   starUniforms.uLensAspect
    };

    const mesh = new THREE.Mesh(meteorGeometry, new THREE.ShaderMaterial({
        uniforms,
        vertexShader: meteorVertexShader,
        fragmentShader: meteorFragmentShader,
        // NOTE: Fixes shooting stars never showing up. The vertex shader maps the
        // quad into y-down CSS pixels, which mirrors it: the triangles end up
        // back-facing and were culled.
        side: THREE.DoubleSide,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        // premultiplied additive, alpha grows with color (see the star material)
        blending: THREE.CustomBlending,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneFactor
    }));
    mesh.frustumCulled = false; // positioned in the vertex shader
    mesh.renderOrder = 0.5;     // after the stars, behind the black hole
    mesh.visible = false;
    scene.add(mesh);

    meteors.push({ mesh, uniforms, start: 0, duration: 1, origin: new THREE.Vector2(), travel: 0, tail: 0 });
}

let nextMeteorAt = -1;

const meteorTail = new THREE.Vector2();
const lensCenterPx = new THREE.Vector2();

// Screen box the meteor's quad has to cover (CSS px)
function updateMeteorBox(uniforms) {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const pad = uniforms.uWidth.value * 3;
    const head = uniforms.uHead.value;
    meteorTail.copy(head).addScaledVector(uniforms.uDir.value, -uniforms.uLength.value);

    let minX = Math.min(head.x, meteorTail.x) - pad;
    let minY = Math.min(head.y, meteorTail.y) - pad;
    let maxX = Math.max(head.x, meteorTail.x) + pad;
    let maxY = Math.max(head.y, meteorTail.y) + pad;

    const einstein = uniforms.uLensEinstein.value * height / 2; // NDC-y units -> px
    if (einstein > 0) {
        // the primary image is pushed out by at most thetaE...
        minX -= einstein; minY -= einstein;
        maxX += einstein; maxY += einstein;

        // ...and the secondary one lands inside the Einstein ring
        const center = uniforms.uLensCenter.value;
        lensCenterPx.set((center.x + 1) / 2 * width, (1 - center.y) / 2 * height);
        const reach = einstein + pad;
        minX = Math.min(minX, lensCenterPx.x - reach);
        minY = Math.min(minY, lensCenterPx.y - reach);
        maxX = Math.max(maxX, lensCenterPx.x + reach);
        maxY = Math.max(maxY, lensCenterPx.y + reach);
    }

    // no point covering anything off screen
    uniforms.uBox.value.set(
        Math.max(minX, 0), Math.max(minY, 0),
        Math.min(maxX, width), Math.min(maxY, height)
    );
}

function spawnMeteor(meteor, seconds) {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const diagonal = Math.hypot(width, height);

    // heading down and to the left or right
    const angle = THREE.MathUtils.degToRad(randomIn(METEOR_ANGLE));
    const side = Math.random() < 0.5 ? -1 : 1;
    meteor.uniforms.uDir.value.set(Math.cos(angle) * side, Math.sin(angle));

    meteor.origin.set(width * randomIn([0.1, 0.9]), height * randomIn([0.0, 0.5]));
    meteor.travel = diagonal * randomIn(METEOR_TRAVEL);
    meteor.tail = diagonal * randomIn(METEOR_TAIL);
    meteor.duration = randomIn(METEOR_DURATION);
    meteor.start = seconds;
    meteor.uniforms.uWidth.value = randomIn(METEOR_WIDTH);
    meteor.mesh.visible = true;
}

function updateMeteors(seconds) {
    if (!meteorsEnabled) return;

    if (nextMeteorAt < 0) nextMeteorAt = seconds + randomIn([METEOR_GAP_MIN, METEOR_GAP_MAX]);
    if (seconds >= nextMeteorAt) {
        const free = meteors.find((meteor) => !meteor.mesh.visible);
        if (free) spawnMeteor(free, seconds);
        nextMeteorAt = seconds + randomIn([METEOR_GAP_MIN, METEOR_GAP_MAX]);
    }

    for (const meteor of meteors) {
        if (!meteor.mesh.visible) continue;

        const progress = (seconds - meteor.start) / meteor.duration;
        if (progress >= 1 || progress < 0) {
            meteor.mesh.visible = false;
            continue;
        }

        const distance = meteor.travel * progress;
        const { uniforms } = meteor;
        uniforms.uHead.value.copy(meteor.origin).addScaledVector(uniforms.uDir.value, distance);
        uniforms.uLength.value = Math.min(meteor.tail, distance);
        uniforms.uViewport.value.set(window.innerWidth, window.innerHeight);
        updateMeteorBox(uniforms);

        // quick fade in, flare up to the peak, then a fast fade out
        const fadeIn = THREE.MathUtils.smoothstep(progress, 0, 0.1);
        const flare = THREE.MathUtils.lerp(0.35, 1, Math.min(progress / METEOR_PEAK, 1));
        const fadeOut = 1 - THREE.MathUtils.smoothstep(progress, METEOR_PEAK, 1);
        uniforms.uBrightness.value = fadeIn * flare * fadeOut;
    }
}

function render() {
    if (blackHoleComposite.visible) {
        camera.layers.set(BH_LAYER);
        renderer.setRenderTarget(blackHoleTarget);
        renderer.render(scene, camera); // only the quad (cleared to transparent)
        renderer.setRenderTarget(null);
        camera.layers.set(0);
    }
    renderer.render(scene, camera);
}

// Keep the black hole anchored to the right side of the viewport
function layoutBlackHole() {
    const halfHeight = cameraBasePosition.z * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const halfWidth = halfHeight * camera.aspect;

    const anchor = portraitQuery.matches ? BH_ANCHOR_PORTRAIT : BH_ANCHOR_LANDSCAPE;
    blackHole.position.set(halfWidth * anchor.x, halfHeight * anchor.y, 0);

    // group scale = size of Rs in world units, so the shadow ends up this big
    const shadowRadius = Math.min(BH_SHADOW_SIZE, halfWidth * 0.12);
    blackHole.scale.setScalar(shadowRadius / BH_SHADOW_RADIUS);

    // Expose where the disk starts on screen (px from the viewport's left) so
    // the page can keep text from running over it (see .about in style.css).
    // The hole sits on the z = 0 plane, where halfWidth maps to NDC 1.
    const diskLeft = blackHole.position.x - BH_DISK_OUTER * blackHole.scale.x;
    const diskLeftPx = (diskLeft / halfWidth + 1) / 2 * window.innerWidth;
    document.documentElement.style.setProperty('--blackhole-left', `${diskLeftPx}px`);

    // ...and where it ends vertically (px from the viewport's top), so portrait
    // layouts can start "About Me" below it (see .hero in hero.css)
    const bottom = blackHole.position.y - BH_VISUAL_HALF_HEIGHT * blackHole.scale.y;
    const bottomPx = (1 - bottom / halfHeight) / 2 * window.innerHeight;
    document.documentElement.style.setProperty('--blackhole-bottom', `${bottomPx}px`);

    applyBlackHoleScale(); // the buffer size may have changed
}

layoutBlackHole();

const lensCenter = new THREE.Vector3();

function updateBlackHole(seconds) {
    blackHoleUniforms.uTime.value = seconds;

    const intro = Math.min(1, seconds / BH_INTRO_TIME);
    blackHoleUniforms.uIntro.value = intro * intro * (3 - 2 * intro);

    // quads face the camera (the group itself is never rotated)
    blackHoleQuad.quaternion.copy(camera.quaternion);
    blackHoleBloom.quaternion.copy(camera.quaternion);

    diskFrame.updateWorldMatrix(true, false); // parents too, in case of a resize
    blackHoleUniforms.uWorldToDisk.value.copy(diskFrame.matrixWorld).invert();

    // Lensing of the background stars: where the hole is on screen and how big
    // its Einstein ring is. For sources at infinity thetaE = sqrt(2 Rs / D).
    camera.updateMatrixWorld();
    blackHole.getWorldPosition(lensCenter).project(camera);
    starUniforms.uLensCenter.value.set(lensCenter.x, lensCenter.y);

    const schwarzschildRadius = blackHole.scale.x; // group scale = Rs in world units
    const distance = camera.position.distanceTo(blackHole.position);
    const einsteinAngle = Math.sqrt(2 * schwarzschildRadius / distance) * BH_LENS_STRENGTH;
    starUniforms.uLensEinstein.value =
        Math.tan(einsteinAngle) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    starUniforms.uLensAspect.value = camera.aspect;
}

// Resize handling
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    // a new size (e.g. rotating the phone) may afford levels that failed before
    failedBlackHoleLevels.clear();
    layoutBlackHole();

    // NOTE: Fixes the black hole flickering while resizing (entering/leaving fullscreen).
    // Resizing the canvas clears it; redraw right away instead of waiting for
    // the next (possibly frame-capped) animation frame, which shows up as a
    // blank flicker, e.g. when entering/leaving fullscreen.
    updateBlackHole(performance.now() * 0.001); // picks up the new layout
    render();
});

// Animation loop
let lastTime = 0;

const mouse = { x: 0, y: 0 };

function updateRelativeCameraPosition(x, y) {
    mouse.x = (x / window.innerWidth) * 2 - 1;
    mouse.y = -(y / window.innerHeight) * 2 + 1;
}

window.addEventListener('pointermove', (event) => {
    if (event.pointerType === 'touch') {
        event.preventDefault();
    }

    updateRelativeCameraPosition(event.clientX, event.clientY);
}, { passive: false });

const cameraOffset = new THREE.Vector3();

const PARALLAX_STRENGTH = 0.4; // adjust for intensity
const CAMERA_SMOOTHING = 0.05; // lower = smoother

function animate(time) {
    requestAnimationFrame(animate);

    // NOTE: Fixes uneven pacing when the cap is below the display rate.
    // Advance by whole frames instead of jumping to `time` (resyncing after a
    // stall), with 1 ms of slack: rAF timestamps jitter, so at 30 fps on a
    // 60 Hz screen an exact comparison would randomly skip an extra frame.
    if (time - lastTime < FRAME_TIME - 1) return;
    lastTime = Math.max(lastTime + FRAME_TIME, time - FRAME_TIME);

    reportFrame(time);
    adaptBlackHole(time);

    // particle motion
    // NOTE: Fixes jittery star motion: per-frame steps + the FPS cap made the speed uneven.
    // time-based so the speed doesn't depend on frame pacing
    particles.rotation.set(STAR_AXIS_TILT, time * 0.001 * STAR_SPIN_SPEED, 0);
    starUniforms.uTime.value = time * 0.001;

    // camera parallax (center-anchored)
    cameraOffset.set(
        mouse.x * PARALLAX_STRENGTH,
        mouse.y * PARALLAX_STRENGTH,
        0
    );

    camera.position.lerp(
        cameraBasePosition.clone().add(cameraOffset),
        CAMERA_SMOOTHING
    );

    camera.lookAt(0, 0, 0);

    updateBlackHole(time * 0.001);
    updateMeteors(time * 0.001);

    render();
}

requestAnimationFrame(animate);

