namespace AnyChat.NET.Api.Models;

public sealed class AuthStatusResponse
{
    public bool Configured { get; init; }

    public string? FingerprintPrefix { get; init; }

    /// <summary>
    /// True when the vault identity has been learned (e.g. after a successful send).
    /// </summary>
    public bool IdentityKnown { get; init; }
}

public sealed class SetApiKeyRequest
{
    public string? ApiKey { get; init; }
}
