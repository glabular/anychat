using Anytype.NET;
using Anytype.NET.Models;
using Anytype.NET.Models.Responses;
using Microsoft.AspNetCore.Mvc;

namespace AnyChat.NET.Api.Controllers;

[ApiController]
[Route("api/spaces")]
public class SpacesController(AnytypeClient client) : ControllerBase
{
    [HttpGet]
    public async Task<IActionResult> List()
    {
        var response = await client.Spaces.ListAsync();
        return Ok(response.Spaces);
    }
}
