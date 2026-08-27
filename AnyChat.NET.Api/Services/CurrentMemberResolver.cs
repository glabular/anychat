using System.Collections.Concurrent;
using Anytype.NET;

namespace AnyChat.NET.Api.Services;

/// <summary>
/// Resolves the learned vault identity to a space-specific participant id.
/// </summary>
public sealed class CurrentMemberResolver(
    AnytypeClient client,
    CurrentUserIdentityStore identityStore)
{
    private readonly ConcurrentDictionary<string, string> _participantIdsBySpace = new(StringComparer.Ordinal);

    public async Task<string?> ResolveParticipantIdAsync(string spaceId)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(spaceId);

        if (!identityStore.IsKnown || string.IsNullOrWhiteSpace(identityStore.Identity))
        {
            return null;
        }

        if (_participantIdsBySpace.TryGetValue(spaceId, out var cachedId))
        {
            return cachedId;
        }

        try
        {
            var member = await client.Members.GetByIdAsync(spaceId, identityStore.Identity);
            if (member is null
                || string.IsNullOrWhiteSpace(member.Id)
                || !string.Equals(member.Identity, identityStore.Identity, StringComparison.Ordinal))
            {
                return null;
            }

            _participantIdsBySpace[spaceId] = member.Id;

            return member.Id;
        }
        catch (Exception)
        {
            // Fail closed: do not cache failures; leave messages unclassified.
            return null;
        }
    }
}
