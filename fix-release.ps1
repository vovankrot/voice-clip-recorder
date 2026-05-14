$token = (git credential fill | ConvertFrom-StringData).password
$releaseId = 322371895

$body = @{
    name = "v1.0.0 — Начальный релиз"
    body = @"
🎙️ Голосовой диктофон для Firefox с поддержкой системного звука.

📋 Компоненты:
• Firefox расширение v1.2.0 (XPI) — Native Messaging integration
• Native helper v1.0.0 (.NET 8, WPF) — WASAPI loopback capture

✨ Возможности:
1. Запись микрофона (микро, наушники, разные форматы)
2. Запись системного звука (YouTube, встречи, плеер) — через помощник
3. Сохранение в %USERPROFILE%\Music\VoiceClipRecorder\
4. Прямая загрузка файлов

🔧 Инструкция:
1. VoiceClipRecorderSetup-v1.0.0.exe — устанавливает Native Messaging Host
2. voice-clip-recorder-v1.2.0-firefox.xpi — установить в Firefox
3. Перезагрузить Firefox
4. Откроется страница с инструкциями

🌐 Исходный код: https://github.com/vovankrot/voice-clip-recorder
"@
} | ConvertTo-Json -Depth 4

$uri = "https://api.github.com/repos/vovankrot/voice-clip-recorder/releases/$releaseId"
$headers = @{ 
    Authorization = "Bearer $token"
    Accept = 'application/vnd.github.v3+json'
}

Write-Host "Updating release $releaseId..." -ForegroundColor Cyan
$response = Invoke-RestMethod -Uri $uri -Method PATCH -Headers $headers -Body $body -ContentType 'application/json; charset=utf-8'
Write-Host "✓ Релиз обновлен с корректной кодировкой" -ForegroundColor Green
Write-Host "Release: https://github.com/vovankrot/voice-clip-recorder/releases/tag/v1.0.0" -ForegroundColor White
