"use strict";

const audioFormats = [
  { id: "auto",       mimeType: "",                          label: "Авто",                  extension: "webm" },
  { id: "ogg-opus",   mimeType: "audio/ogg;codecs=opus",     label: "OGG Opus (.ogg)",       extension: "ogg" },
  { id: "webm-opus",  mimeType: "audio/webm;codecs=opus",    label: "WebM Opus (.webm)",     extension: "webm" },
  { id: "wav-pcm",    mimeType: "audio/wav", recordMimeType: "", postProcess: "wav", label: "WAV PCM (.wav)", extension: "wav" }
];

const videoFormats = [
  { id: "auto-video", mimeType: "",                                label: "Авто",                       extension: "webm" },
  { id: "webm-vp8",   mimeType: "video/webm;codecs=vp8,opus",      label: "WebM VP8 + Opus (.webm)",    extension: "webm" },
  { id: "webm-vp9",   mimeType: "video/webm;codecs=vp9,opus",      label: "WebM VP9 + Opus (.webm)",    extension: "webm" }
];

const ui = {
  micToggle:          document.getElementById("micToggle"),
  displayAudioToggle: document.getElementById("displayAudioToggle"),
  videoToggle:        document.getElementById("videoToggle"),
  nativeAudioToggle:  document.getElementById("nativeAudioToggle"),
  nativeHint:         document.getElementById("nativeHint"),
  nativeMissingHint:  document.getElementById("nativeMissingHint"),
  openFolderBtn:      document.getElementById("openFolderBtn"),
  micGain:            document.getElementById("micGain"),
  micGainValue:       document.getElementById("micGainValue"),
  displayGain:        document.getElementById("displayGain"),
  displayGainValue:   document.getElementById("displayGainValue"),
  micSlider:          document.querySelector('.slider[data-source="mic"]'),
  displaySlider:      document.querySelector('.slider[data-source="display"]'),
  formatSelect:       document.getElementById("formatSelect"),
  displayHint:        document.getElementById("displayHint"),
  recordBtn:          document.getElementById("recordBtn"),
  recordBtnLabel:     document.getElementById("recordBtnLabel"),
  stateDot:           document.getElementById("stateDot"),
  statusText:         document.getElementById("statusText"),
  timer:              document.getElementById("timer"),
  livePreview:        document.getElementById("livePreview"),
  previewEmpty:       document.getElementById("previewEmpty"),
  recordCard:         document.querySelector(".record-card"),
  messages:           document.getElementById("messages"),
  micMeter:           document.getElementById("micMeter"),
  micLevelBar:        document.getElementById("micLevelBar"),
  micLevelValue:      document.getElementById("micLevelValue"),
  displayMeter:       document.getElementById("displayMeter"),
  displayLevelBar:    document.getElementById("displayLevelBar"),
  displayLevelValue:  document.getElementById("displayLevelValue"),
  resultPanel:        document.getElementById("resultPanel"),
  audioPlayback:      document.getElementById("audioPlayback"),
  videoPlayback:      document.getElementById("videoPlayback"),
  fileName:           document.getElementById("fileName"),
  fileSize:           document.getElementById("fileSize"),
  downloadLink:       document.getElementById("downloadLink"),
  clearBtn:           document.getElementById("clearBtn")
};

const state = {
  recorder: null,
  chunks: [],
  sourceStreams: [],
  recordingStream: null,
  audioContext: null,
  audioNodes: [],
  gainNodes: {},
  meterSources: [],
  meterAnimationId: 0,
  objectUrl: "",
  timerId: 0,
  startedAt: 0,
  selectedFormat: null,
  includeVideo: false,
  starting: false,
  stopping: false,
  nativePort: null,
  nativeAvailable: false,
  nativeRecording: false,
  nativeLastPath: "",
  nativePending: null
};

const HOST_NAME = "com.voice_clip_recorder.host";

// ---------- helpers ----------

function setStatus(text) { ui.statusText.textContent = text; }

function setStateDot(mode) {
  ui.stateDot.classList.toggle("ready", mode === "ready");
  ui.stateDot.classList.toggle("recording", mode === "recording");
}

function clearMessages() { ui.messages.textContent = ""; }

function addMessage(text, type = "info") {
  const node = document.createElement("div");
  node.className = `message ${type}`;
  node.textContent = text;
  ui.messages.append(node);
}

