#!/usr/bin/env node
/**
   * flexible-hotels-mcp-server
   *
   * MCP server that lets an AI agent search hotel offers by a NUMBER OF NIGHTS
   * across a flexible window of possible check-in dates, instead of one fixed
   * check-in/check-out date pair.
   *
   * Works out of the box with NO API key at all, in free "link-only" mode: it
   * returns Booking.com search links per candidate date instead of live prices.
   * Optionally, set STAYAPI_KEY (a free one-time 50-request trial key from
   * https://stayapi.com, no credit card) to get real live prices per hotel per
   * date instead, sorted cheapest first.
   *
   * This is an AFFILIATE tool, not a booking engine: it never collects payment details.
   * Every result includes a click-through link to the real hotel's listing (Booking.com
   * by default) where the guest completes the purchase, if they choose to at all.
   *
   * Tools:
   *  - flexible_hotels_resolve_destination      (optional) resolve/disambiguate a place name (priced mode only)
   *  - flexible_hotels_search_flexible_offers   the core flexible-date search (includes a bookingUrl per result)
   */

import path from "node:path";
import { fileURLToPath } from "node:url";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";

import { StayApiClient } from "./services/stayApiClient.js";
import { registerResolveDestinationTool } from "./tools/resolveDestination.js";
import { registerSearchFlexibleOffersTool } from "./tools/searchFlexibleOffers.js";
import { registerWebApi } from "./webApi.js";

// dist/index.js -> ../public is the project-root `public/` folder, regardless of
// the process's current working directory (Render/Docker always run from repo root
// in practice, but resolving from this file's own location is more robust than
// trusting process.cwd()).
const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");

/**
 * Reads the optional StayAPI key from the environment. Unlike the old Amadeus-based
 * version, missing credentials are NOT an error — the server always boots and runs
 * fully in free "link-only" mode when STAYAPI_KEY isn't set. This keeps a hosted,
 * possibly multi-tenant deployment from crash-looping, and keeps the free-forever
 * mode genuinely zero-setup.
 */
function loadStayApiClient(transport: "stdio" | "http"): StayApiClient | null {
    const apiKey = process.env.STAYAPI_KEY;
    if (!apiKey) {
          const msg =
                  "INFO: STAYAPI_KEY is not set. Running in free link-only mode (Booking.com search links, " +
                  "no live price comparison). For real prices, get a free one-time-trial key (no credit card) " +
                  "at https://stayapi.com and set STAYAPI_KEY" +
                  (transport === "http" ? " in your hosting platform's environment settings." : " (see .env.example).");
          console.error(msg);
          return null;
    }
    return new StayApiClient(apiKey);
}

function buildServer(client: StayApiClient | null): McpServer {
    const server = new McpServer({
          name: "flexible-hotels-mcp-server",
          version: "2.0.0",
    });

  registerResolveDestinationTool(server, client);
    registerSearchFlexibleOffersTool(server, client);

  return server;
}

async function runStdio(client: StayApiClient | null): Promise<void> {
    const server = buildServer(client);
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("flexible-hotels-mcp-server running via stdio");
}

async function runHttp(client: StayApiClient | null): Promise<void> {
    const app = express();
    app.use(express.json());

  // Plain health check for the hosting platform (Render/Railway) — separate from
  // the MCP endpoint itself, which only accepts POST per the streamable HTTP spec.
  app.get("/healthz", (_req, res) => {
        res.status(200).json({ status: "ok", server: "flexible-hotels-mcp-server", mode: client ? "priced" : "link_only" });
  });

  // Human-facing search website (public/index.html) + its small JSON REST API.
  // Served at "/" so this doubles as a normal hotel-search site, not just an
  // MCP server for AI agents. AI clients still connect at POST /mcp below.
  registerWebApi(app, client);
    app.use(express.static(PUBLIC_DIR));

  app.post("/mcp", async (req, res) => {
        // A fresh server+transport per request keeps this stateless and safe for concurrent clients.
               const server = buildServer(client);
        const transport = new StreamableHTTPServerTransport({
                sessionIdGenerator: undefined,
                enableJsonResponse: true,
        });
        res.on("close", () => transport.close());
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
  });

  const port = Number.parseInt(process.env.PORT || "3000", 10);
    app.listen(port, () => {
          console.error(`flexible-hotels-mcp-server running on http://localhost:${port}/mcp`);
    });
}

async function main(): Promise<void> {
    const transport = process.env.TRANSPORT === "http" ? "http" : "stdio";
    const client = loadStayApiClient(transport);

  if (transport === "http") {
        await runHttp(client);
  } else {
        await runStdio(client);
  }
}

main().catch((error) => {
    console.error("Fatal server error:", error);
    process.exit(1);
});
