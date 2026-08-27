namespace AnyChat.NET.Api.Models;

public sealed class ChatMessageContentDto
{
    public string? Text { get; init; }
}

public sealed class ChatMessageDto
{
    public string? Id { get; init; }

    public string? Creator { get; init; }

    public string? CreatorName { get; init; }

    public ChatMessageContentDto? Content { get; init; }

    /// <summary>
    /// True when the message is from the learned current user, false when it is
    /// from someone else, and null when ownership cannot be determined yet.
    /// </summary>
    public bool? IsMine { get; init; }
}
