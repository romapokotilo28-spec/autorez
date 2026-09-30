const IMAGE_EXT = ["jpg", "jpeg", "png", "webp", "gif", "bmp", "heic", "avif"];
const VIDEO_EXT = ["mp4", "mov", "webm", "mkv", "avi", "m4v", "mpeg", "mpg"];
const MIME = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  mp4: "video/mp4",
  webm: "video/webm",
  gif: "image/gif",
};
const MAX_CANVAS = 8192;

const drop = document.getElementById("drop");
const work = document.getElementById("work");
const sheet = document.getElementById("sheet");
const rail = document.getElementById("rail");
const preview = document.getElementById("preview");
const fileInput = document.getElementById("file");
const alertBox = document.getElementById("alert");
const fileName = document.getElementById("file-name");
const fileMeta = document.getElementById("file-meta");
const imageFormats = document.getElementById("image-formats");
const videoFormats = document.getElementById("video-formats");
const qualityField = document.getElementById("quality-field");
const qualityInput = document.getElementById("quality");
const qualityValue = document.getElementById("quality-value");
const maxEdgeInput = document.getElementById("max-edge");
const hint = document.getElementById("hint");
const progress = document.getElementById("progress");
const progressBar = document.getElementById("progress-bar");
const progressLabel = document.getElementById("progress-label");
const resultBox = document.getElementById("result");
const resultSize = document.getElementById("result-size");
const viewSwitch = document.getElementById("view-switch");

const state = {
  items: [],
  activeId: null,
  imageFormat: "webp",
  videoFormat: "mp4",
  quality: 0.85,
  maxEdge: 0,
  view: "source",
  busy: false,
};

function active() {
  return state.items.find((item) => item.id === state.activeId) || null;
}

function kindOf(file) {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  const ext = extOf(file.name);
  if (IMAGE_EXT.includes(ext)) return "image";
  if (VIDEO_EXT.includes(ext)) return "video";
  return null;
}

