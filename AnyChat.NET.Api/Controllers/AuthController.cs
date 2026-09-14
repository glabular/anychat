using Anytype.NET;
using AnyChat.NET.Api.Models;
using AnyChat.NET.Api.Filters;
using AnyChat.NET.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace AnyChat.NET.Api.Controllers;

[ApiController]
[Route("api/auth")]
public class AuthController(
    AnytypeSession session,
    CurrentMemberResolver memberResolver) : ControllerBase
{
    [HttpGet("status")]
    public ActionResult<AuthStatusResponse> Status()
    {
        return Ok(new AuthStatusResponse
        {
            Configured = session.IsConfigured,
            FingerprintPrefix = session.FingerprintPrefix,
        });
    }

    [HttpPut("api-key")]
    public async Task<IActionResult> SetApiKey([FromBody] SetApiKeyRequest? request)
    {
        var apiKey = request?.ApiKey?.Trim();

        if (string.IsNullOrEmpty(apiKey))
        {
            return AnytypeAuthExceptionFilter.CreateMissingResult();
        }

        AnytypeClient probeClient;

        try
        {
            probeClient = new AnytypeClient(apiKey);
        }
        catch (ArgumentException)
        {
            return AnytypeAuthExceptionFilter.CreateMissingResult();
        }

        try
        {
            _ = await probeClient.Spaces.ListAsync();
        }
        catch (Exception ex) when (AnytypeUnavailableExceptionFilter.IsAnytypeConnectivityFailure(ex))
        {
            return AnytypeUnavailableExceptionFilter.CreateResult();
        }
        catch (Exception ex) when (AnytypeAuthExceptionFilter.IsAnytypeAuthFailure(ex))
        {
            return AnytypeAuthExceptionFilter.CreateInvalidResult();
        }

        session.SetApiKey(apiKey);
        memberResolver.ClearCache();

        return Ok(new AuthStatusResponse
        {
            Configured = true,
            FingerprintPrefix = session.FingerprintPrefix,
        });
    }
}
