import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AmadeusClient } from "../services/amadeusClient.js";
import { searchFlexibleHotelOffers } from "../services/hotelSearch.js";
import { formatFlexibleSearchMarkdown } from "../services/format.js";
import { CHARACTER_LIMIT, MAX_WINDOW_DAYS } from "../constants.js";
import {
  SearchFlexibleOffersInputSchema,
  ResponseFormat,
  type SearchFlexibleOffersInput,
} from "../schemas/schemas.js";

export function registerSearchFlexibleOffersTool(server: McpServer, client: AmadeusClient): void {
  server.registerTool(
    "flexible_hotels_search_flexible_offers",
    {
      title: "Search Hotel Offers by Number of Nights (Flexible Dates)",
      description: `Find the cheapest hotel offers for a fixed NUMBER OF NIGHTS across a WINDOW of possible check-in
dates, instead of a single fixed check-in/check-out date pair. This is the core tool of this server.

For example: "3 nights in Tel Aviv, sometime between Sep 1 and Sep 20" is expressed as
nights=3, earliest_check_in="2026-09-01", latest_check_in="2026-09-20". The tool scans every
possible check-in date in that window (each implying checkout = check-in + nights), fetches real
priced offers for each, and returns the cheapest options found, sorted by price — so the caller
can see which exact dates are the best deal.

This does NOT search by a single fixed date — for that, just set earliest_check_in = latest_check_in.
This is an AFFILIATE search tool: it never collects payment details or creates a booking. Each returned
offer includes a bookingUrl — a link to the real hotel/OTA listing where the guest can complete the
purchase themselves, if they choose to. Data comes from the Amadeus for Developers hotel API (free
test/sandbox environment by default).

Args:
  - city_code (string): 3-letter IATA city code, e.g. "TLV" (use resolve_city_code to find it from a name)
  - nights (number): exact stay length in nights, 1-28
  - earliest_check_in / latest_check_in (YYYY-MM-DD): the flexible window of possible check-in dates,
    at most ${MAX_WINDOW_DAYS} days apart
  - hotel_ids (string[], optional): restrict to specific Amadeus hotelIds (from list_hotels_in_city)
  - max_hotels (number): if hotel_ids is omitted, how many hotels in the city to auto-check (default 15)
  - adults (number): guests per room (default 2)
  - room_quantity (number): rooms to book (default 1)
  - currency (string, optional): 3-letter ISO currency code, e.g. "USD"
  - max_results (number): how many offers to return, cheapest first (default 10)
  - response_format ('markdown' | 'json'): output format (default markdown)

Returns:
  For JSON format: {
    "cityCode": string, "nights": number, "earliestCheckIn": string, "latestCheckIn": string,
    "datesScanned": number, "datesWithOffers": number,
    "datesSkipped": [{ "date": string, "reason": string }],
    "hotelsConsidered": number,
    "offers": [{ "offerId", "hotelId", "hotelName", "checkInDate", "checkOutDate", "nights",
                  "currency", "totalPrice", "boardType", "roomDescription", "bookingUrl" }, ...],
    "cheapest": <same shape as one offer, or null>,
    "truncated": boolean
  }

Examples:
  - Use when: "find me the cheapest 3-night stay in Paris sometime in the next month"
  - Use when: "is it cheaper to go for a long weekend early or late September?"
  - Don't use when: the user already has exact fixed dates in mind — a single-date search is faster
    (set earliest_check_in = latest_check_in), though this tool still works for that case.

Error Handling:
  - Returns an error if the date window exceeds ${MAX_WINDOW_DAYS} days — narrow it and retry
  - Individual dates that error out (e.g. sandbox has no data) are listed in datesSkipped rather than
    failing the whole search`,
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
        let hotelIds = params.hotel_ids;
        if (!hotelIds || hotelIds.length === 0) {
          const hotels = await client.hotelsByCity(params.city_code);
          if (hotels.length === 0) {
            return {
              content: [
                {
                  type: "text",
                  text:
                    `No hotels found for city code "${params.city_code}". ` +
                    `Double-check the code with flexible_hotels_resolve_city_code, or this city may have no coverage in the current environment.`,
                },
              ],
            };
          }
          hotelIds = hotels.slice(0, params.max_hotels).map((h) => h.hotelId);
        }

        const result = await searchFlexibleHotelOffers(client, {
          cityCode: params.city_code,
          nights: params.nights,
          earliestCheckIn: params.earliest_check_in,
          latestCheckIn: params.latest_check_in,
          hotelIds,
          adults: params.adults,
          roomQuantity: params.room_quantity,
          currency: params.currency,
          maxResults: params.max_results,
        });

        let text =
          params.response_format === ResponseFormat.JSON
            ? JSON.stringify(result, null, 2)
            : formatFlexibleSearchMarkdown(result);

        if (text.length > CHARACTER_LIMIT) {
          text = `${text.slice(0, CHARACTER_LIMIT)}\n\n_[response truncated at ${CHARACTER_LIMIT} characters — lower max_results or max_hotels for a shorter response]_`;
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
