using AnyChat.NET.Api.Filters;
using AnyChat.NET.Api.Models;
using AnyChat.NET.Api.Services;
using Anytype.NET.Models;
using Anytype.NET.Models.Requests;
using Microsoft.AspNetCore.Mvc;

namespace AnyChat.NET.Api.Controllers;

[ApiController]
[Route("api/spaces")]
public class SpacesController(
    AnytypeSession session,
    SpaceDisplayResolver displayResolver) : ControllerBase
{
    [HttpGet]
    public async Task<IActionResult> List()
    {
        var client = session.TryGetClient();

        if (client is null)
        {
            return AnytypeAuthExceptionFilter.CreateMissingResult();
        }

        try
        {
            var response = await client.Spaces.ListAsync();
            var spaces = response.Spaces ?? [];

            var items = new List<SpaceListItemDto>(spaces.Count);

            foreach (var space in spaces)
            {
                items.Add(await MapSpaceListItemAsync(space));
            }

            return Ok(items);
        }
        catch (Exception ex) when (AnytypeAuthExceptionFilter.IsAnytypeAuthFailure(ex))
        {
            return AnytypeAuthExceptionFilter.CreateInvalidResult();
        }
        catch (Exception ex) when (AnytypeUnavailableExceptionFilter.IsAnytypeConnectivityFailure(ex))
        {
            return AnytypeUnavailableExceptionFilter.CreateResult();
        }
    }

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] CreateAppSpaceRequest? request)
    {
        var name = request?.Name?.Trim() ?? string.Empty;
        if (name.Length == 0)
        {
            return BadRequest(new { error = "Space name is required." });
        }

        var description = request?.Description?.Trim() ?? string.Empty;

        var client = session.TryGetClient();
        if (client is null)
        {
            return AnytypeAuthExceptionFilter.CreateMissingResult();
        }

        try
        {
            var space = await client.Spaces.CreateAsync(
                new CreateSpaceRequest
                {
                    Name = name,
                    Description = description,
                });

            return StatusCode(
                StatusCodes.Status201Created,
                await MapSpaceListItemAsync(space));
        }
        catch (Exception ex) when (AnytypeAuthExceptionFilter.IsAnytypeAuthFailure(ex))
        {
            return AnytypeAuthExceptionFilter.CreateInvalidResult();
        }
        catch (Exception ex) when (AnytypeUnavailableExceptionFilter.IsAnytypeConnectivityFailure(ex))
        {
            return AnytypeUnavailableExceptionFilter.CreateResult();
        }
    }

    [HttpPatch("{spaceId}")]
    public async Task<IActionResult> Update(
        string spaceId,
        [FromBody] UpdateAppSpaceRequest? request)
    {
        if (string.IsNullOrWhiteSpace(spaceId))
        {
            return BadRequest(new { error = "Space id is required." });
        }

        var name = request?.Name?.Trim() ?? string.Empty;

        if (name.Length == 0)
        {
            return BadRequest(new { error = "Space name is required." });
        }

        var client = session.TryGetClient();
        
        if (client is null)
        {
            return AnytypeAuthExceptionFilter.CreateMissingResult();
        }

        try
        {
            var space = await client.Spaces.UpdateAsync(
                spaceId,
                new UpdateSpaceRequest { Name = name });

            return Ok(await MapSpaceListItemAsync(space));
        }
        catch (Exception ex) when (AnytypeAuthExceptionFilter.IsAnytypeAuthFailure(ex))
        {
            return AnytypeAuthExceptionFilter.CreateInvalidResult();
        }
        catch (Exception ex) when (AnytypeUnavailableExceptionFilter.IsAnytypeConnectivityFailure(ex))
        {
            return AnytypeUnavailableExceptionFilter.CreateResult();
        }
    }

    private async Task<SpaceListItemDto> MapSpaceListItemAsync(Space space)
    {
        var displayName = await displayResolver.ResolveDisplayNameAsync(space);

        return new SpaceListItemDto
        {
            Id = space.Id,
            Name = space.Name,
            Object = space.Object,
            Icon = space.Icon,
            Description = space.Description,
            GatewayUrl = space.GatewayUrl,
            NetworkId = space.NetworkId,
            DisplayName = displayName,
        };
    }
}
