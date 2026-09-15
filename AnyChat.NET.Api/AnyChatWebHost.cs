using AnyChat.NET.Api.Filters;
using AnyChat.NET.Api.Services;

namespace AnyChat.NET.Api;

/// <summary>
/// Shared ASP.NET Core host used by the Api console entry point and by
/// in-process hosting inside AnyChat.NET.Desktop.
/// </summary>
public static class AnyChatWebHost
{
    public const string DefaultUrl = "http://localhost:5249";

    public static WebApplication Create(string[] args, string? contentRoot = null)
    {
        contentRoot ??= Directory.GetCurrentDirectory();

        var builder = WebApplication.CreateBuilder(new WebApplicationOptions
        {
            Args = args,
            ContentRootPath = contentRoot,
            WebRootPath = ResolveWebRoot(contentRoot)
        });

        // launchSettings / ASPNETCORE_URLS apply when set; otherwise bind the
        // URL Desktop and Api already share.
        if (string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("ASPNETCORE_URLS")))
        {
            builder.WebHost.UseUrls(DefaultUrl);
        }

        builder.Services.AddControllers(options =>
        {
            options.Filters.Add<AnytypeUnavailableExceptionFilter>();
            options.Filters.Add<AnytypeAuthExceptionFilter>();
        }).AddApplicationPart(typeof(AnyChatWebHost).Assembly);
        builder.Services.AddOpenApi();

        var identityPath = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "AnyChat.NET",
            "current-identity.json");

        builder.Services.AddSingleton(_ => new AnytypeApiKeyStore(AnytypeApiKeyStore.DefaultStoragePath));
        builder.Services.AddSingleton(_ =>
            new CurrentUserIdentityStore(AnytypeSession.UnconfiguredFingerprint, identityPath));
        builder.Services.AddSingleton<AnytypeSession>();
        builder.Services.AddSingleton<CurrentMemberResolver>();
        builder.Services.AddSingleton<SpaceDisplayResolver>();

        // Browser tools (Live Server, file preview, etc.) load the HTML from a
        // different origin than the API. Development-only CORS lets fetch work there.
        // WPF still loads http://localhost:5249/ (same origin) — CORS is irrelevant then.
        if (builder.Environment.IsDevelopment())
        {
            builder.Services.AddCors(options =>
            {
                options.AddDefaultPolicy(policy =>
                    policy.AllowAnyOrigin()
                          .AllowAnyHeader()
                          .AllowAnyMethod());
            });
        }

        var app = builder.Build();

        var configApiKey = app.Configuration["Anytype:ApiKey"];
        var session = app.Services.GetRequiredService<AnytypeSession>();
        session.InitializeFromStoreOrConfig(configApiKey);

        if (app.Environment.IsDevelopment())
        {
            app.MapOpenApi();
            app.UseCors();
        }

        // Same origin as the WebView page: UI + /api share http://localhost:5249
        app.UseDefaultFiles();
        app.UseStaticFiles();
        app.MapControllers();

        return app;
    }

    /// <summary>
    /// Prefer the sibling AnyChat.NET.Web project while developing; fall back to
    /// wwwroot next to the app when running a published/bin copy.
    /// </summary>
    public static string ResolveWebRoot(string contentRoot)
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
