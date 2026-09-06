namespace AnyChat.NET.Api.Models;

/// <summary>
/// One Server-Sent Event proxied from Anytype's chat message stream.
/// </summary>
public sealed class ChatMessageStreamEventDto
{
    /// <summary>
    /// Upstream event type: <c>message_added</c>, <c>message_updated</c>,
    /// <c>message_deleted</c>, or <c>reactions_updated</c>.
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
}
