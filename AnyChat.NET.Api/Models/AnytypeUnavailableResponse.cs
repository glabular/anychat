namespace AnyChat.NET.Api.Models;

public sealed class AnytypeUnavailableResponse
{
    public string Error { get; init; } = "anytype_unavailable";

    public string Message { get; init; } = "The Anytype local API is unreachable.";
}
