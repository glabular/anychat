namespace AnyChat.NET.Api.Models;

public sealed class ChatMessageDto
{
    public string? Id { get; init; }

    /// <summary>
    /// Cursor order ID from Anytype; pass as <c>beforeOrderId</c> to load older messages.
    /// </summary>
    public string? OrderId { get; init; }

    public string? Creator { get; init; }

    public string? CreatorName { get; init; }

    public ChatMessageContentDto? Content { get; init; }

    /// <summary>
    /// Id of the message this one replies to, from Anytype <c>reply_to_message_id</c>.
    /// Null when the message is standalone (not a reply).
    /// </summary>
    public string? ReplyToMessageId { get; init; }

    /// <summary>
    /// Trimmed text of the parent message for quote UI.
    /// Null when not a reply, parent text is empty, or parent could not be resolved.
    /// </summary>
    public string? ReplyToText { get; init; }

    /// <summary>
    /// Display name of the parent message author for quote UI.
    /// Null when not a reply or parent could not be resolved.
    /// </summary>
    public string? ReplyToAuthorName { get; init; }

    /// <summary>
    /// Unix timestamp in seconds when the message was created.
    /// Null when the upstream message has no creation time.
    /// </summary>
    public long? CreatedAt { get; init; }

    /// <summary>
    /// Unix timestamp in seconds when the message was last modified.
    /// Null when the upstream message has no modification time.
    /// </summary>
    public long? ModifiedAt { get; init; }

    /// <summary>
    /// True when the message is from the learned current user, false when it is
    /// from someone else, and null when ownership cannot be determined yet.
    /// </summary>
    public bool? IsMine { get; init; }
}
