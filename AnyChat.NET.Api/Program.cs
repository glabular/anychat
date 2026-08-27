using System.Security.Cryptography;
using System.Text;
using AnyChat.NET.Api.Services;
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

        var apiKey = builder.Configuration["Anytype:ApiKey"]
            ?? throw new InvalidOperationException("Anytype:ApiKey not configured");

        builder.Services.AddSingleton(_ => new AnytypeClient(apiKey));
        builder.Services.AddSingleton(_ =>
        {
            var fingerprint = ComputeApiKeyFingerprint(apiKey);
            var storagePath = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "AnyChat.NET",
                "current-identity.json");
            return new CurrentUserIdentityStore(fingerprint, storagePath);
        });
        builder.Services.AddSingleton<CurrentMemberResolver>();

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

        if (app.Environment.IsDevelopment())
        {
            app.MapOpenApi();
            app.UseCors();
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

    private static string ComputeApiKeyFingerprint(string apiKey)
    {
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(apiKey));
        return Convert.ToHexString(hash);
    }
}
