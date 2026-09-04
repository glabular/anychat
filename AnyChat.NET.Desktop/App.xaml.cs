using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Interop;
using System.Windows.Media;

namespace AnyChat.NET.Desktop;

public partial class App : Application
{
    private const int DwmwaCloak = 13;
    private const int StableFramesBeforeUncloak = 2;

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
