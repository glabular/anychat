using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Interop;
using System.Windows.Media;
using AnyChat.NET.Api;
using Microsoft.AspNetCore.Builder;

namespace AnyChat.NET.Desktop;

public partial class App : Application
{
    private const int DwmwaCloak = 13;
    private const int StableFramesBeforeUncloak = 2;
    private const string ExternalApiEnvVar = "ANYCHAT_EXTERNAL_API";

    private WebApplication? _webApp;

    /// <summary>True while this process still owns a running in-process host.</summary>
    internal bool HasInProcessHost => _webApp is not null;

    static App()
    {
        // Known WebView2 issue: setting DefaultBackgroundColor only via API can still
        // white-flash for a frame. This process env var must be set before any
        // CoreWebView2 controller is created. ARGB: opaque #171717.
        // https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/win32/icorewebview2controller2
        Environment.SetEnvironmentVariable(
            "WEBVIEW2_DEFAULT_BACKGROUND_COLOR",
            "FF171717");
    }

    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);

        if (!UseExternalApi())
        {
            if (!TryStartInProcessHost(e.Args))
            {
                Shutdown(1);
                return;
            }
        }

        var mainWindow = new MainWindow();
        MainWindow = mainWindow;

        // Create the HWND without showing it, then cloak it before Show().
        // WPF can render normally while DWM keeps incomplete frames off-screen.
        var handle = new WindowInteropHelper(mainWindow).EnsureHandle();
        var isCloaked = SetWindowCloaked(handle, true);

        EventHandler? onFirstContentRendered = null;
        onFirstContentRendered = (_, _) =>
        {
            mainWindow.ContentRendered -= onFirstContentRendered;

            if (!isCloaked)
            {
                return;
            }

            // ContentRendered can fire before DWM has the finished frame.
            // Wait two CompositionTarget.Rendering ticks, then uncloak.
            var framesRemaining = StableFramesBeforeUncloak;
            EventHandler? onRendering = null;
            onRendering = (_, _) =>
            {
                framesRemaining--;
                if (framesRemaining > 0)
                {
                    return;
                }

                CompositionTarget.Rendering -= onRendering;
                SetWindowCloaked(handle, false);
            };

            CompositionTarget.Rendering += onRendering;
        };

        mainWindow.ContentRendered += onFirstContentRendered;
        mainWindow.Show();
    }

    protected override void OnExit(ExitEventArgs e)
    {
        // Prefer await from MainWindow.Closing. If something else exits the app
        // while the host is still up, stop off the UI sync context to avoid deadlock.
        if (_webApp is not null)
        {
            Task.Run(StopInProcessHostAsync).GetAwaiter().GetResult();
        }

        base.OnExit(e);
    }

    private bool TryStartInProcessHost(string[] args)
    {
        try
        {
            _webApp = AnyChatWebHost.Create(args, AppContext.BaseDirectory);
            _webApp.StartAsync().GetAwaiter().GetResult();
            return true;
        }
        catch (Exception ex)
        {
            MessageBox.Show(
                "AnyChat could not start its local API on " + AnyChatWebHost.DefaultUrl + ".\n\n" +
                "If the Api console is already running, either close it or launch Desktop with " +
                ExternalApiEnvVar + "=1 (profile \"Desktop (external API)\").\n\n" +
                ex.Message,
                "AnyChat",
                MessageBoxButton.OK,
                MessageBoxImage.Error);
            Task.Run(StopInProcessHostAsync).GetAwaiter().GetResult();

            return false;
        }
    }

    /// <summary>
    /// Stops in-process Kestrel. Must be awaited (not blocked on the UI thread via
    /// GetResult on OnExit) or WPF deadlocks and the process never exits.
    /// </summary>
    internal async Task StopInProcessHostAsync()
    {
        if (_webApp is null)
        {
            return;
        }

        var app = _webApp;
        _webApp = null;

        try
        {
            using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(5));
            await app.StopAsync(cts.Token).ConfigureAwait(false);
        }
        catch
        {
            // Best-effort shutdown so the process can still exit.
        }

        try
        {
            await app.DisposeAsync().ConfigureAwait(false);
        }
        catch
        {
            // Ignore dispose races on exit.
        }
    }

    /// <summary>
    /// When set, Desktop only opens the WebView against an already-running Api
    /// (visible console via VS multi-startup). Does not start in-process Kestrel.
    /// </summary>
    internal static bool UseExternalApi()
    {
        var value = Environment.GetEnvironmentVariable(ExternalApiEnvVar);
        
        return value is "1" or "true" or "True" or "TRUE" or "yes" or "YES";
    }

    private static bool SetWindowCloaked(IntPtr handle, bool cloaked)
    {
        var value = cloaked ? 1 : 0;
        return DwmSetWindowAttribute(
            handle,
            DwmwaCloak,
            ref value,
            Marshal.SizeOf<int>()) >= 0;
    }

    [DllImport("dwmapi.dll")]
    private static extern int DwmSetWindowAttribute(
        IntPtr hwnd,
        int attribute,
        ref int attributeValue,
        int attributeSize);
}