function extOf(name) {
  const ext = (name.split(".").pop() || "").toLowerCase();
  return ext.replace(/[^a-z0-9]/g, "");
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} Б`;
  const units = ["КБ", "МБ", "ГБ"];
  let value = bytes / 1024;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) return "";
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

function outputName(file, ext) {
  const base = file.name.replace(/\.[^.]+$/, "") || "файл";
  return `${base}.${ext}`;
}

function showAlert(message) {
  alertBox.hidden = !message;
  alertBox.textContent = message || "";
}

function setProgress(visible, value, label, indeterminate) {
  progress.hidden = !visible;
  progress.classList.toggle("is-indeterminate", Boolean(indeterminate));
  progressLabel.textContent = label || "";
  if (!indeterminate) {
    const clamped = Math.max(0, Math.min(1, value || 0));
    progressBar.style.width = `${Math.round(clamped * 100)}%`;
  }
}

function fit(width, height, maxEdge) {
  const limit = Math.min(maxEdge > 0 ? maxEdge : MAX_CANVAS, MAX_CANVAS);
  const longest = Math.max(width, height);
  if (longest <= limit) return [width, height];
  const scale = limit / longest;
  return [Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale))];
}

function videoMeta(url) {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.className = "capture-video";
    video.preload = "auto";
    video.muted = true;
    video.playsInline = true;
    document.body.append(video);
    const timer = setTimeout(() => finish(new Error("timeout")), 8000);
    const finish = (error, meta) => {
      clearTimeout(timer);
      video.onloadedmetadata = null;
      video.onerror = null;
      video.removeAttribute("src");
      video.load();
      video.remove();
      if (error) reject(error);
      else resolve(meta);
    };
    video.onloadedmetadata = () => {
      const meta = {
        width: video.videoWidth,
        height: video.videoHeight,
        duration: video.duration,
      };
      if (!meta.width || !meta.height) finish(new Error("empty"));
      else finish(null, meta);
    };
    video.onerror = () => finish(new Error("bad video"));
    video.src = url;
  });
}

async function addFiles(fileList) {
  const skipped = [];
  for (const file of fileList) {
    const kind = kindOf(file);
    if (!kind) {
      skipped.push(file.name);
      continue;
    }
    const item = {
      id: crypto.randomUUID(),
      file,
      kind,
      url: URL.createObjectURL(file),
      status: "idle",
      result: null,
      error: "",
      meta: {},
    };
    try {
      if (kind === "image") {
        const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
        item.meta = { width: bitmap.width, height: bitmap.height };
        bitmap.close();
      } else {
        item.meta = await videoMeta(item.url);
      }
    } catch {
      URL.revokeObjectURL(item.url);
      skipped.push(file.name);
      continue;
    }
    state.items.push(item);
    state.activeId = item.id;
  }
  state.view = "source";
  showAlert(skipped.length ? `Не открылись: ${skipped.join(", ")}` : "");
  render();
}

function release(item) {
  URL.revokeObjectURL(item.url);
  if (item.result) URL.revokeObjectURL(item.result.url);
}

function removeActive() {
  if (state.busy) return;
  const item = active();
  if (!item) return;
  release(item);
  state.items = state.items.filter((entry) => entry.id !== item.id);
  state.activeId = state.items.at(-1)?.id || null;
  state.view = "source";
  showAlert("");
  render();
}

function clearAll() {
  if (state.busy) return;
  state.items.forEach(release);
  state.items = [];
  state.activeId = null;
  state.view = "source";
  showAlert("");
  render();
}

async function convertImage(item) {
  const bitmap = await createImageBitmap(item.file, { imageOrientation: "from-image" });
  try {
    const [width, height] = fit(bitmap.width, bitmap.height, state.maxEdge);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (state.imageFormat === "jpg") {
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, width, height);
    }
    context.drawImage(bitmap, 0, 0, width, height);
    const mime = MIME[state.imageFormat];
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, mime, state.quality));
    if (!blob || (state.imageFormat === "webp" && blob.type !== "image/webp")) {
      throw new Error("Этот браузер не умеет сохранять выбранный формат.");
    }
    return blob;
  } finally {
    bitmap.close();
  }
}

function evenSize(width, height, maxEdge) {
  const cap = maxEdge > 0 ? maxEdge : 1920;
  let [w, h] = fit(width, height, cap);
  w = Math.max(2, w - (w % 2));
  h = Math.max(2, h - (h % 2));
  return [w, h];
}

function once(target, event) {
  return new Promise((resolve, reject) => {
    const fail = () => reject(new Error("Не удалось прочитать видео"));
    target.addEventListener(event, () => resolve(), { once: true });
    target.addEventListener("error", fail, { once: true });
  });
}

async function mountVideo(url) {
  const video = document.createElement("video");
  video.className = "capture-video";
  video.playsInline = true;
  video.preload = "auto";
  document.body.append(video);
  const loaded = once(video, "loadeddata");
  video.src = url;
  if (video.readyState < 2) await loaded;
  return video;
}

function seekTo(video, time) {
  if (Math.abs(video.currentTime - time) < 0.04 && video.readyState >= 2) return Promise.resolve();
  const pending = once(video, "seeked");
  video.currentTime = time;
  return pending;
}

async function readAudio(file, format) {
  if (typeof AudioEncoder === "undefined") return null;
  let buffer;
  try {
    const context = new AudioContext();
    buffer = await context.decodeAudioData(await file.arrayBuffer());
    await context.close();
  } catch {
    return null;
  }
  const channels = Math.min(2, buffer.numberOfChannels);
  const codec = format === "mp4" ? "mp4a.40.2" : "opus";
  const supported = await AudioEncoder.isConfigSupported({
    codec,
    sampleRate: buffer.sampleRate,
    numberOfChannels: channels,
    bitrate: 128000,
  });
  if (!supported.supported) return null;
  return { buffer, channels, codec };
}

async function collectAudio(audio) {
  const chunks = [];
  let failed = null;
  const encoder = new AudioEncoder({
    output: (chunk, meta) => chunks.push([chunk, meta]),
    error: (error) => { failed = error; },
  });
  encoder.configure({
    codec: audio.codec,
    sampleRate: audio.buffer.sampleRate,
    numberOfChannels: audio.channels,
    bitrate: 128000,
  });
  const frameSize = 1024;
  const channelData = [];
  for (let channel = 0; channel < audio.channels; channel += 1) {
    channelData.push(audio.buffer.getChannelData(channel));
  }
  for (let offset = 0; offset < audio.buffer.length; offset += frameSize) {
    const count = Math.min(frameSize, audio.buffer.length - offset);
    const planar = new Float32Array(count * audio.channels);
    for (let channel = 0; channel < audio.channels; channel += 1) {
      planar.set(channelData[channel].subarray(offset, offset + count), channel * count);
    }
    const data = new AudioData({
      format: "f32-planar",
      sampleRate: audio.buffer.sampleRate,
      numberOfFrames: count,
      numberOfChannels: audio.channels,
      timestamp: Math.round((offset / audio.buffer.sampleRate) * 1e6),
      data: planar,
    });
    encoder.encode(data);
    data.close();
    if (failed) throw failed;
  }
  await encoder.flush();
  if (failed) throw failed;
  return chunks;
}

async function videoEncoderConfig(format, width, height, bitrate) {
  const candidates = format === "mp4"
    ? ["avc1.42001f", "avc1.4d001f", "avc1.640028", "avc1.640033"]
    : ["vp09.00.10.08", "vp8"];
  for (const codec of candidates) {
    const config = { codec, width, height, bitrate };
    if (codec.startsWith("avc1")) config.avc = { format: "avc" };
    const supported = await VideoEncoder.isConfigSupported(config);
    if (supported.supported) return config;
  }
  throw new Error("Этот размер видео браузер не может записать. Уменьшите длинную сторону.");
}

function isAnnexB(data) {
  return data.length > 3 && data[0] === 0 && data[1] === 0 && (data[2] === 1 || data[3] === 1);
}

function splitAnnexB(data) {
  const starts = [];
  for (let index = 0; index < data.length - 3; index += 1) {
    const four = data[index] === 0 && data[index + 1] === 0 && data[index + 2] === 0 && data[index + 3] === 1;
    const three = data[index] === 0 && data[index + 1] === 0 && data[index + 2] === 1;
    if (four || three) {
      starts.push(index + (four ? 4 : 3));
      index += four ? 3 : 2;
    }
  }
  return starts.map((start, index) => {
    let end = data.length;
    if (index + 1 < starts.length) {
      const next = starts[index + 1];
      end = data[next - 4] === 0 && data[next - 3] === 0 && data[next - 2] === 0 ? next - 4 : next - 3;
    }
    return data.subarray(start, end);
  }).filter((nal) => nal.length);
}

function splitAvcc(data) {
  const nals = [];
  let offset = 0;
  while (offset + 4 <= data.length) {
    const length = (data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3];
    offset += 4;
    if (length <= 0 || offset + length > data.length) break;
    nals.push(data.subarray(offset, offset + length));
    offset += length;
  }
  return nals;
}

function nalsToAvcc(nals) {
  const size = nals.reduce((sum, nal) => sum + 4 + nal.length, 0);
  const out = new Uint8Array(size);
  let offset = 0;
  for (const nal of nals) {
    out[offset] = (nal.length >>> 24) & 255;
    out[offset + 1] = (nal.length >>> 16) & 255;
    out[offset + 2] = (nal.length >>> 8) & 255;
    out[offset + 3] = nal.length & 255;
    out.set(nal, offset + 4);
    offset += 4 + nal.length;
  }
  return out;
}

function avcDecoderRecord(sps, pps) {
  const record = new Uint8Array(11 + sps.length + pps.length);
  record[0] = 1;
  record[1] = sps[1];
  record[2] = sps[2];
  record[3] = sps[3];
  record[4] = 0xff;
  record[5] = 0xe1;
  record[6] = sps.length >> 8;
  record[7] = sps.length & 255;
  record.set(sps, 8);
  const offset = 8 + sps.length;
  record[offset] = 1;
  record[offset + 1] = pps.length >> 8;
  record[offset + 2] = pps.length & 255;
  record.set(pps, offset + 3);
  return record;
}

async function convertRecorded(item) {
  if (typeof VideoEncoder !== "function") {
    throw new Error("Этот браузер не умеет перекодировать видео.");
  }
  const format = state.videoFormat;
  const video = await mountVideo(item.url);
  try {
    const [width, height] = evenSize(item.meta.width || video.videoWidth, item.meta.height || video.videoHeight, state.maxEdge);
    const bitrate = Math.round(width * height * (1.1 + state.quality * 2.4));
    const config = await videoEncoderConfig(format, width, height, bitrate);
    let audio = null;
    let audioChunks = [];
    try {
      audio = await readAudio(item.file, format);
      if (audio) audioChunks = await collectAudio(audio);
    } catch {
      audio = null;
      audioChunks = [];
    }
    const library = format === "mp4" ? await import("./mp4-muxer.js") : await import("./webm-muxer.js");
    const target = new library.ArrayBufferTarget();
    const options = {
      target,
      video: format === "mp4"
        ? { codec: "avc", width, height }
        : { codec: config.codec === "vp8" ? "V_VP8" : "V_VP9", width, height },
      firstTimestampBehavior: "offset",
    };
    if (format === "mp4") options.fastStart = "in-memory";
    if (audio) {
      options.audio = {
        codec: format === "mp4" ? "aac" : "A_OPUS",
        numberOfChannels: audio.channels,
        sampleRate: audio.buffer.sampleRate,
      };
    }
    const muxer = new library.Muxer(options);
    for (const [chunk, meta] of audioChunks) muxer.addAudioChunk(chunk, meta);
    let encoderError = null;
    let avcDescription = null;
    const waitingChunks = [];
    const writeMp4Chunk = (packet) => {
      muxer.addVideoChunkRaw(packet.data, packet.type, packet.timestamp, packet.duration, {
        decoderConfig: { codec: config.codec, description: avcDescription },
      });
    };
    const encoder = new VideoEncoder({
      output: (chunk, meta) => {
        if (format !== "mp4") {
          muxer.addVideoChunk(chunk, meta);
          return;
        }
        const bytes = new Uint8Array(chunk.byteLength);
        chunk.copyTo(bytes);
        const annex = isAnnexB(bytes);
        const nals = annex ? splitAnnexB(bytes) : splitAvcc(bytes);
        if (!avcDescription) {
          const sps = nals.find((nal) => (nal[0] & 31) === 7);
          const pps = nals.find((nal) => (nal[0] & 31) === 8);
          if (sps && pps) avcDescription = avcDecoderRecord(sps, pps);
          else if (meta?.decoderConfig?.description) avcDescription = new Uint8Array(meta.decoderConfig.description);
        }
        const packet = {
          data: annex ? nalsToAvcc(nals) : bytes,
          type: chunk.type,
          timestamp: chunk.timestamp,
          duration: chunk.duration ?? Math.round(1e6 / 30),
        };
        if (!avcDescription) {
          waitingChunks.push(packet);
          return;
        }
        for (const queued of waitingChunks) writeMp4Chunk(queued);
        waitingChunks.length = 0;
        writeMp4Chunk(packet);
      },
      error: (error) => { encoderError = error; },
    });
    encoder.configure(config);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: false });
    const frames = await new Promise((resolve, reject) => {
      let count = 0;
      let last = -1;
      const step = () => {
        if (encoderError) {
          reject(encoderError);
          return;
        }
        const time = video.currentTime;
        if (time - last >= 1 / 30 - 0.002) {
          last = time;
          context.drawImage(video, 0, 0, width, height);
          const frame = new VideoFrame(canvas, { timestamp: Math.round(time * 1e6) });
          encoder.encode(frame, { keyFrame: count % 60 === 0 });
          frame.close();
          count += 1;
        }
        const duration = video.duration || item.meta.duration || 0;
        if (duration) setProgress(true, Math.min(1, time / duration), "Конвертируем видео…", false);
        if (video.ended || (duration && time >= duration - 0.05)) {
          resolve(count);
          return;
        }
        if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(() => step());
        else requestAnimationFrame(step);
      };
      video.muted = true;
      video.play().then(() => {
        if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(() => step());
        else requestAnimationFrame(step);
      }).catch(reject);
    });
    if (!frames) throw new Error("Не удалось прочитать кадры видео.");
    await encoder.flush();
    if (encoderError) throw encoderError;
    if (waitingChunks.length) throw new Error("Браузер не отдал параметры видео.");
    muxer.finalize();
    const blob = new Blob([target.buffer], { type: format === "mp4" ? "video/mp4" : "video/webm" });
    if (!blob.size) throw new Error("Видео получилось пустым.");
    return blob;
  } finally {
    video.pause();
    video.removeAttribute("src");
    video.load();
    video.remove();
  }
}

async function convertGif(item) {
  const { GIFEncoder, quantize, applyPalette } = await import("./gifenc.js");
  const video = await mountVideo(item.url);
  video.muted = true;
  try {
    const edge = state.maxEdge > 0 ? Math.min(state.maxEdge, 720) : 480;
    const [width, height] = evenSize(item.meta.width || video.videoWidth, item.meta.height || video.videoHeight, edge);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    const duration = Math.min(10, video.duration || item.meta.duration || 1);
    const count = Math.max(1, Math.min(40, Math.round(duration * 8)));
    const gif = GIFEncoder();
    for (let index = 0; index < count; index += 1) {
      await seekTo(video, (duration * index) / count);
      context.drawImage(video, 0, 0, width, height);
      const pixels = context.getImageData(0, 0, width, height).data;
      const palette = quantize(pixels, 128);
      gif.writeFrame(applyPalette(pixels, palette), width, height, { palette, delay: Math.round(duration * 1000 / count) });
      setProgress(true, (index + 1) / count, "Собираем GIF…", false);
    }
    gif.finish();
    const bytes = gif.bytes();
    if (!bytes.length) throw new Error("GIF получился пустым.");
    return new Blob([bytes], { type: "image/gif" });
  } finally {
    video.removeAttribute("src");
    video.load();
    video.remove();
  }
}

async function convertVideo(item) {
  return state.videoFormat === "gif" ? convertGif(item) : convertRecorded(item);
}

async function convertItem(item) {
  item.status = "working";
  item.error = "";
  const blob = item.kind === "image" ? await convertImage(item) : await convertVideo(item);
  if (item.result) URL.revokeObjectURL(item.result.url);
  const ext = item.kind === "image" ? state.imageFormat : state.videoFormat;
  item.result = {
    blob,
    url: URL.createObjectURL(blob),
    name: outputName(item.file, ext),
    ext,
  };
  item.status = "done";
}

async function run(items) {
  if (state.busy || !items.length) return;
  state.busy = true;
  document.body.classList.add("is-busy");
  showAlert("");
  setProgress(true, 0, "Готовим…", true);
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    state.activeId = item.id;
    state.view = "source";
    render();
    const prefix = items.length > 1 ? `Файл ${index + 1} из ${items.length}. ` : "";
    setProgress(true, 0, `${prefix}Конвертируем…`, item.kind === "image");
    try {
      await convertItem(item);
    } catch (error) {
      item.status = "error";
      item.error = error instanceof Error ? error.message : "Ошибка конвертации";
    }
  }
  state.busy = false;
  document.body.classList.remove("is-busy");
  setProgress(false, 0, "");
  const current = active();
  state.view = current?.result ? "result" : "source";
  if (current?.error) showAlert(current.error);
  render();
}

function hintFor(item) {
  if (!item) return "";
  if (item.kind === "image" && item.file.type === "image/gif") {
    return "Анимация GIF станет одним кадром.";
  }
  if (item.kind === "image" && state.imageFormat === "jpg") {
    return "Прозрачные области в JPG станут белыми.";
  }
  if (item.kind === "image" && state.imageFormat === "png") {
    return "PNG сохраняется без потерь.";
  }
  if (item.kind === "video" && state.videoFormat === "gif") {
    return "GIF без звука, первые 10 секунд. Длинная сторона не больше 720 px.";
  }
  if (item.kind === "video") {
    const large = state.maxEdge === 0 && Math.max(item.meta.width || 0, item.meta.height || 0) > 1920;
    const sound = "Звук сохраняется, если браузер может его прочитать.";
    return large
      ? `Сторона больше 1920 px будет уменьшена. Запись идёт примерно столько же, сколько длится ролик. ${sound}`
      : `Запись идёт примерно столько же, сколько длится ролик. ${sound}`;
  }
  return "Файл остаётся на этом компьютере.";
}

function renderRail() {
  rail.replaceChildren();
  for (const item of state.items) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `thumb${item.id === state.activeId ? " is-active" : ""}${item.status === "error" ? " is-error" : ""}`;
    button.setAttribute("role", "listitem");
    button.setAttribute("aria-label", item.file.name);
    if (item.kind === "image") {
      const image = document.createElement("img");
      image.alt = "";
      image.src = item.url;
      button.append(image);
    } else {
      const video = document.createElement("video");
      video.muted = true;
      video.preload = "metadata";
      video.src = `${item.url}#t=0.1`;
      button.append(video);
    }
    const badge = document.createElement("span");
    badge.className = "thumb-badge";
    badge.textContent = item.status === "done" ? "готово" : item.status === "error" ? "ошибка" : item.kind === "image" ? "фото" : "видео";
    button.append(badge);
    button.addEventListener("click", () => {
      if (state.busy) return;
      state.activeId = item.id;
      state.view = "source";
      showAlert(item.error || "");
      render();
    });
    rail.append(button);
  }
}