function isRecording() { return state.recorder?.state === "recording"; }

function supportsMime(mime) {
  return !mime || (window.MediaRecorder && MediaRecorder.isTypeSupported(mime));
}

function isFormatSupported(format) {
  if (format.postProcess === "wav") {
    return Boolean(window.AudioContext || window.webkitAudioContext);
  }
  return supportsMime(format.mimeType);
}

function refreshFormatOptions() {
  const list = ui.videoToggle.checked ? videoFormats : audioFormats;
  const supported = list.filter(isFormatSupported);
  const prev = ui.formatSelect.value;
  ui.formatSelect.textContent = "";
  for (const f of supported) {
    const opt = document.createElement("option");
    opt.value = f.id;
    opt.textContent = f.label;
    ui.formatSelect.append(opt);
  }
  if (supported.some(f => f.id === prev)) ui.formatSelect.value = prev;
}

function getSelectedFormat() {
  const list = ui.videoToggle.checked ? videoFormats : audioFormats;
  return list.find(f => f.id === ui.formatSelect.value && isFormatSupported(f))
      || list.find(isFormatSupported)
      || list[0];
}

function getRecordingMimeType(f) { return f?.recordMimeType ?? f?.mimeType ?? ""; }

function updateSlidersVisibility() {
  ui.micSlider.hidden = !ui.micToggle.checked;
  ui.displaySlider.hidden = !ui.displayAudioToggle.checked;
}

function updateRangeOutputs() {
  ui.micGainValue.value = `${Math.round(Number(ui.micGain.value) * 100)}%`;
  ui.displayGainValue.value = `${Math.round(Number(ui.displayGain.value) * 100)}%`;
  if (state.gainNodes.mic) state.gainNodes.mic.gain.value = Number(ui.micGain.value);
  if (state.gainNodes.display) state.gainNodes.display.gain.value = Number(ui.displayGain.value);
}

function updateDisplayHint() {
  const nativeMode = ui.nativeAudioToggle?.checked;
  const needDisplay = ui.displayAudioToggle.checked || ui.videoToggle.checked;
  ui.displayHint.hidden = nativeMode || !needDisplay;
  if (ui.nativeHint) ui.nativeHint.hidden = !nativeMode;
  if (ui.nativeMissingHint) ui.nativeMissingHint.hidden = !(nativeMode && !state.nativeAvailable);
}

function applyNativeModeUi() {
  const on = ui.nativeAudioToggle?.checked;
  // When native mode is on, other source toggles are disabled and visually muted
  for (const el of [ui.micToggle, ui.displayAudioToggle, ui.videoToggle, ui.formatSelect]) {
    el.disabled = !!on || (state.recorder?.state === "recording");
  }
  updateSlidersVisibility();
  updateDisplayHint();
}

function formatDuration(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = String(Math.floor(total / 60)).padStart(2, "0");
  const s = String(total % 60).padStart(2, "0");
  return `${m}:${s}`;
}

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function fileStamp() {
  const d = new Date();
  return `${d.toISOString().slice(0, 10)}-${d.toTimeString().slice(0, 8).replaceAll(":", "-")}`;
}

function extensionFromMime(mime, fallback) {
  if (mime.includes("wav")) return "wav";
  if (mime.includes("ogg")) return "ogg";
  if (mime.includes("webm")) return "webm";
  if (mime.includes("mp4")) return "mp4";
  return fallback || "webm";
}

function startTimer() {
  state.startedAt = Date.now();
  ui.timer.textContent = "00:00";
  state.timerId = window.setInterval(() => {
    ui.timer.textContent = formatDuration(Date.now() - state.startedAt);
  }, 250);
}

function stopTimer() {
  window.clearInterval(state.timerId);
  state.timerId = 0;
}

// ---------- preview & meters ----------

function showPreview(stream) {
  const hasVideo = Boolean(stream && stream.getVideoTracks().length);
  ui.recordCard.classList.toggle("no-video", !hasVideo);
  if (hasVideo) {
    ui.livePreview.srcObject = stream;
    ui.livePreview.hidden = false;
    ui.previewEmpty.hidden = true;
  } else {
    ui.livePreview.srcObject = null;
    ui.livePreview.hidden = true;
    ui.previewEmpty.hidden = false;
  }
}

