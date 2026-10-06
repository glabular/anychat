namespace AnyChat.NET.Api.Models;

public sealed class ChatMessageContentDto
{
    public string? Text { get; init; }

    /// <summary>
    /// Attachments from Anytype <c>ChatMessage.Attachments</c> (nested here for
    /// the client). Empty or null when the message has none.
    /// </summary>
    public IReadOnlyList<ChatMessageAttachmentDto>? Attachments { get; init; }
}
