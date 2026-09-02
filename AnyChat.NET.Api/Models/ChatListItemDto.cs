namespace AnyChat.NET.Api.Models;

/// <summary>
/// A chat as returned by the chats list endpoint for the client UI.
/// </summary>
public sealed class ChatListItemDto
{
    /// <summary>Unique chat identifier.</summary>
    public string? Id { get; init; }

    /// <summary>Display name from Anytype. May be empty.</summary>
    public string? Name { get; init; }

    /// <summary>Anytype object type string (for example, anytype.chat).</summary>
    public string? Object { get; init; }

    /// <summary>
    /// Custom emoji icon from Anytype when the chat icon format is <c>emoji</c>.
    /// Null when the chat has no icon or uses an unsupported icon format.
    /// </summary>
    public string? IconEmoji { get; init; }
}
