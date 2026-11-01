// Gravitational lensing of the background stars, injected after <fog_vertex>
// in PointsMaterial (gl_Position and gl_PointSize are final by then).
//
// Point-lens equation in screen space: every star is far behind the black
// hole, so a star at angle beta from it shows up as two images at
//   theta± = (beta ± sqrt(beta² + 4 thetaE²)) / 2
// with magnifications
//   mu± = (u² + 2) / (2u sqrt(u² + 4)) ± 1/2,   u = beta / thetaE
//
// Without LENS_SECONDARY this draws the primary image (pushed outwards,
// piling up around the Einstein ring). With it, the faint secondary image:
// flipped to the opposite side, between the shadow and the Einstein ring.
// NOTE: Fixes every star vanishing with lensing off (thetaE = 0 made u = beta / 0 a NaN).
#ifdef LENS_SECONDARY
    if (uLensEinstein <= 0.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0); // no lens: no second image
#endif
if (gl_Position.w > 0.0 && uLensEinstein > 0.0) {
    vec2 aspect = vec2(uLensAspect, 1.0);
    vec2 rel = (gl_Position.xy / gl_Position.w - uLensCenter) * aspect;
    float beta = max(length(rel), 1e-5);

    float root = sqrt(beta * beta + 4.0 * uLensEinstein * uLensEinstein);
    float u = beta / uLensEinstein;
    float muCommon = (u * u + 2.0) / (2.0 * u * sqrt(u * u + 4.0));

    #ifdef LENS_SECONDARY
        float theta = 0.5 * (beta - root); // negative: opposite side of the hole
        float mu = muCommon - 0.5;
    #else
        float theta = 0.5 * (beta + root);
        float mu = muCommon + 0.5;
    #endif

    vec2 image = rel * (theta / beta);
    gl_Position.xy = (uLensCenter + image / aspect) * gl_Position.w;

    // flux ∝ magnification: scale the sprite's area (not radius) by mu
    gl_PointSize *= clamp(sqrt(mu), 0.0, LENS_MAX_GROW);

    #ifdef LENS_SECONDARY
        // most secondary images are far too faint to see: drop them (outside
        // the clip volume) instead of drawing a stray 1px dot
        if (gl_PointSize < 1.5) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    #endif
}
