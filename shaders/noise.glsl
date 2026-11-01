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
        // fully faded octaves are just their average: skip the 8 hashes
        v += a * (detail > 0.0 ? mix(0.5, noise(p), detail) : 0.5);
        p *= 2.03;
        fp *= 2.03;
        a *= 0.5;
    }
    return v;
}

// NOTE: Fixes the swirl winding up into aliased stripes over time.
// Swirling gas with keplerian (differential) rotation. Two layers
// cross-fade so the shear never winds up into aliased stripes.
// radial = (cos, sin) of the gas' angle around the ring (no atan needed)
// omega  = angular speed relative to the inner edge, (rInner / r)^1.5
// pixel  = size of one screen pixel in the same units as r
float swirl(vec2 radial, float r, float omega, float time, float pixel) {
    const float CYCLE = 8.0;
    float base = time * 0.12;

    float p0 = fract(time / CYCLE);
    float p1 = fract(time / CYCLE + 0.5);

    // (cos, sin)(angle + phase) = radial rotated by phase
    float phase0 = base + p0 * CYCLE * 0.45 * omega;
    float phase1 = base + p1 * CYCLE * 0.45 * omega;
    vec2 cs0 = vec2(cos(phase0), sin(phase0));
    vec2 cs1 = vec2(cos(phase1), sin(phase1));
    vec2 d0 = vec2(radial.x * cs0.x - radial.y * cs0.y, radial.y * cs0.x + radial.x * cs0.y);
    vec2 d1 = vec2(radial.x * cs1.x - radial.y * cs1.y, radial.y * cs1.x + radial.x * cs1.y);

    // noise space is stretched 6x radially and 2/r around the ring
    float fp = pixel * max(6.0, 2.0 / r);

    float n0 = fbm(vec3(d0 * 2.0, r * 6.0), fp);
    float n1 = fbm(vec3(d1 * 2.0 + vec2(7.3, -3.1), r * 6.0), fp);

    float w0 = 1.0 - abs(2.0 * p0 - 1.0);
    return mix(n1, n0, w0);
}
