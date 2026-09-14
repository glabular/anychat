using System.Net;
using AnyChat.NET.Api.Models;
using Anytype.NET;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;

namespace AnyChat.NET.Api.Filters;

/// <summary>
/// Maps Anytype API authentication failures to HTTP 401 with a stable error code.
/// Prefer try/catch in actions for debugger-friendly handling; this filter is a backstop.
/// </summary>
public sealed class AnytypeAuthExceptionFilter : IExceptionFilter, IAsyncExceptionFilter
{
    public void OnException(ExceptionContext context) => TryHandle(context);

    public Task OnExceptionAsync(ExceptionContext context)
    {
        TryHandle(context);
        return Task.CompletedTask;
    }

    public static ObjectResult CreateMissingResult() =>
        new(new AnytypeAuthResponse
        {
            Error = AnytypeAuthResponse.ErrorMissing,
            Message = "The Anytype API key is not set up.",
        })
        {
            StatusCode = StatusCodes.Status401Unauthorized,
        };

    public static ObjectResult CreateInvalidResult() =>
        new(new AnytypeAuthResponse
        {
            Error = AnytypeAuthResponse.ErrorInvalid,
            Message = "The Anytype API key is incorrect.",
        })
        {
            StatusCode = StatusCodes.Status401Unauthorized,
        };

    private static void TryHandle(ExceptionContext context)
    {
        if (context.ExceptionHandled || !IsAnytypeAuthFailure(context.Exception))
        {
            return;
        }

        context.Result = CreateInvalidResult();
        context.ExceptionHandled = true;
    }

    internal static bool IsAnytypeAuthFailure(Exception exception)
    {
        for (var current = exception; current is not null; current = current.InnerException)
        {
            if (current is AnytypeApiException apiEx)
            {
                return LooksLikeInvalidApiKey(apiEx);
            }
        }

        return false;
    }

    internal static bool LooksLikeInvalidApiKey(AnytypeApiException exception)
    {
        if (exception.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden)
        {
            return true;
        }

        var message = exception.Message ?? string.Empty;
        if (message.Contains("invalid api key", StringComparison.OrdinalIgnoreCase)
            || message.Contains("unauthorized", StringComparison.OrdinalIgnoreCase)
            || message.Contains("api key", StringComparison.OrdinalIgnoreCase)
               && message.Contains("invalid", StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        var errorCode = exception.ErrorCode ?? string.Empty;
        if (errorCode.Contains("unauthorized", StringComparison.OrdinalIgnoreCase)
            || errorCode.Contains("auth", StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        return false;
    }
}
