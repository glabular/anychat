using System.Security.Cryptography;
using System.Text;
using Anytype.NET;

namespace AnyChat.NET.Api.Services;

/// <summary>
/// Mutable holder for the live <see cref="AnytypeClient"/> and API-key fingerprint.
/// </summary>
public sealed class AnytypeSession
{
    public const string UnconfiguredFingerprint = "unconfigured";

    private readonly Lock _gate = new();
    private readonly AnytypeApiKeyStore _keyStore;
    private readonly CurrentUserIdentityStore _identityStore;
    private AnytypeClient? _client;
    private string _fingerprint = UnconfiguredFingerprint;

    public AnytypeSession(AnytypeApiKeyStore keyStore, CurrentUserIdentityStore identityStore)
    {
        _keyStore = keyStore;
        _identityStore = identityStore;
    }

    public bool IsConfigured
    {
        get
        {
            lock (_gate)
            {
                return _client is not null;
            }
        }
    }

    public string Fingerprint
    {
        get
        {
            lock (_gate)
            {
                return _fingerprint;
            }
        }
    }

    /// <summary>
    /// Short prefix of the fingerprint for UI status (never the raw key).
    /// </summary>
    public string? FingerprintPrefix
    {
        get
        {
            lock (_gate)
            {
                if (_client is null
                    || string.Equals(_fingerprint, UnconfiguredFingerprint, StringComparison.Ordinal))
                {
                    return null;
                }

                return _fingerprint.Length <= 8
                    ? _fingerprint
                    : _fingerprint[..8];
            }
        }
    }

    public AnytypeClient? TryGetClient()
    {
        lock (_gate)
        {
            return _client;
        }
    }

    /// <summary>
    /// Boots from LocalAppData file, else optional config key. Safe with no key.
    /// </summary>
    public void InitializeFromStoreOrConfig(string? configApiKey)
    {
        var fromFile = _keyStore.TryRead();
        var key = !string.IsNullOrWhiteSpace(fromFile)
            ? fromFile.Trim()
            : string.IsNullOrWhiteSpace(configApiKey)
                ? null
                : configApiKey.Trim();

        if (key is null)
        {
            lock (_gate)
            {
                _client = null;
                _fingerprint = UnconfiguredFingerprint;
            }

            _identityStore.RebindFingerprint(UnconfiguredFingerprint);
            return;
        }

        ApplyKeyInMemory(key);
    }

    /// <summary>
    /// Persists the key, replaces the live client, and rebinds identity.
    /// Call only after a successful Anytype probe with this key.
    /// </summary>
    public void SetApiKey(string apiKey)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(apiKey);

        var trimmed = apiKey.Trim();
        _keyStore.Write(trimmed);
        ApplyKeyInMemory(trimmed);
    }

    /// <summary>
    /// Deletes the LocalAppData API-key file and learned-identity file, and drops
    /// the live client. Does not re-apply a config/user-secrets key until the next
    /// process start.
    /// </summary>
    public void ClearApiKey()
    {
        _keyStore.Clear();
        _identityStore.Clear();

        lock (_gate)
        {
            _client = null;
            _fingerprint = UnconfiguredFingerprint;
        }
    }

    private void ApplyKeyInMemory(string apiKey)
    {
        var fingerprint = ComputeApiKeyFingerprint(apiKey);
        var client = new AnytypeClient(apiKey);

        lock (_gate)
        {
            _client = client;
            _fingerprint = fingerprint;
        }

        _identityStore.RebindFingerprint(fingerprint);
    }

    public static string ComputeApiKeyFingerprint(string apiKey)
    {
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(apiKey));
        return Convert.ToHexString(hash);
    }
}
