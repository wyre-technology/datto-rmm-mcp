/**
 * Shared MCP server factory for Datto RMM.
 *
 * This module is **side-effect free** (importing it never starts a transport),
 * so it can be reused by every entrypoint:
 * - `index.ts` — stdio + Node HTTP transport
 * - `worker.ts` — Cloudflare Workers (Web Standard) transport
 *
 * All tools are exposed upfront for universal MCP client compatibility. A fresh
 * server is created per request (for credential isolation in HTTP/Workers mode).
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { DattoRmmClient, type Platform } from "@wyre-technology/node-datto-rmm";
import { setServerRef } from "./utils/server-ref.js";
import { elicitSelection } from "./utils/elicitation.js";
import {
  ALERT_CARD_META,
  ALERT_CARD_RESOURCE_URI,
  MCP_APP_RESOURCE_MIME,
  applyBrandInjection,
  brandFromEnv,
  buildAlertCard,
} from "./alert-card.js";
import { ALERT_CARD_HTML } from "./generated/alert-card-html.js";

// ---------------------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------------------

export interface DattoCredentials {
  apiKey: string;
  apiSecretKey: string;
  platform: Platform;
}

const VALID_PLATFORMS: Platform[] = [
  "pinotage",
  "merlot",
  "concord",
  "vidal",
  "zinfandel",
  "syrah",
];

/**
 * Resolve a platform string to a valid Platform, defaulting to "concord".
 */
export function resolvePlatform(platform: string | undefined): Platform {
  return platform && VALID_PLATFORMS.includes(platform as Platform)
    ? (platform as Platform)
    : "concord";
}

/**
 * Read credentials from environment variables (stdio / env HTTP mode).
 */
export function getCredentials(): DattoCredentials | null {
  const apiKey = process.env.DATTO_API_KEY || process.env.X_API_KEY;
  const apiSecretKey = process.env.DATTO_API_SECRET || process.env.X_API_SECRET;
  const platformEnv = process.env.DATTO_PLATFORM || "concord";

  if (!apiKey || !apiSecretKey) {
    return null;
  }

  return { apiKey, apiSecretKey, platform: resolvePlatform(platformEnv) };
}

/**
 * Resolve per-request gateway credentials from a header accessor.
 *
 * Works with any transport: pass a getter that returns a (lowercased) header
 * value. Returns `{ creds }` when the required headers are present, or
 * `{ error }` otherwise.
 *
 * Gateway header mapping:
 *   X-Datto-API-Key    -> apiKey
 *   X-Datto-API-Secret -> apiSecretKey
 *   X-Datto-Platform   -> platform (optional, defaults to concord)
 */
export function resolveGatewayCredentials(
  getHeader: (lowerName: string) => string | undefined
): { creds?: DattoCredentials; error?: string } {
  const apiKey = getHeader("x-datto-api-key");
  const apiSecret = getHeader("x-datto-api-secret");
  const platform = getHeader("x-datto-platform");

  if (!apiKey || !apiSecret) {
    return {
      error:
        "Gateway mode requires X-Datto-API-Key and X-Datto-API-Secret headers",
    };
  }

  return {
    creds: {
      apiKey,
      apiSecretKey: apiSecret,
      platform: resolvePlatform(platform),
    },
  };
}

function createClient(creds: DattoCredentials): DattoRmmClient {
  return new DattoRmmClient({
    apiKey: creds.apiKey,
    apiSecretKey: creds.apiSecretKey,
    platform: creds.platform,
  });
}

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
// Server factory — creates a fresh server per request (stateless HTTP mode)
// ---------------------------------------------------------------------------

