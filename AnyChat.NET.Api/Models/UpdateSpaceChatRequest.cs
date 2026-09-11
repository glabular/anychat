namespace AnyChat.NET.Api.Models;

/// <summary>
/// Body for renaming a chat. Name avoids clashing with Anytype.NET's UpdateObjectRequest.
/// </summary>
public sealed class UpdateSpaceChatRequest
{
    /// <summary>
    /// New display name. Null/empty/whitespace becomes a single space for Anytype;
    /// the Web UI shows those as Untitled.
    /// </summary>
    public string? Name { get; init; }
}
