using System.IO;
using System.Reflection;
using System.Text.Json;
using System.Windows;
using System.Windows.Input;
using Microsoft.Web.WebView2.Core;

namespace AnyChat.NET.Desktop;

public partial class MainWindow : Window
{
    // Must match AnyChat.NET.Api launchSettings (http profile).
    private const string AppUrl = "http://localhost:5249/";

    // Matches --color-bg in AnyChat.NET.Web/styles.css.
    private static readonly System.Drawing.Color AppBackground =
        System.Drawing.Color.FromArgb(255, 0x17, 0x17, 0x17);

    private static readonly string PlacementPath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "AnyChat.NET",
        "window-placement.json");

    // Default WebView2 profile lives next to the exe (bin\Debug\...\*.exe.WebView2),
    // which is wiped on clean/rebuild and is a poor fit for a daily-driver shell.
    // Keep browser storage beside other AnyChat app data under LocalApplicationData.
    private static readonly string WebView2UserDataFolder = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "AnyChat.NET",
        "WebView2");

    private bool _hasRevealedWebView;

    public MainWindow()
    {
        InitializeComponent();

        Title = $"anychat [v{GetProductVersion()}]";

        // Also set on the control before EnsureCoreWebView2Async (belt + suspenders
        // with the process env var in App).
        WebView.DefaultBackgroundColor = AppBackground;

        SourceInitialized += OnSourceInitialized;
        Closing += OnClosing;
        Loaded += OnLoaded;
#if DEBUG
        // WebView2 WPF forwards accelerator keys into WPF KeyDown when the view has focus.
        KeyDown += OnDebugKeyDown;
#endif
    }

    private void OnSourceInitialized(object? sender, EventArgs e)
    {
        TryRestorePlacement();
    }

    private void OnClosing(object? sender, System.ComponentModel.CancelEventArgs e)
    {
        TrySavePlacement();
    }

    private void TryRestorePlacement()
    {
        if (!File.Exists(PlacementPath))
        {
            return;
        }

        try
        {
            var json = File.ReadAllText(PlacementPath);
            var placement = JsonSerializer.Deserialize<WindowPlacement>(json);

            if (placement is null || placement.Width <= 0 || placement.Height <= 0)
            {
                return;
            }

            var bounds = new Rect(placement.Left, placement.Top, placement.Width, placement.Height);

            if (!IsReasonablyOnScreen(bounds))
            {
                return;
            }

            WindowStartupLocation = WindowStartupLocation.Manual;
            Left = placement.Left;
            Top = placement.Top;
            Width = placement.Width;
            Height = placement.Height;

            if (placement.State is WindowState.Normal or WindowState.Maximized)
            {
                WindowState = placement.State;
            }
        }
        catch
        {
            // Corrupt or unreadable placement — keep CenterScreen default.
        }
    }

    private void TrySavePlacement()
    {
        try
        {
            // Minimized: keep last normal/maximized size via RestoreBounds.
            var bounds = WindowState == WindowState.Normal
                ? new Rect(Left, Top, Width, Height)
                : RestoreBounds;

            var state = WindowState == WindowState.Minimized
                ? WindowState.Normal
                : WindowState;

            var placement = new WindowPlacement(bounds.Left, bounds.Top, bounds.Width, bounds.Height, state);

            var dir = Path.GetDirectoryName(PlacementPath);

            if (!string.IsNullOrEmpty(dir))
            {
                Directory.CreateDirectory(dir);
            }

            var json = JsonSerializer.Serialize(placement);
            File.WriteAllText(PlacementPath, json);
        }
        catch
        {
            // Best-effort persistence; ignore IO failures on exit.
        }
    }

    /// <summary>
    /// Ensures at least part of the title-bar area lands on the virtual desktop
    /// (handles removed/moved monitors).
    /// </summary>
    private static bool IsReasonablyOnScreen(Rect windowBounds)
    {
        var virtualScreen = new Rect(
            SystemParameters.VirtualScreenLeft,
            SystemParameters.VirtualScreenTop,
            SystemParameters.VirtualScreenWidth,
            SystemParameters.VirtualScreenHeight);

        var titleBar = new Rect(
            windowBounds.Left,
            windowBounds.Top,
            Math.Max(windowBounds.Width, 1),
            Math.Min(32, Math.Max(windowBounds.Height, 1)));

        return virtualScreen.IntersectsWith(titleBar);
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        try
        {
            // Set DefaultBackgroundColor at controller creation so WebView2 never
            // paints its default white before our first navigation completes.
            var environment = await CoreWebView2Environment.CreateAsync(
                browserExecutableFolder: null,
                userDataFolder: WebView2UserDataFolder);
            var controllerOptions = environment.CreateCoreWebView2ControllerOptions();
            controllerOptions.DefaultBackgroundColor = AppBackground;
            await WebView.EnsureCoreWebView2Async(environment, controllerOptions);
        }
        catch (Exception ex)
        {
            MessageBox.Show(
                "WebView2 failed to start. Install the Microsoft Edge WebView2 Runtime, then try again.\n\n" +
                ex.Message,
                "AnyChat",
                MessageBoxButton.OK,
                MessageBoxImage.Error);
            return;
        }

        ConfigureWebViewForDesktop();
        await PrepareWebViewForNavigation();

        WebView.CoreWebView2.NavigationCompleted += OnNavigationCompleted;

        WebView.Source = new Uri(AppUrl);
    }

    private async Task PrepareWebViewForNavigation()
    {
        try
        {
            // The profile is intentionally persistent for localStorage, but its HTTP
            // cache can otherwise keep an older CSS/JS bundle across app restarts.
            // Clear only cached responses; site data and the saved app state remain.
            await WebView.CoreWebView2.Profile.ClearBrowsingDataAsync(
                CoreWebView2BrowsingDataKinds.DiskCache);
        }
        catch
        {
            // Best-effort; stale cache beats blocking startup on a locked profile.
        }

        try
        {
            // Zoom is stored per host in the WebView2 profile. Since desktop zoom
            // controls are disabled, always start localhost at the CSS baseline.
            WebView.ZoomFactor = 1.0;
        }
        catch
        {
            // Best-effort; navigation should still proceed.
        }
    }

    private void OnNavigationCompleted(object? sender, CoreWebView2NavigationCompletedEventArgs args)
    {
        if (args.IsSuccess)
        {
            RevealWebView();
            return;
        }

        // Keep StartupSurface visible until the fallback HTML finishes loading.
        if (_hasRevealedWebView)
        {
            return;
        }

        WebView.CoreWebView2.NavigateToString(
            """
            <!DOCTYPE html>
            <html lang="en">
            <head><meta charset="UTF-8"><title>AnyChat</title></head>
            <body style="font-family: system-ui, sans-serif; margin: 2rem; background: #171717; color: #f8f8f8;">
              <h1>Cannot reach Anytype</h1>
              <p>Please make sure your Anytype client is running and try again.</p>
            </body>
            </html>
            """);
    }

    private void RevealWebView()
    {
        if (_hasRevealedWebView)
        {
            return;
        }

        _hasRevealedWebView = true;

        // Make WebView visible first (dark via env var / DefaultBackgroundColor),
        // then drop the native surface on the next dispatcher pass so we never
        // show an empty white HWND for a frame.
        WebView.Visibility = Visibility.Visible;
        Dispatcher.BeginInvoke(
            () => StartupSurface.Visibility = Visibility.Collapsed,
            System.Windows.Threading.DispatcherPriority.Render);
    }

    private void ConfigureWebViewForDesktop()
    {
        var s = WebView.CoreWebView2.Settings;
        s.AreDefaultContextMenusEnabled = false;
        s.AreBrowserAcceleratorKeysEnabled = false;
        s.IsStatusBarEnabled = false;
        s.IsZoomControlEnabled = false;
        s.IsSwipeNavigationEnabled = false;
#if DEBUG
        s.AreDevToolsEnabled = true;
#else
        s.AreDevToolsEnabled = false;
#endif

        WebView.AllowExternalDrop = false;

        WebView.CoreWebView2.NewWindowRequested += (_, e) => e.Handled = true;
    }

#if DEBUG
    private void OnDebugKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key != Key.F12)
        {
            return;
        }

        WebView.CoreWebView2?.OpenDevToolsWindow();
        e.Handled = true;
    }
#endif

    /// <summary>
    /// Product version from Directory.Build.props (InformationalVersion).
    /// </summary>
    private static string GetProductVersion()
    {
        var version = Assembly.GetExecutingAssembly()
            .GetCustomAttribute<AssemblyInformationalVersionAttribute>()
            ?.InformationalVersion;

        if (string.IsNullOrWhiteSpace(version))
        {
            return Assembly.GetExecutingAssembly().GetName().Version?.ToString(3) ?? "0.0.0";
        }

        var plus = version.IndexOf('+', StringComparison.Ordinal);

        return plus >= 0 ? version[..plus] : version;
    }

    private sealed record WindowPlacement(
        double Left,
        double Top,
        double Width,
        double Height,
        WindowState State);
}