function meterEls(id) {
  if (id === "mic") return { card: ui.micMeter, bar: ui.micLevelBar, value: ui.micLevelValue };
  if (id === "display") return { card: ui.displayMeter, bar: ui.displayLevelBar, value: ui.displayLevelValue };
  return null;
}

function setMeterLevel(id, level) {
  const e = meterEls(id);
  if (!e) return;
  e.bar.style.width = `${level}%`;
  e.value.value = `${level}%`;
}

function resetMeters() {
  for (const id of ["mic", "display"]) {
    const e = meterEls(id);
    if (!e) continue;
    e.card.hidden = true;
    e.bar.style.width = "0%";
    e.value.value = "0%";
  }
}

function meterLevel(meter) {
  meter.analyser.getByteTimeDomainData(meter.data);
  let sum = 0;
  for (let i = 0; i < meter.data.length; i++) {
    const v = (meter.data[i] - 128) / 128;
    sum += v * v;
  }
  return Math.min(100, Math.round(Math.sqrt(sum / meter.data.length) * 165));
}

function stopMeters() {
  if (state.meterAnimationId) cancelAnimationFrame(state.meterAnimationId);
  state.meterAnimationId = 0;
  state.meterSources = [];
  resetMeters();
}

function startMeters(sources) {
  stopMeters();
  state.meterSources = sources;
  for (const m of sources) {
    const e = meterEls(m.id);
    if (e) { e.card.hidden = false; setMeterLevel(m.id, 0); }
  }
  const tick = () => {
    for (const m of state.meterSources) setMeterLevel(m.id, meterLevel(m));
    state.meterAnimationId = requestAnimationFrame(tick);
  };
  tick();
}

// ---------- capture ----------

async function buildMixer(inputs) {
  const AC = window.AudioContext || window.webkitAudioContext;
  const ctx = new AC();
  const dest = ctx.createMediaStreamDestination();
  const nodes = [];
  const gainNodes = {};
  const meterSources = [];
  for (const input of inputs) {
    const src = ctx.createMediaStreamSource(input.stream);
    const gain = ctx.createGain();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.82;
    gain.gain.value = input.gain;
    src.connect(gain); gain.connect(dest); gain.connect(analyser);
    nodes.push(src, gain, analyser);
    gainNodes[input.id] = gain;
    meterSources.push({ id: input.id, analyser, data: new Uint8Array(analyser.fftSize) });
  }
  if (ctx.state === "suspended") await ctx.resume();
  return { stream: dest.stream, ctx, nodes, gainNodes, meterSources };
}

async function collectSources() {
  const wantMic = ui.micToggle.checked;
  const wantDisplayAudio = ui.displayAudioToggle.checked;
  const wantVideo = ui.videoToggle.checked;
  const wantDisplay = wantDisplayAudio || wantVideo;

  if (!wantMic && !wantDisplay) throw new Error("Выберите хотя бы один источник.");

  const sourceStreams = [];
  const audioInputs = [];
  const videoTracks = [];
  const warnings = [];
  let previewStream = null;

  try {
    if (wantDisplay) {
      if (!navigator.mediaDevices?.getDisplayMedia) {
        throw new Error("Захват вкладки/экрана не поддерживается этим браузером.");
      }
      const ds = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: wantDisplayAudio ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false } : false
      });
      sourceStreams.push(ds);

      const da = ds.getAudioTracks();
      if (wantDisplayAudio && da.length > 0) {
        audioInputs.push({ id: "display", stream: new MediaStream(da), gain: Number(ui.displayGain.value) });
      } else if (wantDisplayAudio) {
        warnings.push("Firefox не передал аудио источника. При захвате окна/экрана он почти никогда не отдаёт звук — это ограничение Firefox.");
      }

      const dv = ds.getVideoTracks();
      if (dv.length > 0) {
        previewStream = new MediaStream(dv);
        if (wantVideo) videoTracks.push(...dv);
        else dv.forEach(t => t.enabled = true); // keep for preview only
      }
    }

    if (wantMic) {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Микрофон не поддерживается этим браузером.");
      }
      const ms = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      });
      sourceStreams.push(ms);
      const mt = ms.getAudioTracks();
      if (mt.length > 0) {
        audioInputs.push({ id: "mic", stream: new MediaStream(mt), gain: Number(ui.micGain.value) });
      }
    }

    const recTracks = [];
    let mixer = null;
    if (audioInputs.length > 0) {
      mixer = await buildMixer(audioInputs);
      recTracks.push(...mixer.stream.getAudioTracks());
    }
    if (wantVideo) recTracks.push(...videoTracks);

    if (recTracks.length === 0) {
      let msg = "Нет доступных дорожек для записи.";
      if (wantDisplayAudio) {
        msg += " Firefox не передал аудио выбранного источника — он отдаёт звук только при захвате отдельной вкладки, а Firefox не показывает вкладки в системном диалоге. Включите «Микрофон» (можно с виртуальным аудио-кабелем / Stereo Mix, чтобы записать системный звук) или «Видео».";
      }
      throw new Error(msg);
    }

    return {
      recordingStream: new MediaStream(recTracks),
      sourceStreams,
      previewStream,
      audioContext: mixer?.ctx ?? null,
      audioNodes: mixer?.nodes ?? [],
      gainNodes: mixer?.gainNodes ?? {},
      meterSources: mixer?.meterSources ?? [],
      includeVideo: wantVideo,
      warnings
    };
  } catch (err) {
    for (const s of sourceStreams) s.getTracks().forEach(t => t.stop());
    throw err;
  }
}

