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
 * How long a single date's hotel-price results stay cached. This is deliberately long
 * (not "real-time") — this tool is an affiliate price-comparison guide, not a live booking
 * engine: the guest always clicks through to Booking.com to see the current price and
 * complete the booking, so a same-day-old comparison price is a fine trade for making the
 * request quota last far longer. Same/overlapping searches (same city + nearby dates,
 * searched again by anyone) within this window cost nothing.
 */
export const PRICE_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Maximum number of LIVE StayAPI price calls a single flexible search will make,
 * regardless of how many candidate dates are in the requested window. Without this cap, a
 * single visitor searching a full 30-day window could spend up to 30 requests in one
 * search — on a paid plan with a monthly cap (e.g. 1,500/month), a handful of visitors
 * searching different destinations could burn through the entire month's quota in minutes.
 *
 * With the cap, only this many dates — spread as evenly as possible across the full
 * requested window — get a real live price lookup; every other date still gets a real,
 * working Booking.com link (same graceful fallback used for quota exhaustion), just
 * without a price shown on our site. This keeps the cost of any single search bounded and
 * predictable while still covering the entire date range the guest asked about.
 */
export const MAX_LIVE_PRICE_CALLS_PER_SEARCH = 10;
