using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using NAudio.CoreAudioApi;
using NAudio.Wave;
using SharpAvi;
using SharpAvi.Codecs;
using SharpAvi.Output;

namespace VoiceClipRecorder.Host;

internal static class Program
{
    private const int VideoFps = 6;
    private const int MaxVideoWidth = 960;
    private const int MaxVideoHeight = 540;
    private const int Mpeg4Quality = 70;
    private const int Mpeg4BitRate = 6_000_000;

    private static readonly object Sync = new();
    private static WasapiLoopbackCapture? _capture;
    private static AviWriter? _aviWriter;
    private static IAviAudioStream? _audioStream;
    private static IAviVideoStream? _videoStream;
    private static string? _currentFile;
    private static DateTime _activeSegmentStartedAt;
    private static TimeSpan _activeDuration;
    private static long _bytesWritten;
    private static int _lastProgressEmittedSec = -1;
    private static Stream _stdout = Stream.Null;
    private static CancellationTokenSource? _videoCts;
    private static Task? _videoTask;
    private static Rectangle _captureBounds;
    private static Size _frameSize;
    private static bool _isPaused;

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
                Log("<- " + Truncate(json));

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
            try
            {
                var state = SnapshotCaptureState();
                if (state != null) DisposeCaptureState(state, deleteFile: true);
            }
            catch { }
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
        Log("-> " + Truncate(json));
    }

    private static object Dispatch(string json)
    {
        using var doc = JsonDocument.Parse(json);
        var cmd = doc.RootElement.GetProperty("cmd").GetString();
        return cmd switch
        {
            "ping"         => new { ok = true, version = "1.0.0", platform = "win", recording = _capture != null, paused = _isPaused },
            "list-devices" => ListDevices(),
            "start"        => StartRecording(doc.RootElement),
            "pause"        => PauseRecording(),
            "resume"       => ResumeRecording(),
            "stop"         => StopRecording(),
            "cancel"       => CancelRecording(),
            "open-folder"  => OpenOutputFolder(),
            "status"       => GetStatus(),
            _               => new { ok = false, error = "unknown cmd: " + cmd }
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
        }

        string? deviceId = el.TryGetProperty("deviceId", out var d) ? d.GetString() : null;
        string baseName = el.TryGetProperty("filename", out var f) ? (f.GetString() ?? "") : "";
        if (string.IsNullOrWhiteSpace(baseName))
            baseName = "VCR-" + DateTime.Now.ToString("yyyyMMdd-HHmmss") + ".avi";
        if (!baseName.EndsWith(".avi", StringComparison.OrdinalIgnoreCase))
            baseName += ".avi";
        baseName = MakeSafe(baseName);
        string outputPath = Path.Combine(OutDir, baseName);

        var en = new MMDeviceEnumerator();
        MMDevice device = string.IsNullOrEmpty(deviceId)
            ? en.GetDefaultAudioEndpoint(DataFlow.Render, Role.Multimedia)
            : en.GetDevice(deviceId);

        var capture = new WasapiLoopbackCapture(device);
        var writer = CreateAviWriter(outputPath);
        var audioStream = writer.AddAudioStream(
            capture.WaveFormat.Channels,
            capture.WaveFormat.SampleRate,
            capture.WaveFormat.BitsPerSample);
        audioStream.Name = "System Audio";

        Rectangle bounds = SystemInformation.VirtualScreen;
        if (bounds.Width <= 0 || bounds.Height <= 0)
            throw new InvalidOperationException("Не удалось определить область экрана для записи.");

        var frameSize = ScaleToFit(bounds.Size, MaxVideoWidth, MaxVideoHeight);
        var videoStream = CreateVideoStream(writer, frameSize.Width, frameSize.Height);
        videoStream.Name = "Desktop";
        var videoCts = new CancellationTokenSource();

        lock (Sync)
        {
            _capture = capture;
            _aviWriter = writer;
            _audioStream = audioStream;
            _videoStream = videoStream;
            _currentFile = outputPath;
            _bytesWritten = 0;
            _lastProgressEmittedSec = -1;
            _activeSegmentStartedAt = DateTime.UtcNow;
            _activeDuration = TimeSpan.Zero;
            _captureBounds = bounds;
            _frameSize = frameSize;
            _isPaused = false;
            _videoCts = videoCts;
            _videoTask = null;
        }

        capture.DataAvailable += OnDataAvailable;
        capture.RecordingStopped += OnRecordingStopped;

        var videoTask = Task.Run(() => CaptureVideoLoop(videoCts.Token), videoCts.Token);
        lock (Sync) { _videoTask = videoTask; }

        capture.StartRecording();

        return new
        {
            ok = true,
            path = outputPath,
            device = device.FriendlyName,
            sampleRate = capture.WaveFormat.SampleRate,
            channels = capture.WaveFormat.Channels,
            bitsPerSample = capture.WaveFormat.BitsPerSample,
            captureVideo = true,
            width = frameSize.Width,
            height = frameSize.Height,
            format = "avi"
        };
    }

    private static void OnDataAvailable(object? sender, WaveInEventArgs e)
    {
        long bytesWritten;
        bool paused;

        lock (Sync)
        {
            if (_audioStream == null || _isPaused) return;
            try
            {
                _audioStream.WriteBlock(e.Buffer, 0, e.BytesRecorded);
                _bytesWritten += e.BytesRecorded;
            }
            catch (Exception ex)
            {
                Log("audio write error: " + ex.Message);
                return;
            }

            bytesWritten = _bytesWritten;
            paused = _isPaused;
        }

        int sec;
        lock (Sync)
        {
            sec = (int)GetCurrentDurationUnsafe().TotalSeconds;
        }

        if (sec != _lastProgressEmittedSec)
        {
            _lastProgressEmittedSec = sec;
            try { Send(new { @event = "progress", seconds = sec, bytes = bytesWritten, paused }); }
            catch (Exception ex) { Log("send progress error: " + ex.Message); }
        }
    }

    private static void OnRecordingStopped(object? sender, StoppedEventArgs e)
    {
        if (e.Exception != null) Log("recording stopped with error: " + e.Exception);
    }

    private static object PauseRecording()
    {
        lock (Sync)
        {
            if (_capture == null) return new { ok = false, error = "not recording" };
            if (_isPaused) return new { ok = true, paused = true };
            _activeDuration += DateTime.UtcNow - _activeSegmentStartedAt;
            _isPaused = true;
            return new { ok = true, paused = true };
        }
    }

    private static object ResumeRecording()
    {
        lock (Sync)
        {
            if (_capture == null) return new { ok = false, error = "not recording" };
            if (!_isPaused) return new { ok = true, paused = false };
            _activeSegmentStartedAt = DateTime.UtcNow;
            _isPaused = false;
            return new { ok = true, paused = false };
        }
    }

    private static object StopRecording()
    {
        var state = SnapshotCaptureState();
        if (state == null) return new { ok = false, error = "not recording" };

        DisposeCaptureState(state, deleteFile: false);

        string path = state.Path ?? "";
        long size = File.Exists(path) ? new FileInfo(path).Length : 0;
        return new { ok = true, path, bytes = size, durationMs = state.Duration.TotalMilliseconds, format = "avi" };
    }

    private static object CancelRecording()
    {
        var state = SnapshotCaptureState();
        if (state == null) return new { ok = false, error = "not recording" };

        DisposeCaptureState(state, deleteFile: true);
        return new { ok = true };
    }

    private static CaptureState? SnapshotCaptureState()
    {
        lock (Sync)
        {
            if (_capture == null || _aviWriter == null) return null;
            if (!_isPaused)
                _activeDuration += DateTime.UtcNow - _activeSegmentStartedAt;

            var state = new CaptureState(
                _capture,
                _aviWriter,
                _videoCts,
                _videoTask,
                _currentFile,
                _activeDuration);

            _capture = null;
            _aviWriter = null;
            _audioStream = null;
            _videoStream = null;
            _videoCts = null;
            _videoTask = null;
            _currentFile = null;
            _captureBounds = Rectangle.Empty;
            _frameSize = Size.Empty;
            _isPaused = false;
            _activeDuration = TimeSpan.Zero;
            _bytesWritten = 0;
            _lastProgressEmittedSec = -1;

            return state;
        }
    }

    private static void DisposeCaptureState(CaptureState state, bool deleteFile)
    {
        try { state.VideoCts?.Cancel(); } catch { }
        try { state.VideoTask?.Wait(TimeSpan.FromSeconds(5)); } catch (AggregateException ex) when (ex.InnerExceptions.All(inner => inner is OperationCanceledException)) { } catch { }
        try { state.Capture?.StopRecording(); } catch (Exception ex) { Log("stop err: " + ex.Message); }
        try { state.Capture?.Dispose(); } catch { }
        try { state.Writer.Close(); } catch (Exception ex) { Log("writer close error: " + ex.Message); }

        if (deleteFile && !string.IsNullOrWhiteSpace(state.Path))
        {
            try { if (File.Exists(state.Path)) File.Delete(state.Path); } catch { }
        }
    }

    private static void CaptureVideoLoop(CancellationToken token)
    {
        int intervalMs = Math.Max(1, 1000 / VideoFps);
        Rectangle bounds;
        Size frameSize;
        lock (Sync)
        {
            bounds = _captureBounds;
            frameSize = _frameSize;
        }
        if (bounds.Width <= 0 || bounds.Height <= 0) return;

        using var sourceBitmap = new Bitmap(bounds.Width, bounds.Height, PixelFormat.Format24bppRgb);
        using var sourceGraphics = Graphics.FromImage(sourceBitmap);
        using var frameBitmap = new Bitmap(frameSize.Width, frameSize.Height, PixelFormat.Format24bppRgb);
        using var frameGraphics = Graphics.FromImage(frameBitmap);

        while (!token.IsCancellationRequested)
        {
            var frameStarted = Stopwatch.StartNew();
            bool paused;
            IAviVideoStream? videoStream;

            lock (Sync)
            {
                paused = _isPaused;
                videoStream = _videoStream;
            }

            if (!paused && videoStream != null)
            {
                try
                {
                    var frame = CaptureFrame(sourceBitmap, sourceGraphics, frameBitmap, frameGraphics, bounds, frameSize);
                    lock (Sync)
                    {
                        if (_videoStream != null && !_isPaused)
                        {
                            _videoStream.WriteFrame(true, frame, 0, frame.Length);
                            _bytesWritten += frame.Length;
                        }
                    }
                }
                catch (Exception ex)
                {
                    Log("video write error: " + ex.Message);
                }
            }

            int delay = intervalMs - (int)frameStarted.ElapsedMilliseconds;
            if (delay > 0 && token.WaitHandle.WaitOne(delay))
                break;
        }
    }

    private static IAviVideoStream CreateVideoStream(AviWriter writer, int width, int height)
    {
        try
        {
            var encoder = new Mpeg4VcmVideoEncoder(width, height, VideoFps, Mpeg4Quality, Mpeg4BitRate, Array.Empty<FourCC>());
            return writer.AddEncodingVideoStream(encoder, true, width, height);
        }
        catch (Exception ex)
        {
            Log("mpeg4-vcm unavailable, fallback to raw AVI: " + ex.Message);
            return writer.AddVideoStream(width, height, BitsPerPixel.Bpp24);
        }
    }

    private static byte[] CaptureFrame(Bitmap sourceBitmap, Graphics sourceGraphics, Bitmap frameBitmap, Graphics frameGraphics, Rectangle bounds, Size frameSize)
    {
        sourceGraphics.CopyFromScreen(bounds.Left, bounds.Top, 0, 0, bounds.Size, CopyPixelOperation.SourceCopy);

        if (sourceBitmap.Width == frameSize.Width && sourceBitmap.Height == frameSize.Height)
        {
            return ExtractFrameBytes(sourceBitmap);
        }

        frameGraphics.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.HighQualityBilinear;
        frameGraphics.PixelOffsetMode = System.Drawing.Drawing2D.PixelOffsetMode.HighQuality;
        frameGraphics.DrawImage(sourceBitmap, new Rectangle(Point.Empty, frameSize));
        return ExtractFrameBytes(frameBitmap);
    }

    private static byte[] ExtractFrameBytes(Bitmap bitmap)
    {
        var rect = new Rectangle(0, 0, bitmap.Width, bitmap.Height);
        var data = bitmap.LockBits(rect, ImageLockMode.ReadOnly, PixelFormat.Format24bppRgb);
        try
        {
            int rowBytes = bitmap.Width * 3;
            var raw = new byte[rowBytes * bitmap.Height];
            for (int y = 0; y < bitmap.Height; y++)
            {
                var row = IntPtr.Add(data.Scan0, y * data.Stride);
                Marshal.Copy(row, raw, y * rowBytes, rowBytes);
            }
            return raw;
        }
        finally
        {
            bitmap.UnlockBits(data);
        }
    }

    private static Size ScaleToFit(Size original, int maxWidth, int maxHeight)
    {
        if (original.Width <= maxWidth && original.Height <= maxHeight)
            return original;

        double scale = Math.Min((double)maxWidth / original.Width, (double)maxHeight / original.Height);
        return new Size(
            Math.Max(2, (int)Math.Round(original.Width * scale)),
            Math.Max(2, (int)Math.Round(original.Height * scale)));
    }

    private static AviWriter CreateAviWriter(string outputPath)
    {
        return new AviWriter(outputPath)
        {
            FramesPerSecond = VideoFps,
            EmitIndex1 = true
        };
    }

    private static object OpenOutputFolder()
    {
        try
        {
            Process.Start(new ProcessStartInfo
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
                paused = _isPaused,
                path = _currentFile,
                seconds = _capture != null ? (int)GetCurrentDurationUnsafe().TotalSeconds : 0,
                bytes = _bytesWritten,
                outputDir = OutDir
            };
        }
    }

    private static TimeSpan GetCurrentDurationUnsafe()
    {
        var duration = _activeDuration;
        if (_capture != null && !_isPaused)
            duration += DateTime.UtcNow - _activeSegmentStartedAt;
        return duration;
    }

    private static string MakeSafe(string s)
    {
        foreach (var c in Path.GetInvalidFileNameChars()) s = s.Replace(c, '_');
        return s;
    }

    private static string Truncate(string s) => s.Length > 400 ? s.Substring(0, 400) + "..." : s;

    private static void Log(string msg)
    {
        try
        {
            File.AppendAllText(LogFile, $"[{DateTime.Now:HH:mm:ss.fff}] {msg}\n");
        }
        catch { }
    }

    private sealed record CaptureState(
        WasapiLoopbackCapture Capture,
        AviWriter Writer,
        CancellationTokenSource? VideoCts,
        Task? VideoTask,
        string? Path,
        TimeSpan Duration);
}
