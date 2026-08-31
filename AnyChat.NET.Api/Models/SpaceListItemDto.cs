namespace AnyChat.NET.Api.Models;

/// <summary>
/// A space as returned by the spaces list endpoint for the client UI.
/// </summary>
public sealed class SpaceListItemDto
{
    /// <summary>Unique space identifier.</summary>
    public string? Id { get; init; }

    /// <summary>Name from Anytype. May be empty for some space types.</summary>
    public string? Name { get; init; }

    /// <summary>Anytype object type string (for example, anytype.space).</summary>
    public string? Object { get; init; }

    /// <summary>Optional space icon from Anytype.</summary>
    public object? Icon { get; init; }

    /// <summary>Optional space description.</summary>
    public string? Description { get; init; }

    /// <summary>Gateway URL used to serve files and media for the space.</summary>
    public string? GatewayUrl { get; init; }

    /// <summary>Network identifier for the space.</summary>
    public string? NetworkId { get; init; }

    /// <summary>
    /// Label for display in the UI. When <see cref="Name"/> is empty,
    /// may be filled from another source such as a space member.
    /// Null or empty when no label could be resolved.
    /// </summary>
    public string? DisplayName { get; init; }
}
