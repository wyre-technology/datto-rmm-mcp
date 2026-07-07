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
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { DattoRmmClient, type Platform } from "@wyre-technology/node-datto-rmm";
import { setServerRef } from "./utils/server-ref.js";
import { elicitSelection } from "./utils/elicitation.js";

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
// Device lookup helpers
// ---------------------------------------------------------------------------

async function findDevicesByHostname(
  client: DattoRmmClient,
  hostname: string,
  options?: {
    siteUid?: string;
    exactMatch?: boolean;
    max?: number;
  }
) {
  const normalizedHostname = hostname.trim().toLowerCase();
  const exactMatch = options?.exactMatch ?? true;
  const max = options?.max ?? 25;
  const matches = [];
  const source = options?.siteUid
    ? client.sites.devicesAll(options.siteUid)
    : client.account.devicesAll();

  for await (const device of source) {
    const deviceHostname = device.hostname?.trim().toLowerCase();

    if (!deviceHostname) {
      continue;
    }

    const isMatch = exactMatch
      ? deviceHostname === normalizedHostname
      : deviceHostname.includes(normalizedHostname);

    if (isMatch) {
      matches.push({
        id: device.id,
        uid: device.uid,
        hostname: device.hostname,
        siteId: device.siteId,
        siteUid: device.siteUid,
        siteName: device.siteName,
        online: device.online,
        intIpAddress: device.intIpAddress,
        operatingSystem: device.operatingSystem,
        lastSeen: device.lastSeen,
        portalUrl: device.portalUrl,
      });
    }

    if (matches.length >= max) {
      break;
    }
  }

  return matches;
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
      },
    }
  );

  setServerRef(server);

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: "datto_list_devices",
          description: "List multiple devices, preferably filtered by siteUid. Do not use for single hostname lookup.",
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
          name: "datto_find_device",
          description:
            "Find a device by hostname and return UID. Use this before datto_get_device when the user provides a hostname instead of a UID..",
          inputSchema: {
            type: "object",
            properties: {
              hostname: {
                type: "string",
                description:
                  "Hostname to search for, for example APP-HV-HOST06",
              },
              siteUid: {
                type: "string",
                description:
                  "Optional site UID to narrow the hostname lookup to one site",
              },
              exactMatch: {
                type: "boolean",
                description:
                  "Whether to require an exact hostname match. Defaults to true.",
                default: true,
              },
              max: {
                type: "number",
                description:
                  "Maximum number of matching devices to return. Defaults to 25.",
                default: 25,
              },
            },
            required: ["hostname"],
          },
        },
        {
          name: "datto_get_device",
          description: "Get full details for one specific device by UID. Do not use this for hostname lookup; call datto_find_device first.",
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

        case "datto_find_device": {
          const {
            hostname,
            siteUid,
            exactMatch = true,
            max = 25,
          } = args as {
            hostname: string;
            siteUid?: string;
            exactMatch?: boolean;
            max?: number;
          };

          const devices = await findDevicesByHostname(client, hostname, {
            siteUid,
            exactMatch,
            max,
          });

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    count: devices.length,
                    devices,
                  },
                  null,
                  2
                ),
              },
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
