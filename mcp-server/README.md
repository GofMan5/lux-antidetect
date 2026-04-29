# Lux Antidetect MCP Server

MCP-server for controlling Lux Antidetect from Claude Desktop, Cursor, and other Model Context Protocol clients.

The server talks to the Lux local REST API and uses Chromium DevTools Protocol for live browser operations such as tab listing, JavaScript execution, and targeted screenshots.
Every Local API endpoint is available through the generic `call_lux_api` MCP tool. Use `list_lux_api_capabilities` to read the live `/openapi` map, then call any path relative to `/api/v1`.

## Install

```bash
cd mcp-server
npm install
npm run build
```

Enable the Lux Local API in `Settings -> General -> Local API`, then copy the token.

## Environment

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `LUX_API_TOKEN` | yes | - | Bearer token from Lux settings. |
| `LUX_API_BASE_URL` | no | auto-detect | Full API base URL, for example `http://127.0.0.1:17888/api/v1`. |
| `LUX_API_HOST` | no | `127.0.0.1` | Host used for port discovery. |
| `LUX_API_PORT` | no | auto-detect | Fixed API port if you do not want scanning. |
| `LUX_API_PORT_SCAN` | no | `17888,17889-17920` | Comma/range list used by auto-detection. |
| `LUX_MCP_TIMEOUT_MS` | no | `15000` | HTTP/CDP timeout. |
| `LUX_MCP_LOG_FILE` | no | - | Optional log file path. Logs always go to stderr too. |

## Claude Desktop

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

## Tools

- `list_lux_api_capabilities`
- `call_lux_api`
- `list_profiles`
- `get_profile`
- `create_profile`
- `update_profile`
- `delete_profile`
- `launch_browser`
- `list_running_browsers`
- `get_browser_status`
- `stop_browser`
- `close_all_browsers`
- `execute_js`
- `take_screenshot`
- `get_active_tabs`
- `list_profile_health`
- `get_profile_health`
- `autofix_profile_health`
- `list_automation_scripts`
- `get_automation_script`
- `create_automation_script`
- `update_automation_script`
- `delete_automation_script`
- `run_automation_script`
- `list_automation_runs`
- `run_adhoc_automation`

`call_lux_api` covers the full API surface, including proxies, fingerprint presets, settings, templates, bookmarks, extensions, AI assistant state, managed browser downloads, updates, database backup/import staging, webhooks, and emergency controls.

## Security

- Keep Lux API bound to `127.0.0.1` or `localhost`.
- Do not expose the token through shell history, shared config files, or screenshots.
- Use a dedicated token per workstation and rotate it if an MCP client is compromised.
- `execute_js` runs inside an already opened browser tab. Treat prompts that call it as privileged automation.
