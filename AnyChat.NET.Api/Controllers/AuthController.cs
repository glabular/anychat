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
    CurrentMemberResolver memberResolver,
    CurrentUserIdentityStore identityStore) : ControllerBase
{
    private const string ChallengeAppName = "anychat";

    [HttpGet("status")]
    public ActionResult<AuthStatusResponse> Status()
    {
        return Ok(CreateStatusResponse(session.IsConfigured));
    }

    [HttpPost("challenge")]
    public async Task<IActionResult> CreateChallenge()
    {
        try
        {
            var challengeId = await AnytypeClient.Auth.CreateChallengeAsync(ChallengeAppName);
            
            if (string.IsNullOrWhiteSpace(challengeId))
            {
                return BadRequest(new { error = "challenge_failed", message = "Could not start authentication with Anytype." });
            }

            return Ok(new CreateChallengeResponse { ChallengeId = challengeId.Trim() });
        }
        catch (Exception ex) when (AnytypeUnavailableExceptionFilter.IsAnytypeConnectivityFailure(ex))
        {
            return AnytypeUnavailableExceptionFilter.CreateResult();
        }
        catch (Exception)
        {
            return BadRequest(new { error = "challenge_failed", message = "Could not start authentication with Anytype." });
        }
    }

    [HttpPost("api-key/from-challenge")]
    public async Task<IActionResult> SetApiKeyFromChallenge(
        [FromBody] CreateApiKeyFromChallengeRequest? request)
    {
        var challengeId = request?.ChallengeId?.Trim();
        var code = request?.Code?.Trim();

        if (string.IsNullOrWhiteSpace(challengeId) || string.IsNullOrWhiteSpace(code))
        {
            return BadRequest(new { error = "challenge_invalid", message = "Challenge id and code are required." });
        }

        string apiKey;

        try
        {
            apiKey = await AnytypeClient.Auth.CreateApiKeyAsync(challengeId, code);
        }
        catch (Exception ex) when (AnytypeUnavailableExceptionFilter.IsAnytypeConnectivityFailure(ex))
        {
            return AnytypeUnavailableExceptionFilter.CreateResult();
        }
        catch (Exception ex) when (AnytypeAuthExceptionFilter.IsAnytypeAuthFailure(ex))
        {
            return AnytypeAuthExceptionFilter.CreateInvalidResult();
        }
        catch (Exception)
        {
            return BadRequest(new { error = "challenge_invalid", message = "That code was rejected. Check it and try again." });
        }

        if (string.IsNullOrWhiteSpace(apiKey))
        {
            return BadRequest(new { error = "challenge_invalid", message = "That code was rejected. Check it and try again." });
        }

        return await ProbeAndPersistApiKeyAsync(apiKey.Trim());
    }

    [HttpPut("api-key")]
    public async Task<IActionResult> SetApiKey([FromBody] SetApiKeyRequest? request)
    {
        var apiKey = request?.ApiKey?.Trim();

        if (string.IsNullOrEmpty(apiKey))
        {
            return AnytypeAuthExceptionFilter.CreateMissingResult();
        }

        return await ProbeAndPersistApiKeyAsync(apiKey);
    }

    private async Task<IActionResult> ProbeAndPersistApiKeyAsync(string apiKey)
    {
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

        return Ok(CreateStatusResponse(configured: true));
    }

    private AuthStatusResponse CreateStatusResponse(bool configured) =>
        new()
        {
            Configured = configured,
            FingerprintPrefix = session.FingerprintPrefix,
            IdentityKnown = identityStore.IsKnown,
        };
}
