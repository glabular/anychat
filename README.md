# anychat

Desktop chat client for [Anytype](https://anytype.io/).

## Requirements (Windows)

Downloads from Releases are **framework-dependent** (they do not bundle the .NET runtime). Install both:

1. [.NET 10 Desktop Runtime (Windows x64)](https://dotnet.microsoft.com/download/dotnet/10.0) — needed for the WPF shell  
2. [.NET 10 ASP.NET Core Runtime (Windows x64)](https://dotnet.microsoft.com/download/dotnet/10.0) — needed for the in-process API host  

Also need [WebView2](https://developer.microsoft.com/microsoft-edge/webview2/) (usually already installed on Windows 10/11).

## Download

1. Open [Releases](https://github.com/glabular/AnyChat.NET/releases).
2. Download `anychat-VERSION-win-x64.zip` and `SHA256SUMS.txt` from the same release.
3. Unzip and run `AnyChat.NET.Desktop.exe`.

Only use assets attached by GitHub Actions on the Release page — not copies from elsewhere.

### Build provenance (optional)

If you have the [GitHub CLI](https://cli.github.com/) installed:

```bash
gh attestation verify anychat-VERSION-win-x64.zip --owner glabular
```

That checks the file was built by this repository’s Actions workflow from the tagged commit.

## Develop

- Startup project: **AnyChat.NET.Desktop** (hosts the API in-process).
- Version: single SemVer in `Directory.Build.props`.
- Releases: bump that version, push `master`, then push an annotated tag `vX.Y.Z` matching the version. Actions publishes the Release.
