// Strong, wide head and a weak, long, tapering tail, lensed by the black hole.
uniform vec2 uHead;      // head position (CSS px, y down)
uniform vec2 uDir;       // unit direction of travel
uniform float uLength;   // current tail length
uniform float uWidth;    // head glow radius
uniform float uBrightness;
uniform vec2 uViewport;

// Shared with the stars (see star_lens_pars.vert)
uniform vec2 uLensCenter;    // black hole center, in NDC
uniform float uLensEinstein; // Einstein radius, in NDC-y units
uniform float uLensAspect;   // viewport width / height

varying vec2 vScreen;

const vec3 HEAD_COLOR = vec3(1.0, 0.97, 0.92);
const vec3 TAIL_COLOR = vec3(0.75, 0.85, 1.0);

// Inverse point-lens mapping: where on the (unlensed) sky the light reaching
// this pixel comes from, beta = theta - thetaE² theta / |theta|². Sampling the
// trail there draws every image at once (the primary one pushed outwards, the
// flipped secondary one inside the Einstein ring, arcs near the ring), and
// lensing conserves surface brightness, so no magnification factor is needed.
vec2 unlensed(vec2 screen) {
    if (uLensEinstein <= 0.0) return screen;

    vec2 aspect = vec2(uLensAspect, 1.0);
    vec2 ndc = vec2(screen.x / uViewport.x * 2.0 - 1.0, 1.0 - screen.y / uViewport.y * 2.0);
    vec2 theta = (ndc - uLensCenter) * aspect;
    vec2 beta = theta * (1.0 - uLensEinstein * uLensEinstein / max(dot(theta, theta), 1e-8));

    ndc = uLensCenter + beta / aspect;
    return vec2((ndc.x + 1.0) * 0.5 * uViewport.x, (1.0 - ndc.y) * 0.5 * uViewport.y);
}

void main() {
    vec2 offset = unlensed(vScreen) - uHead;
    float along = -dot(offset, uDir);                     // distance behind the head
    float across = dot(offset, vec2(-uDir.y, uDir.x));

    // round glow around the head
    float head = exp(-(along * along + across * across) / (uWidth * uWidth));

    // tail: narrows and dims towards its end (min width keeps it from aliasing)
    float t = clamp(along / max(uLength, 1e-3), 0.0, 1.0);
    float tailWidth = max(uWidth * 0.45 * (1.0 - t), 0.5);
    float inTail = step(0.0, along) * step(along, uLength);
    float tail = inTail * exp(-(across * across) / (tailWidth * tailWidth))
               * (1.0 - t) * (1.0 - t) * 0.4;

    float intensity = clamp((head + tail) * uBrightness, 0.0, 1.0);
    vec3 color = mix(TAIL_COLOR, HEAD_COLOR, clamp(head * 2.0, 0.0, 1.0));

    // premultiplied, additive (see the material's blending)
    gl_FragColor = vec4(color * intensity, intensity);
}
