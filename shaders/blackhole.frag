// Ray traced Schwarzschild black hole (units: Schwarzschild radius Rs = 1).
// Every fragment traces a light ray backwards through curved spacetime.
uniform float uTime;
uniform float uIntro;
uniform mat4 uWorldToDisk;
uniform float uPixelAngle;
varying vec3 vWorld;

// Provided by the material's `defines` (see js/three.js):
//   R_IN, R_OUT, R_BOUND, B_CRIT, TEMPERATURE, BEAMING, EXPOSURE, EDGE_SOFTNESS

const int MAX_STEPS = 300;
const float RING_BAND = 0.35; // impact-parameter width of the supersampled ring band

#include <bh_noise>

// Approximate blackbody color (Tanner Helland's fit), t in kelvin
vec3 blackbody(float t) {
    t = clamp(t, 1000.0, 40000.0) / 100.0;
    vec3 c;
    c.r = t <= 66.0 ? 1.0 : 1.29293618606 * pow(t - 60.0, -0.1332047592);
    c.g = t <= 66.0 ? 0.39008157876 * log(t) - 0.63184144378
                    : 1.12989086089 * pow(t - 60.0, -0.0755148492);
    c.b = t >= 66.0 ? 1.0
        : (t <= 19.0 ? 0.0 : 0.54320678911 * log(t - 10.0) - 1.19625408914);
    return clamp(c, 0.0, 1.0);
}

// Null geodesic in Schwarzschild: a = -3/2 h² x / r⁵, given r2 = |x|².
// r⁻⁵ = r⁻⁴ · r⁻¹ from one inversesqrt, instead of pow(r2, 2.5) (exp2 + log2)
vec3 gravity(vec3 pos, float r2, float h2) {
    float invR2 = 1.0 / r2;
    return (-1.5 * h2 * invR2 * invR2 * inversesqrt(r2)) * pos;
}

// Traces a single ray (in disk space). Returns premultiplied color + coverage.
vec4 trace(vec3 ro, vec3 rd, float pixelAtHole) {
    // Jump straight to the bounding sphere
    float b = dot(ro, rd);
    float c = dot(ro, ro) - R_BOUND * R_BOUND;
    float disc = b * b - c;
    if (disc < 0.0) return vec4(0.0);
    float travelled = -b - sqrt(disc);
    vec3 pos = ro + rd * travelled;
    vec3 vel = rd;

    // NOTE: Fixes the shadow showing as two mismatched ellipses (a sharp circle + a
    // perspective-squashed sphere): the shadow is now a single, ray traced edge.
    // Conserved angular momentum. With |vel| = 1 it is also the
    // impact parameter, which alone decides if the ray is captured:
    // that gives an exact, anti-aliased shadow edge.
    vec3 L = cross(pos, vel);
    float h2 = dot(L, L);
    float impact = sqrt(h2);

    float edge = pixelAtHole + EDGE_SOFTNESS;
    float shadow = 1.0 - smoothstep(B_CRIT - edge, B_CRIT + edge, impact);

    // Captured rays (b < B_CRIT) have no turning point: once inside the disk's
    // inner edge they only fall further in, and the disk is only at r > R_IN,
    // so nothing past that point can reach this pixel. Only for rays clearly
    // inside the shadow edge, so near-critical rays (the photon ring) still
    // get the full integration.
    float stop2 = impact < B_CRIT - edge ? R_IN * R_IN : 1.0;

    vec3 color = vec3(0.0);
    float alpha = 0.0;

    // Only r² is ever needed (tests, step size, gravity): no sqrt per step.
    // It's carried over from the force evaluation of the previous step.
    float r2 = dot(pos, pos);
    vec3 acc = gravity(pos, r2, h2);

    for (int i = 0; i < MAX_STEPS; i++) {
        if (r2 < stop2) break; // fell in (or can no longer reach the disk)
        if (r2 > R_BOUND * R_BOUND && dot(pos, vel) > 0.0) break; // escaped
        if (alpha > 0.99) break;

        // smaller steps close in, where the bending is strongest
        float dt = clamp(0.04 * r2, 0.01, 0.8);

        // NOTE: Fixes a noisy, broken-up photon ring (part 1: integration error).
        // leapfrog (velocity Verlet): stays accurate for rays that loop
        // around the photon sphere, where plain Euler drifts and the
        // photon ring turns noisy
        vec3 prev = pos;
        pos += (vel + 0.5 * dt * acc) * dt;
        r2 = dot(pos, pos);
        vec3 accNext = gravity(pos, r2, h2);
        vel += 0.5 * (acc + accNext) * dt;
        acc = accNext;
        travelled += dt;

        // Crossed the disk plane?
        if (prev.y * pos.y < 0.0) {
            vec3 hit = mix(prev, pos, prev.y / (prev.y - pos.y));
            float hr = length(hit.xz);
            if (hr > R_IN && hr < R_OUT) {
                vec3 dir = normalize(vel);

                // x = R_IN / r and its square root are shared by the profile
                // and the swirl: every pow() below is built from them
                float x = R_IN / hr;
                float sx = sqrt(x);

                // Thin-disk temperature profile (peaks just outside the ISCO):
                // x^(3/4) (1 - √x)^(1/4), peak normalized to 1
                float profile = sx * sqrt(sx) * sqrt(sqrt(1.0 - sx)) / 0.488;

                // Keplerian orbit, as seen by a static observer. The orbit's
                // direction is (z, 0, -x) / r, so cos(theta) needs no normalize
                // (photon travels towards the camera, hence -dir)
                float beta2 = 0.5 / (hr - 1.0);
                float cosTheta = (hit.x * dir.z - hit.z * dir.x) / hr;

                // Doppler shift + gravitational redshift:
                // g = sqrt(1 - 1/r) / (gamma (1 - beta cos)), with 1/gamma = sqrt(1 - beta²)
                float g = sqrt((1.0 - 1.0 / hr) * (1.0 - beta2)) / (1.0 - sqrt(beta2) * cosTheta);

                // Turbulence (orbit runs towards decreasing atan(z, x), i.e. the
                // swirl's angle is -atan(z, x), passed as its unit vector)
                float footprint = uPixelAngle * travelled / max(abs(dir.y), 0.08);
                float n = swirl(vec2(hit.x, -hit.z) / hr, hr * 0.3, x * sx, uTime, footprint * 0.3);

                float t = (hr - R_IN) / (R_OUT - R_IN);
                float density = smoothstep(0.0, 0.02, t) * (1.0 - smoothstep(0.5, 1.0, t))
                              * (0.35 + 1.0 * n);

                // brightness ∝ T⁴, so the outer disk fades out quickly
                float profile2 = profile * profile;
                vec3 emitted = blackbody(TEMPERATURE * profile * g)
                             * (profile2 * profile2) * pow(g, BEAMING);

                // NOTE: Fixes a dark ellipse around the disk over the page background.
                // opacity follows brightness: the dim outer disk is see-through
                // instead of a dark ellipse over the page background
                float a = clamp(density * profile2 * 1.5, 0.0, 1.0);
                color += (1.0 - alpha) * a * emitted * density * 1.4;
                alpha += (1.0 - alpha) * a;
            }
        }
    }

    // filmic-ish exposure so the beamed side rolls off instead of clipping
    color = 1.0 - exp(-color * EXPOSURE);

    // shadow sits behind whatever disk light was gathered in front of it
    float coverage = alpha + (1.0 - alpha) * shadow;
    // NOTE: Fixes cyan fringes on the bright (doppler beamed) side of the disk.
    // the canvas is premultiplied: color must never exceed alpha, or
    // the browser composites garbage (cyan fringes) over the page
    coverage = max(coverage, max(max(color.r, color.g), color.b));

    return vec4(color, coverage);
}

