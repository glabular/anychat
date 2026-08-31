using AnyChat.NET.Api.Models;
using AnyChat.NET.Api.Services;
using Anytype.NET;
using Microsoft.AspNetCore.Mvc;

namespace AnyChat.NET.Api.Controllers;

[ApiController]
[Route("api/spaces")]
public class SpacesController(
    AnytypeClient client,
    SpaceDisplayResolver displayResolver) : ControllerBase
{
    [HttpGet]
    public async Task<IActionResult> List()
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
}