function cleanupCapture() {
  stopMeters();
  for (const n of state.audioNodes) { try { n.disconnect(); } catch {} }
  if (state.audioContext) state.audioContext.close().catch(() => {});
  if (state.recordingStream) state.recordingStream.getTracks().forEach(t => t.stop());
  for (const s of state.sourceStreams) s.getTracks().forEach(t => t.stop());
  state.sourceStreams = [];
  state.recordingStream = null;
  state.audioContext = null;
  state.audioNodes = [];
  state.gainNodes = {};
  state.includeVideo = false;
  ui.livePreview.srcObject = null;
  ui.livePreview.hidden = true;
  ui.previewEmpty.hidden = false;
  ui.recordCard.classList.add("no-video");
}

// ---------- WAV post-process ----------

function writeAscii(view, offset, text) {
  for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
}

function encodeWav(buffer) {
  const ch = buffer.numberOfChannels;
  const rate = buffer.sampleRate;
  const bytesPerSample = 2;
  const blockAlign = ch * bytesPerSample;
  const dataSize = buffer.length * blockAlign;
  const ab = new ArrayBuffer(44 + dataSize);
  const view = new DataView(ab);
  const channels = [];
  for (let c = 0; c < ch; c++) channels.push(buffer.getChannelData(c));
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, ch, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bytesPerSample * 8, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataSize, true);
  let off = 44;
  for (let i = 0; i < buffer.length; i++) {
    for (let c = 0; c < ch; c++) {
      const s = Math.max(-1, Math.min(1, channels[c][i]));
      view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      off += 2;
    }
  }
  return ab;
}

async function convertBlobToWav(blob) {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) throw new Error("WAV-конвертация недоступна: Web Audio API не найден.");
  const ctx = new AC();
  try {
    const ab = await blob.arrayBuffer();
    const audio = await new Promise((resolve, reject) => {
      const r = ctx.decodeAudioData(ab, resolve, reject);
      if (r?.then) r.then(resolve, reject);
    });
    return new Blob([encodeWav(audio)], { type: "audio/wav" });
  } finally {
    ctx.close().catch(() => {});
  }
}

async function processBlob(blob, format) {
  if (format?.postProcess === "wav") {
    setStatus("Конвертация в WAV...");
    return convertBlobToWav(blob);
  }
  return blob;
}

// ---------- result ----------

function renderResult(blob) {
  if (state.objectUrl) URL.revokeObjectURL(state.objectUrl);
  const mime = blob.type || state.selectedFormat?.mimeType || "";
  const ext = extensionFromMime(mime, state.selectedFormat?.extension);
  const name = `voice-clip-${fileStamp()}.${ext}`;
  const url = URL.createObjectURL(blob);
  const isVideo = mime.startsWith("video/");
  state.objectUrl = url;
  ui.resultPanel.hidden = false;
  ui.fileName.textContent = name;
  ui.fileSize.textContent = formatBytes(blob.size);
  ui.downloadLink.href = url;
  ui.downloadLink.download = name;
  ui.downloadLink.hidden = false;
  if (ui.openFolderBtn) ui.openFolderBtn.hidden = true;
  ui.audioPlayback.pause(); ui.videoPlayback.pause();
  ui.audioPlayback.hidden = isVideo;
  ui.videoPlayback.hidden = !isVideo;
  if (isVideo) { ui.videoPlayback.src = url; ui.audioPlayback.removeAttribute("src"); }
  else { ui.audioPlayback.src = url; ui.videoPlayback.removeAttribute("src"); }
}

