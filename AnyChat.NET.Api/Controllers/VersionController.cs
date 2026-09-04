using System.Reflection;
using AnyChat.NET.Api.Models;
using Microsoft.AspNetCore.Mvc;

namespace AnyChat.NET.Api.Controllers;

[ApiController]
[Route("api/version")]
public class VersionController : ControllerBase
{
    [HttpGet]
    public ActionResult<VersionResponse> Get()
    {
        var version = Assembly.GetExecutingAssembly()
            .GetCustomAttribute<AssemblyInformationalVersionAttribute>()
            ?.InformationalVersion;

        if (string.IsNullOrWhiteSpace(version))
        {
            version = Assembly.GetExecutingAssembly().GetName().Version?.ToString(3) ?? "0.0.0";
        }
        else
        {
            // Strip optional +build metadata (e.g. from SourceRevisionId).
            var plus = version.IndexOf('+', StringComparison.Ordinal);
            if (plus >= 0)
            {
                version = version[..plus];
            }
        }

        return Ok(new VersionResponse { Version = version });
    }
}
