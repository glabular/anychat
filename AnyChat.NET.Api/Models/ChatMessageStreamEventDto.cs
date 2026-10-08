namespace AnyChat.NET.Api.Models;

/// <summary>
/// One Server-Sent Event proxied from Anytype's chat message stream,
/// or a proxy-synthesized status event.
/// </summary>
public sealed class ChatMessageStreamEventDto
{
    /// <summary>
    /// Event type: upstream <c>message_added</c>, <c>message_updated</c>,
    /// <c>message_deleted</c>, <c>reactions_updated</c>, or proxy
    /// <c>anytype_unavailable</c> when the Anytype local API dropped while
    /// the browser was still connected.
    /// </summary>
    public required string Type { get; init; }

    /// <summary>
    /// Mapped message for <c>message_added</c> / <c>message_updated</c>.
    /// </summary>
    public ChatMessageDto? Message { get; init; }

    /// <summary>
    /// Message id for <c>message_deleted</c> / <c>reactions_updated</c>.
    /// </summary>
    public string? Id { get; init; }

    /// <summary>
    /// Mapped reactions for <c>reactions_updated</c>, ordered by count descending.
    /// Null when the event has no reactions or every entry was empty.
    /// </summary>
    public IReadOnlyList<ChatMessageReactionDto>? Reactions { get; init; }
}