function clearResult() {
  if (state.objectUrl) { URL.revokeObjectURL(state.objectUrl); state.objectUrl = ""; }
  ui.resultPanel.hidden = true;
  ui.audioPlayback.pause(); ui.videoPlayback.pause();
  ui.audioPlayback.removeAttribute("src"); ui.videoPlayback.removeAttribute("src");
  ui.fileName.textContent = "-"; ui.fileSize.textContent = "-";
  ui.downloadLink.hidden = false;
  if (ui.openFolderBtn) ui.openFolderBtn.hidden = true;
  state.nativeLastPath = "";
}

// ---------- native messaging host ----------

function nativeApiAvailable() {
  return typeof browser !== "undefined" && browser.runtime && typeof browser.runtime.connectNative === "function";
}

function ensureNativePort() {
  if (state.nativePort) return state.nativePort;
  if (!nativeApiAvailable()) return null;
  let port;
  try { port = browser.runtime.connectNative(HOST_NAME); }
  catch (err) { state.nativeAvailable = false; updateDisplayHint(); return null; }
  state.nativePort = port;
  port.onMessage.addListener(onNativeMessage);
  port.onDisconnect.addListener(() => {
    const err = (browser.runtime.lastError && browser.runtime.lastError.message) || port.error?.message || "";
    state.nativePort = null;
    state.nativeAvailable = false;
    if (state.nativeRecording) {
      state.nativeRecording = false;
      addMessage("Соединение с помощником разорвано: " + (err || "неизвестная ошибка"), "error");
      stopTimer();
      setRecordingUi(false);
      ui.recordBtn.disabled = false;
    }
    if (state.nativePending) {
      state.nativePending.reject(new Error(err || "host disconnected"));
      state.nativePending = null;
    }
    updateDisplayHint();
  });
  return port;
}

function onNativeMessage(msg) {
  if (!msg || typeof msg !== "object") return;
  if (msg.event === "progress") {
    if (typeof msg.bytes === "number") setStatus(`Идёт запись · ${formatBytes(msg.bytes)}`);
    return;
  }
  if (msg.event === "stopped") {
    state.nativeRecording = false;
    stopTimer();
    if (msg.ok && msg.path) {
      renderNativeResult(msg.path, msg.bytes || 0);
      addMessage("Запись сохранена помощником.", "success");
    } else {
      addMessage(msg.error || "Помощник не смог сохранить запись.", "error");
    }
    setRecordingUi(false);
    ui.recordBtn.disabled = false;
    return;
  }
  // Generic response to pending request
  if (state.nativePending) {
    const p = state.nativePending; state.nativePending = null;
    p.resolve(msg);
  }
}

function nativeSend(cmd, extra = {}) {
  return new Promise((resolve, reject) => {
    const port = ensureNativePort();
    if (!port) { reject(new Error("Помощник недоступен")); return; }
    state.nativePending = { resolve, reject };
    try { port.postMessage(Object.assign({ cmd }, extra)); }
    catch (err) { state.nativePending = null; reject(err); }
    setTimeout(() => {
      if (state.nativePending && state.nativePending.resolve === resolve) {
        state.nativePending = null;
        reject(new Error("Помощник не отвечает"));
      }
    }, 5000);
  });
}

async function probeNativeHost() {
  if (!nativeApiAvailable()) { state.nativeAvailable = false; updateDisplayHint(); return; }
  try {
    const resp = await nativeSend("ping");
    state.nativeAvailable = !!(resp && (resp.ok || resp.pong || resp.version));
  } catch { state.nativeAvailable = false; }
  updateDisplayHint();
}

