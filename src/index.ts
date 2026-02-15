#!/usr/bin/env node
/**
 * Datto RMM MCP Server
 *
 * This MCP server provides tools for interacting with Datto RMM API.
 * It accepts credentials via environment variables from the MCP Gateway.
 * Supports both stdio (default) and HTTP (StreamableHTTP) transports.
 */

import { createServer, IncomingMessage, ServerResponse, Server as HttpServer } from "node:http";
import { randomUUID } from "node:crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { DattoRmmClient, type Platform } from "@asachs01/node-datto-rmm";

// ---------------------------------------------------------------------------
// Server instance
// ---------------------------------------------------------------------------

const server = new Server(
  {
    name: "datto-rmm-mcp",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// ---------------------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------------------

interface DattoCredentials {
  apiKey: string;
  apiSecretKey: string;
  platform: Platform;
}

function getCredentials(): DattoCredentials | null {
  const apiKey = process.env.DATTO_API_KEY || process.env.X_API_KEY;
  const apiSecretKey = process.env.DATTO_API_SECRET || process.env.X_API_SECRET;
  const platformEnv = process.env.DATTO_PLATFORM || "concord";

  if (!apiKey || !apiSecretKey) {
    return null;
  }

  // Validate platform
  const validPlatforms: Platform[] = ["pinotage", "merlot", "concord", "vidal", "zinfandel", "syrah"];
  const platform = validPlatforms.includes(platformEnv as Platform)
    ? (platformEnv as Platform)
    : "concord";

  return { apiKey, apiSecretKey, platform };
}

function createClient(creds: DattoCredentials): DattoRmmClient {
  return new DattoRmmClient({
    apiKey: creds.apiKey,
    apiSecretKey: creds.apiSecretKey,
    platform: creds.platform,
  });
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "datto_list_devices",
        description: "List all devices in Datto RMM. Can filter by site.",
        inputSchema: {
          type: "object",
          properties: {
            siteUid: {
              type: "string",
              description: "Filter devices by site UID (optional - if omitted, returns all devices)",
            },
            max: {
              type: "number",
              description: "Maximum number of results (default: 50)",
              default: 50,
            },
          },
        },
      },
      {
        name: "datto_get_device",
        description: "Get details for a specific device by its UID",
        inputSchema: {
          type: "object",
          properties: {
            deviceUid: {
              type: "string",
              description: "The device UID",
            },
          },
          required: ["deviceUid"],
        },
      },
      {
        name: "datto_list_alerts",
        description: "List open alerts. Can filter by site.",
        inputSchema: {
          type: "object",
          properties: {
            siteUid: {
              type: "string",
              description: "Filter alerts by site UID (optional - if omitted, returns all account alerts)",
            },
            max: {
              type: "number",
              description: "Maximum number of results (default: 50)",
              default: 50,
            },
          },
        },
      },
      {
        name: "datto_resolve_alert",
        description: "Resolve an alert by its UID",
        inputSchema: {
          type: "object",
          properties: {
            alertUid: {
              type: "string",
              description: "The alert UID to resolve",
            },
          },
          required: ["alertUid"],
        },
      },
      {
        name: "datto_list_sites",
        description: "List all sites in the account",
        inputSchema: {
          type: "object",
          properties: {
            max: {
              type: "number",
              description: "Maximum number of results (default: 50)",
              default: 50,
            },
          },
        },
      },
      {
        name: "datto_get_site",
        description: "Get details for a specific site by its UID",
        inputSchema: {
          type: "object",
          properties: {
            siteUid: {
              type: "string",
              description: "The site UID",
            },
          },
          required: ["siteUid"],
        },
      },
      {
        name: "datto_run_quickjob",
        description: "Run a quick job on a device",
        inputSchema: {
          type: "object",
          properties: {
            deviceUid: {
              type: "string",
              description: "The device UID to run the job on",
            },
            jobName: {
              type: "string",
              description: "Name for the quick job",
            },
            componentUid: {
              type: "string",
              description: "UID of the component to run",
            },
            variables: {
              type: "object",
              description: "Variables to pass to the job (key-value pairs)",
              additionalProperties: { type: "string" },
            },
          },
          required: ["deviceUid", "jobName", "componentUid"],
        },
      },
      {
        name: "datto_get_device_audit",
        description: "Get audit data for a device (hardware, software, OS information)",
        inputSchema: {
          type: "object",
          properties: {
            deviceUid: {
              type: "string",
              description: "The device UID",
            },
            auditType: {
              type: "string",
              enum: ["full", "software"],
              description: "Type of audit: 'full' for complete audit or 'software' for software inventory only",
              default: "full",
            },
          },
          required: ["deviceUid"],
        },
      },
    ],
  };
});

// ---------------------------------------------------------------------------
// Helper to collect items from async iterator
// ---------------------------------------------------------------------------

async function collectItems<T>(
  iterable: AsyncIterable<T>,
  max: number
): Promise<T[]> {
  const items: T[] = [];
  for await (const item of iterable) {
    items.push(item);
    if (items.length >= max) break;
  }
  return items;
}

