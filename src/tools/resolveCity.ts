import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AmadeusClient } from "../services/amadeusClient.js";
import { formatCitiesMarkdown } from "../services/format.js";
import { ResolveCityInputSchema, ResponseFormat, type ResolveCityInput } from "../schemas/schemas.js";

export function registerResolveCityTool(server: McpServer, client: AmadeusClient): void {
  server.registerTool(
    "flexible_hotels_resolve_city_code",
    {
      title: "Resolve City Name to IATA City Code",
      description: `Look up the 3-letter IATA city code for a free-text city name (e.g. "Tel Aviv" -> "TLV", "Paris" -> "PAR").

Every other tool in this server (list_hotels_in_city, search_flexible_hotel_offers) requires an IATA city_code, so this is normally the first tool to call when the user names a city.

Args:
  - keyword (string): city name or the start of it, e.g. "Tel Aviv", "New York", "Par"
  - max_results (number): max cities to return, 1-20 (default 10)
  - response_format ('markdown' | 'json'): output format (default markdown)

Returns: matching cities with their name, iataCode, and country code.

Examples:
  - Use when: "find flexible hotel deals in Tel Aviv" -> call with keyword="Tel Aviv" first to get city_code="TLV"
  - Don't use when: you already have a 3-letter IATA city code

Error Handling:
  - Returns "No cities found matching ..." if the keyword doesn't match anything`,
      inputSchema: ResolveCityInputSchema.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: ResolveCityInput) => {
      try {
        const cities = await client.searchCities(params.keyword, params.max_results);
        const output = { keyword: params.keyword, count: cities.length, cities };
        const text =
          params.response_format === ResponseFormat.JSON
            ? JSON.stringify(output, null, 2)
            : formatCitiesMarkdown(params.keyword, cities);
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
