<p align="center">
  <img src="resources/icon.png" alt="Lux Antidetect" width="112" height="112" />
</p>

<h1 align="center">Lux Antidetect</h1>

<p align="center">
  A desktop browser profile manager for isolated sessions, fingerprint consistency, proxy workflows, and repeatable QA environments.
</p>

<p align="center">
  <a href="https://github.com/GofMan5/lux-antidetect/releases/latest">
    <img src="https://img.shields.io/github/v/release/GofMan5/lux-antidetect?label=release" alt="Latest release" />
  </a>
  <img src="https://img.shields.io/badge/Electron-39-47848F?logo=electron&logoColor=white" alt="Electron 39" />
  <img src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black" alt="React 19" />
  <img src="https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white" alt="TypeScript 5.9" />
  <img src="https://img.shields.io/badge/SQLite-WAL-003B57?logo=sqlite&logoColor=white" alt="SQLite WAL" />
  <img src="https://img.shields.io/badge/Platforms-Windows%20%7C%20macOS%20%7C%20Linux-111827" alt="Windows, macOS, Linux" />
</p>

---

## Product Overview

Lux Antidetect is an Electron desktop application for managing browser profiles as separate, reproducible workspaces. Each profile owns its browser data directory, proxy binding, session state, fingerprint settings, cookies, launch history, and UI metadata.

The project is built for operators who need predictable profile isolation, clean session lifecycle handling, and fast switching between browser identities without turning the local machine into a pile of unmanaged browser folders.

## What It Does

- Creates isolated Chromium, Edge, and Firefox profiles.
- Stores profile, proxy, fingerprint, template, settings, and session data in local SQLite.
- Launches real browser processes with per-profile data directories.
- Applies fingerprint settings before page scripts run where the browser engine supports it.
- Manages HTTP, HTTPS, SOCKS4, and SOCKS5 proxies with optional authentication.
- Tracks profile lifecycle: ready, starting, running, stopping, error.
- Recovers stale running sessions after app restart.
- Imports and exports cookies, including Netscape cookie files.
- Supports profile groups, tags, colors, search, sorting, bulk actions, and compact views.
- Provides local-first settings, themes, and portable mode.

AI and Templates UI sections are currently feature-flagged off. The code paths remain in the project so they can be enabled later without redesigning navigation or routing.

## Downloads

