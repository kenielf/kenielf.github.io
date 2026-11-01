// Shared noise helpers, registered as THREE.ShaderChunk.bh_noise
// (use with `#include <bh_noise>`).
float hash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float noise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
        mix(mix(hash(i + vec3(0, 0, 0)), hash(i + vec3(1, 0, 0)), f.x),
            mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
        mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x),
            mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y),
        f.z
    );
}

// NOTE: Fixes the accretion disk aliasing/sparkling where it's seen edge-on.
// fp = noise-space size of one pixel. Octaves finer than a pixel are
// faded to their average instead of sampled, so the disk doesn't
// sparkle/alias where it's seen nearly edge-on.
float fbm(vec3 p, float fp) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 4; i++) {
        float detail = 1.0 - smoothstep(0.06, 0.3, fp);
        v += a * mix(0.5, noise(p), detail);
        p *= 2.03;
        fp *= 2.03;
        a *= 0.5;
    }
    return v;
}

// NOTE: Fixes the swirl winding up into aliased stripes over time.
// Swirling gas with keplerian (differential) rotation. Two layers
// cross-fade so the shear never winds up into aliased stripes.
// pixel = size of one screen pixel in the same units as r
float swirl(float a, float r, float rInner, float time, float pixel) {
    const float CYCLE = 8.0;
    float omega = pow(rInner / r, 1.5);
    float base = time * 0.12;

    float p0 = fract(time / CYCLE);
    float p1 = fract(time / CYCLE + 0.5);

    float a0 = a + base + p0 * CYCLE * 0.45 * omega;
    float a1 = a + base + p1 * CYCLE * 0.45 * omega;

    // noise space is stretched 6x radially and 2/r around the ring
    float fp = pixel * max(6.0, 2.0 / r);

    float n0 = fbm(vec3(cos(a0) * 2.0, sin(a0) * 2.0, r * 6.0), fp);
    float n1 = fbm(vec3(cos(a1) * 2.0 + 7.3, sin(a1) * 2.0 - 3.1, r * 6.0), fp);

    float w0 = 1.0 - abs(2.0 * p0 - 1.0);
    return mix(n1, n0, w0);
}
