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
    toast.timer = setTimeout(() => { el.style.display = "none"; }, 2600);
  }

  function fmt(seconds) {
    if (!Number.isFinite(seconds)) seconds = 0;
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  function updateTime() {
    timeLabel.textContent = `${fmt(video.currentTime)} / ${fmt(video.duration)}`;
    if (Number.isFinite(video.duration) && video.duration > 0 && Date.now() - lastSeekUpdate > 250) {
      seek.value = String(Math.round(video.currentTime / video.duration * 1000));
    }
  }

  function setControls(active, isVideo) {
    playBtn.disabled = !active || !isVideo;
    stopBtn.disabled = !active || !isVideo;
    seek.disabled = !active || !isVideo;
    downloadBtn.disabled = !active;
    snapshotBtn.disabled = !active;
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
    if (!file.type.startsWith("image/") && !file.type.startsWith("video/")) {
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
        status.textContent = `IMAGE READY · ${image.naturalWidth}×${image.naturalHeight}`;
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
      return { element: image, width: image.naturalWidth, height: image.naturalHeight };
    }
    if (mediaType === "video" && video.videoWidth && video.videoHeight) {
      return { element: video, width: video.videoWidth, height: video.videoHeight };
    }
    return null;
  }

  function renderSource() {
    if (isRendering) return;
    const source = getSource();
    if (!source) return;
    isRendering = true;

    try {
      const columns = Number(widthInput.value);
      const rows = Math.max(1, Math.round(columns * source.height / source.width * 0.48));
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
          let luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) * alpha + 255 * (1 - alpha);
          luminance = Math.max(0, Math.min(255, (luminance - 127.5) * contrast + 127.5 + brightness));
          if (invert) luminance = 255 - luminance;
          const charIndex = Math.max(0, Math.min(chars.length - 1, Math.round(luminance / 255 * (chars.length - 1))));
          const character = chars[charIndex] ?? " ";
          plainLine += character;

          if (useColor) {
            // Color the character using the original pixel's RGB value.
            lineParts.push(`<span style="color:rgb(${r},${g},${b})">${escapeHtml(character)}</span>`);
          } else {
            lineParts.push(escapeHtml(character));
          }
        }
        plainLines.push(plainLine);
        outputParts.push(lineParts.join(""));
      }

      lastText = plainLines.join("\n") + "\n";
      output.innerHTML = outputParts.join("\n");
      output.style.fontSize = `${Math.max(4, Math.min(9, 840 / columns))}px`;
      output.style.lineHeight = `${Math.max(4, Math.min(9, 840 / columns))}px`;
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

  function escapeHtml(value) {
    return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
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
    const blob = new Blob([lastText], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${currentName}-${suffix}.txt`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    toast("ASCII text exported.");
  }

  function rerender() {
    renderSource();
  }

  fileInput.addEventListener("change", event => loadFile(event.target.files[0]));
  ["dragenter", "dragover"].forEach(type => dropzone.addEventListener(type, event => {
    event.preventDefault();
    dropzone.classList.add("drag");
  }));
  ["dragleave", "drop"].forEach(type => dropzone.addEventListener(type, event => {
    event.preventDefault();
    dropzone.classList.remove("drag");
  }));
  dropzone.addEventListener("drop", event => loadFile(event.dataTransfer.files[0]));
  stage.addEventListener("dragover", event => {
    event.preventDefault();
    stage.style.outline = "1px dashed var(--accent)";
  });
  stage.addEventListener("dragleave", () => { stage.style.outline = ""; });
  stage.addEventListener("drop", event => {
    event.preventDefault();
    stage.style.outline = "";
    loadFile(event.dataTransfer.files[0]);
  });

  [widthInput, brightnessInput, contrastInput].forEach(input => input.addEventListener("input", () => {
    $("widthValue").textContent = `${widthInput.value} cols`;
    $("brightnessValue").textContent = brightnessInput.value;
    $("contrastValue").textContent = `${(Number(contrastInput.value) / 100).toFixed(1)}×`;
    rerender();
  }));
  [charsetInput, invertInput, colorInput].forEach(input => input.addEventListener("change", rerender));

  autoplayInput.addEventListener("change", () => {
    if (autoplayInput.checked && mediaType === "video" && video.paused) playBtn.click();
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
  snapshotBtn.addEventListener("click", () => {
    const suffix = mediaType === "video" ? `frame-${Math.round(video.currentTime * 100) / 100}s` : "image";
    saveText(suffix);
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden && mediaType === "video" && !video.paused) video.pause();
  });
  window.addEventListener("beforeunload", () => {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  });
})();