function renderNativeResult(path, bytes) {
  if (state.objectUrl) { URL.revokeObjectURL(state.objectUrl); state.objectUrl = ""; }
  state.nativeLastPath = path || "";
  const name = path ? path.split(/[\\\/]/).pop() : "(файл)";
  ui.resultPanel.hidden = false;
  ui.fileName.textContent = name;
  ui.fileSize.textContent = bytes ? formatBytes(bytes) : "-";
  ui.audioPlayback.pause(); ui.videoPlayback.pause();
  ui.audioPlayback.hidden = true;
  ui.videoPlayback.hidden = true;
  ui.audioPlayback.removeAttribute("src");
  ui.videoPlayback.removeAttribute("src");
  ui.downloadLink.removeAttribute("href");
  ui.downloadLink.hidden = true;
  ui.openFolderBtn.hidden = false;
}

// ---------- record flow ----------

function setRecordingUi(recording) {
  if (recording) {
    ui.recordBtn.classList.add("recording");
    ui.recordBtnLabel.textContent = "Стоп";
    setStateDot("recording");
    setStatus("Идёт запись");
    document.querySelectorAll(".check input, .slider input").forEach(el => { el.disabled = false; });
    ui.formatSelect.disabled = true;
    ui.micToggle.disabled = true;
    ui.displayAudioToggle.disabled = true;
    ui.videoToggle.disabled = true;
    if (ui.nativeAudioToggle) ui.nativeAudioToggle.disabled = true;
  } else {
    ui.recordBtn.classList.remove("recording");
    ui.recordBtnLabel.textContent = "Записать";
    setStateDot("");
    setStatus("Готов");
    ui.formatSelect.disabled = false;
    ui.micToggle.disabled = false;
    ui.displayAudioToggle.disabled = false;
    ui.videoToggle.disabled = false;
    if (ui.nativeAudioToggle) ui.nativeAudioToggle.disabled = false;
    applyNativeModeUi();
  }
}

async function startRecording() {
  if (state.starting || isRecording() || state.nativeRecording) return;

  // Native-host mode branch
  if (ui.nativeAudioToggle?.checked) {
    clearMessages();
    clearResult();
    state.starting = true;
    ui.recordBtn.disabled = true;
    setStatus("Подключение к помощнику...");
    try {
      if (!state.nativeAvailable) await probeNativeHost();
      if (!state.nativeAvailable) throw new Error("Помощник не установлен или не отвечает.");
      const resp = await nativeSend("start");
      if (!resp || !resp.ok) throw new Error(resp?.error || "Помощник не смог начать запись.");
      state.nativeRecording = true;
      setRecordingUi(true);
      startTimer();
    } catch (err) {
      addMessage(err.message || String(err), "error");
      setStatus("Готов");
      setRecordingUi(false);
      ui.recordBtn.disabled = false;
      updateDisplayHint();
    } finally {
      state.starting = false;
      ui.recordBtn.disabled = false;
    }
    return;
  }

  if (!window.MediaRecorder) {
    addMessage("MediaRecorder API недоступен в этом браузере.", "error");
    return;
  }

  clearMessages();
  state.starting = true;
  ui.recordBtn.disabled = true;
  setStatus("Запрос разрешений...");

  let capture;
  try {
    capture = await collectSources();
  } catch (err) {
    setStatus("Готов");
    ui.recordBtn.disabled = false;
    state.starting = false;
    if (err && err.name !== "NotAllowedError" && err.name !== "AbortError") {
      addMessage(err.message || "Не удалось получить источники.", "error");
    } else if (err?.name === "NotAllowedError") {
      addMessage("Доступ к источнику не предоставлен.", "error");
    }
    return;
  }

  state.sourceStreams = capture.sourceStreams;
  state.recordingStream = capture.recordingStream;
  state.audioContext = capture.audioContext;
  state.audioNodes = capture.audioNodes;
  state.gainNodes = capture.gainNodes;
  state.includeVideo = capture.includeVideo;
  state.selectedFormat = getSelectedFormat();
  showPreview(capture.previewStream);
  startMeters(capture.meterSources);
  for (const w of capture.warnings) addMessage(w);

  // Stop if user closes a source externally
  for (const s of capture.sourceStreams) {
    for (const t of s.getTracks()) {
      t.addEventListener("ended", () => { if (isRecording()) stopRecording(); }, { once: true });
    }
  }

  try {
    state.chunks = [];
    state.stopping = false;
    const mt = getRecordingMimeType(state.selectedFormat);
    state.recorder = new MediaRecorder(state.recordingStream, mt ? { mimeType: mt } : undefined);

    state.recorder.addEventListener("dataavailable", e => {
      if (e.data && e.data.size > 0) state.chunks.push(e.data);
    });

    state.recorder.addEventListener("stop", async () => {
      stopTimer();
      const fmt = state.selectedFormat;
      const wasVideo = state.includeVideo;
      const blobType = state.recorder?.mimeType || getRecordingMimeType(fmt) || undefined;
      const raw = new Blob(state.chunks, { type: blobType });
      cleanupCapture();
      state.recorder = null;
      state.stopping = false;

      if (raw.size === 0) {
        setStatus("Пустая запись");
        addMessage("Запись не содержит данных.", "error");
        setRecordingUi(false);
        ui.recordBtn.disabled = false;
        return;
      }

      try {
        const out = await processBlob(raw, fmt);
        renderResult(out);
        setStatus("Запись готова");
        addMessage(wasVideo ? "Видео сохранено." : "Аудио сохранено.", "success");
      } catch (err) {
        addMessage(err.message || "Не удалось подготовить файл.", "error");
      } finally {
        setRecordingUi(false);
        ui.recordBtn.disabled = false;
      }
    });

    state.recorder.addEventListener("error", e => {
      addMessage(e.error?.message || "Ошибка записи.", "error");
      stopRecording();
    });

    state.recorder.start(1000);
    setRecordingUi(true);
    startTimer();
  } catch (err) {
    cleanupCapture();
    state.recorder = null;
    addMessage(err.message || "Не удалось начать запись.", "error");
    setRecordingUi(false);
  } finally {
    state.starting = false;
    ui.recordBtn.disabled = false;
  }
}

