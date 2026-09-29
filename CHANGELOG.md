# Changelog

All notable changes to anychat are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/). Versions match `Directory.Build.props` / git tags (`vX.Y.Z`).

Before tagging a release, add a `## [X.Y.Z] - YYYY-MM-DD` section with what changed. The Release workflow copies that section onto the GitHub Release page.

## [Unreleased]

### Added

- About pane: author, GitHub repo link, and invite to the anychat public space
- Reply messages show a quote (author + one-line parent text); click jumps to the parent within a small older-page seek budget; empty parent text shows as Attachment 

### Changed

- Anytype challenge code uses four large OTP boxes and auto-submits
- Anytype connect copy matches the new Allow dialog; no code resend
- Modal primary/secondary text buttons use shared pill styles
- Disable browser focus rings app-wide
- Mouse Back exits settings
- Quote jump softly highlights others’ bubbles and darkens own bubbles once

### Fixed

- Quote click on replies to attachment-only (hidden) parents no longer jumps to latest; tip says the message cannot be opened
- Open chat reflects Anytype Desktop message edits and deletes over the
  existing SSE stream (no reopen)
- Spaces and chats lists soft-refresh while the window is visible so remote
  archives/deletes appear without restarting or reselecting
- Focusing the window no longer flashes the empty main hint over an open chat
- Anytype reconnect countdown no longer jumps or resets when the active-chat
  stream and background recovery probe retry at different times

## [0.3.0] - 2026-09-17

### Added

- Challenge-based Anytype API key setup (4-digit code preferred; paste key still available)
- Settings shell: gear under the spaces rail, About pane, Log out with confirm

### Changed

- Spaces rail uses a tab-style selected state

## [0.2.0] - 2026-09-16

### Added

- Corner tip when chat identity is not learned yet: soft “!” button, explainer
  popover, remount open chat after the first send so own bubbles move right
- Inviting ice glow and inward ring pulse on the tip button

### Fixed

- Tip popover contrast over the message list (darker panel + stronger shadow)

## [0.1.0] - 2026-09-15

### Added

- First public release: Windows desktop shell (WPF + WebView2) with in-process API
- Spaces, chats, messaging against a local Anytype instance (API key on first run)
- Live updates for the open chat, drafts, rename/delete chat, basic profiles
