#!/usr/bin/env node
/**
 * Datto RMM MCP Server
 *
 * This MCP server provides tools for interacting with Datto RMM API.
 * It accepts credentials via environment variables from the MCP Gateway.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { DattoRmmClient, type Platform } from "@asachs01/node-datto-rmm";

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

// Credential extraction from gateway headers/env
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

// Define available tools
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

// Helper to collect items from async iterator
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

// Handle tool calls
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
          // List devices for a specific site
          devices = await collectItems(client.sites.devicesAll(params.siteUid), max);
        } else {
          // List all devices in the account
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
          // List open alerts for a specific site
          alerts = await collectItems(client.sites.alertsOpenAll(params.siteUid), max);
        } else {
          // List all open alerts in the account
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

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Datto RMM MCP server running on stdio");
}

main().catch(console.error);
