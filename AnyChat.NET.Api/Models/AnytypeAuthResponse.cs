namespace AnyChat.NET.Api.Models;

public sealed class AnytypeAuthResponse
{
    public const string ErrorMissing = "anytype_auth_missing";

    public const string ErrorInvalid = "anytype_auth_invalid";

    public string Error { get; init; } = ErrorInvalid;

    public string Message { get; init; } = "The Anytype API key is missing or incorrect.";
}
