using System.Net;
using System.Text.Json;
using System.Text.Json.Serialization;
using AnyChat.NET.Api.Filters;
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
    AnytypeSession session,
    CurrentUserIdentityStore identityStore,
    CurrentMemberResolver memberResolver)
    : ControllerBase
{
    private const int IdentityLearnMaxAttempts = 3;
    private const int StreamHeartbeatSeconds = 30;
    private static readonly TimeSpan IdentityLearnRetryDelay = TimeSpan.FromMilliseconds(200);

    private static readonly JsonSerializerOptions StreamJsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    [HttpGet]
    public async Task<IActionResult> List(string spaceId)
    {
        var client = session.TryGetClient();

        if (client is null)
        {
            return AnytypeAuthExceptionFilter.CreateMissingResult();
        }

        try
        {
            var response = await client.Chats.ListAsync(spaceId);
            var chats = response.Chats ?? [];
            var items = chats.Select(MapChatListItem).ToList();

            return Ok(items);
        }
        catch (Exception ex) when (AnytypeAuthExceptionFilter.IsAnytypeAuthFailure(ex))
        {
            return AnytypeAuthExceptionFilter.CreateInvalidResult();
        }
        catch (Exception ex) when (AnytypeUnavailableExceptionFilter.IsAnytypeConnectivityFailure(ex))
        {
            return AnytypeUnavailableExceptionFilter.CreateResult();
        }
    }

    [HttpPost]
    public async Task<IActionResult> Create(string spaceId, [FromBody] CreateSpaceChatRequest? request)
    {
        // Anytype rejects a fully empty name but accepts a single space as the title.
        // UI maps blank/whitespace names to "Untitled".
        var trimmed = request?.Name?.Trim() ?? string.Empty;
        var name = trimmed.Length == 0 ? " " : trimmed;

        var client = session.TryGetClient();
        if (client is null)
        {
            return AnytypeAuthExceptionFilter.CreateMissingResult();
        }

        try
        {
            var chat = await client.Chats.CreateAsync(
                spaceId,
                new CreateChatRequest { Name = name });

            return StatusCode(StatusCodes.Status201Created, MapChatListItem(chat));
        }
        catch (Exception ex) when (AnytypeAuthExceptionFilter.IsAnytypeAuthFailure(ex))
        {
            return AnytypeAuthExceptionFilter.CreateInvalidResult();
        }
        catch (Exception ex) when (AnytypeUnavailableExceptionFilter.IsAnytypeConnectivityFailure(ex))
        {
            return AnytypeUnavailableExceptionFilter.CreateResult();
        }
    }
        
    [HttpDelete("{chatId}")]
    public async Task<IActionResult> Delete(string spaceId, string chatId)
    {
        if (string.IsNullOrWhiteSpace(chatId))
        {
            return BadRequest(new { error = "Chat id is required." });
        }

        var client = session.TryGetClient();
        if (client is null)
        {
            return AnytypeAuthExceptionFilter.CreateMissingResult();
        }

        try
        {
            await client.Objects.DeleteAsync(spaceId, chatId);
            return NoContent();
        }
        catch (Exception ex) when (AnytypeAuthExceptionFilter.IsAnytypeAuthFailure(ex))
        {
            return AnytypeAuthExceptionFilter.CreateInvalidResult();
        }
        catch (Exception ex) when (AnytypeUnavailableExceptionFilter.IsAnytypeConnectivityFailure(ex))
        {
            return AnytypeUnavailableExceptionFilter.CreateResult();
        }
    }

    [HttpPatch("{chatId}")]
    public async Task<IActionResult> Update(
        string spaceId,
        string chatId,
        [FromBody] UpdateSpaceChatRequest? request)
    {
        if (string.IsNullOrWhiteSpace(chatId))
        {
            return BadRequest(new { error = "Chat id is required." });
        }

        // Same blank-name rule as Create: Anytype rejects "" but accepts " ".
        var trimmed = request?.Name?.Trim() ?? string.Empty;
        var name = trimmed.Length == 0 ? " " : trimmed;

        var client = session.TryGetClient();
        if (client is null)
        {
            return AnytypeAuthExceptionFilter.CreateMissingResult();
        }

        try
        {
            await client.Objects.UpdateAsync(
                spaceId,
                chatId,
                new UpdateObjectRequest { Name = name });

            return NoContent();
        }
        catch (Exception ex) when (AnytypeAuthExceptionFilter.IsAnytypeAuthFailure(ex))
        {
            return AnytypeAuthExceptionFilter.CreateInvalidResult();
        }
        catch (Exception ex) when (AnytypeUnavailableExceptionFilter.IsAnytypeConnectivityFailure(ex))
        {
            return AnytypeUnavailableExceptionFilter.CreateResult();
        }
    }

    [HttpGet("{chatId}/messages")]
    public async Task<IActionResult> ListMessages(
        string spaceId,
        string chatId,
        [FromQuery] int limit = 1,
        [FromQuery] string? beforeOrderId = null)
    {
        limit = ClampMessageLimit(limit);

        var client = session.TryGetClient();
        if (client is null)
        {
            return AnytypeAuthExceptionFilter.CreateMissingResult();
        }

        try
        {
            var response = await client.Chats.ListMessagesAsync(
                spaceId,
                chatId,
                beforeOrderId: beforeOrderId ?? string.Empty,
                afterOrderId: string.Empty,
                limit: limit);
            var participantId = await memberResolver.ResolveParticipantIdAsync(spaceId);
            var sourceMessages = response.Messages ?? [];
            var replyPreviewById = await BuildReplyPreviewLookupAsync(
                client.Chats,
                spaceId,
                chatId,
                sourceMessages);
            var messages = sourceMessages
                .Select(message => MapMessage(
                    message,
                    participantId,
                    LookupReplyPreview(message, replyPreviewById)))
                .ToList();

            return Ok(messages);
        }
        catch (Exception ex) when (AnytypeAuthExceptionFilter.IsAnytypeAuthFailure(ex))
        {
            return AnytypeAuthExceptionFilter.CreateInvalidResult();
        }
        catch (Exception ex) when (AnytypeUnavailableExceptionFilter.IsAnytypeConnectivityFailure(ex))
        {
            return AnytypeUnavailableExceptionFilter.CreateResult();
        }
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

        var client = session.TryGetClient();
        if (client is null)
        {
            await TryWriteAnytypeAuthAsync(AnytypeAuthResponse.ErrorMissing);
            return;
        }

        using var linkedCts = CancellationTokenSource.CreateLinkedTokenSource(
            cancellationToken,
            HttpContext.RequestAborted);
        var streamToken = linkedCts.Token;

        try
        {
            var participantId = await memberResolver.ResolveParticipantIdAsync(spaceId);

            // Plain await foreach only — do not WhenAny-race MoveNextAsync with a timer.
            // Disposing the enumerator while MoveNextAsync is still pending (chat switch
            // closes EventSource) surfaces as NotSupportedException in the debugger.
            await foreach (var streamEvent in client.Chats.StreamMessagesAsync(
                spaceId,
                chatId,
                limit,
                StreamHeartbeatSeconds,
                streamToken))
            {
                var dto = await MapStreamEventAsync(
                    client.Chats,
                    spaceId,
                    chatId,
                    streamEvent,
                    participantId,
                    streamToken);
                var json = JsonSerializer.Serialize(dto, StreamJsonOptions);
                await Response.WriteAsync($"data: {json}\n\n", streamToken);
                await Response.Body.FlushAsync(CancellationToken.None);
            }
        }
        catch (OperationCanceledException) when (streamToken.IsCancellationRequested)
        {
            // Client disconnected or request aborted — expected for SSE.
        }
        catch (IOException) when (streamToken.IsCancellationRequested)
        {
            // Response write failed because the client already closed the socket.
        }
        catch (NotSupportedException) when (streamToken.IsCancellationRequested)
        {
            // Some response/upstream stream teardowns surface this on abort; treat as disconnect.
        }
        catch (IOException) when (!streamToken.IsCancellationRequested)
        {
            // Anytype local API dropped while the browser was still connected.
            await TryWriteAnytypeUnavailableAsync();
        }
        catch (HttpRequestException) when (!streamToken.IsCancellationRequested)
        {
            // Connect/read to Anytype failed (e.g. connection refused after client quit).
            await TryWriteAnytypeUnavailableAsync();
        }
        catch (Exception ex) when (
            !streamToken.IsCancellationRequested
            && AnytypeAuthExceptionFilter.IsAnytypeAuthFailure(ex))
        {
            await TryWriteAnytypeAuthAsync(AnytypeAuthResponse.ErrorInvalid);
        }
        catch (Exception ex) when (
            !streamToken.IsCancellationRequested
            && AnytypeUnavailableExceptionFilter.IsAnytypeConnectivityFailure(ex))
        {
            await TryWriteAnytypeUnavailableAsync();
        }
    }

    /// <summary>
    /// Best-effort signal so the Web UI can show an Anytype-lost notice.
    /// Ignores write failures if the browser already left.
    /// </summary>
    private async Task TryWriteAnytypeUnavailableAsync()
    {
        try
        {
            var dto = new ChatMessageStreamEventDto { Type = "anytype_unavailable" };
            var json = JsonSerializer.Serialize(dto, StreamJsonOptions);
            await Response.WriteAsync($"data: {json}\n\n");
            await Response.Body.FlushAsync(CancellationToken.None);
        }
        catch (OperationCanceledException)
        {
            // Browser gone during the status write.
        }
        catch (IOException)
        {
            // Browser gone during the status write.
        }
    }

    private async Task TryWriteAnytypeAuthAsync(string errorCode)
    {
        try
        {
            var dto = new ChatMessageStreamEventDto { Type = errorCode };
            var json = JsonSerializer.Serialize(dto, StreamJsonOptions);
            await Response.WriteAsync($"data: {json}\n\n");
            await Response.Body.FlushAsync(CancellationToken.None);
        }
        catch (OperationCanceledException)
        {
            // Browser gone during the status write.
        }
        catch (IOException)
        {
            // Browser gone during the status write.
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

        var client = session.TryGetClient();
        if (client is null)
        {
            return AnytypeAuthExceptionFilter.CreateMissingResult();
        }

        try
        {
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
        catch (Exception ex) when (AnytypeAuthExceptionFilter.IsAnytypeAuthFailure(ex))
        {
            return AnytypeAuthExceptionFilter.CreateInvalidResult();
        }
        catch (Exception ex) when (AnytypeUnavailableExceptionFilter.IsAnytypeConnectivityFailure(ex))
        {
            return AnytypeUnavailableExceptionFilter.CreateResult();
        }
    }

    [HttpPatch("{chatId}/messages/{messageId}")]
    public async Task<IActionResult> EditMessage(
        string spaceId,
        string chatId,
        string messageId,
        [FromBody] EditSpaceChatMessageRequest request)
    {
        if (string.IsNullOrWhiteSpace(messageId))
        {
            return BadRequest(new { error = "Message id is required." });
        }

        var text = request.Text?.Trim();

        if (string.IsNullOrEmpty(text))
        {
            return BadRequest(new { error = "Message text is required." });
        }

        var client = session.TryGetClient();

        if (client is null)
        {
            return AnytypeAuthExceptionFilter.CreateMissingResult();
        }

        try
        {
            // Anytype replaces the whole message body on edit. Omitting attachments
            // clears photos/files, so re-send the current list with the new text.
            var existing = await client.Chats.GetMessageAsync(spaceId, chatId, messageId);
            await client.Chats.EditMessageAsync(
                spaceId,
                chatId,
                messageId,
                BuildEditChatMessageRequest(text, existing));

            var message = await client.Chats.GetMessageAsync(spaceId, chatId, messageId);
            var participantId = await memberResolver.ResolveParticipantIdAsync(spaceId);
            var replyPreviewById = await BuildReplyPreviewLookupAsync(
                client.Chats,
                spaceId,
                chatId,
                [message]);

            return Ok(MapMessage(
                message,
                participantId,
                LookupReplyPreview(message, replyPreviewById)));
        }
        catch (Exception ex) when (AnytypeAuthExceptionFilter.IsAnytypeAuthFailure(ex))
        {
            return AnytypeAuthExceptionFilter.CreateInvalidResult();
        }
        catch (Exception ex) when (AnytypeUnavailableExceptionFilter.IsAnytypeConnectivityFailure(ex))
        {
            return AnytypeUnavailableExceptionFilter.CreateResult();
        }
    }

    [HttpDelete("{chatId}/messages/{messageId}")]
    public async Task<IActionResult> DeleteMessage(
        string spaceId,
        string chatId,
        string messageId)
    {
        if (string.IsNullOrWhiteSpace(messageId))
        {
            return BadRequest(new { error = "Message id is required." });
        }

        var client = session.TryGetClient();
        if (client is null)
        {
            return AnytypeAuthExceptionFilter.CreateMissingResult();
        }

        try
        {
            var participantId = await memberResolver.ResolveParticipantIdAsync(spaceId);
            if (string.IsNullOrWhiteSpace(participantId))
            {
                return StatusCode(
                    StatusCodes.Status403Forbidden,
                    new { error = "Current member identity is unknown; cannot verify message ownership." });
            }

            ChatMessage message;
            try
            {
                message = await client.Chats.GetMessageAsync(spaceId, chatId, messageId);
            }
            catch (AnytypeApiException ex) when (ex.StatusCode == HttpStatusCode.NotFound)
            {
                return NotFound(new { error = "Message not found." });
            }

            if (string.IsNullOrWhiteSpace(message.Creator)
                || !string.Equals(message.Creator, participantId, StringComparison.Ordinal))
            {
                return StatusCode(
                    StatusCodes.Status403Forbidden,
                    new { error = "Only the message author can delete this message." });
            }

            await client.Chats.DeleteMessageAsync(spaceId, chatId, messageId);
            return NoContent();
        }
        catch (Exception ex) when (AnytypeAuthExceptionFilter.IsAnytypeAuthFailure(ex))
        {
            return AnytypeAuthExceptionFilter.CreateInvalidResult();
        }
        catch (Exception ex) when (AnytypeUnavailableExceptionFilter.IsAnytypeConnectivityFailure(ex))
        {
            return AnytypeUnavailableExceptionFilter.CreateResult();
        }
    }

    private async Task<bool> TryLearnIdentityAsync(string spaceId, string chatId, string messageId)
    {
        var client = session.TryGetClient();
        if (client is null)
        {
            return false;
        }

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

    private static async Task<ChatMessageStreamEventDto> MapStreamEventAsync(
        IChatsApi chats,
        string spaceId,
        string chatId,
        ChatStreamEvent streamEvent,
        string? participantId,
        CancellationToken cancellationToken)
    {
        var type = streamEvent.Type ?? string.Empty;
        var payload = streamEvent.Payload;

        if (string.Equals(type, "message_added", StringComparison.Ordinal)
            || string.Equals(type, "message_updated", StringComparison.Ordinal))
        {
            ChatMessageDto? message = null;
            if (payload?.Message is not null)
            {
                var replyPreviewById = await BuildReplyPreviewLookupAsync(
                    chats,
                    spaceId,
                    chatId,
                    [payload.Message],
                    cancellationToken);
                message = MapMessage(
                    payload.Message,
                    participantId,
                    LookupReplyPreview(payload.Message, replyPreviewById));
            }

            return new ChatMessageStreamEventDto
            {
                Type = type,
                Message = message,
            };
        }

        if (string.Equals(type, "reactions_updated", StringComparison.Ordinal))
        {
            return new ChatMessageStreamEventDto
            {
                Type = type,
                Id = payload?.Id,
                Reactions = MapReactions(payload?.Reactions, participantId),
            };
        }

        return new ChatMessageStreamEventDto
        {
            Type = type,
            Id = payload?.Id,
        };
    }

    private readonly record struct ReplyPreview(string? Text, string? AuthorName, bool Deleted = false);

    /// <summary>
    /// Parent-message id → text + author name. Uses data already present in
    /// <paramref name="messages"/>, then <c>GetMessageAsync</c> for missing reply targets.
    /// Failed fetches are recorded as deleted so quote UI can show a placeholder.
    /// </summary>
    private static async Task<Dictionary<string, ReplyPreview>> BuildReplyPreviewLookupAsync(
        IChatsApi chats,
        string spaceId,
        string chatId,
        IEnumerable<ChatMessage> messages,
        CancellationToken cancellationToken = default)
    {
        var previewById = new Dictionary<string, ReplyPreview>(StringComparer.Ordinal);
        var replyIds = new HashSet<string>(StringComparer.Ordinal);

        foreach (var message in messages)
        {
            if (!string.IsNullOrWhiteSpace(message.Id))
            {
                previewById[message.Id] = ToReplyPreview(message);
            }

            if (!string.IsNullOrWhiteSpace(message.ReplyToMessageId))
            {
                replyIds.Add(message.ReplyToMessageId);
            }
        }

        foreach (var replyId in replyIds)
        {
            if (previewById.ContainsKey(replyId))
            {
                continue;
            }

            try
            {
                cancellationToken.ThrowIfCancellationRequested();
                var parent = await chats.GetMessageAsync(spaceId, chatId, replyId);
                previewById[replyId] = ToReplyPreview(parent);
            }
            catch (OperationCanceledException)
            {
                throw;
            }
            catch (AnytypeApiException ex) when (ex.StatusCode == HttpStatusCode.NotFound)
            {                
                previewById[replyId] = new ReplyPreview(null, null, Deleted: true);
            }
            catch (Exception)
            {
                // Soft-fail other errors: leave missing (quote stays unresolved).
            }
        }

        return previewById;
    }

    private static ReplyPreview? LookupReplyPreview(
        ChatMessage message,
        IReadOnlyDictionary<string, ReplyPreview> previewById)
    {
        if (string.IsNullOrWhiteSpace(message.ReplyToMessageId))
        {
            return null;
        }

        return previewById.TryGetValue(message.ReplyToMessageId, out var preview)
            ? preview
            : null;
    }

    private static ReplyPreview ToReplyPreview(ChatMessage message)
    {
        return new ReplyPreview(
            NormalizeMessageText(message.Content?.Text),
            NormalizeAuthorName(message.CreatorName));
    }

    private static string? NormalizeMessageText(string? text)
    {
        if (string.IsNullOrWhiteSpace(text))
        {
            return null;
        }

        return text.Trim();
    }

    private static string? NormalizeAuthorName(string? name)
    {
        if (string.IsNullOrWhiteSpace(name))
        {
            return null;
        }

        return name.Trim();
    }

    /// <summary>
    /// Build an Anytype edit payload that keeps attachments (and content style/marks)
    /// while updating text. Anytype treats omitted attachments as “remove all”.
    /// </summary>
    private static EditChatMessageRequest BuildEditChatMessageRequest(
        string text,
        ChatMessage existing)
    {
        var request = new EditChatMessageRequest { Text = text };

        if (existing.Attachments is { Count: > 0 })
        {
            request.Attachments = existing.Attachments
                .Where(static a => !string.IsNullOrWhiteSpace(a.Target))
                .Select(static a => new ChatAttachment
                {
                    Target = a.Target,
                    Type = a.Type,
                })
                .ToList();
        }

        var content = existing.Content;
        if (content is not null)
        {
            if (!string.IsNullOrWhiteSpace(content.Style))
            {
                request.Style = content.Style;
            }

            if (content.Marks is { Count: > 0 })
            {
                request.Marks = content.Marks;
            }
        }

        return request;
    }

    private static ChatMessageDto MapMessage(
        ChatMessage message,
        string? participantId,
        ReplyPreview? replyPreview = null)
    {
        bool? isMine = null;
        if (participantId is not null)
        {
            isMine = string.Equals(message.Creator, participantId, StringComparison.Ordinal);
        }

        var replyToMessageId = string.IsNullOrWhiteSpace(message.ReplyToMessageId)
            ? null
            : message.ReplyToMessageId;

        return new ChatMessageDto
        {
            Id = message.Id,
            OrderId = message.OrderId,
            Creator = message.Creator,
            CreatorName = message.CreatorName,
            Content = new ChatMessageContentDto
            {
                Text = message.Content?.Text,
                Attachments = MapAttachments(message.Attachments),
            },
            ReplyToMessageId = replyToMessageId,
            ReplyToText = replyToMessageId is null || replyPreview?.Deleted == true
                ? null
                : replyPreview?.Text,
            ReplyToAuthorName = replyToMessageId is null || replyPreview?.Deleted == true
                ? null
                : replyPreview?.AuthorName,
            ReplyToMessageDeleted = replyToMessageId is not null
                && replyPreview?.Deleted == true,
            CreatedAt = message.CreatedAt,
            ModifiedAt = message.ModifiedAt,
            Reactions = MapReactions(message.Reactions, participantId),
            IsMine = isMine,
        };
    }

    /// <summary>
    /// Map Anytype emoji → reactor-id dictionary into an ordered list for the UI.
    /// Skips blank emojis and empty reactor lists. Returns null when nothing remains.
    /// </summary>
    private static IReadOnlyList<ChatMessageReactionDto>? MapReactions(
        Dictionary<string, List<string>>? reactions,
        string? participantId)
    {
        if (reactions is null || reactions.Count == 0)
        {
            return null;
        }

        List<ChatMessageReactionDto>? mapped = null;
        foreach (var (emoji, reactors) in reactions)
        {
            if (string.IsNullOrWhiteSpace(emoji) || reactors is null || reactors.Count == 0)
            {
                continue;
            }

            var distinctReactors = reactors
                .Where(static id => !string.IsNullOrWhiteSpace(id))
                .Distinct(StringComparer.Ordinal)
                .ToList();
            if (distinctReactors.Count == 0)
            {
                continue;
            }

            mapped ??= new List<ChatMessageReactionDto>(reactions.Count);
            mapped.Add(new ChatMessageReactionDto
            {
                Emoji = emoji,
                Count = distinctReactors.Count,
                ReactedByMe = participantId is not null
                    && distinctReactors.Contains(participantId, StringComparer.Ordinal),
            });
        }

        if (mapped is null || mapped.Count == 0)
        {
            return null;
        }

        return mapped
            .OrderByDescending(static r => r.Count)
            .ToList();
    }

    /// <summary>
    /// Map Anytype message-level attachments into the content DTO. Skips entries
    /// with no usable target id.
    /// </summary>
    private static IReadOnlyList<ChatMessageAttachmentDto>? MapAttachments(
        IReadOnlyList<ChatAttachment>? attachments)
    {
        if (attachments is null || attachments.Count == 0)
        {
            return null;
        }

        List<ChatMessageAttachmentDto>? mapped = null;
        foreach (var attachment in attachments)
        {
            if (string.IsNullOrWhiteSpace(attachment.Target))
            {
                continue;
            }

            var fileId = NormalizeAttachmentFileId(attachment.Target);
            if (string.IsNullOrWhiteSpace(fileId))
            {
                continue;
            }

            mapped ??= new List<ChatMessageAttachmentDto>(attachments.Count);
            var type = string.IsNullOrWhiteSpace(attachment.Type)
                ? null
                : attachment.Type.Trim();
            mapped.Add(new ChatMessageAttachmentDto
            {
                FileId = fileId,
                Type = type,
                IsImage = IsImageAttachment(type),
            });
        }

        return mapped is { Count: > 0 } ? mapped : null;
    }

    /// <summary>
    /// True for Anytype <c>type: image</c>. SVG is never treated as a displayable
    /// image (untrusted markup if rendered as raw SVG).
    /// </summary>
    private static bool IsImageAttachment(string? type)
    {
        if (string.IsNullOrWhiteSpace(type))
        {
            return false;
        }

        if (type.Contains("svg", StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        return string.Equals(type, "image", StringComparison.OrdinalIgnoreCase)
            || type.StartsWith("image/", StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>
    /// Anytype may send <c>target</c> as a bare id or as an authenticated
    /// <c>/v1/spaces/.../files/{cid}</c> URL. Gateway image URLs need the cid.
    /// </summary>
    private static string NormalizeAttachmentFileId(string target)
    {
        var trimmed = target.Trim();
        if (!Uri.TryCreate(trimmed, UriKind.Absolute, out var uri))
        {
            return trimmed;
        }

        var segments = uri.AbsolutePath.Split(
            '/',
            StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

        for (var i = 0; i < segments.Length - 1; i++)
        {
            if (string.Equals(segments[i], "files", StringComparison.OrdinalIgnoreCase))
            {
                return segments[i + 1];
            }
        }

        return segments.Length > 0 ? segments[^1] : trimmed;
    }
}
