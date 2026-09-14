using System.Text.Json;

namespace AnyChat.NET.Api.Services;

public sealed class CurrentUserIdentityStore
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = false,
    };

    private string _apiKeyFingerprint;
    private readonly string _storagePath;
    private readonly object _gate = new();
    private string? _identity;

    public CurrentUserIdentityStore(string apiKeyFingerprint, string storagePath)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(apiKeyFingerprint);
        ArgumentException.ThrowIfNullOrWhiteSpace(storagePath);

        _apiKeyFingerprint = apiKeyFingerprint;
        _storagePath = storagePath;
        _identity = TryLoadMatchingIdentity();
    }

    public bool IsKnown => _identity is not null;

    public string? Identity => _identity;

    /// <summary>
    /// Switches the active API-key fingerprint. Clears learned identity when it changes
    /// and reloads any stored identity that matches the new fingerprint.
    /// </summary>
    public void RebindFingerprint(string apiKeyFingerprint)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(apiKeyFingerprint);

        lock (_gate)
        {
            if (string.Equals(_apiKeyFingerprint, apiKeyFingerprint, StringComparison.Ordinal))
            {
                return;
            }

            _apiKeyFingerprint = apiKeyFingerprint;
            _identity = TryLoadMatchingIdentity();
        }
    }

    public void Learn(string identity)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(identity);

        lock (_gate)
        {
            if (string.Equals(
                    _apiKeyFingerprint,
                    AnytypeSession.UnconfiguredFingerprint,
                    StringComparison.Ordinal))
            {
                return;
            }

            if (_identity is not null)
            {
                if (string.Equals(_identity, identity, StringComparison.Ordinal))
                {
                    return;
                }

                throw new InvalidOperationException(
                    "Cannot learn a different identity for the same API key.");
            }

            Persist(identity);
            _identity = identity;
        }
    }

    private string? TryLoadMatchingIdentity()
    {
        if (string.Equals(
                _apiKeyFingerprint,
                AnytypeSession.UnconfiguredFingerprint,
                StringComparison.Ordinal))
        {
            return null;
        }

        if (!File.Exists(_storagePath))
        {
            return null;
        }

        try
        {
            var json = File.ReadAllText(_storagePath);
            var record = JsonSerializer.Deserialize<IdentityRecord>(json, JsonOptions);
            if (record is null)
            {
                return null;
            }

            if (!string.Equals(record.ApiKeyFingerprint, _apiKeyFingerprint, StringComparison.Ordinal))
            {
                return null;
            }

            return string.IsNullOrWhiteSpace(record.Identity) ? null : record.Identity;
        }
        catch (JsonException)
        {
            return null;
        }
        catch (IOException)
        {
            return null;
        }
    }

    private void Persist(string identity)
    {
        var directory = Path.GetDirectoryName(_storagePath);
        if (!string.IsNullOrEmpty(directory))
        {
            Directory.CreateDirectory(directory);
        }

        var record = new IdentityRecord
        {
            ApiKeyFingerprint = _apiKeyFingerprint,
            Identity = identity,
        };

        var json = JsonSerializer.Serialize(record, JsonOptions);
        var tempPath = _storagePath + ".tmp";

        File.WriteAllText(tempPath, json);
        File.Move(tempPath, _storagePath, overwrite: true);
    }

    private sealed class IdentityRecord
    {
        public string? ApiKeyFingerprint { get; init; }

        public string? Identity { get; init; }
    }
}
