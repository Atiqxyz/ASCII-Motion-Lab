(() => {
  "use strict";

  const $ = id => document.getElementById(id);
  const fileInput = $("fileInput");
  const dropzone = $("dropzone");
  const stage = $("stage");
  const output = $("asciiOutput");
  const placeholder = $("placeholder");
  const video = $("video");
  const image = $("image");
  const canvas = $("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const playBtn = $("playBtn");
  const stopBtn = $("stopBtn");
  const seek = $("seek");
  const timeLabel = $("time");
  const status = $("status");
  const downloadBtn = $("downloadBtn");
  const snapshotBtn = $("snapshotBtn");
  const gifBtn = $("gifBtn");
  const mp4Btn = $("mp4Btn");
  const widthInput = $("width");
  const brightnessInput = $("brightness");
  const contrastInput = $("contrast");
  const charsetInput = $("charset");
  const invertInput = $("invert");
  const colorInput = $("color");
  const autoplayInput = $("autoplay");

  let objectUrl = null;
  let sourceFile = null;
  let isMp4Exporting = false;
  let mediaType = null;
  let animationId = null;
  let videoFrameCallbackId = null;
  let lastText = "";
  let currentName = "ascii-frame";
  let isRendering = false;
  let lastSeekUpdate = 0;

  function toast(message) {
    const el = $("toast");
    el.textContent = message;
    el.style.display = "block";
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => {
      el.style.display = "none";
    }, 2600);
  }

  function fmt(seconds) {
    if (!Number.isFinite(seconds)) seconds = 0;
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  function updateTime() {
    timeLabel.textContent =
      `${fmt(video.currentTime)} / ${fmt(video.duration)}`;

    if (
      Number.isFinite(video.duration) &&
      video.duration > 0 &&
      Date.now() - lastSeekUpdate > 250
    ) {
      seek.value = String(
        Math.round(video.currentTime / video.duration * 1000)
      );
    }
  }

  function setControls(active, isVideo) {
    playBtn.disabled = !active || !isVideo;
    stopBtn.disabled = !active || !isVideo;
    seek.disabled = !active || !isVideo;
    downloadBtn.disabled = !active;
    snapshotBtn.disabled = !active;
    gifBtn.disabled = !active || !isVideo;
    mp4Btn.disabled = !active || !isVideo;

    if (!isVideo) {
      playBtn.textContent = "▶ Play";
      timeLabel.textContent = "IMAGE / STATIC";
    }
  }

  function stopLoop() {
    if (animationId !== null) cancelAnimationFrame(animationId);
    animationId = null;
    if (videoFrameCallbackId !== null && typeof video.cancelVideoFrameCallback === "function") {
      video.cancelVideoFrameCallback(videoFrameCallbackId);
    }
    videoFrameCallbackId = null;
  }

  function clearOldSource() {
    sourceFile = null;
    stopLoop();
    video.pause();
    video.removeAttribute("src");
    video.load();
    image.removeAttribute("src");

    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
      objectUrl = null;
    }
  }

  function loadFile(file) {
    if (!file) return;
    if (isMp4Exporting) {
      toast("Wait for the MP4 export to finish before changing the source.");
      return;
    }

    if (
      !file.type.startsWith("image/") &&
      !file.type.startsWith("video/")
    ) {
      toast("Please choose a valid image or video file.");
      return;
    }

    clearOldSource();
    sourceFile = file;

    mediaType = file.type.startsWith("video/") ? "video" : "image";

    currentName = (file.name || "ascii-frame")
      .replace(/\.[^.]+$/, "")
      .replace(/[^\w-]+/g, "-")
      .slice(0, 80) || "ascii-frame";

    objectUrl = URL.createObjectURL(file);
    placeholder.style.display = "none";
    output.style.display = "block";
    status.textContent = "LOADING SOURCE…";

    if (mediaType === "image") {
      image.onload = () => {
        status.textContent =
          `IMAGE READY · ${image.naturalWidth}×${image.naturalHeight}`;
        setControls(true, false);
        renderSource();
      };

      image.onerror = () => {
        status.textContent = "COULD NOT READ IMAGE";
        toast("This image format could not be opened by your browser.");
      };

      image.src = objectUrl;
    } else {
      video.onloadedmetadata = () => {
        status.textContent = `VIDEO READY · ${fmt(video.duration)}`;
        setControls(true, true);
        seek.value = "0";
        updateTime();
        renderSource();

        if (autoplayInput.checked) {
          video.play().then(() => {
            playBtn.textContent = "❚❚ Pause";
            startLoop();
          }).catch(() => {});
        }
      };

      video.onerror = () => {
        status.textContent = "COULD NOT READ VIDEO";
        toast("This video codec may not be supported. Try MP4 (H.264).");
      };

      video.src = objectUrl;
      video.load();
    }
  }

  function getSource() {
    if (mediaType === "image" && image.complete && image.naturalWidth) {
      return {
        element: image,
        width: image.naturalWidth,
        height: image.naturalHeight
      };
    }

    if (mediaType === "video" && video.videoWidth && video.videoHeight) {
      return {
        element: video,
        width: video.videoWidth,
        height: video.videoHeight
      };
    }

    return null;
  }

  function escapeHtml(value) {
    return value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  // Cache the luminance-to-character mapping between video frames.
  let lookupKey = "";
  let characterLookup = new Uint8Array(256);
  const colorPalette = new Array(4096);

  // A compact 4-bit RGB palette keeps adjacent glyphs in the same colour
  // run, cutting the number of DOM nodes dramatically on smooth footage.
  for (let key = 0; key < 4096; key++) {
    const r = ((key >> 8) & 15) * 17;
    const g = ((key >> 4) & 15) * 17;
    const b = (key & 15) * 17;
    const gray = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const boost = channel => Math.max(0, Math.min(255,
      Math.round(gray + (channel - gray) * 1.32 + 7)));
    colorPalette[key] = `rgb(${boost(r)},${boost(g)},${boost(b)})`;
  }

  function getCharacterLookup(chars, brightness, contrast, invert) {
    const key = `${chars}| ${brightness}| ${contrast}| ${invert}`;
    if (key !== lookupKey) {
      lookupKey = key;
      const maxIndex = Math.max(0, chars.length - 1);
      for (let value = 0; value < 256; value++) {
        let adjusted = Math.max(0, Math.min(255,
          (value - 127.5) * contrast + 127.5 + brightness));
        if (invert) adjusted = 255 - adjusted;
        characterLookup[value] = Math.round(adjusted / 255 * maxIndex);
      }
    }
    return characterLookup;
  }

  function getGlyphBrightness() {
    const value = Number(brightnessInput.value);
    return value < 0 ? 1 + value / 1000 : 1;
  }

  function getGlyphGlow() {
    return Math.max(0, Number(brightnessInput.value)) / 1000 * 14;
  }

  function renderSource() {
    if (isRendering) return;

    const source = getSource();
    if (!source) return;

    isRendering = true;

    try {
      const columns = Number(widthInput.value);
      const rows = Math.max(
        1,
        Math.round(columns * source.height / source.width * 0.48)
      );

      if (canvas.width !== columns || canvas.height !== rows) {
        canvas.width = columns;
        canvas.height = rows;
      }
      ctx.drawImage(source.element, 0, 0, columns, rows);

      const pixels = ctx.getImageData(0, 0, columns, rows).data;
      const chars = charsetInput.value || " .:-=+*#%@";
      const brightness = 0;
      const contrast = Number(contrastInput.value) / 100;
      const invert = invertInput.checked;
      const useColor = colorInput.checked;
      const lookup = getCharacterLookup(chars, 0, contrast, invert);
      const outputLines = useColor ? new Array(rows) : null;
      const plainLines = new Array(rows);

      for (let y = 0; y < rows; y++) {
        const plainParts = new Array(columns);
        const htmlParts = useColor ? [] : null;
        let activeColor = -1;
        let colorRun = "";

        for (let x = 0; x < columns; x++) {
          const index = (y * columns + x) * 4;
          const r = pixels[index];
          const g = pixels[index + 1];
          const b = pixels[index + 2];
          const alpha = pixels[index + 3] / 255;
          const luminance = Math.max(0, Math.min(255, Math.round(
            (0.2126 * r + 0.7152 * g + 0.0722 * b) * alpha +
            255 * (1 - alpha)
          )));
          const character = chars[lookup[luminance]] ?? " ";
          plainParts[x] = character;

          if (useColor) {
            const colorKey = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
            if (colorKey !== activeColor) {
              if (colorRun) {
                htmlParts.push(`<span style="color:${colorPalette[activeColor]}">${escapeHtml(colorRun)}</span>`);
              }
              activeColor = colorKey;
              colorRun = character;
            } else {
              colorRun += character;
            }
          }
        }

        plainLines[y] = plainParts.join("");
        if (useColor) {
          if (colorRun) {
            htmlParts.push(`<span style="color:${colorPalette[activeColor]}">${escapeHtml(colorRun)}</span>`);
          }
          outputLines[y] = htmlParts.join("");
        }
      }

      lastText = plainLines.join("\n") + "\n";
      if (useColor) {
        output.innerHTML = outputLines.join("\n");
      } else {
        output.textContent = lastText;
      }

      output.style.filter = `brightness(${getGlyphBrightness()})`;
      output.style.textShadow = getGlyphGlow()
        ? `0 0 ${getGlyphGlow()}px currentColor`
        : "none";
      const outputFontSize = `${Math.max(4, Math.min(9, 840 / columns))}px`;
      if (output.style.fontSize !== outputFontSize) {
        output.style.fontSize = outputFontSize;
        output.style.lineHeight = outputFontSize;
      }
      if (output.style.whiteSpace !== "pre") output.style.whiteSpace = "pre";

      status.textContent = mediaType === "video"
        ? `LIVE ASCII · ${columns} COLS · ${rows} ROWS`
        : `CONVERTED · ${columns} COLS · ${rows} ROWS`;
    } catch (error) {
      console.error(error);
      status.textContent = "RENDER ERROR";
      toast("Could not render this frame. Try a lower character width.");
    } finally {
      isRendering = false;
    }
  }

  function startLoop() {
    stopLoop();

    if (typeof video.requestVideoFrameCallback === "function") {
      const onVideoFrame = () => {
        if (mediaType !== "video" || video.paused || video.ended) {
          videoFrameCallbackId = null;
          return;
        }
        renderSource();
        updateTime();
        videoFrameCallbackId = video.requestVideoFrameCallback(onVideoFrame);
      };
      videoFrameCallbackId = video.requestVideoFrameCallback(onVideoFrame);
      return;
    }

    // Uncapped display-refresh fallback for browsers without video-frame callbacks.
    const tick = () => {
      if (mediaType !== "video" || video.paused || video.ended) {
        animationId = null;
        return;
      }
      renderSource();
      updateTime();
      animationId = requestAnimationFrame(tick);
    };
    animationId = requestAnimationFrame(tick);
  }

  function saveText(suffix) {
    if (!lastText) return;

    const blob = new Blob([lastText], {
      type: "text/plain;charset=utf-8"
    });

    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");

    anchor.href = url;
    anchor.download = `${currentName}-${suffix}.txt`;

    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();

    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast("ASCII text exported.");
  }

  // Create one colored ASCII frame for the GIF.
  function makeAsciiGifFrame() {
    const source = getSource();

    if (!source) {
      throw new Error("No readable video frame is available.");
    }

    // Fixed 16:9 export canvas: 160 × 54 glyph cells at 6 × 10 px.
    // Contain-fit the source so it is never stretched or cropped.
    const columns = 160;
    const rows = 54;

    canvas.width = columns;
    canvas.height = rows;
    ctx.fillStyle = "#080809";
    ctx.fillRect(0, 0, columns, rows);
    const scale = Math.min(columns / source.width, rows / source.height);
    const drawWidth = source.width * scale;
    const drawHeight = source.height * scale;
    ctx.drawImage(
      source.element,
      (columns - drawWidth) / 2,
      (rows - drawHeight) / 2,
      drawWidth,
      drawHeight
    );

    const pixels = ctx.getImageData(0, 0, columns, rows).data;
    const chars = charsetInput.value || " .:-=+*#%@";
    const brightness = 0;
    const contrast = Number(contrastInput.value) / 100;
    const invert = invertInput.checked;
    const useColor = colorInput.checked;

    const fontSize = 10;
    const outCanvas = document.createElement("canvas");

    outCanvas.width = 960;
    outCanvas.height = 540;

    const outCtx = outCanvas.getContext("2d", {
      willReadFrequently: true
    });

    outCtx.fillStyle = "#080809";
    outCtx.fillRect(0, 0, outCanvas.width, outCanvas.height);
    outCtx.font = `${fontSize}px "Courier New", monospace`;
    outCtx.textBaseline = "top";
    outCtx.textAlign = "left";
    outCtx.filter = `brightness(${getGlyphBrightness()})`;
    outCtx.shadowBlur = getGlyphGlow();

    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < columns; x++) {
        const i = (y * columns + x) * 4;
        const r = pixels[i];
        const g = pixels[i + 1];
        const b = pixels[i + 2];
        const alpha = pixels[i + 3] / 255;

        let luminance =
          (0.2126 * r + 0.7152 * g + 0.0722 * b) * alpha +
          255 * (1 - alpha);

        luminance = Math.max(
          0,
          Math.min(255, (luminance - 127.5) * contrast + 127.5)
        );

        if (invert) luminance = 255 - luminance;

        const charIndex = Math.max(
          0,
          Math.min(
            chars.length - 1,
            Math.round(luminance / 255 * (chars.length - 1))
          )
        );

        const character = chars[charIndex] ?? " ";

        if (useColor) {
          const colorKey = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
          outCtx.fillStyle = colorPalette[colorKey];
        } else {
          outCtx.fillStyle = "#f2f2f3";
        }

        outCtx.shadowColor = outCtx.fillStyle;
        outCtx.fillText(character, x * 6, y * 10);
      }
    }

    const rgba = outCtx.getImageData(
      0, 0, outCanvas.width, outCanvas.height
    ).data;

    // Convert each pixel to a compact RGB332 palette index.
    const indexed = new Uint8Array(outCanvas.width * outCanvas.height);

    for (let i = 0, j = 0; i < rgba.length; i += 4, j++) {
      indexed[j] =
        ((rgba[i] >> 5) << 5) |
        ((rgba[i + 1] >> 5) << 2) |
        (rgba[i + 2] >> 6);
    }

    return {
      width: outCanvas.width,
      height: outCanvas.height,
      pixels: indexed
    };
  }

  // Dependency-free GIF89a encoder.
  function encodeGif(frames, width, height, frameDelaysCentiseconds) {
    const bytes = [];

    const push = (...values) => bytes.push(...values);
    const word = value => push(value & 255, (value >> 8) & 255);

    const ascii = value => {
      for (let i = 0; i < value.length; i++) {
        push(value.charCodeAt(i));
      }
    };

    const subBlocks = data => {
      for (let i = 0; i < data.length; i += 255) {
        const chunk = data.subarray(i, Math.min(i + 255, data.length));
        push(chunk.length);

        for (let j = 0; j < chunk.length; j++) {
          push(chunk[j]);
        }
      }

      push(0);
    };

    ascii("GIF89a");
    word(width);
    word(height);

    // Global 256-color table.
    push(0xF7, 0, 0);

    for (let i = 0; i < 256; i++) {
      push(Math.round(((i >> 5) & 7) * 255 / 7));
      push(Math.round(((i >> 2) & 7) * 255 / 7));
      push(Math.round((i & 3) * 255 / 3));
    }

    // Infinite animation loop.
    push(0x21, 0xFF, 0x0B);
    ascii("NETSCAPE2.0");
    push(3, 1, 0, 0, 0);

    const lzw = input => {
      const CLEAR = 256;
      const END = 257;

      let codeSize = 9;
      let nextCode = 258;
      let dictionary = new Map();
      const out = [];

      let bitBuffer = 0;
      let bitCount = 0;

      const emit = code => {
        bitBuffer |= code << bitCount;
        bitCount += codeSize;

        while (bitCount >= 8) {
          out.push(bitBuffer & 255);
          bitBuffer >>= 8;
          bitCount -= 8;
        }
      };

      const reset = () => {
        dictionary = new Map();
        codeSize = 9;
        nextCode = 258;
      };

      emit(CLEAR);

      if (!input.length) {
        emit(END);
        if (bitCount) out.push(bitBuffer & 255);
        return new Uint8Array(out);
      }

      let prefix = input[0];

      for (let i = 1; i < input.length; i++) {
        const value = input[i];
        const key = (prefix << 8) | value;

        if (dictionary.has(key)) {
          prefix = dictionary.get(key);
        } else {
          emit(prefix);

          if (nextCode < 4096) {
            dictionary.set(key, nextCode++);

            if (nextCode > (1 << codeSize) && codeSize < 12) {
              codeSize++;
            }
          } else {
            emit(CLEAR);
            reset();
          }

          prefix = value;
        }
      }

      emit(prefix);
      emit(END);

      if (bitCount) out.push(bitBuffer & 255);

      return new Uint8Array(out);
    };

    for (let frameIndex = 0; frameIndex < frames.length; frameIndex++) {
      const frame = frames[frameIndex];
      const delay = Array.isArray(frameDelaysCentiseconds)
        ? frameDelaysCentiseconds[frameIndex] || 1
        : frameDelaysCentiseconds;
      // Graphic Control Extension.
      push(0x21, 0xF9, 0x04, 0x00);
      word(Math.max(1, Math.min(65535, delay)));
      push(0, 0);

      // Image descriptor.
      push(0x2C);
      word(0);
      word(0);
      word(width);
      word(height);
      push(0);

      push(8); // LZW minimum code size.
      subBlocks(lzw(frame));
    }

    push(0x3B);

    return new Blob([new Uint8Array(bytes)], {
      type: "image/gif"
    });
  }

  function seekVideoTo(seconds) {
    return new Promise((resolve, reject) => {
      if (Math.abs(video.currentTime - seconds) < 0.001) {
        resolve();
        return;
      }

      const timer = setTimeout(() => {
        cleanup();
        reject(new Error("Timed out while reading video frame."));
      }, 5000);

      const cleanup = () => {
        clearTimeout(timer);
        video.removeEventListener("seeked", onSeeked);
        video.removeEventListener("error", onError);
      };

      const onSeeked = () => {
        cleanup();
        resolve();
      };

      const onError = () => {
        cleanup();
        reject(new Error("The browser could not decode this video frame."));
      };

      video.addEventListener("seeked", onSeeked, { once: true });
      video.addEventListener("error", onError, { once: true });
      video.currentTime = seconds;
    });
  }

  async function exportGif() {
  if (
    mediaType !== "video" ||
    !Number.isFinite(video.duration) ||
    video.duration <= 0
  ) {
    toast("Load a video first.");
    return;
  }

  const wasPlaying = !video.paused;
  const originalTime = video.currentTime;
  const duration = Math.min(video.duration, 10);
  const frames = [];
  const frameDelays = [];

  let gifWidth = 0;
  let gifHeight = 0;
  let previousMediaTime = null;

  gifBtn.disabled = true;
  playBtn.disabled = true;
  stopBtn.disabled = true;

  video.pause();
  stopLoop();

  try {
    status.textContent = "PREPARING GIF…";

    // Start from the beginning, without waiting for a seeked event.
    video.currentTime = 0;
    await video.play();

    // Prevent the normal ASCII preview loop from competing with export.
    stopLoop();

    status.textContent = "RECORDING ASCII FRAMES…";

    // Capture every presented video frame, using its media timestamp.
    const waitForPresentedFrame = () => new Promise(resolve => {
      if (typeof video.requestVideoFrameCallback === "function") {
        video.requestVideoFrameCallback((now, metadata) => resolve(metadata));
      } else {
        requestAnimationFrame(() => resolve({ mediaTime: video.currentTime }));
      }
    });

    while (!video.ended) {
      const metadata = await waitForPresentedFrame();
      const mediaTime = Number.isFinite(metadata.mediaTime)
        ? metadata.mediaTime
        : video.currentTime;

      if (mediaTime >= duration) break;
      if (previousMediaTime !== null && mediaTime <= previousMediaTime + 0.0001) continue;

      const frame = makeAsciiGifFrame();
      frames.push(frame.pixels);
      if (gifWidth === 0) {
        gifWidth = frame.width;
        gifHeight = frame.height;
      }
      if (previousMediaTime !== null) {
        frameDelays.push(Math.max(1, Math.round(mediaTime * 100) - Math.round(previousMediaTime * 100)));
      }
      previousMediaTime = mediaTime;
      status.textContent = `RECORDING ASCII FRAMES… ${mediaTime.toFixed(1)}s · ${frames.length} FRAMES`;
    }

    frameDelays.push(frameDelays.length ? frameDelays[frameDelays.length - 1] : 3);

    video.pause();
    stopLoop();

    if (frames.length < 2) {
      throw new Error(
        "Not enough frames were captured. Try another video."
      );
    }

    status.textContent = "ENCODING GIF…";

    const blob = encodeGif(
      frames,
      gifWidth,
      gifHeight,
      frameDelays
    );

    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");

    anchor.href = url;
    anchor.download = `${currentName}-ascii.gif`;

    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();

    setTimeout(() => URL.revokeObjectURL(url), 2000);

    status.textContent = "GIF EXPORTED";
    toast(
      `GIF exported! ${frames.length} frames captured.`
    );
  } catch (error) {
    console.error("GIF export error:", error);

    status.textContent = "GIF EXPORT FAILED";
    toast(error.message || "GIF export failed.");
  } finally {
    video.pause();
    stopLoop();

    // Restore the previous position without waiting for a seek event.
    try {
      video.currentTime = Math.min(
        originalTime,
        Math.max(0, video.duration - 0.05)
      );
    } catch {}

    gifBtn.disabled = false;
    playBtn.disabled = false;
    stopBtn.disabled = false;

    if (wasPlaying) {
      video.play().catch(() => {});
    } else {
      renderSource();
      updateTime();
    }
  }
}


  // Render one ASCII frame using reusable canvases. Grouping adjacent glyphs
  // into color runs avoids issuing one canvas text operation per character.
  function drawAsciiExportFrame(exportCanvas, exportCtx, sampleCanvas, sampleCtx) {
    const source = getSource();
    if (!source) throw new Error("The source video frame is not available.");

    const columns = 160;
    const rows = 54;
    const width = 960;
    const height = 540;

    if (sampleCanvas.width !== columns || sampleCanvas.height !== rows) {
      sampleCanvas.width = columns;
      sampleCanvas.height = rows;
    }
    if (exportCanvas.width !== width || exportCanvas.height !== height) {
      exportCanvas.width = width;
      exportCanvas.height = height;
    }

    sampleCtx.fillStyle = "#080809";
    sampleCtx.fillRect(0, 0, columns, rows);

    const scale = Math.min(columns / source.width, rows / source.height);
    const drawWidth = source.width * scale;
    const drawHeight = source.height * scale;
    sampleCtx.drawImage(
      source.element,
      (columns - drawWidth) / 2,
      (rows - drawHeight) / 2,
      drawWidth,
      drawHeight
    );

    const pixels = sampleCtx.getImageData(0, 0, columns, rows).data;
    const chars = charsetInput.value || " .:-=+*#%@";
    const contrast = Number(contrastInput.value) / 100;
    const invert = invertInput.checked;
    const useColor = colorInput.checked;

    exportCtx.fillStyle = "#080809";
    exportCtx.fillRect(0, 0, width, height);
    exportCtx.font = '10px "Courier New", monospace';
    exportCtx.textBaseline = "top";
    exportCtx.textAlign = "left";
    exportCtx.filter = "brightness(" + getGlyphBrightness() + ")";
    exportCtx.shadowBlur = getGlyphGlow();

    for (let y = 0; y < rows; y++) {
      const glyphs = new Array(columns);
      const colors = useColor ? new Uint16Array(columns) : null;

      for (let x = 0; x < columns; x++) {
        const i = (y * columns + x) * 4;
        const r = pixels[i];
        const g = pixels[i + 1];
        const b = pixels[i + 2];
        const alpha = pixels[i + 3] / 255;
        let luminance =
          (0.2126 * r + 0.7152 * g + 0.0722 * b) * alpha +
          255 * (1 - alpha);

        luminance = Math.max(
          0,
          Math.min(255, (luminance - 127.5) * contrast + 127.5)
        );
        if (invert) luminance = 255 - luminance;

        const index = Math.max(
          0,
          Math.min(chars.length - 1,
            Math.round(luminance / 255 * (chars.length - 1)))
        );
        glyphs[x] = chars[index] ?? " ";

        if (useColor) {
          colors[x] = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
        }
      }

      if (!useColor) {
        exportCtx.fillStyle = "#f2f2f3";
        exportCtx.shadowColor = "#f2f2f3";
        exportCtx.fillText(glyphs.join(""), 0, y * 10);
        continue;
      }

      let runStart = 0;
      let activeColor = colors[0];
      for (let x = 1; x <= columns; x++) {
        if (x < columns && colors[x] === activeColor) continue;

        const color = colorPalette[activeColor];
        exportCtx.fillStyle = color;
        exportCtx.shadowColor = color;
        exportCtx.fillText(glyphs.slice(runStart, x).join(""), runStart * 6, y * 10);

        if (x < columns) {
          runStart = x;
          activeColor = colors[x];
        }
      }
    }
  }

  function canvasToPngBlob(targetCanvas) {
    return new Promise((resolve, reject) => {
      targetCanvas.toBlob(blob => {
        if (blob) resolve(blob);
        else reject(new Error("Could not encode an ASCII frame."));
      }, "image/png");
    });
  }

  async function removeFfmpegFile(ffmpeg, path) {
    try {
      await ffmpeg.deleteFile(path);
    } catch {
      // The file may already have been removed or may not have been created.
    }
  }

  async function exportMp4() {
    if (
      mediaType !== "video" ||
      !Number.isFinite(video.duration) ||
      video.duration <= 0 ||
      !sourceFile
    ) {
      toast("Load a video first.");
      return;
    }

    const inputFile = sourceFile;
    const duration = video.duration;
    const originalTime = video.currentTime;
    const wasPlaying = !video.paused;
    const fps = 24;
    const framesPerSegment = fps * 5;
    const totalFrames = Math.max(1, Math.ceil(duration * fps));
    const extensionMatch = (inputFile.name || "").match(/\.([a-z0-9]{2,5})$/i);
    const extension = extensionMatch
      ? extensionMatch[1].toLowerCase()
      : ({
          "video/mp4": "mp4",
          "video/webm": "webm",
          "video/quicktime": "mov",
          "video/x-matroska": "mkv",
          "video/ogg": "ogv"
        }[inputFile.type] || "mp4");
    const sourcePath = "source-input." + extension;
    const temporaryFiles = [sourcePath];
    const segmentPaths = [];
    let ffmpeg = null;

    isMp4Exporting = true;
    mp4Btn.disabled = true;
    gifBtn.disabled = true;
    playBtn.disabled = true;
    stopBtn.disabled = true;
    seek.disabled = true;
    fileInput.disabled = true;
    [widthInput, brightnessInput, contrastInput, charsetInput, invertInput, colorInput].forEach(input => {
      input.disabled = true;
    });
    video.pause();
    stopLoop();

    try {
      status.textContent = "LOADING OFFLINE MP4 ENCODER…";
      toast("Preparing offline export. The original audio track will be preserved.");

      const version = "0.12.10";
      const base = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@" + version + "/dist/umd";
      const [{ FFmpeg }, { toBlobURL }] = await Promise.all([
        import("https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/dist/esm/index.js"),
        import("https://cdn.jsdelivr.net/npm/@ffmpeg/util@0.12.2/dist/esm/index.js")
      ]);

      ffmpeg = new FFmpeg();
      ffmpeg.on("log", ({ message }) => {
        if (message) console.debug("[MP4 encoder]", message);
      });
      await ffmpeg.load({
        coreURL: await toBlobURL(base + "/ffmpeg-core.js", "text/javascript"),
        wasmURL: await toBlobURL(base + "/ffmpeg-core.wasm", "application/wasm")
      });

      status.textContent = "READING SOURCE VIDEO…";
      const sourceBytes = new Uint8Array(await inputFile.arrayBuffer());
      await ffmpeg.writeFile(sourcePath, sourceBytes);

      const exportCanvas = document.createElement("canvas");
      const exportCtx = exportCanvas.getContext("2d");
      const sampleCanvas = document.createElement("canvas");
      const sampleCtx = sampleCanvas.getContext("2d", {
        willReadFrequently: true
      });

      if (!exportCtx || !sampleCtx) {
        throw new Error("This browser could not create the export canvases.");
      }

      if (video.readyState < 2) {
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            cleanup();
            reject(new Error("Timed out while decoding the source video."));
          }, 15000);
          const cleanup = () => {
            clearTimeout(timeout);
            video.removeEventListener("loadeddata", onLoaded);
            video.removeEventListener("error", onError);
          };
          const onLoaded = () => {
            cleanup();
            resolve();
          };
          const onError = () => {
            cleanup();
            reject(new Error("The browser could not decode the source video."));
          };
          video.addEventListener("loadeddata", onLoaded, { once: true });
          video.addEventListener("error", onError, { once: true });
        });
      }

      await seekVideoTo(0);

      for (
        let chunkStart = 0, segmentIndex = 0;
        chunkStart < totalFrames;
        chunkStart += framesPerSegment, segmentIndex++
      ) {
        const chunkEnd = Math.min(totalFrames, chunkStart + framesPerSegment);
        const chunkFiles = [];

        status.textContent =
          "PROCESSING ASCII FRAMES… " + (chunkStart + 1) + "-" +
          chunkEnd + " / " + totalFrames;

        for (let frameIndex = chunkStart; frameIndex < chunkEnd; frameIndex++) {
          const frameTime = Math.min(
            frameIndex / fps,
            Math.max(0, duration - 0.001)
          );
          await seekVideoTo(frameTime);
          drawAsciiExportFrame(exportCanvas, exportCtx, sampleCanvas, sampleCtx);

          const pngBlob = await canvasToPngBlob(exportCanvas);
          const frameName =
            "frame-" + String(frameIndex - chunkStart + 1).padStart(6, "0") + ".png";
          await ffmpeg.writeFile(
            frameName,
            new Uint8Array(await pngBlob.arrayBuffer())
          );
          chunkFiles.push(frameName);
          temporaryFiles.push(frameName);

          if ((frameIndex - chunkStart + 1) % 6 === 0) {
            await new Promise(resolve => setTimeout(resolve, 0));
          }
        }

        const segmentPath =
          "segment-" + String(segmentIndex).padStart(4, "0") + ".mp4";
        status.textContent = "ENCODING VIDEO SEGMENT " + (segmentIndex + 1) + "…";
        const encodeResult = await ffmpeg.exec([
          "-hide_banner", "-loglevel", "error",
          "-framerate", String(fps),
          "-start_number", "1",
          "-i", "frame-%06d.png",
          "-frames:v", String(chunkEnd - chunkStart),
          "-an",
          "-c:v", "libx264",
          "-preset", "ultrafast",
          "-crf", "20",
          "-threads", "2",
          "-pix_fmt", "yuv420p",
          segmentPath
        ]);

        if (encodeResult !== 0) {
          throw new Error("The offline video encoder could not encode a frame segment.");
        }

        segmentPaths.push(segmentPath);
        temporaryFiles.push(segmentPath);
        for (const frameName of chunkFiles) {
          await removeFfmpegFile(ffmpeg, frameName);
        }
      }

      let videoOnlyPath = segmentPaths[0];
      if (segmentPaths.length > 1) {
        const concatText = segmentPaths.map(path => "file '" + path + "'").join("\n");
        await ffmpeg.writeFile(
          "segments.txt",
          new TextEncoder().encode(concatText)
        );
        temporaryFiles.push("segments.txt");
        videoOnlyPath = "joined-video.mp4";
        temporaryFiles.push(videoOnlyPath);

        status.textContent = "JOINING VIDEO SEGMENTS…";
        const concatResult = await ffmpeg.exec([
          "-hide_banner", "-loglevel", "error",
          "-f", "concat", "-safe", "0",
          "-i", "segments.txt",
          "-c", "copy",
          "-an",
          videoOnlyPath
        ]);
        if (concatResult !== 0) {
          throw new Error("Could not join the encoded video segments.");
        }
      }

      status.textContent = "RESTORING ORIGINAL AUDIO…";
      const outputPath = "ascii-motion.mp4";
      temporaryFiles.push(outputPath);
      const durationArg = duration.toFixed(3);
      const muxArgs = [
        "-hide_banner", "-loglevel", "error",
        "-i", videoOnlyPath,
        "-i", sourcePath,
        "-map", "0:v:0",
        "-map", "1:a?",
        "-map_metadata", "1",
        "-c:v", "copy",
        "-c:a", "copy",
        "-t", durationArg,
        "-avoid_negative_ts", "make_zero",
        "-movflags", "+faststart",
        outputPath
      ];

      let muxResult = await ffmpeg.exec(muxArgs);
      if (muxResult !== 0) {
        // Some source audio codecs (for example Opus) cannot be stored in MP4.
        // Re-encode only audio in those cases; the video remains stream-copied.
        await removeFfmpegFile(ffmpeg, outputPath);
        const aacArgs = muxArgs.slice();
        const audioCodecIndex = aacArgs.indexOf("-c:a");
        aacArgs.splice(audioCodecIndex + 1, 1, "aac");
        aacArgs.splice(audioCodecIndex + 2, 0, "-b:a", "192k");
        muxResult = await ffmpeg.exec(aacArgs);
      }

      if (muxResult !== 0) {
        throw new Error("MP4 muxing failed. The source audio could not be added.");
      }

      status.textContent = "FINALIZING MP4…";
      const outputBytes = await ffmpeg.readFile(outputPath);
      const finalBlob = new Blob([outputBytes], { type: "video/mp4" });
      const url = URL.createObjectURL(finalBlob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = currentName + "-ascii.mp4";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);

      status.textContent = "MP4 EXPORTED";
      toast("ASCII MP4 exported with the source audio.");
    } catch (error) {
      console.error("MP4 export error:", error);
      status.textContent = "MP4 EXPORT FAILED";
      toast(error.message || "MP4 export failed.");
    } finally {
      if (ffmpeg) {
        for (const path of temporaryFiles) {
          await removeFfmpegFile(ffmpeg, path);
        }
        ffmpeg.terminate();
      }

      video.pause();
      stopLoop();
      const restoreTime = Math.min(
        originalTime,
        Math.max(0, video.duration - 0.05)
      );
      try {
        await seekVideoTo(restoreTime);
      } catch {
        video.currentTime = restoreTime;
      }

      isMp4Exporting = false;
      fileInput.disabled = false;
      [widthInput, brightnessInput, contrastInput, charsetInput, invertInput, colorInput].forEach(input => {
        input.disabled = false;
      });
      setControls(true, true);
      if (wasPlaying) {
        video.play().catch(() => {});
      } else {
        renderSource();
        updateTime();
      }
    }
  }

  function rerender() {
    renderSource();
  }

  fileInput.addEventListener("change", event => {
    loadFile(event.target.files[0]);
  });

  ["dragenter", "dragover"].forEach(type => {
    dropzone.addEventListener(type, event => {
      event.preventDefault();
      dropzone.classList.add("drag");
    });
  });

  ["dragleave", "drop"].forEach(type => {
    dropzone.addEventListener(type, event => {
      event.preventDefault();
      dropzone.classList.remove("drag");
    });
  });

  dropzone.addEventListener("drop", event => {
    loadFile(event.dataTransfer.files[0]);
  });

  stage.addEventListener("dragover", event => {
    event.preventDefault();
    stage.style.outline = "1px dashed var(--accent)";
  });

  stage.addEventListener("dragleave", () => {
    stage.style.outline = "";
  });

  stage.addEventListener("drop", event => {
    event.preventDefault();
    stage.style.outline = "";
    loadFile(event.dataTransfer.files[0]);
  });

  [widthInput, brightnessInput, contrastInput].forEach(input => {
    input.addEventListener("input", () => {
      $("widthValue").textContent = `${widthInput.value} cols`;
      $("brightnessValue").textContent = brightnessInput.value;
      $("contrastValue").textContent =
        `${(Number(contrastInput.value) / 100).toFixed(1)}×`;

      rerender();
    });
  });

  [charsetInput, invertInput, colorInput].forEach(input => {
    input.addEventListener("change", rerender);
  });

  autoplayInput.addEventListener("change", () => {
    if (autoplayInput.checked && mediaType === "video" && video.paused) {
      playBtn.click();
    }
  });

  playBtn.addEventListener("click", async () => {
    if (mediaType !== "video") return;

    if (video.paused || video.ended) {
      if (video.ended) video.currentTime = 0;

      try {
        await video.play();
        playBtn.textContent = "❚❚ Pause";
        startLoop();
      } catch {
        toast("Playback was blocked. Tap Play again.");
      }
    } else {
      video.pause();
      playBtn.textContent = "▶ Play";
      renderSource();
    }
  });

  stopBtn.addEventListener("click", () => {
    if (mediaType !== "video") return;

    video.pause();
    video.currentTime = 0;
    playBtn.textContent = "▶ Play";
    renderSource();
    updateTime();
  });

  seek.addEventListener("input", () => {
    if (mediaType !== "video" || !Number.isFinite(video.duration)) return;

    lastSeekUpdate = Date.now();
    video.currentTime = Number(seek.value) / 1000 * video.duration;

    renderSource();
    updateTime();
  });

  video.addEventListener("timeupdate", updateTime);

  video.addEventListener("ended", () => {
    playBtn.textContent = "▶ Play";
    renderSource();
    updateTime();
  });

  video.addEventListener("play", () => {
    playBtn.textContent = "❚❚ Pause";
    startLoop();
  });

  video.addEventListener("pause", () => {
    playBtn.textContent = "▶ Play";
    renderSource();
  });

  downloadBtn.addEventListener("click", () => saveText("ascii"));

  gifBtn.addEventListener("click", exportGif);
  mp4Btn.addEventListener("click", exportMp4);

  snapshotBtn.addEventListener("click", () => {
    const suffix = mediaType === "video"
      ? `frame-${Math.round(video.currentTime * 100) / 100}s`
      : "image";

    saveText(suffix);
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden && mediaType === "video" && !video.paused) {
      video.pause();
    }
  });

  window.addEventListener("beforeunload", () => {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  });
})();
