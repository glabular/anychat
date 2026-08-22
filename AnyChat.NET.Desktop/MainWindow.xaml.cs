using System.IO;
using System.Windows;

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

        var htmlPath = Path.Combine(AppContext.BaseDirectory, "www", "index.html");
        WebView.Source = new Uri(htmlPath);
    }
}
