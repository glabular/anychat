namespace AnyChat.NET.Api.Models;

/// <summary>
/// Body for creating a space. Name avoids clashing with Anytype.NET's CreateSpaceRequest.
/// </summary>
public sealed class CreateAppSpaceRequest
{
    /// <summary>
    /// Display name for the new space. Required (non-empty after trim).
    /// </summary>
    public string? Name { get; init; }

    /// <summary>
    /// Optional description. Whitespace-only is treated as empty.
    /// </summary>
    public string? Description { get; init; }
}
