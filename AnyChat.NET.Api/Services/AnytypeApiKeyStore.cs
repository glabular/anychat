using System.Security.Cryptography;
using System.Text;

namespace AnyChat.NET.Api.Services;

/// <summary>
/// Persists the Anytype API key under LocalApplicationData using DPAPI (CurrentUser).
/// </summary>
public sealed class AnytypeApiKeyStore
{
    private readonly string _storagePath;

    public AnytypeApiKeyStore(string storagePath)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(storagePath);
        _storagePath = storagePath;
    }

    public static string DefaultStoragePath =>
        Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "AnyChat.NET",
            "anytype-api-key.dat");

    /// <summary>
    /// Reads and decrypts the stored key, or <see langword="null"/> if missing/unreadable.
    /// </summary>
    public string? TryRead()
    {
        if (!File.Exists(_storagePath))
        {
            return null;
        }

        try
        {
            var cipher = File.ReadAllBytes(_storagePath);

            if (cipher.Length == 0)
            {
                return null;
            }

            var plain = ProtectedData.Unprotect(cipher, optionalEntropy: null, DataProtectionScope.CurrentUser);
            var key = Encoding.UTF8.GetString(plain);

            return string.IsNullOrWhiteSpace(key) ? null : key.Trim();
        }
        catch (CryptographicException)
        {
            return null;
        }
        catch (IOException)
        {
            return null;
        }
        catch (UnauthorizedAccessException)
        {
            return null;
        }
    }

    /// <summary>
    /// Encrypts and writes the key. Overwrites any previous file.
    /// </summary>
    public void Write(string apiKey)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(apiKey);

        var directory = Path.GetDirectoryName(_storagePath);

        if (!string.IsNullOrEmpty(directory))
        {
            Directory.CreateDirectory(directory);
        }

        var plain = Encoding.UTF8.GetBytes(apiKey.Trim());
        var cipher = ProtectedData.Protect(plain, optionalEntropy: null, DataProtectionScope.CurrentUser);
        var tempPath = _storagePath + ".tmp";

        File.WriteAllBytes(tempPath, cipher);
        File.Move(tempPath, _storagePath, overwrite: true);
    }

    /// <summary>
    /// Removes the persisted key file. Overwrites ciphertext before delete when possible.
    /// Safe if the file is already missing.
    /// </summary>
    public void Clear()
    {
        DeleteQuietly(_storagePath + ".tmp");

        if (!File.Exists(_storagePath))
        {
            return;
        }

        try
        {
            // DPAPI ciphertext is useless without this Windows user, but overwrite
            // before delete so the blob is less likely to remain in slack space.
            var length = new FileInfo(_storagePath).Length;
            if (length > 0 && length <= 1_048_576)
            {
                var zeros = new byte[length];
                File.WriteAllBytes(_storagePath, zeros);
                CryptographicOperations.ZeroMemory(zeros);
            }

            File.Delete(_storagePath);
        }
        catch (IOException)
        {
            DeleteQuietly(_storagePath);
        }
        catch (UnauthorizedAccessException)
        {
            DeleteQuietly(_storagePath);
        }
    }

    private static void DeleteQuietly(string path)
    {
        try
        {
            if (File.Exists(path))
            {
                File.Delete(path);
            }
        }
        catch (IOException)
        {
        }
        catch (UnauthorizedAccessException)
        {
        }
    }
}
