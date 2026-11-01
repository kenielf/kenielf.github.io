// Upscales the (premultiplied) low resolution black hole onto the screen
uniform sampler2D uTexture;
varying vec2 vUv;
void main() {
    gl_FragColor = texture2D(uTexture, vUv);
}