// ---------------------------------------------------------------------------
// Tool call handler
// ---------------------------------------------------------------------------

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const creds = getCredentials();

  if (!creds) {
    return {
      content: [
        {
          type: "text",
          text: "Error: No API credentials provided. Please configure your Datto RMM API key and secret via DATTO_API_KEY and DATTO_API_SECRET environment variables.",
        },
      ],
      isError: true,
    };
  }

  const client = createClient(creds);

  try {
    switch (name) {
      case "datto_list_devices": {
        const params = args as { siteUid?: string; max?: number };
        const max = params.max || 50;

        let devices;
        if (params.siteUid) {
          devices = await collectItems(client.sites.devicesAll(params.siteUid), max);
        } else {
          devices = await collectItems(client.account.devicesAll(), max);
        }

        return {
          content: [{ type: "text", text: JSON.stringify(devices, null, 2) }],
        };
      }

      case "datto_get_device": {
        const { deviceUid } = args as { deviceUid: string };
        const device = await client.devices.get(deviceUid);
        return {
          content: [{ type: "text", text: JSON.stringify(device, null, 2) }],
        };
      }

      case "datto_list_alerts": {
        const params = args as { siteUid?: string; max?: number };
        const max = params.max || 50;

        let alerts;
        if (params.siteUid) {
          alerts = await collectItems(client.sites.alertsOpenAll(params.siteUid), max);
        } else {
          alerts = await collectItems(client.account.alertsOpenAll(), max);
        }

        return {
          content: [{ type: "text", text: JSON.stringify(alerts, null, 2) }],
        };
      }

      case "datto_resolve_alert": {
        const { alertUid } = args as { alertUid: string };
        const result = await client.alerts.resolve(alertUid);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      }

      case "datto_list_sites": {
        const params = args as { max?: number };
        const max = params.max || 50;
        const sites = await collectItems(client.account.sitesAll(), max);
        return {
          content: [{ type: "text", text: JSON.stringify(sites, null, 2) }],
        };
      }

      case "datto_get_site": {
        const { siteUid } = args as { siteUid: string };
        const site = await client.sites.get(siteUid);
        return {
          content: [{ type: "text", text: JSON.stringify(site, null, 2) }],
        };
      }

      case "datto_run_quickjob": {
        const { deviceUid, jobName, componentUid, variables } = args as {
          deviceUid: string;
          jobName: string;
          componentUid: string;
          variables?: Record<string, string>;
        };

        const jobRequest = {
          jobName,
          componentUid,
          variables,
        };

        const result = await client.devices.createQuickJob(deviceUid, jobRequest);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      }

      case "datto_get_device_audit": {
        const { deviceUid, auditType = "full" } = args as {
          deviceUid: string;
          auditType?: "full" | "software";
        };

        let audit;
        if (auditType === "software") {
          audit = await client.audit.deviceSoftware(deviceUid);
        } else {
          audit = await client.audit.device(deviceUid);
        }

        return {
          content: [{ type: "text", text: JSON.stringify(audit, null, 2) }],
        };
      }

      default:
        return {
          content: [{ type: "text", text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: "text", text: `Error: ${message}` }],
      isError: true,
    };
  }
});

// ---------------------------------------------------------------------------
// Transport: stdio (default)
// ---------------------------------------------------------------------------

async function startStdioTransport(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Datto RMM MCP server running on stdio");
}

// ---------------------------------------------------------------------------
// Transport: HTTP (StreamableHTTPServerTransport)
// ---------------------------------------------------------------------------

let httpServer: HttpServer | undefined;

async function startHttpTransport(): Promise<void> {
  const port = parseInt(process.env.MCP_HTTP_PORT || "8080", 10);
  const host = process.env.MCP_HTTP_HOST || "0.0.0.0";
  const authMode = process.env.AUTH_MODE || "env";
  const isGatewayMode = authMode === "gateway";

  const httpTransport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    enableJsonResponse: true,
  });

  httpServer = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

    // Health endpoint - no auth required
    if (url.pathname === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        status: "ok",
        transport: "http",
        authMode: isGatewayMode ? "gateway" : "env",
        timestamp: new Date().toISOString(),
      }));
      return;
    }

    // MCP endpoint
    if (url.pathname === "/mcp") {
      // In gateway mode, extract credentials from headers
      if (isGatewayMode) {
        const headers = req.headers as Record<string, string | string[] | undefined>;
        const apiKey = headers["x-datto-api-key"] as string | undefined;
        const apiSecret = headers["x-datto-api-secret"] as string | undefined;
        const platform = headers["x-datto-platform"] as string | undefined;

        if (!apiKey || !apiSecret) {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            error: "Missing credentials",
            message: "Gateway mode requires X-Datto-API-Key and X-Datto-API-Secret headers",
            required: ["X-Datto-API-Key", "X-Datto-API-Secret"],
          }));
          return;
        }

        // Set process.env so getCredentials() picks them up for this request
        process.env.DATTO_API_KEY = apiKey;
        process.env.DATTO_API_SECRET = apiSecret;
        if (platform) {
          process.env.DATTO_PLATFORM = platform;
        }
      }

      httpTransport.handleRequest(req, res);
      return;
    }

    // 404 for everything else
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found", endpoints: ["/mcp", "/health"] }));
  });

  await server.connect(httpTransport as unknown as Transport);

  await new Promise<void>((resolve) => {
    httpServer!.listen(port, host, () => {
      console.error(`Datto RMM MCP server listening on http://${host}:${port}/mcp`);
      console.error(`Health check available at http://${host}:${port}/health`);
      console.error(`Authentication mode: ${isGatewayMode ? "gateway (header-based)" : "env (environment variables)"}`);
      resolve();
    });
  });
}

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

function setupShutdownHandlers(): void {
  const shutdown = async () => {
    console.error("Shutting down Datto RMM MCP server...");
    if (httpServer) {
      await new Promise<void>((resolve, reject) => {
        httpServer!.close((err) => (err ? reject(err) : resolve()));
      });
    }
    await server.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  setupShutdownHandlers();

  const transportType = process.env.MCP_TRANSPORT || "stdio";

  if (transportType === "http") {
    await startHttpTransport();
  } else {
    await startStdioTransport();
  }
}

main().catch(console.error);
