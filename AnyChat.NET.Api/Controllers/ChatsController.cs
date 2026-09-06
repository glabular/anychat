using System.Text.Json;
using System.Text.Json.Serialization;
using AnyChat.NET.Api.Models;
using AnyChat.NET.Api.Services;
using Anytype.NET;
using Anytype.NET.Interfaces;
using Anytype.NET.Models;
using Anytype.NET.Models.Requests;
using Microsoft.AspNetCore.Http.Features;
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
    private const int StreamHeartbeatSeconds = 30;
    private static readonly TimeSpan IdentityLearnRetryDelay = TimeSpan.FromMilliseconds(200);
    private static readonly TimeSpan StreamKeepaliveInterval = TimeSpan.FromSeconds(15);

    private static readonly JsonSerializerOptions StreamJsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

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
        limit = ClampMessageLimit(limit);

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

    /// <summary>
    /// Proxies Anytype's chat message SSE to the browser as <c>text/event-stream</c>.
    /// Cancels the upstream stream when the HTTP client disconnects.
    /// </summary>
    [HttpGet("{chatId}/messages/stream")]
    public async Task StreamMessages(
        string spaceId,
        string chatId,
        [FromQuery] int limit = 50,
        CancellationToken cancellationToken = default)
    {
        limit = ClampMessageLimit(limit);

        Response.ContentType = "text/event-stream";
        Response.Headers.CacheControl = "no-cache";
        Response.Headers.Append("X-Accel-Buffering", "no");
        HttpContext.Features.Get<IHttpResponseBodyFeature>()?.DisableBuffering();

        var participantId = await memberResolver.ResolveParticipantIdAsync(spaceId);

        using var linkedCts = CancellationTokenSource.CreateLinkedTokenSource(
            cancellationToken,
            HttpContext.RequestAborted);
        var streamToken = linkedCts.Token;

        try
        {
            // Single-writer loop: interleave upstream events with SSE comment keepalives
            // (Anytype.NET strips upstream heartbeats, so the browser never sees them).
            await using var enumerator = client.Chats
                .StreamMessagesAsync(
                    spaceId,
                    chatId,
                    limit,
                    StreamHeartbeatSeconds,
                    streamToken)
                .GetAsyncEnumerator(streamToken);

            var moveNextTask = enumerator.MoveNextAsync().AsTask();

            while (!streamToken.IsCancellationRequested)
            {
                using var delayCts = CancellationTokenSource.CreateLinkedTokenSource(streamToken);
                var delayTask = Task.Delay(StreamKeepaliveInterval, delayCts.Token);
                var completed = await Task.WhenAny(moveNextTask, delayTask);

                if (completed == moveNextTask)
                {
                    await delayCts.CancelAsync();
                    try
                    {
                        await delayTask;
                    }
                    catch (OperationCanceledException)
                    {
                        // Keepalive timer cancelled because an upstream event arrived.
                    }

                    if (!await moveNextTask)
                    {
                        break;
                    }

                    var dto = MapStreamEvent(enumerator.Current, participantId);
                    var json = JsonSerializer.Serialize(dto, StreamJsonOptions);
                    await Response.WriteAsync($"data: {json}\n\n", streamToken);
                    await Response.Body.FlushAsync(streamToken);

                    moveNextTask = enumerator.MoveNextAsync().AsTask();
                    continue;
                }

                await delayTask;
                await Response.WriteAsync(":\n\n", streamToken);
                await Response.Body.FlushAsync(streamToken);
            }
        }
        catch (OperationCanceledException) when (streamToken.IsCancellationRequested)
        {
            // Client disconnected or request aborted — expected for SSE.
        }
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

    private static int ClampMessageLimit(int limit)
    {
        if (limit < 1)
        {
            return 1;
        }

        if (limit > 1000)
        {
            return 1000;
        }

        return limit;
    }

    private static ChatMessageStreamEventDto MapStreamEvent(
        ChatStreamEvent streamEvent,
        string? participantId)
    {
        var type = streamEvent.Type ?? string.Empty;
        var payload = streamEvent.Payload;

        if (string.Equals(type, "message_added", StringComparison.Ordinal)
            || string.Equals(type, "message_updated", StringComparison.Ordinal))
        {
            return new ChatMessageStreamEventDto
            {
                Type = type,
                Message = payload?.Message is null
                    ? null
                    : MapMessage(payload.Message, participantId),
            };
        }

        return new ChatMessageStreamEventDto
        {
            Type = type,
            Id = payload?.Id,
        };
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
