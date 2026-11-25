/*
 * Same-origin FFmpeg worker shim for GitHub Pages.
 *
 * FFmpeg's wrapper creates its worker from classWorkerURL. Keeping this file
 * on the app's origin avoids the browser's cross-origin Worker restriction.
 * The FFmpeg core itself is loaded from version-pinned CDN Blob URLs.
 */
const CORE_URL = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.js";

const FFMessageType = {
  LOAD: "LOAD",
  EXEC: "EXEC",
  WRITE_FILE: "WRITE_FILE",
  READ_FILE: "READ_FILE",
  DELETE_FILE: "DELETE_FILE",
  RENAME: "RENAME",
  CREATE_DIR: "CREATE_DIR",
  LIST_DIR: "LIST_DIR",
  DELETE_DIR: "DELETE_DIR",
  ERROR: "ERROR",
  DOWNLOAD: "DOWNLOAD",
  PROGRESS: "PROGRESS",
  LOG: "LOG",
  MOUNT: "MOUNT",
  UNMOUNT: "UNMOUNT"
};

const ERROR_UNKNOWN_MESSAGE_TYPE = new Error("unknown message type");
const ERROR_NOT_LOADED = new Error("ffmpeg is not loaded, call `await ffmpeg.load()` first");
const ERROR_IMPORT_FAILURE = new Error("failed to import ffmpeg-core.js");

let ffmpeg;

async function load({
  coreURL: requestedCoreURL,
  wasmURL: requestedWasmURL,
  workerURL: requestedWorkerURL
}) {
  const first = !ffmpeg;
  let coreURL = requestedCoreURL;

  try {
    if (!coreURL) coreURL = CORE_URL;
    importScripts(coreURL);
  } catch {
    if (!coreURL) coreURL = CORE_URL.replace("/umd/", "/esm/");
    const importedCore = await import(/* @vite-ignore */ coreURL);
    self.createFFmpegCore = importedCore.default;

    if (!self.createFFmpegCore) {
      throw ERROR_IMPORT_FAILURE;
    }
  }

  const wasmURL = requestedWasmURL || coreURL.replace(/\.js$/g, ".wasm");
  const workerURL = requestedWorkerURL || coreURL.replace(/\.js$/g, ".worker.js");

  ffmpeg = await self.createFFmpegCore({
    mainScriptUrlOrBlob: coreURL + "#" + btoa(JSON.stringify({ wasmURL, workerURL }))
  });

  ffmpeg.setLogger(data => {
    self.postMessage({ type: FFMessageType.LOG, data });
  });
  ffmpeg.setProgress(data => {
    self.postMessage({ type: FFMessageType.PROGRESS, data });
  });

  return first;
}

function exec({ args, timeout = -1 }) {
  ffmpeg.setTimeout(timeout);
  ffmpeg.exec(...args);
  const result = ffmpeg.ret;
  ffmpeg.reset();
  return result;
}

function writeFile({ path, data }) {
  ffmpeg.FS.writeFile(path, data);
  return true;
}

function readFile({ path, encoding }) {
  return ffmpeg.FS.readFile(path, { encoding });
}

function deleteFile({ path }) {
  ffmpeg.FS.unlink(path);
  return true;
}

function rename({ oldPath, newPath }) {
  ffmpeg.FS.rename(oldPath, newPath);
  return true;
}

function createDir({ path }) {
  ffmpeg.FS.mkdir(path);
  return true;
}

function listDir({ path }) {
  const names = ffmpeg.FS.readdir(path);
  return names.map(name => {
    const stat = ffmpeg.FS.stat(path + "/" + name);
    return { name, isDir: ffmpeg.FS.isDir(stat.mode) };
  });
}

function deleteDir({ path }) {
  ffmpeg.FS.rmdir(path);
  return true;
}

function mount({ fsType, options, mountPoint }) {
  const fileSystem = ffmpeg.FS.filesystems[fsType];
  if (!fileSystem) return false;
  ffmpeg.FS.mount(fileSystem, options, mountPoint);
  return true;
}

function unmount({ mountPoint }) {
  ffmpeg.FS.unmount(mountPoint);
  return true;
}

self.onmessage = async event => {
  const { id, type, data } = event.data;
  let result;
  const transfer = [];

  try {
    if (type !== FFMessageType.LOAD && !ffmpeg) {
      throw ERROR_NOT_LOADED;
    }

    switch (type) {
      case FFMessageType.LOAD:
        result = await load(data);
        break;
      case FFMessageType.EXEC:
        result = exec(data);
        break;
      case FFMessageType.WRITE_FILE:
        result = writeFile(data);
        break;
      case FFMessageType.READ_FILE:
        result = readFile(data);
        break;
      case FFMessageType.DELETE_FILE:
        result = deleteFile(data);
        break;
      case FFMessageType.RENAME:
        result = rename(data);
        break;
      case FFMessageType.CREATE_DIR:
        result = createDir(data);
        break;
      case FFMessageType.LIST_DIR:
        result = listDir(data);
        break;
      case FFMessageType.DELETE_DIR:
        result = deleteDir(data);
        break;
      case FFMessageType.MOUNT:
        result = mount(data);
        break;
      case FFMessageType.UNMOUNT:
        result = unmount(data);
        break;
      default:
        throw ERROR_UNKNOWN_MESSAGE_TYPE;
    }
  } catch (error) {
    self.postMessage({
      id,
      type: FFMessageType.ERROR,
      data: String(error)
    });
    return;
  }

  if (result instanceof Uint8Array) {
    transfer.push(result.buffer);
  }
  self.postMessage({ id, type, data: result }, transfer);
};
