namespace AnyChat.NET.Api.Models;

/// <summary>
/// Normalized member icon for the UI. Null when the member has no usable icon.
/// </summary>
public sealed class MemberAvatarDto
{
    /// <summary>
    /// Icon kind: <c>emoji</c>, <c>file</c>, or <c>named</c>.
    /// </summary>
    public string Kind { get; init; } = "";

    /// <summary>Emoji glyph when <see cref="Kind"/> is <c>emoji</c>.</summary>
    public string? Emoji { get; init; }

    /// <summary>
    /// Anytype file id when <see cref="Kind"/> is <c>file</c>.
    /// The client builds a URL with the space gateway.
    /// </summary>
    public string? FileId { get; init; }

    /// <summary>Named-icon label when <see cref="Kind"/> is <c>named</c>.</summary>
    public string? Name { get; init; }

    /// <summary>Optional named-icon color when <see cref="Kind"/> is <c>named</c>.</summary>
    public string? Color { get; init; }
}