void main() {
    // world-space size of one pixel, taken before any branching
    vec3 dx = dFdx(vWorld);
    vec3 dy = dFdy(vWorld);

    // Ray from the camera through this pixel, in disk space
    mat3 toDisk = mat3(uWorldToDisk);
    vec3 ro = (uWorldToDisk * vec4(cameraPosition, 1.0)).xyz;
    vec3 ray = toDisk * (vWorld - cameraPosition);
    vec3 rd = normalize(ray);

    // cheap early out for pixels whose ray misses the bounding sphere
    float b = dot(ro, rd);
    if (b * b - dot(ro, ro) + R_BOUND * R_BOUND < 0.0) discard;

    float pixelAtHole = uPixelAngle * length(ro);
    float impact = length(cross(ro, rd)); // conserved along the ray

    // NOTE: Fixes the photon ring aliasing (part 2: one sample per pixel isn't enough).
    // The photon ring (and the lensed images right outside the shadow)
    // comes from rays skimming the photon sphere: neighbouring pixels
    // can loop around a different number of times, so one sample per
    // pixel aliases badly. Supersample just that thin band.
    vec4 result;
    float band = 3.0 * pixelAtHole;
    if (impact > B_CRIT - band && impact < B_CRIT + RING_BAND + band) {
        // rotated-grid 4x (the transform is linear: map the pixel steps once)
        vec3 rx = toDisk * dx;
        vec3 ry = toDisk * dy;
        result = trace(ro, normalize(ray - 0.125 * rx - 0.375 * ry), pixelAtHole)
               + trace(ro, normalize(ray + 0.375 * rx - 0.125 * ry), pixelAtHole)
               + trace(ro, normalize(ray + 0.125 * rx + 0.375 * ry), pixelAtHole)
               + trace(ro, normalize(ray - 0.375 * rx + 0.125 * ry), pixelAtHole);
        result *= 0.25;
    } else {
        result = trace(ro, rd, pixelAtHole);
    }

    // premultiplied output (see blending below)
    gl_FragColor = result * uIntro;
}
