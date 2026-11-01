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
    antialias: true,
    alpha: true // allows CSS background to show through
});
// capped: the black hole is ray traced per pixel, 3x screens would triple the cost
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);

document.getElementById('background').appendChild(renderer.domElement);

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
    blackHoleVertexShader,
    blackHoleFragmentShader,
    bloomVertexShader,
    bloomFragmentShader
] = await Promise.all([
    'noise.glsl',
    'star_drift_pars.vert',
    'star_drift.vert',
    'blackhole.vert',
    'blackhole.frag',
    'bloom.vert',
    'bloom.frag'
].map(loadShader));

THREE.ShaderChunk.bh_noise = noiseChunk;
THREE.ShaderChunk.star_drift_pars_vertex = starDriftParsChunk;
THREE.ShaderChunk.star_drift_vertex = starDriftChunk;

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
    uTime: { value: 0 }
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

    // Rotate drifting stars around their axis on the GPU (Rodrigues' formula)
    material.onBeforeCompile = (shader) => {
        shader.uniforms.uTime = starUniforms.uTime;
        shader.vertexShader = shader.vertexShader
            .replace('#include <common>', '#include <common>\n#include <star_drift_pars_vertex>')
            .replace('#include <begin_vertex>', '#include <begin_vertex>\n#include <star_drift_vertex>');
    };

    return new THREE.Points(geometry, material);
}

// Only a slice of the shell is ever on screen, hence the higher counts
const particles = new THREE.Group();
particles.add(createStarLayer(6000, 6, 0.6));   // faint background dust
particles.add(createStarLayer(400, 14, 0.9));   // a few bright stars
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
// height; portrait ("vertical" screens) puts it at 75% width, 60% from the top
const portraitQuery = window.matchMedia('(orientation: portrait)');
const BH_ANCHOR_LANDSCAPE = { x: 0.5, y: 0.0 };
const BH_ANCHOR_PORTRAIT = { x: 0.5, y: 0.35 };
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
const BH_SHADOW_RADIUS = 1.5 * Math.sqrt(3); // critical impact parameter
const BH_BOUND = BH_DISK_OUTER + 1.0;        // rays outside this sphere aren't traced
// NOTE: Fixes the disk glow being clipped by a hard vertical edge on the right.
const BH_QUAD_HALF = BH_BOUND * 1.6;         // covers the bound sphere's (off-axis, stretched) projection

const blackHole = new THREE.Group();
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

// Keep the black hole anchored to the right side of the viewport
function layoutBlackHole() {
    const halfHeight = cameraBasePosition.z * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const halfWidth = halfHeight * camera.aspect;

    const anchor = portraitQuery.matches ? BH_ANCHOR_PORTRAIT : BH_ANCHOR_LANDSCAPE;
    blackHole.position.set(halfWidth * anchor.x, halfHeight * anchor.y, 0);

    // group scale = size of Rs in world units, so the shadow ends up this big
    const shadowRadius = Math.min(BH_SHADOW_SIZE, halfWidth * 0.12);
    blackHole.scale.setScalar(shadowRadius / BH_SHADOW_RADIUS);

    const bufferHeight = renderer.getDrawingBufferSize(new THREE.Vector2()).y;
    blackHoleUniforms.uPixelAngle.value =
        2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / bufferHeight;
}

layoutBlackHole();

function updateBlackHole(seconds) {
    blackHoleUniforms.uTime.value = seconds;

    const intro = Math.min(1, seconds / BH_INTRO_TIME);
    blackHoleUniforms.uIntro.value = intro * intro * (3 - 2 * intro);

    // quads face the camera (the group itself is never rotated)
    blackHoleQuad.quaternion.copy(camera.quaternion);
    blackHoleBloom.quaternion.copy(camera.quaternion);

    diskFrame.updateWorldMatrix(true, false); // parents too, in case of a resize
    blackHoleUniforms.uWorldToDisk.value.copy(diskFrame.matrixWorld).invert();
}

// Resize handling
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    layoutBlackHole();

    // NOTE: Fixes the black hole flickering while resizing (entering/leaving fullscreen).
    // Resizing the canvas clears it; redraw right away instead of waiting for
    // the next (possibly frame-capped) animation frame, which shows up as a
    // blank flicker, e.g. when entering/leaving fullscreen.
    updateBlackHole(performance.now() * 0.001); // picks up the new layout
    renderer.render(scene, camera);
});

// Animation loop
const FPS = 120;
const FRAME_TIME = 1000 / FPS;
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

    if (time - lastTime < FRAME_TIME) return;
    lastTime = time;

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

    renderer.render(scene, camera);
}

requestAnimationFrame(animate);

