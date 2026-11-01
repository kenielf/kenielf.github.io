// Fullscreen quad: PlaneGeometry(2, 2) is already in clip space
varying vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
}
