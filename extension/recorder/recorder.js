"use strict";

const HOST_NAME = "com.voice_clip_recorder.host";

const ui = {
  recordBtn: document.getElementById("recordBtn"),
  recordBtnLabel: document.getElementById("recordBtnLabel"),
  pauseBtn: document.getElementById("pauseBtn"),
  pauseBtnLabel: document.getElementById("pauseBtnLabel"),
  openFolderBtn: document.getElementById("openFolderBtn"),
  delayStartInput: document.getElementById("delayStartInput"),
  autoPauseInput: document.getElementById("autoPauseInput"),
  stateDot: document.getElementById("stateDot"),
  statusText: document.getElementById("statusText"),
  timer: document.getElementById("timer"),
  modeValue: document.getElementById("modeValue"),
  nextActionValue: document.getElementById("nextActionValue"),
  bytesValue: document.getElementById("bytesValue"),
  missingPanel: document.getElementById("missingPanel"),
  resultPanel: document.getElementById("resultPanel"),
  fileName: document.getElementById("fileName"),
  fileSize: document.getElementById("fileSize"),
  filePath: document.getElementById("filePath"),
  messages: document.getElementById("messages")
};

const state = {
  nativePort: null,
  nativeAvailable: false,
  pending: null,
  statusText: "Проверка помощника...",
  recording: false,
  paused: false,
  starting: false,
  stopping: false,
  accumulatedMs: 0,
  activeStartedAt: 0,
  bytesWritten: 0,
  lastPath: "",
  delayedStartId: 0,
  delayedStartDueAt: 0,
  autoPauseId: 0,
  autoPauseDueAt: 0,
  uiTickId: 0
};

function setStatus(text) {
  state.statusText = text;
  ui.statusText.textContent = text;
}

function clearMessages() {
  ui.messages.textContent = "";
}

function addMessage(text, type = "info") {
  const node = document.createElement("div");
  node.className = `message ${type}`;
  node.textContent = text;
  ui.messages.prepend(node);
}

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function getElapsedMs() {
  return state.accumulatedMs + (state.recording && !state.paused && state.activeStartedAt ? Date.now() - state.activeStartedAt : 0);
}

function getDelayStartSeconds() {
  return Math.max(0, Number.parseInt(ui.delayStartInput.value || "0", 10) || 0);
}

function getAutoPauseSeconds() {
  return Math.max(0, Number.parseInt(ui.autoPauseInput.value || "0", 10) || 0);
}

function sanitizeNumberInput(input) {
  const value = Math.max(0, Number.parseInt(input.value || "0", 10) || 0);
  input.value = String(value);
}

function setStateDot(mode) {
  ui.stateDot.classList.toggle("ready", mode === "ready");
  ui.stateDot.classList.toggle("recording", mode === "recording");
  ui.stateDot.classList.toggle("paused", mode === "paused");
}

function nextActionText() {
  const now = Date.now();
  if (state.delayedStartDueAt > now) {
    return `Старт через ${Math.ceil((state.delayedStartDueAt - now) / 1000)} сек`;
  }
  if (state.autoPauseDueAt > now) {
    return `Авто-пауза через ${Math.ceil((state.autoPauseDueAt - now) / 1000)} сек`;
  }
  return "Нет таймеров";
}

function renderResult(path, bytes) {
  state.lastPath = path || "";
  ui.resultPanel.hidden = !path;
  ui.fileName.textContent = path ? path.split(/[\\/]/).pop() : "-";
  ui.fileSize.textContent = bytes ? formatBytes(bytes) : "-";
  ui.filePath.textContent = path || "-";
}

