namespace AnyChat.NET.Api.Models;

/// <summary>
/// Body for creating a chat in a space. Name avoids clashing with Anytype.NET's CreateChatRequest.
/// </summary>
public sealed class CreateSpaceChatRequest
{
    /// <summary>Display name for the new chat.</summary>
    public string? Name { get; init; }
}
