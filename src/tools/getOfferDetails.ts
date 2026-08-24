import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AmadeusClient } from "../services/amadeusClient.js";
import { formatOfferDetailsMarkdown } from "../services/format.js";
import { GetOfferDetailsInputSchema, ResponseFormat, type GetOfferDetailsInput } from "../schemas/schemas.js";

export function registerGetOfferDetailsTool(server: McpServer, client: AmadeusClient): void {
  server.registerTool(
    "flexible_hotels_get_offer_details",
    {
      title: "Get Hotel Offer Details",
      description: `Fetch full, up-to-date details for a single hotel offer previously returned by search_flexible_hotel_offers, including its cancellation policy.

Offer prices can shift between search and booking, so call this before telling the user a final price or
sending them to book. Like the rest of this server, it never collects payment details — it only reads
offer details and returns a click-through link to the real site.

Args:
  - offer_id (string): the offerId returned by search_flexible_hotel_offers
  - response_format ('markdown' | 'json'): output format (default markdown)

Returns: hotel name, confirmed price, check-in/check-out dates, room description, board type, cancellation deadline, and a booking link to the real site.

Examples:
  - Use when: the user picked one result from search_flexible_hotel_offers and wants to double-check the price before going to book
  - Don't use when: you don't have an offer_id yet — run search_flexible_hotel_offers first

Error Handling:
  - Returns "No details found for this offer id" if the offer expired (Amadeus test-environment offers are short-lived)`,
      inputSchema: GetOfferDetailsInputSchema.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: GetOfferDetailsInput) => {
      try {
        const raw = await client.offerById(params.offer_id);
        const text =
          params.response_format === ResponseFormat.JSON
            ? JSON.stringify(raw, null, 2)
            : formatOfferDetailsMarkdown(raw);
        return { content: [{ type: "text", text }], structuredContent: raw ?? {} };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
        };
      }
    },
  );
}