function renderPreview() {
  const item = active();
  preview.replaceChildren();
  if (!item) return;
  const showResult = state.view === "result" && item.result;
  const url = showResult ? item.result.url : item.url;
  const ext = showResult ? item.result.ext : "";
  const asImage = showResult ? ext === "gif" || item.kind === "image" : item.kind === "image";
  if (asImage) {
    const image = document.createElement("img");
    image.alt = item.file.name;
    image.src = url;
    preview.append(image);
  } else {
    const video = document.createElement("video");
    video.controls = true;
    video.playsInline = true;
    video.preload = "auto";
    video.src = url;
    video.addEventListener("loadeddata", () => {
      if (video.currentTime < 0.05) video.currentTime = 0.1;
    }, { once: true });
    preview.append(video);
  }
  const hasResult = Boolean(item.result);
  viewSwitch.hidden = !hasResult;
  for (const button of viewSwitch.querySelectorAll("[data-view]")) {
    button.setAttribute("aria-pressed", String(button.dataset.view === (hasResult ? state.view : "source")));
  }
}

function renderPanel() {
  const item = active();
  if (!item) return;
  const hasImage = state.items.some((entry) => entry.kind === "image");
  const hasVideo = state.items.some((entry) => entry.kind === "video");
  fileName.textContent = item.file.name;
  fileMeta.textContent = [item.meta.width && `${item.meta.width}×${item.meta.height}`, item.meta.duration && formatDuration(item.meta.duration), formatBytes(item.file.size)].filter(Boolean).join(" · ");
  imageFormats.hidden = !hasImage;
  videoFormats.hidden = !hasVideo;
  imageFormats.classList.toggle("is-muted", item.kind !== "image");
  videoFormats.classList.toggle("is-muted", item.kind !== "video");
  for (const button of imageFormats.querySelectorAll("[data-image]")) {
    button.setAttribute("aria-pressed", String(button.dataset.image === state.imageFormat));
  }
  for (const button of videoFormats.querySelectorAll("[data-video]")) {
    button.setAttribute("aria-pressed", String(button.dataset.video === state.videoFormat));
  }
  const hideQuality = (item.kind === "image" && state.imageFormat === "png") || (item.kind === "video" && state.videoFormat === "gif");
  qualityField.hidden = hideQuality;
  hint.textContent = hintFor(item);
  if (item.result) {
    resultBox.hidden = false;
    resultSize.textContent = `${item.result.ext.toUpperCase()} · ${formatBytes(item.file.size)} → ${formatBytes(item.result.blob.size)}`;
  } else {
    resultBox.hidden = true;
  }
  document.getElementById("convert-all").hidden = state.items.length < 2;
}

