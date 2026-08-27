using System.IO;
using System.Text.Json;
using System.Windows;
using System.Windows.Input;

namespace AnyChat.NET.Desktop;

public partial class MainWindow : Window
{
    // Must match AnyChat.NET.Api launchSettings (http profile).
    private const string AppUrl = "http://localhost:5249/";

    private static readonly string PlacementPath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "AnyChat.NET",
        "window-placement.json");

    public MainWindow()
    {
        InitializeComponent();
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
            await WebView.EnsureCoreWebView2Async();
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

        WebView.CoreWebView2.NavigationCompleted += (_, args) =>
        {
            if (args.IsSuccess)
            {
                return;
            }

            WebView.CoreWebView2.NavigateToString(
                """
                <!DOCTYPE html>
                <html lang="en">
                <head><meta charset="UTF-8"><title>AnyChat</title></head>
                <body style="font-family: system-ui, sans-serif; margin: 2rem;">
                  <h1>API not reachable</h1>
                  <p>Start <code>AnyChat.NET.Api</code> on
                     <a href="http://localhost:5249/">http://localhost:5249/</a>,
                     then restart this app.</p>
                </body>
                </html>
                """);
        };

        WebView.Source = new Uri(AppUrl);
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

    private sealed record WindowPlacement(
        double Left,
        double Top,
        double Width,
        double Height,
        WindowState State);
}
