/** Shared constants for the flexible-hotels-mcp-server. */

/** StayAPI base URL (multi-provider hospitality data API, https://stayapi.com). */
export const STAYAPI_BASE_URL = "https://api.stayapi.com/v1";

/** Maximum characters returned in a single tool response before truncation. */
export const CHARACTER_LIMIT = 25000;

/** Maximum number of candidate check-in dates scanned in one flexible search (bounds API usage). */
export const MAX_WINDOW_DAYS = 30;

/**
 * Maximum number of hotels requested per candidate date when a StayAPI key is configured
 * (bounds API usage / response size). Also the cap on rows_per_page sent to StayAPI.
 */
export const MAX_HOTELS_PER_SEARCH = 30;

/** Delay between successive StayAPI requests, to be a polite API citizen (and to spread out free-trial usage). */
export const REQUEST_THROTTLE_MS = 200;

/**
 * How long a resolved destination (city name -> StayAPI dest_id) stays cached. Long-lived
 * because a city's dest_id essentially never changes, so there's no reason to ever pay for
 * the same resolve twice.
 */
export const DESTINATION_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * How long a single date's hotel-price results stay cached. Real prices do drift over a
 * few hours, so this is much shorter than the destination cache — but it's what turns a
 * repeated or overlapping search (the same city + nearby dates, searched again by anyone)
 * from "another full round of API calls" into "instant and free."
 */
export const PRICE_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