function render() {
  const empty = state.items.length === 0;
  drop.hidden = !empty;
  work.hidden = empty;
  if (empty) return;
  renderRail();
  renderPreview();
  renderPanel();
}

document.getElementById("pick").addEventListener("click", () => fileInput.click());
document.getElementById("add-more").addEventListener("click", () => fileInput.click());
document.getElementById("clear-all").addEventListener("click", clearAll);
document.getElementById("remove").addEventListener("click", removeActive);
document.getElementById("convert").addEventListener("click", () => {
  const item = active();
  if (item) run([item]);
});
document.getElementById("convert-all").addEventListener("click", () => run(state.items.slice()));
document.getElementById("download").addEventListener("click", () => {
  const item = active();
  if (!item?.result) return;
  const link = document.createElement("a");
  link.href = item.result.url;
  link.download = item.result.name;
  link.click();
});

fileInput.addEventListener("change", () => {
  if (fileInput.files?.length) addFiles(fileInput.files);
  fileInput.value = "";
});

qualityInput.addEventListener("input", () => {
  state.quality = Number(qualityInput.value) / 100;
  qualityValue.textContent = `${qualityInput.value}%`;
});

maxEdgeInput.addEventListener("change", () => {
  state.maxEdge = Number(maxEdgeInput.value);
  if (active()) hint.textContent = hintFor(active());
});

