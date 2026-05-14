using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Text.Json;
using NAudio.CoreAudioApi;
using NAudio.Wave;

namespace VoiceClipRecorder.Host;

internal static class Program
{
    private static readonly object Sync = new();
    private static WasapiLoopbackCapture? _capture;
    private static WaveFileWriter? _writer;
    private static string? _currentFile;
    private static DateTime _startedAt;
    private static long _bytesWritten;
    private static int _lastProgressEmittedSec = -1;
    private static Stream _stdout = Stream.Null;

    private static readonly string LogDir = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "VoiceClipRecorder");

    private static readonly string OutDir = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.MyMusic),
        "VoiceClipRecorder");

    private static readonly string LogFile = Path.Combine(LogDir, "host.log");

    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping
    };

    static int Main(string[] args)
    {
        try
        {
            Directory.CreateDirectory(LogDir);
            Directory.CreateDirectory(OutDir);

            // CLI helpers used by installer / manual checks.
            if (args.Length > 0)
            {
                switch (args[0])
                {
                    case "--version":
                        Console.WriteLine("1.0.0");
                        return 0;
                    case "--probe":
                        Console.WriteLine("ok");
                        return 0;
                }
            }

            Log($"host started (pid {Environment.ProcessId})");

            var stdin = Console.OpenStandardInput();
            _stdout = Console.OpenStandardOutput();

            while (true)
            {
                var lenBytes = new byte[4];
                int read = ReadExact(stdin, lenBytes, 0, 4);
                if (read == 0) { Log("stdin closed, exiting"); break; }
                if (read != 4) { Log($"short read header ({read})"); break; }

                int len = BitConverter.ToInt32(lenBytes, 0);
                if (len <= 0 || len > 1024 * 1024)
                {
                    Log($"bad message length {len}");
                    break;
                }

                var buf = new byte[len];
                if (ReadExact(stdin, buf, 0, len) != len)
                {
                    Log("short read body");
                    break;
                }

                var json = Encoding.UTF8.GetString(buf);
                Log("← " + Truncate(json));

                object response;
                try
                {
                    response = Dispatch(json);
                }
                catch (Exception ex)
                {
                    Log("dispatch error: " + ex);
                    response = new { ok = false, error = ex.Message };
                }

                Send(response);
            }

            return 0;
        }
        catch (Exception ex)
        {
            Log("fatal: " + ex);
            return 1;
        }
        finally
        {
            try { lock (Sync) { CancelInternal(); } } catch { }
        }
    }

    private static int ReadExact(Stream s, byte[] buf, int off, int count)
    {
        int total = 0;
        while (total < count)
        {
            int n = s.Read(buf, off + total, count - total);
            if (n <= 0) return total;
            total += n;
        }
        return total;
    }

    private static void Send(object payload)
    {
        var json = JsonSerializer.Serialize(payload, JsonOpts);
        var bytes = Encoding.UTF8.GetBytes(json);
        lock (_stdout)
        {
            _stdout.Write(BitConverter.GetBytes(bytes.Length), 0, 4);
            _stdout.Write(bytes, 0, bytes.Length);
            _stdout.Flush();
        }
        Log("→ " + Truncate(json));
    }

    private static object Dispatch(string json)
    {
        using var doc = JsonDocument.Parse(json);
        var cmd = doc.RootElement.GetProperty("cmd").GetString();
        return cmd switch
        {
            "ping"         => new { ok = true, version = "1.0.0", platform = "win", recording = _capture != null },
            "list-devices" => ListDevices(),
            "start"        => StartRecording(doc.RootElement),
            "stop"         => StopRecording(),
            "cancel"       => CancelRecording(),
            "open-folder"  => OpenOutputFolder(),
            "status"       => GetStatus(),
            _              => new { ok = false, error = "unknown cmd: " + cmd }
        };
    }

    private static object ListDevices()
    {
        var en = new MMDeviceEnumerator();
        string defId = en.GetDefaultAudioEndpoint(DataFlow.Render, Role.Multimedia).ID;
        var list = new List<object>();
        foreach (var d in en.EnumerateAudioEndPoints(DataFlow.Render, DeviceState.Active))
        {
            list.Add(new { id = d.ID, name = d.FriendlyName, isDefault = d.ID == defId });
        }
        return new { ok = true, devices = list };
    }

    private static object StartRecording(JsonElement el)
    {
        lock (Sync)
        {
            if (_capture != null) return new { ok = false, error = "already recording" };

            string? deviceId = el.TryGetProperty("deviceId", out var d) ? d.GetString() : null;
            string baseName = el.TryGetProperty("filename", out var f) ? (f.GetString() ?? "") : "";
            if (string.IsNullOrWhiteSpace(baseName))
                baseName = "VCR-" + DateTime.Now.ToString("yyyyMMdd-HHmmss") + ".wav";
            if (!baseName.EndsWith(".wav", StringComparison.OrdinalIgnoreCase))
                baseName += ".wav";
            baseName = MakeSafe(baseName);
            _currentFile = Path.Combine(OutDir, baseName);

            var en = new MMDeviceEnumerator();
            MMDevice device = string.IsNullOrEmpty(deviceId)
                ? en.GetDefaultAudioEndpoint(DataFlow.Render, Role.Multimedia)
                : en.GetDevice(deviceId);

            _capture = new WasapiLoopbackCapture(device);
            _writer = new WaveFileWriter(_currentFile, _capture.WaveFormat);
            _bytesWritten = 0;
            _lastProgressEmittedSec = -1;

            _capture.DataAvailable += OnDataAvailable;
            _capture.RecordingStopped += (s, e) =>
            {
                lock (Sync) { _writer?.Dispose(); _writer = null; }
                if (e.Exception != null) Log("recording stopped with error: " + e.Exception);
            };

            _capture.StartRecording();
            _startedAt = DateTime.UtcNow;

            return new
            {
                ok = true,
                path = _currentFile,
                device = device.FriendlyName,
                sampleRate = _capture.WaveFormat.SampleRate,
                channels = _capture.WaveFormat.Channels,
                bitsPerSample = _capture.WaveFormat.BitsPerSample
            };
        }
    }

    private static void OnDataAvailable(object? sender, WaveInEventArgs e)
    {
        lock (Sync)
        {
            if (_writer == null) return;
            try
            {
                _writer.Write(e.Buffer, 0, e.BytesRecorded);
                _bytesWritten += e.BytesRecorded;
            }
            catch (Exception ex)
            {
                Log("write error: " + ex.Message);
                return;
            }
        }

        int sec = (int)(DateTime.UtcNow - _startedAt).TotalSeconds;
        if (sec != _lastProgressEmittedSec)
        {
            _lastProgressEmittedSec = sec;
            try { Send(new { @event = "progress", seconds = sec, bytes = _bytesWritten }); }
            catch (Exception ex) { Log("send progress error: " + ex.Message); }
        }
    }

    private static object StopRecording()
    {
        lock (Sync)
        {
            if (_capture == null) return new { ok = false, error = "not recording" };
            string path = _currentFile ?? "";
            try { _capture.StopRecording(); } catch (Exception ex) { Log("stop err: " + ex.Message); }
            try { _capture.Dispose(); } catch { }
            _capture = null;
            _writer?.Dispose();
            _writer = null;

            long size = File.Exists(path) ? new FileInfo(path).Length : 0;
            double ms = (DateTime.UtcNow - _startedAt).TotalMilliseconds;
            return new { ok = true, path, bytes = size, durationMs = ms };
        }
    }

    private static object CancelRecording()
    {
        lock (Sync)
        {
            if (_capture == null) return new { ok = false, error = "not recording" };
            CancelInternal();
            return new { ok = true };
        }
    }

    private static void CancelInternal()
    {
        try { _capture?.StopRecording(); } catch { }
        try { _capture?.Dispose(); } catch { }
        _capture = null;
        _writer?.Dispose();
        _writer = null;
        try { if (_currentFile != null && File.Exists(_currentFile)) File.Delete(_currentFile); } catch { }
        _currentFile = null;
    }

    private static object OpenOutputFolder()
    {
        try
        {
            System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo
            {
                FileName = OutDir,
                UseShellExecute = true
            });
            return new { ok = true, path = OutDir };
        }
        catch (Exception ex)
        {
            return new { ok = false, error = ex.Message };
        }
    }

    private static object GetStatus()
    {
        lock (Sync)
        {
            return new
            {
                ok = true,
                recording = _capture != null,
                path = _currentFile,
                seconds = _capture != null ? (int)(DateTime.UtcNow - _startedAt).TotalSeconds : 0,
                bytes = _bytesWritten,
                outputDir = OutDir
            };
        }
    }

    private static string MakeSafe(string s)
    {
        foreach (var c in Path.GetInvalidFileNameChars()) s = s.Replace(c, '_');
        return s;
    }

    private static string Truncate(string s) => s.Length > 400 ? s.Substring(0, 400) + "…" : s;

    private static void Log(string msg)
    {
        try
        {
            File.AppendAllText(LogFile, $"[{DateTime.Now:HH:mm:ss.fff}] {msg}\n");
        }
        catch { }
    }
}
