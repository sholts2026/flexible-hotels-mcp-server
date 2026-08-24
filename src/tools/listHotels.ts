import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AmadeusClient } from "../services/amadeusClient.js";
import { formatHotelsMarkdown } from "../services/format.js";
import { ListHotelsInputSchema, ResponseFormat, type ListHotelsInput } from "../schemas/schemas.js";

export function registerListHotelsTool(server: McpServer, client: AmadeusClient): void {
  server.registerTool(
    "flexible_hotels_list_hotels_in_city",
    {
      title: "List Hotels in a City",
      description: `List hotels (with their Amadeus hotelId) located in a given IATA city code, optionally within a radius.

Use this to discover hotelIds you can pass into search_flexible_hotel_offers via hotel_ids, e.g. to restrict a
search to a specific neighborhood or a shortlist of hotels the user already mentioned by name. It does NOT
return prices or availability — only hotel identity/location. This tool does not modify any data.

Args:
  - city_code (string): 3-letter IATA city code, e.g. "TLV", "PAR" (use resolve_city_code to find it)
  - radius_km (number): search radius around the city center in km, 1-300 (default 20)
  - max_results (number): max hotels to return, 1-30 (default 20)
  - response_format ('markdown' | 'json'): output format (default markdown)

Returns: hotel name, hotelId, chain code, and coordinates for each matching hotel.

Examples:
  - Use when: "only search hotels near the Tel Aviv beachfront" -> narrow radius_km, then pass returned hotelIds to search_flexible_hotel_offers
  - Don't use when: you just want priced offers — use search_flexible_hotel_offers directly, it looks up hotels automatically

Error Handling:
  - Returns "No hotels found for city code ..." if the city_code is invalid or has no coverage in this environment`,
      inputSchema: ListHotelsInputSchema.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: ListHotelsInput) => {
      try {
        const hotels = (await client.hotelsByCity(params.city_code, params.radius_km)).slice(
          0,
          params.max_results,
        );
        const output = { cityCode: params.city_code, count: hotels.length, hotels };
        const text =
          params.response_format === ResponseFormat.JSON
            ? JSON.stringify(output, null, 2)
            : formatHotelsMarkdown(params.city_code, hotels);
        return { content: [{ type: "text", text }], structuredContent: output };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
        };
      }
    },
  );
}
