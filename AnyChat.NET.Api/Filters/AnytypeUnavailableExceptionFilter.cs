using System.Net.Sockets;
using AnyChat.NET.Api.Models;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;

namespace AnyChat.NET.Api.Filters;

/// <summary>
/// Maps Anytype local-API connectivity failures to HTTP 503 with a stable error code.
/// Prefer try/catch in actions for debugger-friendly handling; this filter is a backstop.
/// </summary>
public sealed class AnytypeUnavailableExceptionFilter : IExceptionFilter, IAsyncExceptionFilter
{
    public const string ErrorCode = "anytype_unavailable";

    public void OnException(ExceptionContext context) => TryHandle(context);

    public Task OnExceptionAsync(ExceptionContext context)
    {
        TryHandle(context);
        return Task.CompletedTask;
    }

    public static ObjectResult CreateResult() =>
        new(new AnytypeUnavailableResponse())
        {
            StatusCode = StatusCodes.Status503ServiceUnavailable,
        };

    private static void TryHandle(ExceptionContext context)
    {
        if (context.ExceptionHandled || !IsAnytypeConnectivityFailure(context.Exception))
        {
            return;
        }

        context.Result = CreateResult();
        context.ExceptionHandled = true;
    }

    internal static bool IsAnytypeConnectivityFailure(Exception exception)
    {
        for (var current = exception; current is not null; current = current.InnerException)
        {
            if (current is OperationCanceledException)
            {
                return false;
            }

            if (current is HttpRequestException or SocketException)
            {
                return true;
            }

            // Connection reset / broken pipe while talking to Anytype (not client abort).
            if (current is IOException)
            {
                return true;
            }
        }

        return false;
    }
}
