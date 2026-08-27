namespace AnyChat.NET.Api.Models;

public sealed class SendChatMessageResponse
{
    public required string MessageId { get; init; }

    public required bool IdentityLearned { get; init; }
}
