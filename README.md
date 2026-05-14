# Voice Clip Recorder

Минималистичный диктофон для Firefox: микрофон, звук вкладки/экрана, видео и — главное — **полноценный захват системного звука Windows** через нативное приложение-помощника.

Состоит из двух частей:

| Компонент | Папка | Что это |
|---|---|---|
| **Расширение Firefox** | [`extension/`](extension/) | Сам диктофон. UI на странице, MediaRecorder для микрофона / `getDisplayMedia` для вкладки. |
| **Native helper** | [`native/`](native/) | .NET 8 приложение `vcr-host.exe`, которое пишет системный звук через WASAPI loopback. Поставляется красивым WPF-инсталятором без UAC. |

## Возможности

- Запись микрофона, звука вкладки/экрана, видео — стандартные WebExtension API
- **Системный звук Windows** через помощника (обходит ограничение Firefox, который не отдаёт звук при захвате окна/экрана)
- Несколько форматов: OGG Opus, WebM Opus, WAV PCM, видео WebM VP8/VP9
- Регулировка громкости источников и индикаторы уровня
- Файлы сохраняются на диск в `%USERPROFILE%\Music\VoiceClipRecorder\`

## Установка

### Шаг 1 — Помощник (для системного звука)

1. Скачайте [`VoiceClipRecorderSetup.exe`](https://github.com/vovankrot/voice-clip-recorder/releases/latest) из последнего релиза.
2. Запустите — установка идёт в `%LOCALAPPDATA%\Programs\VoiceClipRecorder\` без UAC.
3. Установщик автоматически регистрирует Native Messaging Host в реестре Firefox (`HKCU\Software\Mozilla\NativeMessagingHosts\com.voice_clip_recorder.host`).

### Шаг 2 — Расширение Firefox

Установите [`voice-clip-recorder-v1.2.0-firefox.xpi`](https://github.com/vovankrot/voice-clip-recorder/releases/latest) из того же релиза (перетащите файл в Firefox).

## Использование

1. Откройте Firefox, нажмите иконку расширения — откроется страница диктофона.
2. Выберите источники:
   - **Микрофон** — обычный микрофон через `getUserMedia`
   - **Звук вкладки / экрана** — `getDisplayMedia` (есть ограничения Firefox)
   - **Видео** — захват окна с видеодорожкой
   - **Системный звук (через помощник)** — рекомендуется для записи любого системного звука. Использует Native Messaging.
3. Нажмите «Записать».

## Сборка из исходников

### Расширение (XPI)

```powershell
cd extension
powershell -ExecutionPolicy Bypass -File .\build-xpi.ps1
```

### Native installer (EXE)

```powershell
cd native
powershell -ExecutionPolicy Bypass -File .\build.ps1
```

Требуется .NET 8 SDK. Результат: `native/dist/VoiceClipRecorderSetup-v1.0.0.exe` (~137 MB, single-file self-contained win-x64).

## Лицензия

MIT — см. [LICENSE](LICENSE).
