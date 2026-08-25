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

    [HttpGet("{chatId}/messages")]
    public async Task<IActionResult> ListMessages(
        string spaceId,
        string chatId,
        [FromQuery] int limit = 1)
    {
        if (limit < 1)
        {
            limit = 1;
        }
        else if (limit > 1000)
        {
            limit = 1000;
        }

        var response = await client.Chats.ListMessagesAsync(spaceId, chatId, limit: limit);
        
        return Ok(response.Messages ?? []);
    }
}
