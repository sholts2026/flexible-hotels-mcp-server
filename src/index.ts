#!/usr/bin/env node
/**
 * flexible-hotels-mcp-server
 *
 * MCP server that lets an AI agent search hotel offers by a NUMBER OF NIGHTS
 * across a flexible window of possible check-in dates, instead of one fixed
 * check-in/check-out date pair. Backed by the free Amadeus for Developers
 * self-service "test" environment (no credit card required).
 *
 * This is an AFFILIATE tool, not a booking engine: it never collects payment details.
 * Every result includes a click-through link to the real hotel's listing (Booking.com
 * by default) where the guest completes the purchase, if they choose to at all.
 *
 * Tools:
 *  - flexible_hotels_resolve_city_code    resolve a city name to an IATA city code
 *  - flexible_hotels_list_hotels_in_city  list hotels (and hotelIds) in a city
 *  - flexible_hotels_search_flexible_offers  the core flexible-date search (includes a booking_url per offer)
 *  - flexible_hotels_get_offer_details    fetch fresh details for one offer
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";

import { AmadeusClient } from "./services/amadeusClient.js";
import { registerResolveCityTool } from "./tools/resolveCity.js";
import { registerListHotelsTool } from "./tools/listHotels.js";
import { registerSearchFlexibleOffersTool } from "./tools/searchFlexibleOffers.js";
import { registerGetOfferDetailsTool } from "./tools/getOfferDetails.js";

/**
 * Reads Amadeus credentials from the environment.
 *
 * For stdio (local, single-user) we fail fast with a clear message — there's a
 * human at a terminal right there to fix it. For http (a hosted, possibly
 * multi-tenant deployment) we deliberately do NOT crash-loop the process when
 * credentials are missing: the platform would just keep restarting it forever.
 * Instead the server boots normally so health checks pass, and every tool call
 * fails with a clear, actionable AmadeusApiError until real credentials are set
 * (e.g. via `railway variable set` / the Render dashboard) and the service redeploys.
 */
function loadConfig(transport: "stdio" | "http") {
  const clientId = process.env.AMADEUS_CLIENT_ID;
  const clientSecret = process.env.AMADEUS_CLIENT_SECRET;
  const missing = !clientId || !clientSecret;

  if (missing && transport === "stdio") {
    console.error(
      "ERROR: AMADEUS_CLIENT_ID and AMADEUS_CLIENT_SECRET environment variables are required.\n" +
        "Get a free key (no credit card) at https://developers.amadeus.com/register, then set them " +
        "(e.g. in a .env file — see .env.example).",
    );
    process.exit(1);
  }
  if (missing) {
    console.error(
      "WARNING: AMADEUS_CLIENT_ID / AMADEUS_CLIENT_SECRET are not set. The server will start and " +
        "health checks will pass, but every tool call will fail until real credentials are configured " +
        "(get a free key at https://developers.amadeus.com/register).",
    );
  }
  const env = process.env.AMADEUS_ENV === "production" ? "production" : "test";
  return { clientId: clientId ?? "", clientSecret: clientSecret ?? "", env: env as "test" | "production" };
}

function buildServer(client: AmadeusClient): McpServer {
  const server = new McpServer({
    name: "flexible-hotels-mcp-server",
    version: "1.0.0",
  });

  registerResolveCityTool(server, client);
  registerListHotelsTool(server, client);
  registerSearchFlexibleOffersTool(server, client);
  registerGetOfferDetailsTool(server, client);

  return server;
}

async function runStdio(client: AmadeusClient): Promise<void> {
  const server = buildServer(client);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("flexible-hotels-mcp-server running via stdio");
}

async function runHttp(client: AmadeusClient): Promise<void> {
  const app = express();
  app.use(express.json());

  // Plain health check for the hosting platform (Render/Railway) — separate from
  // the MCP endpoint itself, which only accepts POST per the streamable HTTP spec.
  app.get("/healthz", (_req, res) => {
    res.status(200).json({ status: "ok", server: "flexible-hotels-mcp-server" });
  });
  app.get("/", (_req, res) => {
    res.status(200).send("flexible-hotels-mcp-server is running. MCP endpoint: POST /mcp");
  });

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
  const config = loadConfig(transport);
  const client = new AmadeusClient(config);

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
