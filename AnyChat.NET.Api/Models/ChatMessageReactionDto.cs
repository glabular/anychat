namespace AnyChat.NET.Api.Models;

/// <summary>
/// One emoji reaction on a chat message, mapped from Anytype
/// <c>ChatMessage.Reactions</c> (emoji → reactor identity list).
/// </summary>
public sealed class ChatMessageReactionDto
{
    /// <summary>
    /// Emoji key from Anytype (for example <c>🔥</c>).
    /// </summary>
    public required string Emoji { get; init; }

    /// <summary>
    /// Number of distinct reactors for this emoji.
    /// </summary>
    public int Count { get; init; }

    /// <summary>
    /// True when the learned current user is among the reactors for this emoji.
    /// </summary>
    public bool ReactedByMe { get; init; }
}
