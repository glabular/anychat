using Anytype.NET;
using Anytype.NET.Models;

namespace AnyChat.NET.Api.Services;

/// <summary>
/// Builds a display label for a space from its name or, when that is empty, from its members.
/// </summary>
public sealed class SpaceDisplayResolver(
    AnytypeClient client,
    CurrentUserIdentityStore identityStore)
{
    /// <summary>
    /// Returns a trimmed <see cref="Space.Name"/> when present; otherwise a name derived from
    /// another member of the space. Returns <see langword="null"/> when no label can be resolved.
    /// </summary>
    /// <param name="space">The space to label.</param>
    /// <returns>A non-empty display label, or <see langword="null"/>.</returns>
    public async Task<string?> ResolveDisplayNameAsync(Space space)
    {
        ArgumentNullException.ThrowIfNull(space);

        if (!string.IsNullOrWhiteSpace(space.Name))
        {
            return space.Name.Trim();
        }

        if (string.IsNullOrWhiteSpace(space.Id))
        {
            return null;
        }

        try
        {
            var response = await client.Members.ListAsync(space.Id);
            var members = response.Members ?? [];
            var other = PickOtherMember(members);

            if (other is null)
            {
                return null;
            }

            if (!string.IsNullOrWhiteSpace(other.Name))
            {
                return other.Name.Trim();
            }

            if (!string.IsNullOrWhiteSpace(other.GlobalName))
            {
                return other.GlobalName.Trim();
            }

            return null;
        }
        catch (Exception)
        {
            // Leave this space unlabeled rather than failing the full list.
            return null;
        }
    }

    /// <summary>
    /// Selects the member whose name should represent the space when the space name is empty.
    /// Prefer active members other than the current vault identity; if identity is unknown,
    /// prefer a named non-owner, then any named member.
    /// </summary>
    /// <param name="members">Members of the space.</param>
    /// <returns>The chosen member, or <see langword="null"/> if none is suitable.</returns>
    private Member? PickOtherMember(IReadOnlyList<Member> members)
    {
        var active = members
            .Where(m =>
                m is not null
                && (string.IsNullOrWhiteSpace(m.Status)
                    || string.Equals(m.Status, "active", StringComparison.OrdinalIgnoreCase)))
            .ToList();

        if (active.Count == 0)
        {
            active = members.Where(m => m is not null).ToList()!;
        }

        if (identityStore.IsKnown
            && !string.IsNullOrWhiteSpace(identityStore.Identity))
        {
            var other = active.FirstOrDefault(m =>
                !string.Equals(m.Identity, identityStore.Identity, StringComparison.Ordinal));
            if (other is not null)
            {
                return other;
            }
        }

        var withName = active
            .Where(m =>
                !string.IsNullOrWhiteSpace(m.Name)
                || !string.IsNullOrWhiteSpace(m.GlobalName))
            .ToList();

        if (withName.Count == 0)
        {
            return null;
        }

        if (withName.Count == 1)
        {
            return withName[0];
        }

        var nonOwner = withName.FirstOrDefault(m =>
            !string.Equals(m.Role, "owner", StringComparison.OrdinalIgnoreCase));

        return nonOwner ?? withName[0];
    }
}
