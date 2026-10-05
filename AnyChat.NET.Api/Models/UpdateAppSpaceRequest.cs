namespace AnyChat.NET.Api.Models;

/// <summary>
/// Body for renaming a space. Name avoids clashing with Anytype.NET's UpdateSpaceRequest.
/// </summary>
public sealed class UpdateAppSpaceRequest
{
    /// <summary>
    /// New display name. Required (non-empty after trim), same rule as create.
    /// </summary>
    public string? Name { get; init; }
}
