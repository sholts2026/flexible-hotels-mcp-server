/**
 * Builds the click-through link shown for each result.
 *
 * This server is an AFFILIATE tool: the guest completes any actual purchase on the
 * real booking site, not here. By default that's a Booking.com search results page
 * (or, when StayAPI returns a direct hotel URL, that exact hotel's page) — no API key
 * or partner approval needed for the link itself.
 *
 * Set BOOKING_AFFILIATE_ID (a Booking.com Partner "aid" value, from their free
 * self-serve Affiliate Partner Program) to earn a commission on completed bookings.
 * Without it, links still work — they just aren't tracked/monetized.
 */

const BOOKING_SEARCH_BASE = "https://www.booking.com/searchresults.html";

function affiliateId(explicit?: string): string | undefined {
  return explicit ?? process.env.BOOKING_AFFILIATE_ID;
}

/** Builds a Booking.com search-results link for a specific hotel name + destination + dates. */
export function buildBookingUrl(params: {
  hotelName: string;
  cityCode: string;
  checkInDate: string;
  checkOutDate: string;
  adults: number;
  roomQuantity: number;
  affiliateId?: string;
}): string {
  const url = new URL(BOOKING_SEARCH_BASE);
  url.searchParams.set("ss", `${params.hotelName}, ${params.cityCode}`);
  url.searchParams.set("checkin", params.checkInDate);
  url.searchParams.set("checkout", params.checkOutDate);
  url.searchParams.set("group_adults", String(params.adults));
  url.searchParams.set("no_rooms", String(params.roomQuantity));
  url.searchParams.set("group_children", "0");

  const aid = affiliateId(params.affiliateId);
  if (aid) url.searchParams.set("aid", aid);

  return url.toString();
}

/**
 * Builds a generic Booking.com search-results link for a free-text destination and
 * dates, with no specific hotel in mind. Used by the free "link-only" mode (no API
 * key configured), where no per-hotel price data is available — the guest clicks
 * through to see live options and prices themselves.
 */
export function buildBookingDestinationUrl(params: {
  destination: string;
  checkInDate: string;
  checkOutDate: string;
  adults: number;
  roomQuantity: number;
  affiliateId?: string;
}): string {
  const url = new URL(BOOKING_SEARCH_BASE);
  url.searchParams.set("ss", params.destination);
  url.searchParams.set("checkin", params.checkInDate);
  url.searchParams.set("checkout", params.checkOutDate);
  url.searchParams.set("group_adults", String(params.adults));
  url.searchParams.set("no_rooms", String(params.roomQuantity));
  url.searchParams.set("group_children", "0");

  const aid = affiliateId(params.affiliateId);
  if (aid) url.searchParams.set("aid", aid);

  return url.toString();
}

/** Appends the configured Booking.com affiliate id to an existing hotel URL (e.g. one returned directly by StayAPI). */
export function appendAffiliateId(rawUrl: string, explicitAffiliateId?: string): string {
  const aid = affiliateId(explicitAffiliateId);
  if (!aid) return rawUrl;
  try {
    const url = new URL(rawUrl);
    url.searchParams.set("aid", aid);
    return url.toString();
  } catch {
    return rawUrl;
  }
}
