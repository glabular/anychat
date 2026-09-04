using AnyChat.NET.Api.Models;
using Anytype.NET;
using Anytype.NET.Interfaces;
using Anytype.NET.Models;
using Microsoft.AspNetCore.Mvc;

namespace AnyChat.NET.Api.Controllers;

[ApiController]
[Route("api/spaces/{spaceId}/members")]
public class MembersController(AnytypeClient client) : ControllerBase
{
    [HttpGet]
    public async Task<IActionResult> List(string spaceId)
    {
        var response = await client.Members.ListAsync(spaceId);
        var members = response.Members ?? [];
        var items = members
            .Where(IsListableMember)
            .Select(MapMember)
            .ToList();

        return Ok(items);
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
                    FileId = fileIcon.File.Trim(),
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
}
