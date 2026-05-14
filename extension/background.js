const extensionApi = typeof browser !== "undefined" ? browser : chrome;
const actionApi = extensionApi.action || extensionApi.browserAction;
const recorderUrl = extensionApi.runtime.getURL("recorder/recorder.html");

async function openOrFocusRecorder() {
  try {
    const tabs = await extensionApi.tabs.query({ url: recorderUrl });
    if (tabs && tabs.length > 0) {
      const target = tabs[0];
      await extensionApi.tabs.update(target.id, { active: true });
      if (typeof target.windowId === "number" && extensionApi.windows?.update) {
        await extensionApi.windows.update(target.windowId, { focused: true });
      }
      return;
    }
  } catch {
    // tabs.query may fail in some contexts -- fall through to create.
  }
  extensionApi.tabs.create({ url: recorderUrl });
}

actionApi?.onClicked?.addListener(openOrFocusRecorder);
