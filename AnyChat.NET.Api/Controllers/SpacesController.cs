using AnyChat.NET.Api.Filters;
using AnyChat.NET.Api.Models;
using AnyChat.NET.Api.Services;
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
                var displayName = await displayResolver.ResolveDisplayNameAsync(space);

                items.Add(new SpaceListItemDto
                {
                    Id = space.Id,
                    Name = space.Name,
                    Object = space.Object,
                    Icon = space.Icon,
                    Description = space.Description,
                    GatewayUrl = space.GatewayUrl,
                    NetworkId = space.NetworkId,
                    DisplayName = displayName,
                });
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
}
