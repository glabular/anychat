namespace AnyChat.NET.Api.Models;

public sealed class AuthStatusResponse
{
    public bool Configured { get; init; }

    public string? FingerprintPrefix { get; init; }
}

public sealed class SetApiKeyRequest
{
    public string? ApiKey { get; init; }
}
