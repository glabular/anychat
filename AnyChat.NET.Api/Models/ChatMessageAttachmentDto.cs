namespace AnyChat.NET.Api.Models;

/// <summary>
/// An attachment on a chat message, mapped from Anytype <c>ChatAttachment</c>.
/// </summary>
public sealed class ChatMessageAttachmentDto
{
    /// <summary>
    /// Attached object / file id from Anytype <c>target</c>. Normalized to a bare
    /// cid when Anytype sends an authenticated <c>/files/{cid}</c> URL so the
    /// client can build <c>{gatewayUrl}/image/{fileId}</c>.
    /// </summary>
    public string? FileId { get; init; }

    /// <summary>
    /// Anytype attachment type string (for example <c>image</c> or <c>file</c>).
    /// </summary>
    public string? Type { get; init; }

    /// <summary>
    /// True when this attachment should be shown as an image in the UI.
    /// </summary>
    public bool IsImage { get; init; }
}
