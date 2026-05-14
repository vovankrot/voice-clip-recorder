# Voice Clip Recorder — Native Helper

Локальная программа-помощник для расширения **Voice Clip Recorder**. Через Native Messaging она записывает рабочий стол Windows и системный звук без использования браузерного `MediaRecorder`.

## Из чего состоит

| Компонент | Что делает |
|---|---|
| `src/Host` | Консольный `vcr-host.exe` — .NET 8, NAudio `WasapiLoopbackCapture` + desktop capture. Получает JSON-команды через stdin, пишет AVI. |
| `src/Installer` | WPF-инсталлятор `VoiceClipRecorderSetup.exe` — тёмный borderless UI, ставит хост в `%LOCALAPPDATA%\Programs\VoiceClipRecorder`, регистрирует Native Messaging для Firefox, добавляет запись в «Программы и компоненты`. Без UAC. |

## Сборка

Требуется .NET 8 SDK (`dotnet --list-sdks` должен показать `8.x`).

```powershell
.\build.ps1
```

На выходе — `dist\VoiceClipRecorderSetup-v1.0.0.exe`.

## Что делает инсталлятор

1. Распаковывает `vcr-host.exe` в `%LOCALAPPDATA%\Programs\VoiceClipRecorder\vcr-host.exe`.
2. Кладёт рядом `manifest.json` (Native Messaging manifest для Firefox).
3. Пишет в реестр `HKCU\Software\Mozilla\NativeMessagingHosts\com.voice_clip_recorder.host`.
4. Регистрирует приложение в `HKCU\...\Uninstall\VoiceClipRecorder`.
5. Опционально создаёт ярлык в меню `Пуск`.

## Native Messaging — протокол

```js
const port = browser.runtime.connectNative("com.voice_clip_recorder.host");
port.postMessage({ cmd: "start" });
port.onMessage.addListener(msg => console.log(msg));
```

Поддерживаемые команды:

| `cmd` | Параметры | Ответ |
|---|---|---|
| `ping` | — | `{ok, version, recording, paused}` |
| `list-devices` | — | `{ok, devices:[{id,name,isDefault}]}` |
| `start` | `deviceId?`, `filename?` | `{ok, path, sampleRate, channels, bitsPerSample, width, height, format:"avi"}` |
| `pause` | — | `{ok, paused:true}` |
| `resume` | — | `{ok, paused:false}` |
| `stop` | — | `{ok, path, bytes, durationMs, format:"avi"}` |
| `cancel` | — | `{ok}` |
| `open-folder` | — | `{ok, path}` |
| `status` | — | `{ok, recording, paused, seconds, bytes, outputDir}` |

Дополнительно хост отправляет событие `{event:"progress", seconds, bytes, paused}` во время активной записи.

Записи сохраняются в `%USERPROFILE%\Music\VoiceClipRecorder\VCR-yyyyMMdd-HHmmss.avi`. Логи — `%LOCALAPPDATA%\VoiceClipRecorder\host.log`.

## Безопасность / права

- Установка только для текущего пользователя (HKCU + `%LOCALAPPDATA%`), UAC не требуется.
- Хост слушает только stdin от родительского процесса (браузер), сетевых интерфейсов не открывает.
- `allowed_extensions` в manifest ограничивает запуск только конкретным ID расширения (`voice-clip-recorder@local`).
