// Declarations for lensing the stars, injected after <common> in PointsMaterial.
uniform vec2 uLensCenter;    // black hole center, in NDC
uniform float uLensEinstein; // Einstein radius, in NDC-y units
uniform float uLensAspect;   // viewport width / height

const float LENS_MAX_GROW = 3.0; // cap on the sprite size boost near the ring
