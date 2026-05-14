using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Text.Json;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using Microsoft.Win32;

namespace VoiceClipRecorder.Installer;

public partial class MainWindow : Window
{
    private const string AppName        = "Voice Clip Recorder";
    private const string AppPublisher   = "vovankrot";
    private const string AppVersion     = "1.0.0";
    private const string HostName       = "com.voice_clip_recorder.host";
    private const string HostExeName    = "vcr-host.exe";
    private const string UninstallExeName = "uninstall.exe";
    private const string FirefoxExtensionId = "voice-clip-recorder@local";

    private static readonly string InstallDir = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "Programs", "VoiceClipRecorder");

    private static readonly string HostExePath = Path.Combine(InstallDir, HostExeName);
    private static readonly string ManifestPath = Path.Combine(InstallDir, "manifest.json");
    private static readonly string UninstallerPath = Path.Combine(InstallDir, UninstallExeName);

    private const string UninstallRegPath =
        @"Software\Microsoft\Windows\CurrentVersion\Uninstall\VoiceClipRecorder";

    private enum Step { Ready, ReadyUninstall, Installing, Done, Uninstalling, UninstallDone, Error }
    private Step _step;
    private bool _isInstalled;

    public MainWindow()
    {
        InitializeComponent();

        InstallPathText.Text = InstallDir;
        VersionTag.Text = "v" + AppVersion;

        _isInstalled = IsInstalled();

        bool forceUninstall = false;
        foreach (var a in Environment.GetCommandLineArgs())
            if (string.Equals(a, "/uninstall", StringComparison.OrdinalIgnoreCase) ||
                string.Equals(a, "--uninstall", StringComparison.OrdinalIgnoreCase))
                forceUninstall = true;

        if (forceUninstall && _isInstalled)
            ShowReadyUninstall();
        else if (_isInstalled)
            ShowReadyUninstall();
        else
            ShowReady();
    }

    // ---------- screens ----------

    private void ShowReady()
    {
        _step = Step.Ready;
        SwapVisible(ScreenReady);
        HeaderTitle.Text = "Готов к установке";
        HeaderSubtitle.Text =
            "Будет установлено приложение-помощник, которое запишет звук из Firefox и других программ. Не требует прав администратора.";
        BtnPrimary.Content = "Установить";
        BtnPrimary.IsEnabled = true;
        BtnSecondary.Content = "Отмена";
        BtnSecondary.Visibility = Visibility.Visible;
        BtnSecondary.IsEnabled = true;
    }

    private void ShowReadyUninstall()
    {
        _step = Step.ReadyUninstall;
        SwapVisible(ScreenReady);
        HeaderTitle.Text = "Voice Clip Recorder уже установлен";
        HeaderSubtitle.Text =
            "Программа найдена в системе. Можно переустановить (свежая версия из этого инсталлятора) или удалить.";
        BtnPrimary.Content = "Удалить";
        BtnPrimary.IsEnabled = true;
        BtnSecondary.Content = "Переустановить";
        BtnSecondary.Visibility = Visibility.Visible;
        BtnSecondary.IsEnabled = true;
    }

    private void ShowProgress(string title)
    {
        SwapVisible(ScreenProgress);
        ProgressStatus.Text = title;
        ProgressBar.Value = 0;
        BtnPrimary.IsEnabled = false;
        BtnSecondary.IsEnabled = false;
    }

    private void ShowDone(bool uninstalled)
    {
        _step = uninstalled ? Step.UninstallDone : Step.Done;
        SwapVisible(ScreenDone);
        if (uninstalled)
        {
            DoneTitle.Text = "Удалено";
            DoneSubtitle.Text = "Программа-помощник и регистрация в браузерах удалены.";
        }
        else
        {
            DoneTitle.Text = "Готово!";
            DoneSubtitle.Text =
                $"Программа-помощник установлена в {InstallDir}.\nОткройте расширение Voice Clip Recorder в Firefox — оно само подключится к программе.";
        }
        BtnPrimary.Content = "Закрыть";
        BtnPrimary.IsEnabled = true;
        BtnSecondary.Visibility = Visibility.Collapsed;
    }

    private void ShowError(string msg)
    {
        _step = Step.Error;
        SwapVisible(ScreenError);
        ErrorMessage.Text = msg;
        BtnPrimary.Content = "Закрыть";
        BtnPrimary.IsEnabled = true;
        BtnSecondary.Visibility = Visibility.Collapsed;
    }

    private void SwapVisible(FrameworkElement target)
    {
        ScreenReady.Visibility    = ReferenceEquals(target, ScreenReady)    ? Visibility.Visible : Visibility.Collapsed;
        ScreenProgress.Visibility = ReferenceEquals(target, ScreenProgress) ? Visibility.Visible : Visibility.Collapsed;
        ScreenDone.Visibility     = ReferenceEquals(target, ScreenDone)     ? Visibility.Visible : Visibility.Collapsed;
        ScreenError.Visibility    = ReferenceEquals(target, ScreenError)    ? Visibility.Visible : Visibility.Collapsed;
    }

    // ---------- buttons ----------

    private void Caption_MouseLeftButtonDown(object sender, MouseButtonEventArgs e)
    {
        if (e.ChangedButton == MouseButton.Left) DragMove();
    }
    private void Minimize_Click(object sender, RoutedEventArgs e) => WindowState = WindowState.Minimized;
    private void Close_Click(object sender, RoutedEventArgs e) => Close();

    private async void Primary_Click(object sender, RoutedEventArgs e)
    {
        switch (_step)
        {
            case Step.Ready:           await RunInstallAsync();   break;
            case Step.ReadyUninstall:  await RunUninstallAsync(); break;
            case Step.Done:
            case Step.UninstallDone:
            case Step.Error:           Close();                   break;
        }
    }

    private async void Secondary_Click(object sender, RoutedEventArgs e)
    {
        switch (_step)
        {
            case Step.Ready:           Close(); break;
            case Step.ReadyUninstall:  await RunInstallAsync(); break;
            default:                   Close(); break;
        }
    }

    // ---------- install ----------

    private async Task RunInstallAsync()
    {
        ShowProgress("Подготовка...");
        _step = Step.Installing;
        try
        {
            await Task.Run(() => Install());
            ShowDone(false);
        }
        catch (Exception ex)
        {
            ShowError(ex.Message);
        }
    }

    private void Install()
    {
        Report(10, "Создание папки установки...");
        Directory.CreateDirectory(InstallDir);

        Report(25, "Распаковка vcr-host.exe...");
        ExtractEmbeddedHostExe(HostExePath);

        Report(45, "Копирование установщика для удаления...");
        CopySelfTo(UninstallerPath);

        Report(60, "Запись Native Messaging manifest...");
        WriteHostManifest(ManifestPath, HostExePath);

        Report(75, "Регистрация в Firefox...");
        RegisterFirefox(ManifestPath);

        if (ChkStartMenu.IsChecked == true)
        {
            Report(85, "Создание ярлыка в меню «Пуск»...");
            try { CreateStartMenuShortcut(); } catch { /* non-fatal */ }
        }

        Report(95, "Регистрация в «Программах и компонентах»...");
        WriteUninstallEntry();

        Report(100, "Готово.");
    }

    private async Task RunUninstallAsync()
    {
        ShowProgress("Удаление...");
        _step = Step.Uninstalling;
        try
        {
            await Task.Run(Uninstall);
            ShowDone(true);
        }
        catch (Exception ex)
        {
            ShowError(ex.Message);
        }
    }

    private void Uninstall()
    {
        Report(20, "Удаление регистрации в Firefox...");
        try { Registry.CurrentUser.DeleteSubKey($@"Software\Mozilla\NativeMessagingHosts\{HostName}", false); } catch { }

        Report(40, "Удаление ярлыка...");
        try { RemoveStartMenuShortcut(); } catch { }

        Report(55, "Удаление записи в «Программах и компонентах»...");
        try { Registry.CurrentUser.DeleteSubKeyTree(UninstallRegPath, false); } catch { }

        Report(70, "Удаление файлов...");
        // Try to remove host exe + manifest, but leave the running uninstaller until exit.
        try { if (File.Exists(HostExePath)) File.Delete(HostExePath); } catch { }
        try { if (File.Exists(ManifestPath)) File.Delete(ManifestPath); } catch { }

        Report(90, "Удаление папки...");
        try
        {
            // schedule self-delete of uninstall.exe + its folder on reboot if locked,
            // otherwise drop a small cleanup .cmd that runs after process exit.
            ScheduleSelfCleanup();
        }
        catch { }

        Report(100, "Готово.");
    }

    private void Report(int percent, string status)
    {
        Dispatcher.Invoke(() =>
        {
            ProgressBar.Value = percent;
            ProgressStatus.Text = status;
        });
    }

    // ---------- file operations ----------

    private static void ExtractEmbeddedHostExe(string targetPath)
    {
        var asm = Assembly.GetExecutingAssembly();
        string? resourceName = null;
        foreach (var n in asm.GetManifestResourceNames())
            if (n.EndsWith("vcr-host.exe", StringComparison.OrdinalIgnoreCase))
                { resourceName = n; break; }

        if (resourceName == null)
            throw new InvalidOperationException(
                "vcr-host.exe не вшит в установщик. Запустите build.ps1 чтобы пересобрать.");

        using var src = asm.GetManifestResourceStream(resourceName)
            ?? throw new InvalidOperationException("Не удалось открыть встроенный ресурс.");
        using var dst = File.Create(targetPath);
        src.CopyTo(dst);
    }

    private static void CopySelfTo(string targetPath)
    {
        var self = Process.GetCurrentProcess().MainModule?.FileName
            ?? throw new InvalidOperationException("Не удалось определить путь к установщику.");
        if (string.Equals(Path.GetFullPath(self), Path.GetFullPath(targetPath), StringComparison.OrdinalIgnoreCase))
            return; // already running as uninstaller from install dir
        File.Copy(self, targetPath, overwrite: true);
    }

    private static void WriteHostManifest(string path, string hostExePath)
    {
        var manifest = new Dictionary<string, object>
        {
            ["name"] = HostName,
            ["description"] = "Voice Clip Recorder native host",
            ["path"] = hostExePath,
            ["type"] = "stdio",
            ["allowed_extensions"] = new[] { FirefoxExtensionId }
        };
        var json = JsonSerializer.Serialize(manifest, new JsonSerializerOptions { WriteIndented = true });
        File.WriteAllText(path, json);
    }

    private static void RegisterFirefox(string manifestPath)
    {
        using var k = Registry.CurrentUser.CreateSubKey($@"Software\Mozilla\NativeMessagingHosts\{HostName}")
            ?? throw new InvalidOperationException("Не удалось открыть ключ реестра Firefox.");
        k.SetValue(null, manifestPath, RegistryValueKind.String);
    }

    private static void WriteUninstallEntry()
    {
        using var k = Registry.CurrentUser.CreateSubKey(UninstallRegPath)
            ?? throw new InvalidOperationException("Не удалось создать запись Uninstall.");
        k.SetValue("DisplayName", AppName);
        k.SetValue("DisplayVersion", AppVersion);
        k.SetValue("Publisher", AppPublisher);
        k.SetValue("InstallLocation", InstallDir);
        k.SetValue("DisplayIcon", HostExePath);
        k.SetValue("UninstallString", $"\"{UninstallerPath}\" /uninstall");
        k.SetValue("NoModify", 1, RegistryValueKind.DWord);
        k.SetValue("NoRepair", 1, RegistryValueKind.DWord);
        k.SetValue("EstimatedSize", 80_000, RegistryValueKind.DWord);
    }

    private static bool IsInstalled()
    {
        try
        {
            using var k = Registry.CurrentUser.OpenSubKey(UninstallRegPath);
            return k != null;
        }
        catch { return false; }
    }

    // ---------- shortcuts ----------

    private static string StartMenuLinkPath
    {
        get
        {
            var dir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.Programs),
                "Voice Clip Recorder");
            return Path.Combine(dir, "Voice Clip Recorder — записи.lnk");
        }
    }

    private static void CreateStartMenuShortcut()
    {
        string lnk = StartMenuLinkPath;
        Directory.CreateDirectory(Path.GetDirectoryName(lnk)!);

        string recordingsDir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.MyMusic),
            "VoiceClipRecorder");
        Directory.CreateDirectory(recordingsDir);

        Type? t = Type.GetTypeFromProgID("WScript.Shell");
        if (t == null) return;
        dynamic shell = Activator.CreateInstance(t)!;
        dynamic sc = shell.CreateShortcut(lnk);
        sc.TargetPath = recordingsDir;
        sc.WorkingDirectory = recordingsDir;
        sc.Description = "Открыть папку с записями Voice Clip Recorder";
        sc.IconLocation = HostExePath + ",0";
        sc.Save();

        // Also a small "Uninstall" link next to it.
        string lnkU = Path.Combine(Path.GetDirectoryName(lnk)!, "Удалить Voice Clip Recorder.lnk");
        dynamic scu = shell.CreateShortcut(lnkU);
        scu.TargetPath = UninstallerPath;
        scu.Arguments = "/uninstall";
        scu.WorkingDirectory = InstallDir;
        scu.Description = "Удалить Voice Clip Recorder";
        scu.IconLocation = UninstallerPath + ",0";
        scu.Save();
    }

    private static void RemoveStartMenuShortcut()
    {
        string lnk = StartMenuLinkPath;
        var dir = Path.GetDirectoryName(lnk);
        if (dir != null && Directory.Exists(dir))
        {
            try { Directory.Delete(dir, recursive: true); } catch { }
        }
    }

    // ---------- self-delete on uninstall ----------

    private static void ScheduleSelfCleanup()
    {
        // Write a cleanup .cmd in %TEMP% that waits a moment, then removes the
        // install dir (including this uninstall.exe).
        string cmdPath = Path.Combine(Path.GetTempPath(),
            "vcr-cleanup-" + Guid.NewGuid().ToString("N").Substring(0, 8) + ".cmd");

        string content =
            "@echo off\r\n" +
            "ping -n 2 127.0.0.1 >nul\r\n" +
            $"rmdir /s /q \"{InstallDir}\" 2>nul\r\n" +
            "del \"%~f0\" >nul 2>&1\r\n";
        File.WriteAllText(cmdPath, content);

        Process.Start(new ProcessStartInfo
        {
            FileName = cmdPath,
            CreateNoWindow = true,
            UseShellExecute = false,
            WindowStyle = ProcessWindowStyle.Hidden
        });
    }
}
