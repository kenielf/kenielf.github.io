// Soft glow standing in for bloom: hugs the disk's on-screen ellipse and,
// like the disk, is much brighter on the approaching (left) side.
uniform float uIntro;
uniform float uBloom;
varying vec2 vPos;
// Provided by the material's `defines` (see js/three.js):
//   DISK_INNER, DISK_OUTER, ROLL, FLATTEN

void main() {
    vec2 q = vec2(cos(ROLL) * vPos.x + sin(ROLL) * vPos.y,
                 -sin(ROLL) * vPos.x + cos(ROLL) * vPos.y);

    float beam = clamp(exp(-q.x * 0.12), 0.3, 2.5);
    float eDisk = length(q / vec2(DISK_INNER * 2.2, DISK_INNER * 2.2 * FLATTEN + 1.6));
    float eWide = length(q / vec2(DISK_OUTER, DISK_OUTER * FLATTEN + 3.0));

    vec3 col = vec3(1.0, 0.72, 0.45) * exp(-eDisk * eDisk * 1.5) * 0.15 * beam
             + vec3(0.95, 0.5, 0.35) * exp(-eWide * eWide * 2.0) * 0.07 * beam;

    // NOTE: Fixes a faint black rectangle over the page (alpha = 1 with additive blending
    // marked the whole bloom quad as opaque) and cyan fringes from color > alpha.
    // premultiplied: alpha = brightest channel, so color never exceeds
    // alpha on the transparent canvas
    col *= uBloom * uIntro;
    gl_FragColor = vec4(col, max(max(col.r, col.g), col.b));
}
