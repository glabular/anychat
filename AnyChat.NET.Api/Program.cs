using Anytype.NET;

namespace AnyChat.NET.Api;

public partial class Program
{
    private static void Main(string[] args)
    {
        var builder = WebApplication.CreateBuilder(args);

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

        app.UseHttpsRedirection();
        app.MapControllers();

        app.Run();
    }
}
