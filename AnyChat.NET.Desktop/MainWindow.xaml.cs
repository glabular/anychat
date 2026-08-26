using System.Windows;
using System.Windows.Input;

namespace AnyChat.NET.Desktop;

public partial class MainWindow : Window
{
    // Must match AnyChat.NET.Api launchSettings (http profile).
    private const string AppUrl = "http://localhost:5249/";

    public MainWindow()
    {
        InitializeComponent();
        Loaded += OnLoaded;
#if DEBUG
        // WebView2 WPF forwards accelerator keys into WPF KeyDown when the view has focus.
        KeyDown += OnDebugKeyDown;
#endif
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
}