function stopRecording() {
  if (state.nativeRecording) {
    setStatus("Сохранение...");
    ui.recordBtn.disabled = true;
    nativeSend("stop").then(resp => {
      state.nativeRecording = false;
      stopTimer();
      if (resp && resp.ok && resp.path) {
        renderNativeResult(resp.path, resp.bytes || 0);
        addMessage("Запись сохранена помощником.", "success");
      } else {
        addMessage((resp && resp.error) || "Помощник не смог сохранить запись.", "error");
      }
      setRecordingUi(false);
      ui.recordBtn.disabled = false;
    }).catch(err => {
      state.nativeRecording = false;
      stopTimer();
      addMessage(err.message || String(err), "error");
      setRecordingUi(false);
      ui.recordBtn.disabled = false;
    });
    return;
  }
  if (!state.recorder || state.recorder.state === "inactive") return;
  state.stopping = true;
  setStatus("Сохранение...");
  ui.recordBtn.disabled = true;
  state.recorder.stop();
}

function toggleRecord() {
  if (isRecording() || state.nativeRecording) stopRecording();
  else startRecording();
}

// ---------- listeners ----------

ui.recordBtn.addEventListener("click", toggleRecord);
ui.clearBtn.addEventListener("click", clearResult);
ui.micToggle.addEventListener("change", () => { updateSlidersVisibility(); });
ui.displayAudioToggle.addEventListener("change", () => { updateSlidersVisibility(); updateDisplayHint(); });
ui.videoToggle.addEventListener("change", () => { refreshFormatOptions(); updateDisplayHint(); });
ui.micGain.addEventListener("input", updateRangeOutputs);
ui.displayGain.addEventListener("input", updateRangeOutputs);
if (ui.nativeAudioToggle) ui.nativeAudioToggle.addEventListener("change", () => {
  if (ui.nativeAudioToggle.checked && !state.nativeAvailable) probeNativeHost();
  applyNativeModeUi();
});
if (ui.openFolderBtn) ui.openFolderBtn.addEventListener("click", () => {
  if (state.nativeLastPath) nativeSend("open-folder", { path: state.nativeLastPath }).catch(() => {});
});
window.addEventListener("beforeunload", () => {
  if (state.nativeRecording) { try { state.nativePort?.postMessage({ cmd: "cancel" }); } catch {} }
  if (isRecording()) state.recorder.stop();
  cleanupCapture();
});

// ---------- init ----------

refreshFormatOptions();
updateSlidersVisibility();
updateRangeOutputs();
updateDisplayHint();
resetMeters();
setRecordingUi(false);

if (!window.MediaRecorder) {
  ui.recordBtn.disabled = true;
  addMessage("MediaRecorder API недоступен в этом браузере.", "error");
}

// Probe native host on load (non-blocking)
probeNativeHost();
