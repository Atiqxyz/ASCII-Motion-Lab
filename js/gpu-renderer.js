(() => {
  "use strict";
  class AsciiGpuRenderer {
    constructor(canvas) {
      this.canvas=canvas;
      const gl=canvas.getContext("webgl2",{alpha:false,antialias:false,preserveDrawingBuffer:true,powerPreference:"high-performance"});
      if(!gl) throw new Error("WebGL2 is unavailable");
      this.gl=gl;
      const vs=\`#version 300 es
      out vec2 vUv;
      void main(){
        vec2 p=gl_VertexID==0?vec2(-1.0,-1.0):(gl_VertexID==1?vec2(3.0,-1.0):vec2(-1.0,3.0));
        vUv=p*0.5+0.5;
        gl_Position=vec4(p,0.0,1.0);
      }\`;
      const fs=\`#version 300 es
      precision highp float;
      in vec2 vUv; out vec4 outColor;
      uniform sampler2D uSource; uniform sampler2D uAtlas;
      uniform vec2 uResolution; uniform vec2 uCellPx; uniform vec2 uGrid;
      uniform vec2 uSourceSize; uniform float uRampLen;
      uniform float uBrightness; uniform float uContrast;
      uniform bool uInvert; uniform bool uColor;
      uniform vec3 uBg; uniform vec3 uFg;
      uniform float uSaturation; uniform float uLift;
      uniform float uAtlasCols; uniform float uAtlasRows;
      vec3 boost(vec3 c){
        float y=dot(c,vec3(0.2126,0.7152,0.0722));
        return clamp((vec3(y)+(c-vec3(y))*uSaturation)*uLift,0.0,1.0);
      }
      void main(){
        vec2 px=gl_FragCoord.xy;
        vec2 cell=floor(px/uCellPx);
        vec2 local=fract(px/uCellPx);
        vec2 uv=(cell+0.5)/uGrid;
        float lod=clamp(log2(max(uSourceSize.x/uGrid.x,uSourceSize.y/uGrid.y)),0.0,12.0);
        vec3 src=textureLod(uSource,uv,lod).rgb;
        float lum=dot(src,vec3(0.2126,0.7152,0.0722));
        lum=clamp((lum-0.5)*uContrast+0.5+uBrightness/255.0,0.0,1.0);
        if(uInvert) lum=1.0-lum;
        float index=floor(lum*(uRampLen-1.0)+0.5);
        float col=mod(index,uAtlasCols);
        float row=floor(index/uAtlasCols);
        vec2 atlasUv=(vec2(col,row)+vec2(local.x,1.0-local.y))/vec2(uAtlasCols,uAtlasRows);
        float ink=texture(uAtlas,atlasUv).r;
        vec3 inkColor=uColor?boost(src):uFg;
        outColor=vec4(mix(uBg,inkColor,ink),1.0);
      }\`;
      const compile=(type,src)=>{const s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(s));return s;};
      const p=gl.createProgram();gl.attachShader(p,compile(gl.VERTEX_SHADER,vs));gl.attachShader(p,compile(gl.FRAGMENT_SHADER,fs));gl.linkProgram(p);
      if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(p));
      this.program=p;gl.useProgram(p);
      this.loc={};["uSource","uAtlas","uResolution","uCellPx","uGrid","uSourceSize","uRampLen","uBrightness","uContrast","uInvert","uColor","uBg","uFg","uSaturation","uLift","uAtlasCols","uAtlasRows"].forEach(n=>this.loc[n]=gl.getUniformLocation(p,n));
      this.sourceTex=gl.createTexture();this.atlasTex=gl.createTexture();
      this.bindTexture(this.sourceTex,true);this.bindTexture(this.atlasTex,false);
      gl.uniform1i(this.loc.uSource,0);gl.uniform1i(this.loc.uAtlas,1);
      this.atlasKey="";this.sourceWidth=0;this.sourceHeight=0;
      this.vertexArray=gl.createVertexArray();gl.bindVertexArray(this.vertexArray);
      gl.disable(gl.DEPTH_TEST);gl.disable(gl.BLEND);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);
      gl.clearColor(0.031,0.031,0.035,1);
    }
    bindTexture(tex,mipmap){
      const gl=this.gl;gl.bindTexture(gl.TEXTURE_2D,tex);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,mipmap?gl.LINEAR_MIPMAP_LINEAR:gl.LINEAR);
    }
    buildAtlas(chars){
      const key=chars;
      if(key===this.atlasKey)return;
      const cols=16,tileW=64,tileH=80,rows=Math.ceil(chars.length/cols);
      const c=document.createElement("canvas");c.width=cols*tileW;c.height=rows*tileH;
      const x=c.getContext("2d");x.fillStyle="#000";x.fillRect(0,0,c.width,c.height);
      x.fillStyle="#fff";x.textAlign="center";x.textBaseline="middle";
      x.font='72px "Courier New",monospace';
      for(let i=0;i<chars.length;i++)x.fillText(chars[i],(i%cols)*tileW+tileW/2,Math.floor(i/cols)*tileH+tileH/2+3);
      const gl=this.gl;gl.activeTexture(gl.TEXTURE1);this.bindTexture(this.atlasTex,false);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,c);
      this.atlasKey=key;this.atlasRows=rows;this.atlasCols=cols;this.rampLen=chars.length;
    }
    draw(source,columns,rows,settings){
      const gl=this.gl;
      const width=Math.max(320,Math.min(1600,columns*10));
      const height=Math.max(180,Math.round(width*rows/columns*2));
      if(this.canvas.width!==width||this.canvas.height!==height){this.canvas.width=width;this.canvas.height=height;}
      gl.viewport(0,0,width,height);
      const chars=settings.chars||" .:-=+*#%@";
      this.buildAtlas(chars);
      gl.activeTexture(gl.TEXTURE0);this.bindTexture(this.sourceTex,true);
      const sw=source.videoWidth||source.naturalWidth||source.width;
      const sh=source.videoHeight||source.naturalHeight||source.height;
      if(sw!==this.sourceWidth||sh!==this.sourceHeight){
        gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,source);
        this.sourceWidth=sw;this.sourceHeight=sh;
      }else{
        gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,gl.RGBA,gl.UNSIGNED_BYTE,source);
      }
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.useProgram(this.program);gl.bindVertexArray(this.vertexArray);
      const u=this.loc;
      gl.uniform2f(u.uResolution,width,height);
      gl.uniform2f(u.uCellPx,width/columns,height/rows);
      gl.uniform2f(u.uGrid,columns,rows);
      gl.uniform2f(u.uSourceSize,source.videoWidth||source.naturalWidth||source.width,source.videoHeight||source.naturalHeight||source.height);
      gl.uniform1f(u.uRampLen,this.rampLen);
      gl.uniform1f(u.uBrightness,Number(settings.brightness)||0);
      gl.uniform1f(u.uContrast,(Number(settings.contrast)||100)/100);
      gl.uniform1i(u.uInvert,settings.invert?1:0);
      gl.uniform1i(u.uColor,settings.color?1:0);
      gl.uniform3f(u.uBg,8/255,8/255,9/255);
      gl.uniform3f(u.uFg,0.95,0.95,0.96);
      gl.uniform1f(u.uSaturation,1.48);gl.uniform1f(u.uLift,1.12);
      gl.uniform1f(u.uAtlasCols,this.atlasCols);gl.uniform1f(u.uAtlasRows,this.atlasRows);
      gl.drawArrays(gl.TRIANGLES,0,3);
    }
  }
  window.AsciiGpuRenderer=AsciiGpuRenderer;
})();