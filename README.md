# Voice Clip Recorder

Firefox-расширение для записи экрана Windows и системного звука через локальный нативный помощник. Браузерная часть теперь работает как пульт управления: старт, стоп, пауза, отложенный старт и авто-пауза.

Состоит из двух частей:

| Компонент | Папка | Что это |
|---|---|---|
| **Расширение Firefox** | [`extension/`](extension/) | Пульт управления. Открывает страницу с минимальным UI и управляет helper через Native Messaging. |
| **Native helper** | [`native/`](native/) | .NET 8 приложение `vcr-host.exe`, которое пишет экран рабочего стола и системный звук в AVI. Поставляется WPF-инсталлятором без UAC. |

## Возможности

- Запись экрана Windows и системного звука полностью через локальный helper.
- Старт, стоп, пауза и продолжение записи из Firefox.
- Отложенный старт и авто-пауза по таймеру.
- Открытие папки с записью прямо из интерфейса расширения.
- Сохранение файлов в `%USERPROFILE%\Music\VoiceClipRecorder\`.

## Установка

### Шаг 1 — Помощник

1. Скачайте [`VoiceClipRecorderSetup.exe`](https://github.com/vovankrot/voice-clip-recorder/releases/latest) из последнего релиза.
2. Запустите — установка идёт в `%LOCALAPPDATA%\Programs\VoiceClipRecorder\` без UAC.
3. Установщик автоматически регистрирует Native Messaging Host в реестре Firefox (`HKCU\Software\Mozilla\NativeMessagingHosts\com.voice_clip_recorder.host`).

### Шаг 2 — Расширение Firefox

Установите [`voice-clip-recorder-v1.3.0-firefox.xpi`](https://github.com/vovankrot/voice-clip-recorder/releases/latest) из того же релиза.

## Использование

1. Откройте Firefox и нажмите иконку расширения.
2. При необходимости задайте `Отложенный старт` и/или `Авто-паузу после старта`.
3. Нажмите `Старт`.
4. Во время записи используйте `Пауза` / `Продолжить` или `Стоп`.
5. После завершения нажмите `Открыть папку`.

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

Требуется .NET 8 SDK. Результат: `native/dist/VoiceClipRecorderSetup-v1.0.0.exe`.

## Лицензия

MIT — см. [LICENSE](LICENSE).
