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

  // Export progress UI, created dynamically so it stays self-contained.
  const exportProgress = document.createElement("div");
  exportProgress.id = "mp4Progress";
  exportProgress.style.cssText = "display:none;padding:10px 14px;background:#101012;border-bottom:1px solid #303035;font:11px ui-monospace,monospace;";
  exportProgress.innerHTML = '<div style="display:flex;justify-content:space-between;gap:10px;margin-bottom:7px"><span id="mp4ProgressLabel">MP4 EXPORT</span><span id="mp4ProgressPercent">0%</span></div><div style="height:7px;background:#303035;border-radius:5px;overflow:hidden"><div id="mp4ProgressFill" style="height:100%;width:0%;background:#ff304f;transition:width .18s"></div></div>';
  const heading = document.querySelector(".panel-heading");
  if (heading) heading.insertAdjacentElement("afterend", exportProgress);
  function updateExportProgress(percent, label) {
    const clamped = Math.max(0, Math.min(100, percent));
    exportProgress.style.display = "block";
    $("mp4ProgressFill").style.width = clamped + "%";
    $("mp4ProgressPercent").textContent = Math.floor(clamped) + "%";
    if (label) $("mp4ProgressLabel").textContent = label;
  }
  function hideExportProgress() {
    exportProgress.style.display = "none";
  }

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

  function toast(message, duration = 2600) {
    const el = $("toast");
    el.textContent = message;
    el.style.display = "block";
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => {
      el.style.display = "none";
    }, duration);
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
      }, 15000);

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

  // Wait for normal playback to reach a timestamp. Unlike seekVideoTo(),
  // this lets the browser decode sequentially instead of repositioning the
  // decoder for every output frame.
  function waitForVideoTime(seconds) {
    return new Promise((resolve, reject) => {
      let animationId = null;
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error("Timed out while waiting for the next decoded video frame."));
      }, 30000);

      const cleanup = () => {
        clearTimeout(timer);
        if (animationId !== null) cancelAnimationFrame(animationId);
        video.removeEventListener("error", onError);
      };

      const finish = () => {
        cleanup();
        resolve();
      };

      const onError = () => {
        cleanup();
        reject(new Error("The browser could not decode the source video."));
      };

      const check = () => {
        if (video.error) {
          onError();
          return;
        }
        if (video.currentTime + 0.001 >= seconds) {
          finish();
          return;
        }
        if (video.ended) {
          finish();
          return;
        }
        animationId = requestAnimationFrame(check);
      };

      video.addEventListener("error", onError, { once: true });
      check();
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
  // Render one optimized ASCII frame. Export dimensions follow the selected
  // character width and source aspect ratio instead of a fixed 160x54 grid.
  function drawAsciiExportFrame(
    exportCanvas, exportCtx, sampleCanvas, sampleCtx, columns, rows
  ) {
    const source = getSource();
    if (!source) throw new Error("The source video frame is not available.");

    const width = columns * 6;
    const height = rows * 10;

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

  async function removeFfmpegFile(ffmpeg, path) {
    try {
      await ffmpeg.deleteFile(path);
    } catch {
      // The file may already have been removed or may not have been created.
    }
  }

  async function exportMp4Legacy() {
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
    const originalMuted = video.muted;
    const wasPlaying = !video.paused;
    // Lower frame density and honor the UI width control for a much lighter
    // export workload. The original source audio is still muxed unchanged.
    const fps = 12;
    const sourceWidth = video.videoWidth || 16;
    const sourceHeight = video.videoHeight || 9;
    const columns = Math.max(40, Math.min(120, Number(widthInput.value) || 120));
    const rows = Math.max(1, Math.round(columns * 0.6 * sourceHeight / sourceWidth));
    const exportWidth = columns * 6;
    const exportHeight = rows * 10;
    const bytesPerFrame = exportWidth * exportHeight * 4;
    // Keep each raw-frame batch bounded to avoid large transient allocations
    // on mobile browsers and smaller devices.
    const maxSegmentBytes = 48 * 1024 * 1024;
    const framesPerSegment = Math.max(
      1,
      Math.min(fps * 5, Math.floor(maxSegmentBytes / bytesPerFrame))
    );
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
    video.muted = true; // Keep sequential frame sampling silent; source audio is muxed from the original file.
    stopLoop();

    try {
      updateExportProgress(1, "LOADING ENCODER");
      status.textContent = "LOADING OFFLINE MP4 ENCODER…";
      toast("Fast export: 12 FPS, up to 120 columns. Original audio will be preserved.", 5000);

      const version = "0.12.10";
      // FFmpeg's main package 0.12.10 is paired with core 0.12.6.
      const coreVersion = "0.12.6";
      // The local worker runs as an ES module, so it must dynamically import
      // the ESM core build rather than the UMD script.
      const base = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@" + coreVersion + "/dist/esm";
      const [{ FFmpeg }, { toBlobURL }] = await Promise.all([
        import("https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/dist/esm/index.js"),
        import("https://cdn.jsdelivr.net/npm/@ffmpeg/util@0.12.2/dist/esm/index.js")
      ]);

      ffmpeg = new FFmpeg();
      ffmpeg.on("log", ({ message }) => {
        if (message) console.debug("[MP4 encoder]", message);
      });
      await ffmpeg.load({
        // Workers must be same-origin on GitHub Pages.
        classWorkerURL: new URL("js/ffmpeg-worker.js?v=20261125-esm-core-fix", window.location.href).href,
        coreURL: await toBlobURL(base + "/ffmpeg-core.js", "text/javascript"),
        wasmURL: await toBlobURL(base + "/ffmpeg-core.wasm", "application/wasm")
      });

      updateExportProgress(5, "READING SOURCE");
      status.textContent = "READING SOURCE VIDEO…";
      const sourceBytes = new Uint8Array(await inputFile.arrayBuffer());
      await ffmpeg.writeFile(sourcePath, sourceBytes);

      const exportCanvas = document.createElement("canvas");
      const exportCtx = exportCanvas.getContext("2d", { willReadFrequently: true });
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
        const framesInChunk = chunkEnd - chunkStart;
        const rawPath =
          "raw-segment-" + String(segmentIndex).padStart(4, "0") + ".rgba";
        temporaryFiles.push(rawPath);
        const rawFrames = new Uint8Array(framesInChunk * bytesPerFrame);

        status.textContent =
          "RENDERING ASCII FRAMES… " + (chunkStart + 1) + "-" +
          chunkEnd + " / " + totalFrames + " · " + fps + " FPS";

        // Sequential playback avoids costly decoder seeks. Instead of encoding
        // every frame to PNG and making a worker call per frame, collect raw
        // RGBA pixels into one bounded buffer and write it once per segment.
        await video.play();

        for (let frameIndex = chunkStart; frameIndex < chunkEnd; frameIndex++) {
          const frameTime = Math.min(
            frameIndex / fps,
            Math.max(0, duration - 0.001)
          );
          await waitForVideoTime(frameTime);
          drawAsciiExportFrame(
            exportCanvas, exportCtx, sampleCanvas, sampleCtx, columns, rows
          );

          const framePixels = exportCtx.getImageData(
            0, 0, exportWidth, exportHeight
          ).data;
          rawFrames.set(framePixels, (frameIndex - chunkStart) * bytesPerFrame);

          if ((frameIndex - chunkStart + 1) % fps === 0) {
            const frameProgress = (frameIndex + 1) / totalFrames;
            updateExportProgress(
              8 + 72 * frameProgress,
              "RENDERING FRAMES · " + Math.floor(frameProgress * 100) + "%"
            );
            status.textContent = "RENDERING ASCII FRAMES… " +
              (frameIndex + 1) + " / " + totalFrames;
          }
        }

        video.pause();
        updateExportProgress(80 + 5 * (segmentIndex + 1) / Math.max(1, Math.ceil(totalFrames / framesPerSegment)), "TRANSFERRING FRAME BATCH");
        status.textContent = "TRANSFERRING FRAME BATCH…";
        await ffmpeg.writeFile(rawPath, rawFrames);

        const segmentPath =
          "segment-" + String(segmentIndex).padStart(4, "0") + ".mp4";
        updateExportProgress(80 + 5 * (segmentIndex + 1) / Math.max(1, Math.ceil(totalFrames / framesPerSegment)), "ENCODING SEGMENT " + (segmentIndex + 1));
        status.textContent = "ENCODING VIDEO SEGMENT " + (segmentIndex + 1) + "…";
        const encodeResult = await ffmpeg.exec([
          "-hide_banner", "-loglevel", "error",
          "-f", "rawvideo",
          "-pixel_format", "rgba",
          "-video_size", exportWidth + "x" + exportHeight,
          "-framerate", String(fps),
          "-i", rawPath,
          "-frames:v", String(framesInChunk),
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
        await removeFfmpegFile(ffmpeg, rawPath);
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

        updateExportProgress(87, "JOINING SEGMENTS");
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

      updateExportProgress(92, "MUXING AUDIO");
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

      updateExportProgress(98, "FINALIZING FILE");
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

      updateExportProgress(100, "EXPORT COMPLETE");
      status.textContent = "MP4 EXPORTED";
      toast("ASCII MP4 exported with the source audio.");
    } catch (error) {
      console.error("MP4 export error:", error);
      // FFmpeg's worker can reject with a plain string, not an Error object.
      const errorMessage =
        typeof error === "string"
          ? error
          : (error && error.message) || String(error || "Unknown error");
      updateExportProgress(0, "EXPORT FAILED");
      status.textContent = "MP4 FAILED: " + errorMessage.slice(0, 100);
      toast("MP4 export failed: " + errorMessage, 8000);
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

      video.muted = originalMuted;
      isMp4Exporting = false;
      setTimeout(hideExportProgress, 4500);
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


  function* exportFrameTimestamps(startTime, totalFrames, fps) {
    for (let index = 0; index < totalFrames; index++) {
      yield startTime + index / fps;
    }
  }

  function trimExportAudioBuffer(buffer, startFrame, endFrame) {
    if (startFrame <= 0 && endFrame >= buffer.length) return buffer;
    const length = Math.max(0, endFrame - startFrame);
    if (!length) return null;
    const trimmed = new AudioBuffer({
      length,
      numberOfChannels: buffer.numberOfChannels,
      sampleRate: buffer.sampleRate
    });
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
      trimmed.copyToChannel(
        buffer.getChannelData(channel).subarray(startFrame, endFrame),
        channel
      );
    }
    return trimmed;
  }

  async function exportMp4Fast() {
    if (
      mediaType !== "video" ||
      !Number.isFinite(video.duration) ||
      video.duration <= 0 ||
      !sourceFile
    ) {
      toast("Load a video first.");
      return;
    }
    if (typeof VideoEncoder === "undefined") {
      const error = new Error("This browser does not expose the WebCodecs video encoder.");
      error.useCompatibilityExporter = true;
      throw error;
    }

    const inputFile = sourceFile;
    const duration = video.duration;
    const originalMuted = video.muted;
    const wasPlaying = !video.paused;
    let input = null;
    let output = null;
    let renderer = null;
    let videoSource = null;
    let audioSource = null;
    let audioError = null;

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
      updateExportProgress(2, "LOADING NATIVE MEDIA PIPELINE");
      status.textContent = "LOADING FAST MP4 EXPORTER…";

      const [media, rendererModule] = await Promise.all([
        import("https://esm.sh/mediabunny@1.66.4"),
        import("./gpu-ascii-export.js?v=20261125-gpu-export1")
      ]);
      const {
        Input,
        BlobSource,
        ALL_FORMATS,
        VideoSampleSink,
        AudioBufferSink,
        AudioBufferSource,
        CanvasSource,
        Output,
        Mp4OutputFormat,
        BufferTarget
      } = media;
      const { GPUAsciiRenderer } = rendererModule;

      updateExportProgress(6, "READING VIDEO TRACK");
      input = new Input({
        source: new BlobSource(inputFile),
        formats: ALL_FORMATS
      });
      if (!(await input.canRead())) {
        throw new Error("The native media reader could not recognize this video format.");
      }

      const videoTrack = await input.getPrimaryVideoTrack();
      if (!videoTrack) throw new Error("No video track was found in the selected file.");

      const firstTimestamp = await videoTrack.getFirstTimestamp();
      const sourceWidth = await videoTrack.getDisplayWidth();
      const sourceHeight = await videoTrack.getDisplayHeight();
      const startTime = Number.isFinite(firstTimestamp) ? firstTimestamp : 0;
      const columns = Math.max(40, Math.min(120, Number(widthInput.value) || 120));
      const rows = Math.max(1, Math.round(columns * 0.6 * sourceHeight / sourceWidth));

      // Keep the encoded canvas at the source's exact display aspect ratio.
      // H.264 4:2:0 requires even dimensions, so scale the reduced ratio by
      // the smallest factor that is large enough and makes both sides even.
      const aspectW = Math.max(1, Math.round(sourceWidth));
      const aspectH = Math.max(1, Math.round(sourceHeight));
      const gcd = (a, b) => {
        while (b) [a, b] = [b, a % b];
        return a;
      };
      const aspectDivisor = gcd(aspectW, aspectH);
      const ratioWidth = aspectW / aspectDivisor;
      const ratioHeight = aspectH / aspectDivisor;
      let aspectScale = Math.max(1, Math.ceil(columns * 6 / ratioWidth));
      while ((ratioWidth * aspectScale) % 2 || (ratioHeight * aspectScale) % 2) {
        aspectScale++;
      }
      const outputWidth = ratioWidth * aspectScale;
      const outputHeight = ratioHeight * aspectScale;
      const fps = 12;
      const totalFrames = Math.max(1, Math.ceil(duration * fps));
      const frameDuration = 1 / fps;

      updateExportProgress(9, "INITIALIZING GPU RENDERER");
      renderer = new GPUAsciiRenderer({
        columns,
        rows,
        outputWidth,
        outputHeight,
        charset: charsetInput.value || " .:-=+*#%@",
        contrast: Number(contrastInput.value) / 100,
        brightness: getGlyphBrightness(),
        invert: invertInput.checked,
        useColor: colorInput.checked
      });

      const target = new BufferTarget();
      output = new Output({
        format: new Mp4OutputFormat(),
        target
      });
      videoSource = new CanvasSource(renderer.canvas, {
        codec: "avc",
        bitrate: 2000000,
        keyFrameInterval: 2,
        latencyMode: "quality"
      });
      output.addVideoTrack(videoSource);

      let audioTrack = null;
      try {
        audioTrack = await input.getPrimaryAudioTrack();
      } catch {
        audioTrack = null;
      }

      let audioSink = null;
      let audioStartTime = startTime;
      if (audioTrack) {
        try {
          const trackAudioStart = await audioTrack.getFirstTimestamp();
          if (Number.isFinite(trackAudioStart)) {
            audioStartTime = Math.max(startTime, trackAudioStart);
          }
          audioSink = new AudioBufferSink(audioTrack);
          audioSource = new AudioBufferSource(
            { codec: "aac", bitrate: 160000 },
            { startTimestamp: Math.max(0, audioStartTime - startTime) }
          );
          output.addAudioTrack(audioSource);
        } catch (error) {
          throw new Error("Could not prepare the source audio for MP4: " + (error.message || error));
        }
      }

      await output.start();
      updateExportProgress(12, "DECODING AND RENDERING FRAMES");
      status.textContent = "DECODING VIDEO · GPU ASCII RENDER…";

      let audioWork = Promise.resolve();
      if (audioTrack && audioSink && audioSource) {
        audioWork = (async () => {
          const audioEndTime = startTime + duration;
          for await (const wrapped of audioSink.buffers(audioStartTime, audioEndTime)) {
            const buffer = wrapped.buffer;
            const sampleRate = buffer.sampleRate;
            const startFrame = Math.max(
              0,
              Math.ceil((audioStartTime - wrapped.timestamp) * sampleRate)
            );
            const endFrame = Math.min(
              buffer.length,
              Math.floor((audioEndTime - wrapped.timestamp) * sampleRate)
            );
            const segment = trimExportAudioBuffer(buffer, startFrame, endFrame);
            if (segment) await audioSource.add(segment);
          }
          audioSource.close();
        })().catch(error => {
          audioError = error;
        });
      }

      const sampleSink = new VideoSampleSink(videoTrack);
      let frameIndex = 0;
      let hasRenderedFrame = false;

      for await (const sample of sampleSink.samplesAtTimestamps(
        exportFrameTimestamps(startTime, totalFrames, fps)
      )) {
        if (sample) {
          try {
            renderer.renderSample(sample);
            hasRenderedFrame = true;
          } finally {
            sample.close();
          }
        }
        if (!hasRenderedFrame) {
          throw new Error("The video decoder did not provide the first frame.");
        }

        const timestamp = frameIndex / fps;
        const thisFrameDuration = Math.max(
          0.001,
          Math.min(frameDuration, duration - timestamp)
        );
        await videoSource.add(timestamp, thisFrameDuration, {
          keyFrame: frameIndex === 0 || frameIndex % (fps * 2) === 0
        });

        frameIndex++;
        if (frameIndex % 2 === 0 || frameIndex === totalFrames) {
          const frameProgress = frameIndex / totalFrames;
          updateExportProgress(
            12 + 76 * frameProgress,
            "GPU RENDER + NATIVE ENCODE · " + Math.floor(frameProgress * 100) + "%"
          );
          status.textContent =
            "RENDERING ASCII FRAMES… " + frameIndex + " / " + totalFrames;
        }
      }

      if (frameIndex === 0) throw new Error("No video frames were decoded.");
      videoSource.close();
      await audioWork;
      if (audioError) {
        throw new Error("Source audio encoding failed: " + (audioError.message || audioError));
      }
      if (audioSource) audioSource.close();

      updateExportProgress(92, "FINALIZING MP4");
      status.textContent = "FINALIZING NATIVE MP4…";
      await output.finalize();

      if (!target.buffer) throw new Error("The MP4 encoder returned an empty file.");
      const blob = new Blob([target.buffer], { type: "video/mp4" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = currentName + "-ascii.mp4";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 15000);

      updateExportProgress(100, "EXPORT COMPLETE");
      status.textContent = "MP4 EXPORTED";
      toast("GPU + native MP4 export complete. Source audio preserved.");
    } finally {
      if (output && output.state !== "finalized" && output.state !== "canceled") {
        try {
          await output.cancel();
        } catch {}
      }
      if (renderer) renderer.destroy();
      if (input) {
        try {
          input.dispose();
        } catch {}
      }

      video.pause();
      stopLoop();
      video.muted = originalMuted;
      isMp4Exporting = false;
      setTimeout(hideExportProgress, 4500);
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

  async function exportMp4() {
    try {
      await exportMp4Fast();
    } catch (error) {
      console.warn("Fast MP4 export unavailable; switching to compatibility exporter.", error);
      const message = error && error.message ? error.message : String(error || "Unknown error");
      toast("Fast exporter unavailable for this browser or file. Switching to compatibility mode.", 6500);
      updateExportProgress(0, "SWITCHING TO COMPATIBILITY EXPORT");
      status.textContent = "SWITCHING TO COMPATIBILITY MP4 EXPORT…";
      await exportMp4Legacy();
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
