using System.IO;
using System.Windows;
using Microsoft.Web.WebView2.Core;

namespace AnyChat.NET.Desktop;

public partial class MainWindow : Window
{
    public MainWindow()
    {
        InitializeComponent();
        Loaded += OnLoaded;
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        await WebView.EnsureCoreWebView2Async();

        var wwwFolder = Path.Combine(AppContext.BaseDirectory, "www");
        WebView.CoreWebView2.SetVirtualHostNameToFolderMapping(
            "app.local",
            wwwFolder,
            CoreWebView2HostResourceAccessKind.Allow);
        WebView.Source = new Uri("https://app.local/index.html");
    }
}
