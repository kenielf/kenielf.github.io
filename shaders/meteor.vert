// Shooting star: a screen-aligned box (CSS pixels, y down) covering the trail
// and, while it's lensed, every image the black hole can make of it.
uniform vec4 uBox;       // min.xy, max.xy
uniform vec2 uViewport;  // CSS size of the canvas
varying vec2 vScreen;    // this fragment's CSS position

void main() {
    vScreen = mix(uBox.xy, uBox.zw, position.xy + 0.5);
    gl_Position = vec4(vScreen.x / uViewport.x * 2.0 - 1.0, 1.0 - vScreen.y / uViewport.y * 2.0, 0.0, 1.0);
}