Production builds are published on the [GitHub Releases page](https://github.com/GofMan5/lux-antidetect/releases/latest).

| Platform | Architecture | Formats |
| --- | --- | --- |
| Windows | x64, arm64 | NSIS installer |
| macOS | Intel, Apple Silicon | DMG, ZIP |
| Linux | x64, arm64 | AppImage, Deb, RPM, tar.gz |

macOS builds are unsigned and not notarized unless signing credentials are added to CI. Users may need to allow the app manually in macOS security settings.

## Core Features

### Profile Isolation

- Separate browser data directory per profile.
- Independent cookies, local storage, cache, extensions, and session data.
- Profile duplication with fresh fingerprint seed generation.
- Start URL per profile.
- Batch launch, stop, delete, and export flows.

### Fingerprint Management

Lux keeps browser-facing values coherent across related surfaces instead of changing one field in isolation.

| Area | Covered Values |
| --- | --- |
| Navigator | user agent, platform, languages, hardware concurrency, memory, webdriver |
| Screen | width, height, color depth, pixel ratio, viewport dimensions |
| Timezone | offset, IANA timezone, Intl formatting |
| WebGL | vendor, renderer, extensions, shader precision |
| Canvas | deterministic per-profile noise |
| Audio | deterministic AudioContext perturbation |
| Fonts | OS-appropriate font availability filtering |
| WebRTC | ICE policy and candidate filtering |
| Media devices | stable virtual device identifiers |
| Browser objects | Chrome-compatible runtime surface where applicable |

### Proxy Workflows

- HTTP, HTTPS, SOCKS4, and SOCKS5 support.
- Per-profile proxy assignment.
- Proxy authentication through local browser extension support.
- Connectivity testing and geo synchronization.
- WebRTC leak protection controls.

### Session Reliability

- Main-process session registry.
- Process health checks.
- Graceful shutdown on app quit.
- Crash and stale-state recovery on restart.
- Session history with launch and stop timestamps.
- Main-process enforcement for concurrent session limits.

### Local Data

- SQLite database with WAL mode.
- Local app data directory by default.
- Portable mode when a `data/` directory exists next to the executable.
- Database import/export tools.
- No cloud account requirement.

### Local Automation API

Lux includes an optional local REST API for scripts and automation tools.

- Disabled by default.
- Binds only to `127.0.0.1` or `localhost`.
- Uses a generated bearer token.
- Can be enabled, stopped, moved to another port, or token-rotated from Settings.
- Exposes profile, proxy, browser lifecycle, session, cookie, screenshot, and CDP endpoints.
- Provides a server-sent events stream for session/profile/proxy automation events.
- Includes a one-call automation endpoint for create/update profile, attach proxy, launch, open URL, and return CDP info.
- Supports HMAC-signed webhooks for automation systems that cannot keep an SSE stream open.
- Includes a kill switch that can stop running sessions, rotate the API token, and disable the API.

### MCP Server

The repository includes a dedicated Model Context Protocol server in `mcp-server/`. It bridges Claude Desktop, Cursor, and other MCP clients to the Lux Local API.

It exposes tools for profile CRUD, profile launch/stop, running browser inventory, browser status, screenshots, active tab listing, and JavaScript execution in live Chromium/Edge sessions through CDP.

```bash
cd mcp-server
npm install
npm run build
```

Claude Desktop example:

```json
{
  "mcpServers": {
    "lux-antidetect": {
      "command": "node",
      "args": ["E:/Projects/!Lux antidetect/mcp-server/dist/index.js"],
      "env": {
        "LUX_API_TOKEN": "lux_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        "LUX_API_BASE_URL": "http://127.0.0.1:17888/api/v1"
      }
    }
  }
}
```

The MCP server can also auto-detect the API port when `LUX_API_BASE_URL` is omitted. See `mcp-server/README.md` for the full environment reference and tool list.

## Screens

The current UI is optimized for dense profile operations:

- left navigation with Profiles, Proxies, and Settings;
- profile list with compact and comfortable density modes;
- quick filters for status, browser engine, proxy state, and groups;
- inline profile actions;
- editor panels for profile, proxy, fingerprint, cookies, and launch settings.

## Architecture

```text
src/
  main/
    index.ts             Electron app lifecycle, window policy, tray, import/export
    ipc.ts               Main-process IPC handlers
    db.ts                SQLite schema, migrations, settings storage
    browser.ts           Browser launch, stop, process tracking, cookie import/export
    browser-manager.ts   Managed browser install/uninstall flows
    fingerprint.ts       Fingerprint generation and injection script builder
    profile.ts           Profile CRUD and proxy/fingerprint synchronization
    proxy.ts             Proxy CRUD, testing, geo helpers
    sessions.ts          Runtime session registry and history
  preload/
    index.ts             Context bridge API
    index.d.ts           Renderer API types
  renderer/src/
    App.tsx              Router and feature gates
    components/          Layout and shared UI components
    pages/               Profiles, editor, proxies, settings, AI, templates
    stores/              Zustand stores
    lib/                 API wrapper, themes, feature flags, shared types
```

## Security Model

Lux is a local desktop app. The renderer does not get Node.js access, and all privileged operations are routed through the Electron main process.

- `contextIsolation` enabled.
- `nodeIntegration` disabled.
- renderer sandbox enabled.
- remote same-window navigation blocked.
- external window navigation controlled by the main process.
- managed browser uninstall inputs validated before filesystem operations.
- proxy passwords are kept in local storage and exposed to the renderer only as `has_password`.

## Requirements

- Node.js 22 for development and CI parity.
- npm 10 or newer.
- Git.
- A supported browser installed locally, or a managed browser installed through the app where available.

## Development

```bash
npm install
npm run dev
```

Useful checks:

```bash
npm run typecheck
npm run lint -- --quiet
npm run build
```

## Command Reference

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the Electron/Vite development app. |
| `npm run start` | Preview the built Electron app. |
| `npm run typecheck` | Run main-process and renderer TypeScript checks. |
| `npm run lint -- --quiet` | Run ESLint without warning noise. |
| `npm run format` | Format the repository with Prettier. |
| `npm run build` | Typecheck and build main, preload, and renderer bundles. |
| `npm run build:unpack` | Build an unpacked Electron app for inspection. |
| `npm run build:win` | Build Windows NSIS installers. |
| `npm run build:mac` | Build macOS DMG and ZIP artifacts. |
| `npm run build:linux` | Build Linux AppImage, Deb, RPM, and tar.gz artifacts. |
| `npm run build:ci:win` | CI Windows package command without publishing. |
| `npm run build:ci:mac` | CI macOS package command without publishing. |
| `npm run build:ci:linux` | CI Linux package command without publishing. |

## Local API

Open `Settings -> General -> Local API`, enable the server, copy the token, and call the base URL shown in the UI.

Default base URL:

```text
http://127.0.0.1:17888/api/v1
```

Every endpoint except `/health` requires:

```text
Authorization: Bearer <token>
```

Quick check:

```bash
curl http://127.0.0.1:17888/api/v1/health
```

List profiles:

```bash
curl \
  -H "Authorization: Bearer <token>" \
  http://127.0.0.1:17888/api/v1/profiles
```

Create and launch a profile:

```bash
curl \
  -X POST \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"name":"QA Profile","browser_type":"chromium","start_url":"https://example.com"}' \
  http://127.0.0.1:17888/api/v1/profiles

curl \
  -X POST \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"targetUrl":"https://example.com"}' \
  http://127.0.0.1:17888/api/v1/profiles/<profile-id>/launch
```

Get CDP connection info for external automation:

```bash
curl \
  -H "Authorization: Bearer <token>" \
  http://127.0.0.1:17888/api/v1/profiles/<profile-id>/cdp
```

One-call automation flow:

```bash
curl \
  -X POST \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "profile": { "name": "Automation QA", "browser_type": "chromium" },
    "proxyId": "<proxy-id>",
    "targetUrl": "https://example.com"
  }' \
  http://127.0.0.1:17888/api/v1/automation/profile-session
```

Import proxies in bulk:

```bash
curl \
  -X POST \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"text":"socks5://user:pass@127.0.0.1:1080\nhttp://127.0.0.1:8080","group_tag":"qa","test":true}' \
  http://127.0.0.1:17888/api/v1/proxies/bulk-import
```

Listen for events:

```bash
curl -N \
  -H "Authorization: Bearer <token>" \
  http://127.0.0.1:17888/api/v1/events
```

Create a webhook:

```bash
curl \
  -X POST \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.internal/lux-webhook","events":["session.started","session.stopped"]}' \
  http://127.0.0.1:17888/api/v1/webhooks
```

Webhook deliveries are `POST` requests with:

- `X-Lux-Event`: event type;
- `X-Lux-Delivery`: monotonic event id;
- `X-Lux-Signature`: `sha256=<hmac>` over the raw JSON body.

Emergency stop:

```bash
curl \
  -X POST \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"stopSessions":true,"rotateToken":true,"disableApi":true}' \
  http://127.0.0.1:17888/api/v1/kill-switch
```

Core endpoints:

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | API health and app version. |
| `GET` | `/openapi` | Raw OpenAPI-style endpoint map. |
| `GET` | `/events` | Server-sent events stream. |
| `POST` | `/kill-switch` | Stop sessions, rotate token, and disable API. |
| `GET` | `/profiles` | List profiles. |
| `POST` | `/profiles` | Create profile. |
| `GET` | `/profiles/:id` | Get profile, fingerprint, and proxy detail. |
| `GET` | `/profiles/:id/status` | Read lifecycle status, session, and CDP support. |
| `PATCH` | `/profiles/:id` | Update profile metadata. |
| `PATCH` | `/profiles/:id/fingerprint` | Update fingerprint fields. |
| `POST` | `/profiles/:id/proxy` | Bind or clear proxy with `proxyId`. |
| `POST` | `/profiles/:id/duplicate` | Duplicate profile with fresh fingerprint noise. |
| `POST` | `/profiles/:id/launch` | Launch browser, optionally with `targetUrl`. |
| `POST` | `/profiles/:id/stop` | Stop browser. |
| `POST` | `/profiles/:id/open-url` | Open URL in a running profile or cold-launch it. |
| `GET` | `/profiles/:id/cdp` | Return CDP websocket/http endpoints for Chromium-based profiles. |
| `GET` | `/profiles/:id/cookies?format=json|netscape` | Export cookies from a running profile. |
| `POST` | `/profiles/:id/cookies/import` | Import JSON or Netscape cookies into a running profile. |
| `GET` | `/profiles/:id/screenshot` | Capture a screenshot from a running Chromium-based profile. |
| `DELETE` | `/profiles/:id` | Delete a stopped profile. |
| `GET` | `/proxies` | List proxies without exposing passwords. |
| `POST` | `/proxies` | Create proxy and start async geo/reputation lookup. |
| `POST` | `/proxies/bulk-import` | Parse and import up to 10,000 proxy lines. |
| `PATCH` | `/proxies/:id` | Update proxy. |
| `DELETE` | `/proxies/:id` | Delete proxy. |
| `POST` | `/proxies/:id/test` | Test proxy connectivity. |
| `POST` | `/proxies/:id/lookup-geo` | Refresh proxy geo and sync dependent fingerprints. |
| `GET` | `/sessions` | List running sessions. |
| `GET` | `/session-history?profileId=:id` | Read session history. |
| `POST` | `/bulk/launch` | Launch multiple profiles with `profileIds`. |
| `POST` | `/bulk/stop` | Stop multiple profiles with `profileIds`. |
| `POST` | `/automation/profile-session` | Create/update profile, optionally create/attach proxy, launch, and return CDP info. |
| `GET` | `/webhooks` | List webhook registrations. |
| `POST` | `/webhooks` | Register webhook target. |
| `PATCH` | `/webhooks/:id` | Update webhook target, filters, enabled state, or rotate secret. |
| `DELETE` | `/webhooks/:id` | Delete webhook target. |
| `GET` | `/webhooks/deliveries` | Inspect recent webhook delivery attempts. |
| `GET` | `/browsers/detect` | Detect locally installed browsers. |

Security notes:

- The API never binds to `0.0.0.0`.
- Request bodies are capped at 1 MB.
- Proxy bulk import is capped at 10,000 lines and 1 MB.
- `file:`, `javascript:`, `data:`, `chrome:`, and `about:` URLs are rejected.
- Proxy list responses preserve the existing `has_password` model and do not return stored proxy passwords.
- Webhook URLs must be `http:` or `https:` and are signed with per-webhook secrets.

## Local Packaging

```bash
# Windows NSIS installers for x64 and arm64
npm run build:win

# macOS DMG and ZIP for x64 and arm64
npm run build:mac

# Linux AppImage, Deb, RPM, and tar.gz for x64 and arm64
npm run build:linux
```

Cross-building has platform limits. Windows builds are verified locally on Windows. Linux and macOS release artifacts are produced on native GitHub Actions runners.

## Release Process

The release workflow is defined in `.github/workflows/build-release.yml`.

1. Update `package.json` and `package-lock.json` version.
2. Run local checks:

   ```bash
   npm run typecheck
   npm run lint -- --quiet
   npm run build:win
   ```

3. Commit the release changes.
4. Create and push a matching tag:

   ```bash
   git tag -a v1.0.74 -m "Lux Antidetect v1.0.74"
   git push origin master
   git push origin v1.0.74
   ```

5. GitHub Actions verifies the tag matches `package.json`, builds all platform artifacts, and publishes the release.

## Build Matrix

| Job | Runner | Output |
| --- | --- | --- |
| Verify | Ubuntu latest | typecheck, lint, release tag validation |
| Windows x64 | Windows latest | `*-x64-setup.exe` |
| Windows arm64 | Windows latest | `*-arm64-setup.exe` |
| Linux x64 | Ubuntu latest | AppImage, Deb, RPM, tar.gz |
| Linux arm64 | Ubuntu 24.04 arm | AppImage, Deb, RPM, tar.gz |
| macOS x64 | macOS 15 Intel | DMG, ZIP |
| macOS arm64 | macOS 14 | DMG, ZIP |

## Configuration Notes

- App ID: `com.lux.antidetect`.
- Release publishing targets `GofMan5/lux-antidetect`.
- `CSC_IDENTITY_AUTO_DISCOVERY=false` in CI, so macOS and Windows signing is disabled unless signing is configured explicitly.
- `electron-builder` packages `resources/` and unpacks native `better-sqlite3` files from ASAR.
- The app can run in portable mode by placing a `data/` directory next to the executable.

## Roadmap

- Re-enable Templates after the UX and import/export contract are finalized.
- Re-enable AI tools after provider configuration and local privacy controls are production-ready.
- Add signed and notarized macOS releases.
- Add signed Windows releases.
- Add release checksums.
- Add profile bundle import/export with schema versioning.
- Add first-run diagnostics for browser path detection.

## License

MIT
