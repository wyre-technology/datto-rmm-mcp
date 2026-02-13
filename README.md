# Datto RMM MCP Server

MCP server for Datto RMM, enabling Claude to interact with your Datto RMM account.

## One-Click Deployment

[![Deploy to DO](https://www.deploytodo.com/do-btn-blue.svg)](https://cloud.digitalocean.com/apps/new?repo=https://github.com/wyre-technology/datto-rmm-mcp/tree/main)

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/wyre-technology/datto-rmm-mcp)

## Features

- **Device Management**: List, search, and get details for devices
- **Alert Management**: View and resolve alerts
- **Site Management**: List and view site details
- **Quick Jobs**: Run quick jobs on devices
- **Audit Data**: Retrieve full device audit or software inventory

## Installation

### Via MCP Gateway (Recommended)

This server is designed to work with the [MCP Gateway](https://github.com/wyre-technology/mcp-gateway) which handles authentication and credential management.

### Local Development

```bash
npm install
npm run build
npm start
```

## Configuration

The server accepts credentials via environment variables:

| Variable | Description |
|----------|-------------|
| `DATTO_API_KEY` | Your Datto RMM API key |
| `DATTO_API_SECRET` | Your Datto RMM API secret |
| `DATTO_PLATFORM` | API platform: `pinotage`, `merlot`, `concord`, `vidal`, `zinfandel`, or `syrah` (default: `concord`) |

When used with the MCP Gateway, credentials are injected via `X_API_KEY` and `X_API_SECRET` environment variables.

### Platform Selection

Datto RMM uses regional API endpoints. Select the platform that matches your account:

| Platform | Region/Description |
|----------|-------------------|
| `pinotage` | South Africa |
| `merlot` | Europe |
| `concord` | US East (default) |
| `vidal` | Canada |
| `zinfandel` | US West |
| `syrah` | Australia |

## Available Tools

| Tool | Description |
|------|-------------|
| `datto_list_devices` | List devices with optional site filter |
| `datto_get_device` | Get device details by UID |
| `datto_list_alerts` | List open alerts with optional site filter |
| `datto_resolve_alert` | Resolve an alert |
| `datto_list_sites` | List all sites |
| `datto_get_site` | Get site details |
| `datto_run_quickjob` | Run a quick job on a device |
| `datto_get_device_audit` | Get device audit data (full or software only) |

## Docker

```bash
docker build -t datto-rmm-mcp .
docker run -e DATTO_API_KEY=xxx -e DATTO_API_SECRET=xxx -e DATTO_PLATFORM=concord datto-rmm-mcp
```

## License

Apache-2.0
