import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { StayApiClient } from "../services/stayApiClient.js";
import { searchFlexibleHotelOffers } from "../services/hotelSearch.js";
import { formatFlexibleSearchMarkdown } from "../services/format.js";
import { CHARACTER_LIMIT, MAX_WINDOW_DAYS } from "../constants.js";
import {
  SearchFlexibleOffersInputSchema,
  ResponseFormat,
  type SearchFlexibleOffersInput,
} from "../schemas/schemas.js";

export function registerSearchFlexibleOffersTool(server: McpServer, client: StayApiClient | null): void {
  server.registerTool(
    "flexible_hotels_search_flexible_offers",
    {
      title: "Search Hotel Offers by Number of Nights (Flexible Dates)",
      description: `Find the best hotel options for a fixed NUMBER OF NIGHTS across a WINDOW of possible check-in
dates, instead of a single fixed check-in/check-out date pair. This is the core tool of this server, and it
works with NO setup or API key required.

For example: "3 nights in Tel Aviv, sometime between Sep 1 and Sep 20" is expressed as
nights=3, earliest_check_in="2026-09-01", latest_check_in="2026-09-20". The tool scans every
possible check-in date in that window (each implying checkout = check-in + nights) and returns results
sorted by date (or by price, when price data is available) — so the caller can see the options across the window.

This does NOT search by a single fixed date — for that, just set earliest_check_in = latest_check_in.
This is an AFFILIATE search tool: it never collects payment details or creates a booking. Every result
includes a bookingUrl — a link to Booking.com where the guest can see live prices and complete the purchase
themselves, if they choose to.

TWO MODES (automatic, based on server configuration):
  - Free "link-only" mode (default, no setup needed): returns one Booking.com search link per candidate
    date. No price comparison happens on our end — real prices appear after clicking through. Free forever,
    no rate limits.
  - "Priced" mode (only if the server operator configured a STAYAPI_KEY): fetches real live prices per
    hotel per date via StayAPI, and returns results sorted cheapest-first. StayAPI's free trial is a
    ONE-TIME quota of 50 requests total (not monthly) — this tool uses 1 request to resolve the destination
    plus 1 request per candidate date scanned, so a wide date window can use up the trial quickly. Narrow
    the window (fewer candidate dates) to conserve quota.

Args:
  - destination (string): free-text place name, e.g. "Tel Aviv", "Paris", "Barcelona" — no lookup needed first
  - nights (number): exact stay length in nights, 1-28
  - earliest_check_in / latest_check_in (YYYY-MM-DD): the flexible window of possible check-in dates,
    at most ${MAX_WINDOW_DAYS} days apart
  - adults (number): guests per room (default 2)
  - room_quantity (number): rooms to book (default 1)
  - currency (string, optional): 3-letter ISO currency code, e.g. "USD" (priced mode only)
  - max_hotels_per_date (number): priced mode only, how many hotels to consider per date (default 15)
  - max_results (number): how many results to return (default 10)
  - response_format ('markdown' | 'json'): output format (default markdown)

Returns:
  For JSON format: {
    "destination": string, "mode": "priced" | "link_only", "nights": number,
    "earliestCheckIn": string, "latestCheckIn": string,
    "datesScanned": number, "datesWithOffers": number,
    "datesSkipped": [{ "date": string, "reason": string }],
    "offers": [{ "hotelName?", "checkInDate", "checkOutDate", "nights", "priceKnown",
                  "currency?", "totalPrice?", "bookingUrl" }, ...],
    "cheapest": <same shape as one offer, or null — only set in priced mode>,
    "truncated": boolean,
    "note": string
  }

Examples:
  - Use when: "find me the cheapest 3-night stay in Paris sometime in the next month"
  - Use when: "is it cheaper to go for a long weekend early or late September?"
  - Don't use when: the user already has exact fixed dates in mind — a single-date search is faster
    (set earliest_check_in = latest_check_in), though this tool still works for that case.

Error Handling:
  - Returns an error if the date window exceeds ${MAX_WINDOW_DAYS} days — narrow it and retry
  - In priced mode, individual dates that error out are listed in datesSkipped rather than failing the
    whole search`,
      inputSchema: SearchFlexibleOffersInputSchema.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false, // prices/availability can change between identical calls
        openWorldHint: true,
      },
    },
    async (params: SearchFlexibleOffersInput) => {
      try {
        const result = await searchFlexibleHotelOffers(client, {
          destination: params.destination,
          nights: params.nights,
          earliestCheckIn: params.earliest_check_in,
          latestCheckIn: params.latest_check_in,
          adults: params.adults,
          roomQuantity: params.room_quantity,
          currency: params.currency,
          maxHotelsPerDate: params.max_hotels_per_date,
          maxResults: params.max_results,
        });

        let text =
          params.response_format === ResponseFormat.JSON
            ? JSON.stringify(result, null, 2)
            : formatFlexibleSearchMarkdown(result);

        if (text.length > CHARACTER_LIMIT) {
          text = `${text.slice(0, CHARACTER_LIMIT)}\n\n_[response truncated at ${CHARACTER_LIMIT} characters — lower max_results for a shorter response]_`;
        }

        return { content: [{ type: "text", text }], structuredContent: result as unknown as Record<string, unknown> };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
        };
      }
    },
  );
}
