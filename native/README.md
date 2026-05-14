# Voice Clip Recorder — Native Helper

Локальная программа-помощник для расширения **Voice Clip Recorder**. Решает фундаментальное ограничение Firefox: расширение не может само захватывать звук вкладки/системы, но через Native Messaging оно может попросить эту маленькую программу сделать запись через WASAPI loopback (системный микшер).

## Из чего состоит

| Компонент | Что делает |
|---|---|
| `src/Host` | Консольный `vcr-host.exe` — .NET 8, NAudio `WasapiLoopbackCapture`. Получает JSON-команды через stdin, пишет WAV. |
| `src/Installer` | WPF-инсталлятор `VoiceClipRecorderSetup.exe` — тёмный borderless UI, ставит хост в `%LOCALAPPDATA%\Programs\VoiceClipRecorder`, регистрирует Native Messaging для Firefox, добавляет запись в «Программы и компоненты». Без UAC. |

## Сборка

Требуется .NET 8 SDK (`dotnet --list-sdks` должен показать `8.x`).

```powershell
.\build.ps1
```

На выходе — `dist\VoiceClipRecorderSetup-v1.0.0.exe` (single-file, self-contained, win-x64, ~70 МБ).

## Что делает инсталлятор

1. Распаковывает `vcr-host.exe` в `%LOCALAPPDATA%\Programs\VoiceClipRecorder\vcr-host.exe`.
2. Кладёт рядом `manifest.json` (Native Messaging manifest для Firefox).
3. Пишет в реестр `HKCU\Software\Mozilla\NativeMessagingHosts\com.voice_clip_recorder.host` (значение по умолчанию — путь к manifest.json).
4. Регистрирует приложение в `HKCU\...\Uninstall\VoiceClipRecorder`, чтобы оно появилось в «Установка и удаление программ».
5. (Опционально) создаёт ярлык «Voice Clip Recorder — записи» в меню «Пуск».

Удаление — через стандартный «Установка и удаление программ» Windows, либо `vcr-host` папка / `uninstall.exe /uninstall`.

## Native Messaging — протокол

Расширение подключается так:

```js
const port = browser.runtime.connectNative("com.voice_clip_recorder.host");
port.postMessage({ cmd: "start" });
port.onMessage.addListener(msg => console.log(msg));
```

Поддерживаемые команды:

| `cmd` | Параметры | Ответ |
|---|---|---|
| `ping` | — | `{ok, version, recording}` |
| `list-devices` | — | `{ok, devices:[{id,name,isDefault}]}` |
| `start` | `deviceId?`, `filename?` | `{ok, path, sampleRate, channels, bitsPerSample}` |
| `stop` | — | `{ok, path, bytes, durationMs}` |
| `cancel` | — | `{ok}` (удаляет файл) |
| `open-folder` | — | `{ok, path}` |
| `status` | — | `{ok, recording, seconds, bytes, outputDir}` |

Дополнительно хост push-ит событие `{event:"progress", seconds, bytes}` раз в секунду во время записи.

Записи сохраняются в `%USERPROFILE%\Music\VoiceClipRecorder\VCR-yyyyMMdd-HHmmss.wav`. Логи — `%LOCALAPPDATA%\VoiceClipRecorder\host.log`.

## Безопасность / права

- Установка только для текущего пользователя (HKCU + `%LOCALAPPDATA%`), UAC не требуется.
- Хост слушает только stdin от родительского процесса (браузер), сетевых интерфейсов не открывает.
- `allowed_extensions` в manifest ограничивает запуск только конкретным ID расширения (`voice-clip-recorder@local`).

## Поддержка Chrome / Edge

Сейчас инсталлятор регистрирует хост только для Firefox: у Chrome/Edge формат manifest другой (`allowed_origins: ["chrome-extension://<ID>/"]`), а опубликованного ID расширения пока нет. Когда расширение появится в Chrome Web Store, добавится отдельная регистрация.