function renderUi() {
  const hasDelayedStart = state.delayedStartId !== 0;
  const canControl = state.nativeAvailable && !state.starting && !state.stopping;
  const isBusy = state.recording || hasDelayedStart;

  ui.recordBtnLabel.textContent = hasDelayedStart ? "Отменить старт" : (state.recording ? "Стоп" : "Старт");
  ui.pauseBtnLabel.textContent = state.paused ? "Продолжить" : "Пауза";
  ui.recordBtn.disabled = (!state.nativeAvailable && !hasDelayedStart) || state.starting || state.stopping;
  ui.pauseBtn.disabled = !state.recording || state.starting || state.stopping || !state.nativeAvailable;
  ui.openFolderBtn.disabled = !state.nativeAvailable;
  ui.missingPanel.hidden = state.nativeAvailable;

  if (hasDelayedStart) {
    setStateDot("");
    ui.modeValue.textContent = "Отложенный старт";
  } else if (state.recording && state.paused) {
    setStateDot("paused");
    ui.modeValue.textContent = "Пауза";
  } else if (state.recording) {
    setStateDot("recording");
    ui.modeValue.textContent = "Запись";
  } else if (canControl) {
    setStateDot("ready");
    ui.modeValue.textContent = "Готов";
  } else {
    setStateDot("");
    ui.modeValue.textContent = "Помощник недоступен";
  }

  ui.bytesValue.textContent = formatBytes(state.bytesWritten);
  ui.nextActionValue.textContent = nextActionText();
  ui.timer.textContent = formatDuration(getElapsedMs());
}

function startUiTicker() {
  if (state.uiTickId) return;
  state.uiTickId = window.setInterval(renderUi, 250);
}

function cancelDelayedStart(silent = false) {
  if (state.delayedStartId) {
    clearTimeout(state.delayedStartId);
    state.delayedStartId = 0;
    state.delayedStartDueAt = 0;
    if (!silent) {
      setStatus("Отложенный старт отменён.");
      addMessage("Отложенный старт отменён.", "info");
    }
  }
}

function cancelAutoPause() {
  if (state.autoPauseId) {
    clearTimeout(state.autoPauseId);
    state.autoPauseId = 0;
    state.autoPauseDueAt = 0;
  }
}

function scheduleAutoPause() {
  cancelAutoPause();
  const delaySec = getAutoPauseSeconds();
  if (delaySec <= 0) return;

  state.autoPauseDueAt = Date.now() + delaySec * 1000;
  state.autoPauseId = window.setTimeout(() => {
    state.autoPauseId = 0;
    state.autoPauseDueAt = 0;
    pauseRecording(true).catch(() => {});
  }, delaySec * 1000);
}

function nativeApiAvailable() {
  return typeof browser !== "undefined" && browser.runtime && typeof browser.runtime.connectNative === "function";
}

function ensureNativePort() {
  if (state.nativePort) return state.nativePort;
  if (!nativeApiAvailable()) return null;

  let port;
  try {
    port = browser.runtime.connectNative(HOST_NAME);
  } catch {
    state.nativeAvailable = false;
    renderUi();
    return null;
  }

  state.nativePort = port;
  port.onMessage.addListener(onNativeMessage);
  port.onDisconnect.addListener(() => {
    const err = (browser.runtime.lastError && browser.runtime.lastError.message) || port.error?.message || "Соединение с помощником разорвано.";
    state.nativePort = null;
    state.nativeAvailable = false;

    if (state.pending) {
      clearTimeout(state.pending.timerId);
      state.pending.reject(new Error(err));
      state.pending = null;
    }

    if (state.recording || state.delayedStartId) {
      cancelDelayedStart(true);
      cancelAutoPause();
      state.recording = false;
      state.paused = false;
      state.starting = false;
      state.stopping = false;
      state.accumulatedMs = 0;
      state.activeStartedAt = 0;
      setStatus(err);
      addMessage(err, "error");
    }

    renderUi();
  });

  return port;
}

function onNativeMessage(msg) {
  if (!msg || typeof msg !== "object") return;

  if (msg.event === "progress") {
    if (typeof msg.bytes === "number") state.bytesWritten = msg.bytes;
    if (state.recording && !state.paused) {
      setStatus(`Идёт запись · ${formatBytes(state.bytesWritten)}`);
    }
    renderUi();
    return;
  }

  if (state.pending) {
    const pending = state.pending;
    clearTimeout(pending.timerId);
    state.pending = null;
    pending.resolve(msg);
  }
}

