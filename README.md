<p align="center">
  <img src="resources/icon.png" alt="Lux Antidetect" width="128" height="128" />
</p>

<h1 align="center">Lux Antidetect Browser</h1>

<p align="center">
  Advanced antidetect browser manager with per-profile fingerprint isolation, proxy management, and real browser automation.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Electron-39-47848F?logo=electron&logoColor=white" alt="Electron" />
  <img src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black" alt="React" />
  <img src="https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/SQLite-WAL-003B57?logo=sqlite&logoColor=white" alt="SQLite" />
  <img src="https://img.shields.io/badge/Tailwind_CSS-4-06B6D4?logo=tailwindcss&logoColor=white" alt="Tailwind CSS" />
  <img src="https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-0078D6?logo=electron&logoColor=white" alt="Platforms" />
  <img src="https://img.shields.io/badge/License-MIT-green" alt="License" />
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Fingerprint_Engine-16_Vectors-blueviolet" alt="Fingerprint Vectors" />
  <img src="https://img.shields.io/badge/GPU_Configs-39-orange" alt="GPU Configs" />
  <img src="https://img.shields.io/badge/Timezone_Pool-70%2B-yellow" alt="Timezones" />
  <img src="https://img.shields.io/badge/Chrome_Versions-12-blue" alt="Chrome Versions" />
</p>

---

## Overview

Lux Antidetect is a desktop application that launches real browsers (Chrome, Edge, Firefox) with fully spoofed, unique fingerprints per profile. Each profile gets its own isolated browser data directory, proxy configuration, and fingerprint identity — making every session appear as a completely different user.

Unlike browser extensions or simple UA switchers, Lux injects fingerprint overrides at the **content script level** (Chromium MV3 `MAIN` world) before any page JavaScript executes, covering **16 independent fingerprint vectors** with `toString()` cloaking to defeat detection.

## Key Features

### Fingerprint Engine

| Vector | Technique |
|--------|-----------|
| **Canvas** | Seeded PRNG noise on `toDataURL`, `toBlob`, `getImageData` |
| **WebGL** | Vendor/renderer spoofing, extension list, shader precision |
| **AudioContext** | Channel data noise, frequency data perturbation, oscillator detune |
| **Fonts** | `FontFaceSet.check()` filtering against randomized font subsets |
| **ClientRects** | Sub-pixel noise on `getBoundingClientRect` / `getClientRects` |
| **Navigator** | UA, platform, hardware concurrency, device memory, languages |
| **Screen** | Resolution, color depth, pixel ratio, inner/outer dimensions |
| **Timezone** | `getTimezoneOffset`, `Intl.DateTimeFormat`, constructor hook |
| **WebRTC** | ICE candidate filtering, SDP stripping, STUN/TURN policy |
| **Media Devices** | Deterministic device IDs, configurable input/output counts |
| **Plugins** | Realistic PDF plugin array matching real Chrome |
| **Permissions** | Consistent permission states for all queried APIs |
| **Battery** | Static battery API response |
| **Connection** | Spoofed `navigator.connection` properties |
| **Chrome Object** | Full `window.chrome` with `runtime`, `csi`, `loadTimes`, `app` |
| **Misc** | `webdriver=false`, `doNotTrack`, speech synthesis, notifications |

All hooks are **cloaked**: `Function.prototype.toString` returns the original native code string for every patched function.

### Browser Management

- **Multi-browser support** — Chrome, Edge, Firefox with auto-detection
- **Isolated profiles** — Each profile has its own `--user-data-dir` (Chromium) or `-profile` (Firefox)
- **State machine** — `ready → starting → running → stopping → ready` with error recovery
- **Crash recovery** — Stale "running" profiles auto-reset to "ready" on app restart
- **Graceful shutdown** — All browser processes killed cleanly on app exit
- **Process health monitoring** — Periodic PID probing to detect orphaned processes
- **Session history** — Every launch/stop is logged with timestamps and exit codes

### Network & Security

- **Proxy support** — HTTP, HTTPS, SOCKS4, SOCKS5 with per-profile assignment
- **Proxy auth extension** — MV3 background service worker handles `username:password` auth automatically
- **DNS-over-HTTPS** — Enabled by default via `--dns-over-https-mode=automatic`
- **TLS fingerprint randomization** — Shuffled TLS 1.3 cipher suite ordering per launch
- **WebRTC leak protection** — Configurable ICE policy with SDP candidate filtering
- **Start URL** — Configurable per-profile URL to open on launch

### Profile Tooling

- **Bulk operations** — Select multiple profiles, launch/stop/delete in batch
- **Group color tags** — Assign colors to profiles, filter by group
- **Profile templates** — Save profile configs as reusable templates
- **Profile duplication** — One-click clone with fresh fingerprint seeds
- **Cookie import/export** — Read/write cookies from profile data directories
- **Fingerprint validation** — Cross-check UA/platform/GPU/screen consistency

### Fingerprint Generation

Every launch generates a **unique, coherent fingerprint** from realistic data pools:

