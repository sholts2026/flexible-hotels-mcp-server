/** Shared constants for the flexible-hotels-mcp-server. */

/** Amadeus for Developers hosts. "test" is the free, no-credit-card sandbox environment. */
export const AMADEUS_HOSTS: Record<"test" | "production", string> = {
  test: "https://test.api.amadeus.com",
  production: "https://api.amadeus.com",
};

/** Maximum characters returned in a single tool response before truncation. */
export const CHARACTER_LIMIT = 25000;

/** Maximum number of candidate check-in dates scanned in one flexible search (bounds API usage). */
export const MAX_WINDOW_DAYS = 30;

/** Maximum number of hotels checked per candidate date (bounds API usage / response size). */
export const MAX_HOTELS_PER_SEARCH = 30;

/** Delay between successive Amadeus requests, to stay comfortably under the test environment's 10 TPS limit. */
export const REQUEST_THROTTLE_MS = 150;

/** How long before its stated expiry we proactively refresh the OAuth2 token. */
export const TOKEN_REFRESH_MARGIN_MS = 60_000;