function nativeSend(cmd, extra = {}, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    if (state.pending) {
      reject(new Error("Идёт другая операция с помощником."));
      return;
    }

    const port = ensureNativePort();
    if (!port) {
      reject(new Error("Помощник недоступен."));
      return;
    }

    let timerId = 0;
    state.pending = {
      resolve,
      reject,
      timerId
    };

    try {
      port.postMessage(Object.assign({ cmd }, extra));
    } catch (error) {
      state.pending = null;
      reject(error);
      return;
    }

    timerId = window.setTimeout(() => {
      if (state.pending && state.pending.resolve === resolve) {
        state.pending = null;
        reject(new Error("Помощник не отвечает."));
      }
    }, timeoutMs);

    state.pending.timerId = timerId;
  });
}

function syncFromStatus(response) {
  state.nativeAvailable = !!response?.ok;

  if (!response?.ok) {
    state.recording = false;
    state.paused = false;
    state.accumulatedMs = 0;
    state.activeStartedAt = 0;
    state.bytesWritten = 0;
    renderUi();
    return;
  }

  state.recording = !!response.recording;
  state.paused = !!response.paused;
  state.bytesWritten = Number(response.bytes || 0);
  state.lastPath = response.path || state.lastPath;

  if (state.recording) {
    state.accumulatedMs = Number(response.seconds || 0) * 1000;
    state.activeStartedAt = state.paused ? 0 : Date.now();
    setStatus(state.paused ? "На паузе" : `Идёт запись · ${formatBytes(state.bytesWritten)}`);
  } else {
    state.accumulatedMs = 0;
    state.activeStartedAt = 0;
    setStatus("Готов к записи.");
  }

  renderUi();
}

async function probeNativeHost() {
  if (!nativeApiAvailable()) {
    state.nativeAvailable = false;
    setStatus("Firefox не поддерживает Native Messaging в этом режиме.");
    renderUi();
    return;
  }

  try {
    const response = await nativeSend("status", {}, 5000);
    syncFromStatus(response);
  } catch {
    state.nativeAvailable = false;
    setStatus("Помощник недоступен.");
    renderUi();
  }
}

async function startNow() {
  clearMessages();
  state.starting = true;
  setStatus("Подключение к помощнику...");
  renderUi();

  try {
    if (!state.nativeAvailable) {
      await probeNativeHost();
      if (!state.nativeAvailable) throw new Error("Помощник не установлен или не отвечает.");
    }

    const response = await nativeSend("start", { captureVideo: true }, 15000);
    if (!response?.ok) throw new Error(response?.error || "Помощник не смог начать запись.");

    state.recording = true;
    state.paused = false;
    state.accumulatedMs = 0;
    state.activeStartedAt = Date.now();
    state.bytesWritten = 0;
    renderResult("", 0);
    scheduleAutoPause();
    setStatus("Идёт запись · 0 B");
    addMessage("Запись запущена через помощник Windows.", "success");
  } catch (error) {
    setStatus("Готов к записи.");
    addMessage(error.message || String(error), "error");
  } finally {
    state.starting = false;
    renderUi();
  }
}

function scheduleDelayedStart(seconds) {
  cancelDelayedStart(true);
  if (seconds <= 0) {
    startNow();
    return;
  }

  clearMessages();
  state.delayedStartDueAt = Date.now() + seconds * 1000;
  setStatus(`Старт через ${seconds} сек.`);
  addMessage(`Запуск записи запланирован через ${seconds} сек.`, "info");
  state.delayedStartId = window.setTimeout(() => {
    state.delayedStartId = 0;
    state.delayedStartDueAt = 0;
    startNow();
  }, seconds * 1000);
  renderUi();
}

