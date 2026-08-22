using System.Windows;

namespace AnyChat.NET.Desktop;

public partial class MainWindow : Window
{
    // Must match AnyChat.NET.Api launchSettings (http profile).
    private const string AppUrl = "http://localhost:5249/";

    public MainWindow()
    {
        InitializeComponent();
        Loaded += OnLoaded;
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
}
