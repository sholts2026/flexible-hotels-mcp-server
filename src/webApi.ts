/**
 * Plain JSON REST API for the browser-based search website (public/index.html).
 *
 * This is separate from the MCP endpoint (/mcp, JSON-RPC, for AI agents) — a normal
 * website can't speak MCP's JSON-RPC tool-call protocol easily, so this exposes the
 * exact same underlying search logic (searchFlexibleHotelOffers) as a small, plain
 * REST API instead. Both the MCP tool and this API call the same function, so results
 * are identical either way.
 */

import type { Express, Request, Response } from "express";
import type { StayApiClient } from "./services/stayApiClient.js";
import { searchFlexibleHotelOffers } from "./services/hotelSearch.js";
import { MAX_WINDOW_DAYS } from "./constants.js";

function parseIntParam(value: unknown, fallback: number): number {
    if (typeof value !== "string" || value.trim() === "") return fallback;
    const n = Number.parseInt(value, 10);
    return Number.isFinite(n) ? n : fallback;
}

export function registerWebApi(app: Express, client: StayApiClient | null): void {
    /** Lets the frontend know up front whether it's in priced or link-only mode. */
  app.get("/api/config", (_req: Request, res: Response) => {
        res.status(200).json({ mode: client ? "priced" : "link_only" });
  });

  app.get("/api/search", async (req: Request, res: Response) => {
        const destination = typeof req.query.destination === "string" ? req.query.destination.trim() : "";
        const earliestCheckIn = typeof req.query.earliest_check_in === "string" ? req.query.earliest_check_in : "";
        const latestCheckIn = typeof req.query.latest_check_in === "string" ? req.query.latest_check_in : "";
        const nights = parseIntParam(req.query.nights, 1);
        const adults = parseIntParam(req.query.adults, 2);
        const roomQuantity = parseIntParam(req.query.room_quantity, 1);
        const currency = typeof req.query.currency === "string" && req.query.currency.trim() ? req.query.currency.trim() : undefined;
        const maxHotelsPerDate = parseIntParam(req.query.max_hotels_per_date, 15);
        const maxResults = parseIntParam(req.query.max_results, 12);

              if (!destination) {
                      res.status(400).json({ error: "Missing required parameter: destination" });
                      return;
              }
        if (!earliestCheckIn || !latestCheckIn) {
                res.status(400).json({ error: "Missing required parameters: earliest_check_in and latest_check_in (YYYY-MM-DD)" });
                return;
        }
        if (!Number.isInteger(nights) || nights < 1 || nights > 28) {
                res.status(400).json({ error: "nights must be an integer between 1 and 28" });
                return;
        }

              try {
                      const result = await searchFlexibleHotelOffers(client, {
                                destination,
                                nights,
                                earliestCheckIn,
                                latestCheckIn,
                                adults,
                                roomQuantity,
                                currency,
                                maxHotelsPerDate,
                                maxResults,
                      });
                      res.status(200).json(result);
              } catch (error) {
                      const message = error instanceof Error ? error.message : String(error);
                      const status = /exceeds the maximum of|must be a valid date|must be on or after/.test(message) ? 400 : 502;
                      res.status(status).json({ error: message });
              }
  });

  // Surfaced so the frontend can show a helpful hint about the date-window cap.
  app.get("/api/limits", (_req: Request, res: Response) => {
        res.status(200).json({ maxWindowDays: MAX_WINDOW_DAYS });
  });
}