async function stopRecording() {
  cancelDelayedStart(true);
  cancelAutoPause();

  if (!state.recording) {
    setStatus("Готов к записи.");
    renderUi();
    return;
  }

  state.stopping = true;
  if (!state.paused && state.activeStartedAt) {
    state.accumulatedMs += Date.now() - state.activeStartedAt;
    state.activeStartedAt = 0;
  }
  setStatus("Сохранение файла...");
  renderUi();

  try {
    const response = await nativeSend("stop", {}, 120000);
    if (!response?.ok) throw new Error(response?.error || "Помощник не смог завершить запись.");

    state.recording = false;
    state.paused = false;
    state.bytesWritten = Number(response.bytes || 0);
    state.accumulatedMs = 0;
    state.activeStartedAt = 0;
    renderResult(response.path || "", state.bytesWritten);
    setStatus("Файл сохранён.");
    addMessage("Запись сохранена помощником.", "success");
  } catch (error) {
    setStatus("Ошибка сохранения.");
    addMessage(error.message || String(error), "error");
  } finally {
    state.stopping = false;
    renderUi();
  }
}

async function pauseRecording(autoTriggered = false) {
  if (!state.recording || state.paused) return;

  cancelAutoPause();
  setStatus(autoTriggered ? "Срабатывает авто-пауза..." : "Ставим запись на паузу...");
  renderUi();

  try {
    const response = await nativeSend("pause", {}, 10000);
    if (!response?.ok) throw new Error(response?.error || "Помощник не смог поставить запись на паузу.");

    if (state.activeStartedAt) {
      state.accumulatedMs += Date.now() - state.activeStartedAt;
      state.activeStartedAt = 0;
    }
    state.paused = true;
    setStatus(autoTriggered ? "Авто-пауза сработала." : "На паузе.");
    addMessage(autoTriggered ? "Запись поставлена на паузу по таймеру." : "Запись поставлена на паузу.", "info");
  } catch (error) {
    setStatus("Не удалось поставить запись на паузу.");
    addMessage(error.message || String(error), "error");
  } finally {
    renderUi();
  }
}

async function resumeRecording() {
  if (!state.recording || !state.paused) return;

  setStatus("Возобновляем запись...");
  renderUi();

  try {
    const response = await nativeSend("resume", {}, 10000);
    if (!response?.ok) throw new Error(response?.error || "Помощник не смог продолжить запись.");

    state.paused = false;
    state.activeStartedAt = Date.now();
    setStatus(`Идёт запись · ${formatBytes(state.bytesWritten)}`);
    addMessage("Запись продолжена.", "success");
  } catch (error) {
    setStatus("Не удалось продолжить запись.");
    addMessage(error.message || String(error), "error");
  } finally {
    renderUi();
  }
}

function handleRecordClick() {
  if (state.delayedStartId) {
    cancelDelayedStart();
    renderUi();
    return;
  }

  if (state.recording) {
    stopRecording();
    return;
  }

  scheduleDelayedStart(getDelayStartSeconds());
}

function handlePauseClick() {
  if (state.paused) {
    resumeRecording();
  } else {
    pauseRecording(false);
  }
}

ui.recordBtn.addEventListener("click", handleRecordClick);
ui.pauseBtn.addEventListener("click", handlePauseClick);
ui.openFolderBtn.addEventListener("click", () => {
  nativeSend("open-folder", {}, 5000).catch(error => addMessage(error.message || String(error), "error"));
});
ui.delayStartInput.addEventListener("change", () => sanitizeNumberInput(ui.delayStartInput));
ui.autoPauseInput.addEventListener("change", () => sanitizeNumberInput(ui.autoPauseInput));

window.addEventListener("beforeunload", () => {
  cancelDelayedStart(true);
  cancelAutoPause();
  if (state.recording) {
    try { state.nativePort?.postMessage({ cmd: "cancel" }); } catch {}
  }
});

startUiTicker();
sanitizeNumberInput(ui.delayStartInput);
sanitizeNumberInput(ui.autoPauseInput);
renderUi();
probeNativeHost();
