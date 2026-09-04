namespace AnyChat.NET.Api.Models;

/// <summary>
/// A space member exposed for message author profiles.
/// </summary>
public sealed class SpaceMemberDto
{
    /// <summary>
    /// Space participant id (matches chat message <c>creator</c>).
    /// </summary>
    public string Id { get; init; } = "";

    /// <summary>Display name resolved from the member record.</summary>
    public string? Name { get; init; }

    /// <summary>Anytype network identity.</summary>
    public string? Identity { get; init; }

    /// <summary>
    /// Normalized avatar, or null when the member has no usable icon.
    /// </summary>
    public MemberAvatarDto? Avatar { get; init; }
}
