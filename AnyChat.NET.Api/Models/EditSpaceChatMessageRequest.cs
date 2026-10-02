namespace AnyChat.NET.Api.Models;

/// <summary>
/// Body for editing chat message text. Name avoids clashing with
/// Anytype.NET's <c>EditChatMessageRequest</c>.
/// </summary>
public sealed class EditSpaceChatMessageRequest
{
    public string? Text { get; init; }
}
