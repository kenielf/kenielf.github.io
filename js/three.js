// Scene
const scene = new THREE.Scene();

// Camera
const camera = new THREE.PerspectiveCamera(
    75,
    window.innerWidth / window.innerHeight,
    0.1,
    1000
);

// Base (anchored) camera position
const cameraBasePosition = new THREE.Vector3(0, 0, 5);
camera.position.copy(cameraBasePosition);

// Renderer
const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true // allows CSS background to show through
});
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);

document.getElementById('background').appendChild(renderer.domElement);

function createStarTexture() {
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');

    ctx.clearRect(0, 0, size, size);
    ctx.translate(size / 2, size / 2);

    ctx.fillStyle = 'white';
    ctx.beginPath();

    const rOuter = size * 0.45;
    const rInner = size * 0.12;

    for (let i = 0; i < 4; i++) {
        ctx.lineTo(0, -rOuter);
        ctx.rotate(Math.PI / 4);
        ctx.lineTo(0, -rInner);
        ctx.rotate(Math.PI / 4);
    }

    ctx.closePath();
    ctx.fill();

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;

    return texture;
}

// Particles
const count = 1000;
const positions = new Float32Array(count * 3);
const colors = new Float32Array(count * 3);

for (let i = 0; i < count; i++) {
    const i3 = i * 3;
    positions[i3]         = (Math.random() - 0.5) * 12;
    positions[i3 + 1] = (Math.random() - 0.5) * 12;
    positions[i3 + 2] = (Math.random() - 0.5) * 12;

    // star-like color variation
    const color = new THREE.Color();

    // bias toward white / blue / warm yellow
    const t = Math.random();
    if (t < 0.6) {
        color.setHSL(0.6, 0.2, 0.9);     // cool white / blue
    } else if (t < 0.85) {
        color.setHSL(0.1, 0.3, 0.85);    // warm yellow
    } else {
        color.setHSL(0.0, 0.4, 0.8);     // reddish tint
    }

    colors[i3]     = color.r;
    colors[i3 + 1] = color.g;
    colors[i3 + 2] = color.b;
}

const geometry = new THREE.BufferGeometry();
geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

const starTexture = createStarTexture();

const material = new THREE.PointsMaterial({
    map: starTexture,
    transparent: true,
    // color: 0xffffff,
    size: 0.15,
    opacity: 0.7,
    sizeAttenuation: true,
    vertexColors: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending
});
//
//     color: 0xffffff,
//     size: 0.03,
//     transparent: true,
//     opacity: 0.7
// });

const particles = new THREE.Points(geometry, material);
scene.add(particles);

// Resize handling
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
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
    updateRelativeCameraPosition(event.clientX, event.clientY);
});

const cameraOffset = new THREE.Vector3();

const PARALLAX_STRENGTH = 0.4; // adjust for intensity
const CAMERA_SMOOTHING = 0.05; // lower = smoother

function animate(time) {
    requestAnimationFrame(animate);

    if (time - lastTime < FRAME_TIME) return;
    lastTime = time;

    // particle motion
    particles.rotation.y += 0.0008;
    particles.rotation.x += 0.0004;

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

    renderer.render(scene, camera);
}

requestAnimationFrame(animate);
// function animate() {
//     requestAnimationFrame(animate);
//
//     particles.rotation.y += 0.0008;
//     particles.rotation.x += 0.0004;
//
//     renderer.render(scene, camera);
// }
//
// animate();

