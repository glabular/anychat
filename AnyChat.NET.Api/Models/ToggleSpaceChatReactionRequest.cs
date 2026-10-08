namespace AnyChat.NET.Api.Models;

/// <summary>
/// Body for toggling an emoji reaction on a chat message. Name avoids clashing
/// with Anytype.NET's <c>ToggleChatReactionRequest</c>.
/// </summary>
public sealed class ToggleSpaceChatReactionRequest
{
    /// <summary>
    /// Emoji to add or remove for the current user (for example <c>👍</c>).
    /// </summary>
    public string? Emoji { get; init; }
}
