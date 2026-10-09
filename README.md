# anychat

A Windows desktop chat client for [Anytype](https://anytype.io/).

[![CI](https://github.com/glabular/anychat/actions/workflows/ci.yml/badge.svg?branch=master)](https://github.com/glabular/anychat/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/glabular/anychat)](https://github.com/glabular/anychat/releases/latest)

Anytype has built-in chats, but they live inside a note-taking app. anychat pulls them out into a standalone messenger: a familiar three-pane window, like Telegram or Slack, backed by your existing Anytype account, spaces and encrypted sync. It connects to the Anytype desktop app running on your machine and adds no servers of its own.

## Features

- Messenger-style layout: spaces, chats, conversation
- Real-time updates: new messages, edits, deletions and reactions appear instantly
- Messaging basics: send, edit, delete, react, drafts, threaded quotes
- Image attachments with a built-in viewer
- Manage spaces and chats without leaving the app
- Local-only: no extra accounts or servers; your data stays in Anytype

## Install

Requirements (Windows 10/11, x64):

- [.NET 10 Desktop Runtime](https://dotnet.microsoft.com/download/dotnet/10.0)
- [.NET 10 ASP.NET Core Runtime](https://dotnet.microsoft.com/download/dotnet/10.0)
- [WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/) (preinstalled on most systems)
- Anytype desktop app running locally

Then:

1. Download `anychat-<version>-win-x64.zip` from [Releases](https://github.com/glabular/anychat/releases).
2. Unzip and run `AnyChat.NET.Desktop.exe`.
3. On first launch, approve the pairing request in Anytype. The API key is stored encrypted (DPAPI) under `%LocalAppData%`.

Release zips are published by GitHub Actions with a `SHA256SUMS` file and build attestation.

## How it works

```
AnyChat.NET.Desktop   WPF window + WebView2; hosts the API in-process
AnyChat.NET.Api       ASP.NET Core; proxies Anytype's local API, serves the UI
AnyChat.NET.Web       Plain HTML, CSS and JavaScript
```

The desktop app starts Kestrel on `http://localhost:5249/` and loads the UI from it. No frameworks on the front end, no external services.

## Build from source

Requires the .NET 10 SDK. The solution is `AnyChat.NET.slnx`; use a Visual Studio version that supports the `.slnx` format, or the CLI.

```powershell
git clone https://github.com/glabular/anychat.git
cd anychat
dotnet run --project AnyChat.NET.Desktop
```

To run the API in a separate console for log output, start `AnyChat.NET.Api` first, then launch Desktop with `ANYCHAT_EXTERNAL_API=1`. See [`.cursor/docs/desktop-hosting.md`](.cursor/docs/desktop-hosting.md).

## Releases

Versions follow SemVer. The `master` branch is CI-only; pushing a `vX.Y.Z` tag builds and publishes a release. Changes are tracked in [CHANGELOG.md](CHANGELOG.md).

## Status

Early, actively developed. Reply-from-menu, pinning and a full emoji picker are not there yet. Issues and pull requests are welcome.
