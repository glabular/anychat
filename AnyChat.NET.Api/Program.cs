using Anytype.NET;

namespace AnyChat.NET.Api;

public partial class Program
{
    private static void Main(string[] args)
    {
        var contentRoot = Directory.GetCurrentDirectory();
        var builder = WebApplication.CreateBuilder(new WebApplicationOptions
        {
            Args = args,
            ContentRootPath = contentRoot,
            WebRootPath = ResolveWebRoot(contentRoot)
        });

        builder.Services.AddControllers();
        builder.Services.AddOpenApi();
        builder.Services.AddSingleton(_ =>
        {
            var key = builder.Configuration["Anytype:ApiKey"]
                ?? throw new InvalidOperationException("Anytype:ApiKey not configured");
            return new AnytypeClient(key);
        });

        var app = builder.Build();

        if (app.Environment.IsDevelopment())
        {
            app.MapOpenApi();
        }

        // Same origin as the WebView page: UI + /api share http://localhost:5249
        app.UseDefaultFiles();
        app.UseStaticFiles();
        app.MapControllers();

        app.Run();
    }

    /// <summary>
    /// Prefer the sibling AnyChat.NET.Web project while developing; fall back to
    /// wwwroot next to the app when running a published/bin copy.
    /// </summary>
    private static string ResolveWebRoot(string contentRoot)
    {
        var siblingWeb = Path.GetFullPath(Path.Combine(contentRoot, "..", "AnyChat.NET.Web"));
        
        if (Directory.Exists(siblingWeb))
        {
            return siblingWeb;
        }

        var underContentRoot = Path.Combine(contentRoot, "wwwroot");

        if (Directory.Exists(underContentRoot))
        {
            return underContentRoot;
        }

        var underBaseDir = Path.Combine(AppContext.BaseDirectory, "wwwroot");

        if (Directory.Exists(underBaseDir))
        {
            return underBaseDir;
        }

        throw new DirectoryNotFoundException(
            "Web UI folder not found. Expected AnyChat.NET.Web next to the API project, " +
            "or a wwwroot folder beside the running app.");
    }
}
