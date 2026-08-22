using Anytype.NET;
using Anytype.NET.Models;
using Anytype.NET.Models.Responses;
using Microsoft.AspNetCore.Mvc;

namespace AnyChat.NET.Api.Controllers;

[ApiController]
[Route("api/spaces/{spaceId}/chats")]
public class ChatsController(AnytypeClient client) : ControllerBase
{
    [HttpGet]
    public async Task<IActionResult> List(string spaceId)
    {
        var response = await client.Chats.ListAsync(spaceId);
        return Ok(response.Chats);
    }
}
