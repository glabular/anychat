using AnyChat.NET.Api.Models;
using AnyChat.NET.Api.Services;
using Anytype.NET;
using Anytype.NET.Interfaces;
using Anytype.NET.Models;
using Anytype.NET.Models.Requests;
using Microsoft.AspNetCore.Mvc;

namespace AnyChat.NET.Api.Controllers;

[ApiController]
[Route("api/spaces/{spaceId}/chats")]
public class ChatsController(
    AnytypeClient client,
    CurrentUserIdentityStore identityStore,
    CurrentMemberResolver memberResolver)
    : ControllerBase
{
    private const int IdentityLearnMaxAttempts = 3;
    private static readonly TimeSpan IdentityLearnRetryDelay = TimeSpan.FromMilliseconds(200);

    [HttpGet]
    public async Task<IActionResult> List(string spaceId)
    {
        var response = await client.Chats.ListAsync(spaceId);
        var chats = response.Chats ?? [];
        var items = chats.Select(MapChatListItem).ToList();

        return Ok(items);
    }

    [HttpGet("{chatId}/messages")]
    public async Task<IActionResult> ListMessages(
        string spaceId,
        string chatId,
        [FromQuery] int limit = 1,
        [FromQuery] string? beforeOrderId = null)
    {
        if (limit < 1)
        {
            limit = 1;
        }
        else if (limit > 1000)
        {
            limit = 1000;
        }

        var response = await client.Chats.ListMessagesAsync(
            spaceId,
            chatId,
            beforeOrderId: beforeOrderId ?? string.Empty,
            afterOrderId: string.Empty,
            limit: limit);
        var participantId = await memberResolver.ResolveParticipantIdAsync(spaceId);
        var messages = (response.Messages ?? []).Select(message => MapMessage(message, participantId));

        return Ok(messages);
    }

    [HttpPost("{chatId}/messages")]
    public async Task<IActionResult> SendMessage(
        string spaceId,
        string chatId,
        [FromBody] SendChatMessageRequest request)
    {
        var text = request.Text?.Trim();
        if (string.IsNullOrEmpty(text))
        {
            return BadRequest(new { error = "Message text is required." });
        }

        var addResponse = await client.Chats.AddMessageAsync(
            spaceId,
            chatId,
            new AddChatMessageRequest { Text = text });

        var messageId = addResponse.MessageId;
        if (string.IsNullOrWhiteSpace(messageId))
        {
            return StatusCode(
                StatusCodes.Status502BadGateway,
                new { error = "Anytype did not return a message id." });
        }

        var identityLearned = identityStore.IsKnown;

        if (!identityLearned)
        {
            identityLearned = await TryLearnIdentityAsync(spaceId, chatId, messageId);
        }

        return StatusCode(
            StatusCodes.Status201Created,
            new SendChatMessageResponse
            {
                MessageId = messageId,
                IdentityLearned = identityLearned,
            });
    }

    private async Task<bool> TryLearnIdentityAsync(string spaceId, string chatId, string messageId)
    {
        for (var attempt = 1; attempt <= IdentityLearnMaxAttempts; attempt++)
        {
            try
            {
                var message = await client.Chats.GetMessageAsync(spaceId, chatId, messageId);
                
                if (string.IsNullOrWhiteSpace(message.Creator))
                {
                    // Fall through to retry/delay.
                }
                else
                {
                    var member = await client.Members.GetByIdAsync(spaceId, message.Creator);
                    if (member is not null && !string.IsNullOrWhiteSpace(member.Identity))
                    {
                        identityStore.Learn(member.Identity);
                        return true;
                    }
                }
            }
            catch (Exception)
            {
                // Learning must not turn a successful send into a retryable failure.
            }

            if (attempt < IdentityLearnMaxAttempts)
            {
                await Task.Delay(IdentityLearnRetryDelay);
            }
        }

        return false;
    }

    private static ChatListItemDto MapChatListItem(Chat chat)
    {
        return new ChatListItemDto
        {
            Id = chat.Id,
            Name = chat.Name,
            Object = chat.Object,
            IconEmoji = ResolveIconEmoji(chat.Icon),
        };
    }

    private static string? ResolveIconEmoji(IIcon? icon)
    {
        if (icon is EmojiIcon emojiIcon && !string.IsNullOrWhiteSpace(emojiIcon.Emoji))
        {
            return emojiIcon.Emoji;
        }

        return null;
    }

    private static ChatMessageDto MapMessage(ChatMessage message, string? participantId)
    {
        bool? isMine = null;
        if (participantId is not null)
        {
            isMine = string.Equals(message.Creator, participantId, StringComparison.Ordinal);
        }

        return new ChatMessageDto
        {
            Id = message.Id,
            OrderId = message.OrderId,
            Creator = message.Creator,
            CreatorName = message.CreatorName,
            Content = new ChatMessageContentDto
            {
                Text = message.Content?.Text,
            },
            CreatedAt = message.CreatedAt,
            IsMine = isMine,
        };
    }
}