export function createMcpServer(credentialOverrides?: DattoCredentials): Server {
  const server = new Server(
    {
      name: "datto-rmm-mcp",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
        resources: {},
      },
    }
  );

  setServerRef(server);

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
                description:
                  "Filter devices by site UID (optional - if omitted, returns all devices)",
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
                description:
                  "Filter alerts by site UID (optional - if omitted, returns all account alerts)",
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
          name: "datto_get_alert",
          description: "Get details for a specific alert by its UID",
          _meta: ALERT_CARD_META,
          inputSchema: {
            type: "object",
            properties: {
              alertUid: {
                type: "string",
                description: "The alert UID",
              },
            },
            required: ["alertUid"],
          },
        },
        {
          name: "datto_resolve_alert",
          description: "Resolve an alert by its UID",
          _meta: ALERT_CARD_META,
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
          description:
            "Get audit data for a device (hardware, software, OS information)",
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
                description:
                  "Type of audit: 'full' for complete audit or 'software' for software inventory only",
                default: "full",
              },
            },
            required: ["deviceUid"],
          },
        },
      ],
    };
  });

  // MCP Apps (SEP-1865): the ui:// alert card is static HTML embedded at
  // build time (src/generated/alert-card-html.ts), so it serves identically
  // from stdio, Node HTTP, and the fs-less Cloudflare Workers runtime.
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    return {
      resources: [
        {
          uri: ALERT_CARD_RESOURCE_URI,
          name: "Datto RMM Alert Card",
          description: "Interactive MCP Apps card rendering a Datto RMM alert",
          mimeType: MCP_APP_RESOURCE_MIME,
        },
      ],
    };
  });

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;
    if (uri !== ALERT_CARD_RESOURCE_URI) {
      throw new Error(`Unknown resource: ${uri}`);
    }
    return {
      contents: [
        {
          uri,
          mimeType: MCP_APP_RESOURCE_MIME,
          // The card ships neutral; operators brand it at serve time via
          // MCP_BRAND_* env vars (no vars = HTML served unchanged).
          text: applyBrandInjection(ALERT_CARD_HTML, brandFromEnv()),
        },
      ],
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const creds = credentialOverrides ?? getCredentials();

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
          let siteUid = params.siteUid;

          // If no site filter, ask the user if they want to narrow by site
          if (!siteUid) {
            const siteFilter = await elicitSelection(
              "Listing all devices across all sites can return a large result set. Would you like to filter by a specific site?",
              "site",
              [
                { value: "__all__", label: "All sites (no filter)" },
                { value: "__enter__", label: "Enter a site UID manually" },
              ]
            );
            if (siteFilter === "__enter__") {
              const { elicitText } = await import("./utils/elicitation.js");
              const enteredUid = await elicitText(
                "Enter the site UID to filter devices by.",
                "siteUid",
                "The site UID from Datto RMM"
              );
              if (enteredUid) {
                siteUid = enteredUid;
              }
            }
          }

          let devices;
          if (siteUid) {
            devices = await collectItems(client.sites.devicesAll(siteUid), max);
          } else {
            devices = await collectItems(client.account.devicesAll(), max);
          }

          return {
            content: [
              { type: "text", text: JSON.stringify(devices ?? [], null, 2) },
            ],
          };
        }

        case "datto_get_device": {
          const { deviceUid } = args as { deviceUid: string };
          const device = await client.devices.get(deviceUid);
          return {
            content: [
              { type: "text", text: JSON.stringify(device ?? {}, null, 2) },
            ],
          };
        }

        case "datto_list_alerts": {
          const params = args as { siteUid?: string; max?: number };
          const max = params.max || 50;
          let siteUid = params.siteUid;

          // If no site filter, ask the user if they want to narrow by site
          if (!siteUid) {
            const siteFilter = await elicitSelection(
              "Listing all open alerts can return many results. Would you like to filter by a specific site?",
              "site",
              [
                { value: "__all__", label: "All sites (no filter)" },
                { value: "__enter__", label: "Enter a site UID manually" },
              ]
            );
            if (siteFilter === "__enter__") {
              const { elicitText } = await import("./utils/elicitation.js");
              const enteredUid = await elicitText(
                "Enter the site UID to filter alerts by.",
                "siteUid",
                "The site UID from Datto RMM"
              );
              if (enteredUid) {
                siteUid = enteredUid;
              }
            }
          }

          let alerts;
          if (siteUid) {
            alerts = await collectItems(client.sites.alertsOpenAll(siteUid), max);
          } else {
            alerts = await collectItems(client.account.alertsOpenAll(), max);
          }

          return {
            content: [
              { type: "text", text: JSON.stringify(alerts ?? [], null, 2) },
            ],
          };
        }

        case "datto_get_alert": {
          const { alertUid } = args as { alertUid: string };
          const alert = await client.alerts.get(alertUid);
          // MCP Apps: attach the normalized payload the ui:// alert card
          // renders from. Best-effort — a null card just means no UI surface.
          const card = buildAlertCard(alert);
          const payload = card ? { ...alert, _card: card } : alert;
          return {
            content: [
              { type: "text", text: JSON.stringify(payload ?? {}, null, 2) },
            ],
          };
        }

        case "datto_resolve_alert": {
          const { alertUid } = args as { alertUid: string };
          const result = await client.alerts.resolve(alertUid);
          return {
            content: [
              { type: "text", text: JSON.stringify(result ?? {}, null, 2) },
            ],
          };
        }

        case "datto_list_sites": {
          const params = args as { max?: number };
          const max = params.max || 50;
          const sites = await collectItems(client.account.sitesAll(), max);
          return {
            content: [
              { type: "text", text: JSON.stringify(sites ?? [], null, 2) },
            ],
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

          const result = await client.devices.createQuickJob(
            deviceUid,
            jobRequest
          );
          return {
            content: [
              { type: "text", text: JSON.stringify(result ?? {}, null, 2) },
            ],
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
            content: [
              { type: "text", text: JSON.stringify(audit ?? {}, null, 2) },
            ],
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

  return server;
}
