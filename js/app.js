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
  const widthInput = $("width");
  const brightnessInput = $("brightness");
  const contrastInput = $("contrast");
  const charsetInput = $("charset");
  const invertInput = $("invert");
  const colorInput = $("color");
  const autoplayInput = $("autoplay");

  let objectUrl = null;
  let mediaType = null;
  let animationId = null;
  let lastFrameTime = 0;
  let lastText = "";
  let currentName = "ascii-frame";
  let isRendering = false;
  let lastSeekUpdate = 0;
  const frameInterval = 1000 / 18;

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

    if (!isVideo) {
      playBtn.textContent = "▶ Play";
      timeLabel.textContent = "IMAGE / STATIC";
    }
  }

  function stopLoop() {
    if (animationId !== null) cancelAnimationFrame(animationId);
    animationId = null;
  }

  function clearOldSource() {
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

    if (
      !file.type.startsWith("image/") &&
      !file.type.startsWith("video/")
    ) {
      toast("Please choose a valid image or video file.");
      return;
    }

    clearOldSource();

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

      canvas.width = columns;
      canvas.height = rows;
      ctx.drawImage(source.element, 0, 0, columns, rows);

      const pixels = ctx.getImageData(0, 0, columns, rows).data;
      const chars = charsetInput.value || " .:-=+*#%@";
      const brightness = Number(brightnessInput.value);
      const contrast = Number(contrastInput.value) / 100;
      const invert = invertInput.checked;
      const useColor = colorInput.checked;
      const outputParts = [];
      const plainLines = [];

      for (let y = 0; y < rows; y++) {
        const lineParts = [];
        let plainLine = "";

        for (let x = 0; x < columns; x++) {
          const index = (y * columns + x) * 4;
          const r = pixels[index];
          const g = pixels[index + 1];
          const b = pixels[index + 2];
          const alpha = pixels[index + 3] / 255;

          let luminance =
            (0.2126 * r + 0.7152 * g + 0.0722 * b) * alpha +
            255 * (1 - alpha);

          luminance = Math.max(
            0,
            Math.min(255, (luminance - 127.5) * contrast + 127.5 + brightness)
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
          plainLine += character;

          if (useColor) {
            lineParts.push(
              `<span style="color:rgb(${r},${g},${b})">${escapeHtml(character)}</span>`
            );
          } else {
            lineParts.push(escapeHtml(character));
          }
        }

        plainLines.push(plainLine);
        outputParts.push(lineParts.join(""));
      }

      lastText = plainLines.join("\n") + "\n";
      output.innerHTML = outputParts.join("\n");

      output.style.fontSize =
        `${Math.max(4, Math.min(9, 840 / columns))}px`;
      output.style.lineHeight =
        `${Math.max(4, Math.min(9, 840 / columns))}px`;
      output.style.whiteSpace = "pre";

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

    const tick = now => {
      animationId = requestAnimationFrame(tick);

      if (now - lastFrameTime < frameInterval) return;
      lastFrameTime = now;

      if (mediaType === "video" && !video.paused && !video.ended) {
        renderSource();
        updateTime();
      }
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

    const columns = Number(widthInput.value);
    const rows = Math.max(
      1,
      Math.round(columns * source.height / source.width * 0.48)
    );

    canvas.width = columns;
    canvas.height = rows;
    ctx.drawImage(source.element, 0, 0, columns, rows);

    const pixels = ctx.getImageData(0, 0, columns, rows).data;
    const chars = charsetInput.value || " .:-=+*#%@";
    const brightness = Number(brightnessInput.value);
    const contrast = Number(contrastInput.value) / 100;
    const invert = invertInput.checked;
    const useColor = colorInput.checked;

    const fontSize = Math.max(4, Math.min(6, 480 / columns));
    const outCanvas = document.createElement("canvas");

    outCanvas.width = Math.max(1, Math.round(columns * fontSize));
    outCanvas.height = Math.max(1, Math.round(rows * fontSize));

    const outCtx = outCanvas.getContext("2d", {
      willReadFrequently: true
    });

    outCtx.fillStyle = "#080809";
    outCtx.fillRect(0, 0, outCanvas.width, outCanvas.height);
    outCtx.font = `${fontSize}px "Courier New", monospace`;
    outCtx.textBaseline = "top";
    outCtx.textAlign = "left";

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
          Math.min(255, (luminance - 127.5) * contrast + 127.5 + brightness)
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

        outCtx.fillStyle = useColor
          ? `rgb(${r},${g},${b})`
          : "#f2f2f3";

        outCtx.fillText(character, x * fontSize, y * fontSize);
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
  function encodeGif(frames, width, height, delayCentiseconds) {
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

    for (const frame of frames) {
      // Graphic Control Extension.
      push(0x21, 0xF9, 0x04, 0x00);
      word(delayCentiseconds);
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
      return;
    }

    const wasPlaying = !video.paused;
    const originalTime = video.currentTime;
    const duration = Math.min(video.duration, 10);
    const fps = 8;
    const frameCount = Math.max(2, Math.ceil(duration * fps));
    const frames = [];

    gifBtn.disabled = true;
    playBtn.disabled = true;
    stopBtn.disabled = true;

    const priorStatus = status.textContent;

    video.pause();
    stopLoop();

    try {
      for (let i = 0; i < frameCount; i++) {
        const time = Math.min(
          Math.max(0, duration - 0.001),
          i / fps
        );

        await seekVideoTo(time);
        const frame = makeAsciiGifFrame();

        frames.push(frame.pixels);
        status.textContent = `BUILDING GIF · ${i + 1}/${frameCount}`;
      }

      const gifFontSize = Math.max(
        4,
        Math.min(6, 480 / Number(widthInput.value))
      );

      const width = Math.max(
        1,
        Math.round(Number(widthInput.value) * gifFontSize)
      );

      const height = Math.max(
        1,
        Math.round(
          Math.max(
            1,
            Number(widthInput.value) *
            video.videoHeight / video.videoWidth * 0.48
          ) * gifFontSize
        )
      );

      const blob = encodeGif(
        frames,
        width,
        height,
        Math.round(100 / fps)
      );

      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");

      anchor.href = url;
      anchor.download = `${currentName}-ascii.gif`;

      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();

      setTimeout(() => URL.revokeObjectURL(url), 1500);

      toast(
        video.duration > 10
          ? "GIF exported (first 10 seconds at 8 FPS)."
          : "Animated ASCII GIF exported."
      );

      status.textContent = "GIF EXPORTED";
    } catch (error) {
      console.error(error);
      toast(
        error.message ||
        "GIF export failed. Try a shorter video or lower character width."
      );
      status.textContent = "GIF EXPORT FAILED";
    } finally {
      try {
        await seekVideoTo(
          Math.min(originalTime, Math.max(0, video.duration - 0.001))
        );
      } catch {}

      if (wasPlaying) {
        try {
          await video.play();
        } catch {}
      } else {
        renderSource();
      }

      gifBtn.disabled = false;
      playBtn.disabled = false;
      stopBtn.disabled = false;

      if (
        status.textContent !== "GIF EXPORTED" &&
        status.textContent !== "GIF EXPORT FAILED"
      ) {
        status.textContent = priorStatus;
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