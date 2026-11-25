const VERTEX_SHADER = [
  '#version 300 es',
  'void main() {',
  '  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);',
  '  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);',
  '}'
].join('\n');

const FRAGMENT_SHADER = [
  '#version 300 es',
  'precision highp float;',
  'precision highp int;',
  'uniform sampler2D uFrame;',
  'uniform sampler2D uAtlas;',
  'uniform vec2 uOutputSize;',
  'uniform vec2 uGridSize;',
  'uniform vec2 uCellSize;',
  'uniform float uCharCount;',
  'uniform float uAtlasColumns;',
  'uniform float uAtlasRows;',
  'uniform float uContrast;',
  'uniform float uBrightness;',
  'uniform int uInvert;',
  'uniform int uUseColor;',
  'out vec4 outColor;',
  'void main() {',
  '  vec2 topPixel = vec2(gl_FragCoord.x, uOutputSize.y - gl_FragCoord.y);',
  '  vec2 cell = floor(topPixel / uCellSize);',
  '  cell = clamp(cell, vec2(0.0), uGridSize - vec2(1.0));',
  '  vec2 local = fract(topPixel / uCellSize);',
  '  vec3 source = texelFetch(uFrame, ivec2(cell), 0).rgb;',
  '  float lum = dot(source, vec3(0.2126, 0.7152, 0.0722));',
  '  lum = clamp((lum - 0.5) * uContrast + 0.5, 0.0, 1.0);',
  '  if (uInvert == 1) lum = 1.0 - lum;',
  '  float glyphIndex = floor(lum * (uCharCount - 1.0) + 0.5);',
  '  vec2 tile = vec2(mod(glyphIndex, uAtlasColumns), floor(glyphIndex / uAtlasColumns));',
  '  vec2 atlasUv = (tile + local) / vec2(uAtlasColumns, uAtlasRows);',
  '  float coverage = texture(uAtlas, atlasUv).a;',
  '  vec3 glyphColor = vec3(0.9490196);',
  '  if (uUseColor == 1) {',
  '    vec3 quantized = floor(source * 15.0) / 15.0;',
  '    float gray = dot(quantized, vec3(0.2126, 0.7152, 0.0722));',
  '    glyphColor = clamp(vec3(gray) + (quantized - vec3(gray)) * 1.32 + vec3(7.0 / 255.0), 0.0, 1.0);',
  '  }',
  '  glyphColor = clamp(glyphColor * uBrightness, 0.0, 1.0);',
  '  vec3 background = vec3(8.0 / 255.0, 8.0 / 255.0, 9.0 / 255.0);',
  '  outColor = vec4(mix(background, glyphColor, coverage), 1.0);',
  '}'
].join('\n');

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('Could not allocate a WebGL shader.');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) || 'Unknown shader error';
    gl.deleteShader(shader);
    throw new Error('GPU ASCII shader failed: ' + message);
  }
  return shader;
}

function createProgram(gl) {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
  const program = gl.createProgram();
  if (!program) throw new Error('Could not allocate the GPU ASCII program.');
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) || 'Unknown link error';
    gl.deleteProgram(program);
    throw new Error('GPU ASCII program could not link: ' + message);
  }
  return program;
}

function createTexture(gl, filter) {
  const texture = gl.createTexture();
  if (!texture) throw new Error('Could not allocate a GPU texture.');
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  return texture;
}

function buildGlyphAtlas(charset) {
  const glyphs = Array.from(String(charset || ' .:-=+*#%@')).slice(0, 256);
  if (!glyphs.length) glyphs.push(' ');
  const columns = 16;
  const rows = Math.ceil(glyphs.length / columns);
  const tileWidth = 24;
  const tileHeight = 40;
  const canvas = document.createElement('canvas');
  canvas.width = columns * tileWidth;
  canvas.height = rows * tileHeight;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not create the glyph atlas.');
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#ffffff';
  context.font = '32px "Courier New", monospace';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.imageSmoothingEnabled = true;

  for (let i = 0; i < glyphs.length; i++) {
    if (glyphs[i] === ' ') continue;
    const x = (i % columns) * tileWidth + tileWidth / 2;
    const y = Math.floor(i / columns) * tileHeight + tileHeight / 2;
    context.fillText(glyphs[i], x, y, tileWidth);
  }
  return { canvas, count: glyphs.length, columns, rows };
}