for (const button of imageFormats.querySelectorAll("[data-image]")) {
  button.addEventListener("click", () => {
    state.imageFormat = button.dataset.image;
    if (active()) renderPanel();
  });
}

for (const button of videoFormats.querySelectorAll("[data-video]")) {
  button.addEventListener("click", () => {
    state.videoFormat = button.dataset.video;
    if (active()) renderPanel();
  });
}

viewSwitch.addEventListener("click", (event) => {
  const button = event.target.closest("[data-view]");
  if (!button || !active()?.result) return;
  state.view = button.dataset.view;
  renderPreview();
});

for (const eventName of ["dragenter", "dragover", "drop"]) {
  window.addEventListener(eventName, (event) => event.preventDefault());
}

sheet.addEventListener("dragenter", () => sheet.classList.add("is-over"));
sheet.addEventListener("dragover", () => sheet.classList.add("is-over"));
sheet.addEventListener("dragleave", (event) => {
  if (!sheet.contains(event.relatedTarget)) sheet.classList.remove("is-over");
});
sheet.addEventListener("drop", (event) => {
  sheet.classList.remove("is-over");
  if (event.dataTransfer?.files?.length) addFiles(event.dataTransfer.files);
});

async function configureImageFormats() {
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/webp", 0.8));
  if (blob && blob.type === "image/webp") return;
  const button = imageFormats.querySelector('[data-image="webp"]');
  if (button) {
    button.disabled = true;
    button.title = "Этот браузер не сохраняет WebP";
  }
  if (state.imageFormat === "webp") state.imageFormat = "jpg";
  if (active()) renderPanel();
}

configureImageFormats();
