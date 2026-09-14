using AnyChat.NET.Api.Filters;
using AnyChat.NET.Api.Models;
using AnyChat.NET.Api.Services;
using Anytype.NET.Interfaces;
using Anytype.NET.Models;
using Microsoft.AspNetCore.Mvc;

namespace AnyChat.NET.Api.Controllers;

[ApiController]
[Route("api/spaces/{spaceId}/members")]
public class MembersController(AnytypeSession session) : ControllerBase
{
    [HttpGet("{memberId}")]
    public async Task<IActionResult> Get(string spaceId, string memberId)
    {
        var client = session.TryGetClient();

        if (client is null)
        {
            return AnytypeAuthExceptionFilter.CreateMissingResult();
        }

        try
        {
            var member = await client.Members.GetByIdAsync(spaceId, memberId);

            if (member is null || !IsListableMember(member))
            {
                return NotFound();
            }

            return Ok(MapMember(member));
        }
        catch (Exception ex) when (AnytypeAuthExceptionFilter.IsAnytypeAuthFailure(ex))
        {
            return AnytypeAuthExceptionFilter.CreateInvalidResult();
        }
        catch (Exception ex) when (AnytypeUnavailableExceptionFilter.IsAnytypeConnectivityFailure(ex))
        {
            return AnytypeUnavailableExceptionFilter.CreateResult();
        }
        catch (Exception)
        {
            return NotFound();
        }
    }

    private static bool IsListableMember(Member? member)
    {
        if (member is null || string.IsNullOrWhiteSpace(member.Id))
        {
            return false;
        }

        return string.IsNullOrWhiteSpace(member.Status)
            || string.Equals(member.Status, "active", StringComparison.OrdinalIgnoreCase);
    }

    private static SpaceMemberDto MapMember(Member member)
    {
        return new SpaceMemberDto
        {
            Id = member.Id!.Trim(),
            Name = ResolveDisplayName(member),
            GlobalName = string.IsNullOrWhiteSpace(member.GlobalName)
                ? null
                : member.GlobalName.Trim(),
            Identity = string.IsNullOrWhiteSpace(member.Identity)
                ? null
                : member.Identity.Trim(),
            Avatar = MapAvatar(member.Icon),
        };
    }

    private static string? ResolveDisplayName(Member member)
    {
        if (!string.IsNullOrWhiteSpace(member.Name))
        {
            return member.Name.Trim();
        }

        if (!string.IsNullOrWhiteSpace(member.GlobalName))
        {
            return member.GlobalName.Trim();
        }

        return null;
    }

    private static MemberAvatarDto? MapAvatar(IIcon? icon)
    {
        switch (icon)
        {
            case EmojiIcon emojiIcon when !string.IsNullOrWhiteSpace(emojiIcon.Emoji):
                return new MemberAvatarDto
                {
                    Kind = "emoji",
                    Emoji = emojiIcon.Emoji.Trim(),
                };

            case FileIcon fileIcon when !string.IsNullOrWhiteSpace(fileIcon.File):
                return new MemberAvatarDto
                {
                    Kind = "file",
                    FileId = NormalizeFileId(fileIcon.File),
                };

            case NamedIcon namedIcon when !string.IsNullOrWhiteSpace(namedIcon.Name):
                return new MemberAvatarDto
                {
                    Kind = "named",
                    Name = namedIcon.Name.Trim(),
                    Color = string.IsNullOrWhiteSpace(namedIcon.Color)
                        ? null
                        : namedIcon.Color.Trim(),
                };

            default:
                return null;
        }
    }

    /// <summary>
    /// Anytype often returns file icons as absolute <c>/v1/spaces/.../files/{cid}</c> URLs
    /// that require API auth. The local gateway serves the same bytes at
    /// <c>{gatewayUrl}/image/{cid}</c> without a bearer token — return only the cid.
    /// </summary>
    private static string NormalizeFileId(string file)
    {
        var trimmed = file.Trim();
        if (!Uri.TryCreate(trimmed, UriKind.Absolute, out var uri))
        {
            return trimmed;
        }

        var segments = uri.AbsolutePath.Split(
            '/',
            StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

        for (var i = 0; i < segments.Length - 1; i++)
        {
            if (string.Equals(segments[i], "files", StringComparison.OrdinalIgnoreCase))
            {
                return segments[i + 1];
            }
        }

        return segments.Length > 0 ? segments[^1] : trimmed;
    }
}