export class GPUAsciiRenderer {
  constructor(options) {
    this.columns = Math.max(1, Math.floor(options.columns));
    this.rows = Math.max(1, Math.floor(options.rows));
    this.cellWidth = 6;
    this.cellHeight = 10;
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.columns * this.cellWidth;
    this.canvas.height = this.rows * this.cellHeight;

    const gl = this.canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: true,
      premultipliedAlpha: false
    });
    if (!gl) throw new Error('WebGL 2 is not available. The compatibility exporter can be used instead.');
    this.gl = gl;

    this.program = createProgram(gl);
    this.frameTexture = createTexture(gl, gl.NEAREST);
    this.atlasTexture = createTexture(gl, gl.LINEAR);
    this.atlas = buildGlyphAtlas(options.charset);
    this.destroyed = false;

    this.sourceCanvas = document.createElement('canvas');
    this.sourceCanvas.width = this.columns;
    this.sourceCanvas.height = this.rows;
    this.sourceContext = this.sourceCanvas.getContext('2d', {
      alpha: false,
      desynchronized: true
    });
    if (!this.sourceContext) throw new Error('Could not create the low-resolution source canvas.');

    this.uniforms = {};
    [
      'uFrame', 'uAtlas', 'uOutputSize', 'uGridSize', 'uCellSize',
      'uCharCount', 'uAtlasColumns', 'uAtlasRows', 'uContrast',
      'uBrightness', 'uInvert', 'uUseColor'
    ].forEach(name => {
      this.uniforms[name] = gl.getUniformLocation(this.program, name);
    });

    gl.useProgram(this.program);
    gl.uniform1i(this.uniforms.uFrame, 0);
    gl.uniform1i(this.uniforms.uAtlas, 1);
    gl.uniform2f(this.uniforms.uOutputSize, this.canvas.width, this.canvas.height);
    gl.uniform2f(this.uniforms.uGridSize, this.columns, this.rows);
    gl.uniform2f(this.uniforms.uCellSize, this.cellWidth, this.cellHeight);
    gl.uniform1f(this.uniforms.uCharCount, this.atlas.count);
    gl.uniform1f(this.uniforms.uAtlasColumns, this.atlas.columns);
    gl.uniform1f(this.uniforms.uAtlasRows, this.atlas.rows);
    gl.uniform1f(this.uniforms.uContrast, Number(options.contrast) || 1);
    gl.uniform1f(this.uniforms.uBrightness, Number(options.brightness) || 1);
    gl.uniform1i(this.uniforms.uInvert, options.invert ? 1 : 0);
    gl.uniform1i(this.uniforms.uUseColor, options.useColor ? 1 : 0);

    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.atlasTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.atlas.canvas);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.frameTexture);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
  }

  renderSample(sample) {
    if (this.destroyed) throw new Error('The GPU renderer has already been closed.');
    const context = this.sourceContext;
    context.fillStyle = '#080809';
    context.fillRect(0, 0, this.columns, this.rows);
    if (typeof sample.drawWithFit === 'function') {
      sample.drawWithFit(context, { fit: 'contain' });
    } else {
      sample.draw(context, 0, 0, this.columns, this.rows);
    }

    const gl = this.gl;
    if (gl.isContextLost()) throw new Error('The GPU rendering context was lost during export.');
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.frameTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.sourceCanvas);
    gl.useProgram(this.program);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    const gl = this.gl;
    if (gl && !gl.isContextLost()) {
      gl.deleteTexture(this.frameTexture);
      gl.deleteTexture(this.atlasTexture);
      gl.deleteProgram(this.program);
    }
  }
}