- **12 Chrome major versions** (122–133) with randomized build/patch numbers
- **39 GPU configurations** — NVIDIA (17), AMD (12), Intel (10) for Windows; Apple Silicon (15) for Mac
- **25 screen resolutions** — 15 Windows, 10 Mac with appropriate pixel ratios
- **70+ timezones** — Weighted by real-world usage, with timezone→language mapping
- **9 hardware configs** — Weighted CPU core / memory combinations
- **60+ fonts** — OS-appropriate subsets (Windows fonts vs Mac fonts)
- **OS distribution** — ~65% Windows / ~35% Mac matching real browser stats

### UI & Theming

- **Compact dashboard** — Split-panel layout with collapsible sidebar
- **5 theme presets** — Midnight Blue, Midnight Purple, Emerald Dark, Crimson Dark, Ocean Teal
- **Custom themes** — Full color picker for 12 color tokens
- **Responsive** — Adapts to window resizing with flexible column layouts

### Portable Mode

Place a `data/` directory next to the executable — Lux will use it instead of `%APPDATA%`, making the entire app portable on a USB drive.

## Architecture

```
src/
├── main/                    # Electron main process
│   ├── index.ts             # App entry, window creation, crash recovery
│   ├── db.ts                # SQLite schema + migrations (WAL mode)
│   ├── ipc.ts               # 30+ IPC handlers
│   ├── browser.ts           # Browser launch/stop, extension writing
│   ├── fingerprint.ts       # Generation engine + injection script builder
│   ├── profile.ts           # Profile CRUD
│   ├── proxy.ts             # Proxy CRUD + connectivity test
│   ├── sessions.ts          # In-memory session tracking + history logging
│   └── models.ts            # TypeScript interfaces
├── preload/
│   ├── index.ts             # contextBridge API exposure
│   └── index.d.ts           # Type declarations for renderer
└── renderer/src/
    ├── App.tsx               # Router setup
    ├── components/
    │   └── Layout.tsx        # Sidebar navigation
    ├── pages/
    │   ├── ProfilesPage.tsx  # Split-panel profiles dashboard
    │   ├── ProfileEditorPage.tsx  # Profile editor panel
    │   ├── ProxiesPage.tsx   # Proxy management
    │   └── SettingsPage.tsx  # Themes, fingerprint settings, history
    ├── stores/
    │   ├── profiles.ts       # Zustand store with reactive session events
    │   ├── proxies.ts        # Proxy store
    │   └── settings.ts       # Theme + settings store
    └── lib/
        ├── themes.ts         # Theme system (presets + custom)
        ├── types.ts          # Shared TypeScript types
        ├── ui.ts             # Shared UI class constants
        └── api.ts            # Window API reference
```

### Database Schema

| Table | Purpose |
|-------|---------|
| `profiles` | Browser profiles with status, group, proxy, start URL |
| `fingerprints` | 20-field fingerprint per profile (1:1) |
| `proxies` | Proxy server configurations |
| `templates` | Reusable profile templates |
| `session_history` | Launch/stop audit log with duration and exit codes |
| `settings` | Key-value store for app settings |

## Getting Started

### Prerequisites

- **Node.js** 18+
- **npm** 9+
- At least one supported browser installed (Chrome, Edge, or Firefox)

### Install

```bash
git clone https://github.com/GofMan5/lux-antidetect.git
cd lux-antidetect
npm install
```

### Development

```bash
npm run dev
```

### Build

```bash
# Windows installer (NSIS, x64/arm64 in CI)
npm run build:win

# macOS (DMG + ZIP, x64/arm64 in CI)
npm run build:mac

# Linux (AppImage, Deb, RPM, tar.gz; x64/arm64 in CI)
npm run build:linux
```

### Release Builds

GitHub Actions builds release artifacts for:

- Windows x64 / arm64: NSIS installer
- macOS x64 / arm64: DMG + ZIP
- Linux x64 / arm64: AppImage, Deb, RPM, tar.gz

Push a tag like `v1.0.71` to run the full matrix and publish assets to the GitHub release:

```bash
git tag -a v1.0.71 -m "Lux Antidetect v1.0.71"
git push origin v1.0.71
```

### Type Check

```bash
npm run typecheck
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Electron 39 |
| Frontend | React 19, React Router 7, Zustand 5 |
| Styling | Tailwind CSS 4 with CSS custom properties |
| Forms | React Hook Form + Zod validation |
| Database | better-sqlite3 (WAL mode, foreign keys) |
| Build | electron-vite 5, Vite 7 |
| Language | TypeScript 5.9 (strict) |
| Packaging | electron-builder (NSIS, DMG, AppImage) |

## Security Considerations

- **Sandbox enabled** — Renderer runs with `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`
- **No remote code** — All fingerprint injection is local, no external calls
- **Passwords isolated** — Proxy passwords stored in local SQLite, never sent to renderer (only `has_password: boolean`)
- **Process isolation** — Each browser runs as a detached child process

## Roadmap

- [ ] Real fingerprint database from browser telemetry
- [ ] Electron auto-updater with GitHub Releases
- [ ] Cookie editor with domain-level management
- [ ] Playwright/Puppeteer automation API per profile
- [ ] Multi-platform browser path detection (Linux, macOS)
- [ ] Profile import/export (JSON bundles)
- [ ] Team collaboration with encrypted profile sharing

## License

MIT

---

<p align="center">
  <sub>Built with Electron, React, and an unhealthy obsession with fingerprint vectors.</sub>
</p>
