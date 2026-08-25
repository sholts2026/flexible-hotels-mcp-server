import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { StayApiClient } from "../services/stayApiClient.js";
import { formatDestinationMarkdown } from "../services/format.js";
import { ResolveDestinationInputSchema, ResponseFormat, type ResolveDestinationInput } from "../schemas/schemas.js";

export function registerResolveDestinationTool(server: McpServer, client: StayApiClient | null): void {
  server.registerTool(
    "flexible_hotels_resolve_destination",
    {
      title: "Resolve a Place Name to a Booking.com Destination",
      description: `Disambiguate a free-text place name (e.g. "Tel Aviv", "Paris") against Booking.com's own destination
database, returning the best match plus alternative suggestions when the name is ambiguous.

This is OPTIONAL — search_flexible_hotel_offers accepts any free-text destination directly and resolves it
internally. Only call this first if you want to check/disambiguate a place name before searching, or to show
the user alternative matches (e.g. "Paris, France" vs "Paris, Texas").

Requires a STAYAPI_KEY to be configured (uses one StayAPI request per call). If no key is configured, this
tool returns an explanatory error — it is not needed in the free link-only mode; just pass your destination
text straight to search_flexible_hotel_offers.

Args:
  - query (string): free-text place name, e.g. "Tel Aviv", "Barcelona", "Phuket"
  - response_format ('markdown' | 'json'): output format (default markdown)

Returns: the best-matching destination plus up to 5 alternative suggestions.`,
      inputSchema: ResolveDestinationInputSchema.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: ResolveDestinationInput) => {
      if (!client) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text:
                "No STAYAPI_KEY is configured, so destination resolution isn't available. " +
                "This is only a convenience lookup — you can just pass your destination as free text " +
                "(e.g. \"Tel Aviv\") directly to search_flexible_hotel_offers, which works without any API key.",
            },
          ],
        };
      }
      try {
        const resolved = await client.resolveDestination(params.query);
        const text =
          params.response_format === ResponseFormat.JSON
            ? JSON.stringify({ query: params.query, resolved }, null, 2)
            : formatDestinationMarkdown(params.query, resolved);
        return { content: [{ type: "text", text }], structuredContent: { query: params.query, resolved } };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
        };
      }
    },
  );
}
