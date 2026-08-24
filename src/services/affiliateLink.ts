/**
 * Builds the click-through link shown for each offer.
 *
 * This server is an AFFILIATE tool: it shows prices found via Amadeus, but the
 * guest completes any actual purchase on the real booking site, not here. By
 * default that's a Booking.com search results page pre-filled with the hotel
 * name and dates — no API key or partner approval needed for the link itself.
 *
 * Set BOOKING_AFFILIATE_ID (a Booking.com Partner "aid" value, from their free
 * self-serve Affiliate Partner Program) to earn a commission on completed
 * bookings. Without it, the link still works — it just isn't tracked/monetized.
 */

const BOOKING_SEARCH_BASE = "https://www.booking.com/searchresults.html";

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

  const affiliateId = params.affiliateId ?? process.env.BOOKING_AFFILIATE_ID;
  if (affiliateId) {
    url.searchParams.set("aid", affiliateId);
  }

  return url.toString();
}
