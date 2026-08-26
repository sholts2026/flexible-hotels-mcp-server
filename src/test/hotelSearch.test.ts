/**
 * Smoke tests for the pure flexible-date search logic, run with Node's built-in
 * test runner against a mocked StayApiClient (no network / API key required), plus
 * the free link-only mode (client = null).
 *
 * Run with: npm run build && npm test
 */

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  addDays,
  daysBetween,
  buildCandidateCheckInDates,
  searchFlexibleHotelOffers,
} from "../services/hotelSearch.js";
import { buildBookingUrl, buildBookingDestinationUrl } from "../services/affiliateLink.js";
import { clearCache } from "../services/priceCache.js";
import type { StayApiClient } from "../services/stayApiClient.js";

// Every fakeClient() in this file resolves to the same dest_id (-1), so without resetting
// the (production) cache between tests, one test's cached prices would leak into the next
// test that happens to search the same dates/guest-count — clear it before every test.
beforeEach(() => {
  clearCache();
});

test("addDays adds calendar days correctly, including month/year rollover", () => {
  assert.equal(addDays("2026-09-01", 3), "2026-09-04");
  assert.equal(addDays("2026-09-29", 3), "2026-10-02");
  assert.equal(addDays("2026-12-30", 3), "2027-01-02");
});

test("daysBetween computes the correct span", () => {
  assert.equal(daysBetween("2026-09-01", "2026-09-01"), 0);
  assert.equal(daysBetween("2026-09-01", "2026-09-10"), 9);
});

test("buildCandidateCheckInDates returns every date in an inclusive window", () => {
  const dates = buildCandidateCheckInDates("2026-09-01", "2026-09-04");
  assert.deepEqual(dates, ["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04"]);
});

test("buildCandidateCheckInDates handles a single-day window", () => {
  assert.deepEqual(buildCandidateCheckInDates("2026-09-01", "2026-09-01"), ["2026-09-01"]);
});

test("buildCandidateCheckInDates rejects an inverted window", () => {
  assert.throws(() => buildCandidateCheckInDates("2026-09-10", "2026-09-01"), /on or after/);
});

test("buildCandidateCheckInDates rejects a window wider than the cap", () => {
  assert.throws(
    () => buildCandidateCheckInDates("2026-09-01", "2026-10-15", 30),
    /exceeds the maximum/,
  );
});

test("buildCandidateCheckInDates rejects malformed dates", () => {
  assert.throws(() => buildCandidateCheckInDates("09/01/2026", "2026-09-04"), /YYYY-MM-DD/);
});

/** Builds a fake StayApiClient whose searchHotels returns a canned price per check-in date. */
function fakeClient(pricesByDate: Record<string, number | "error" | "empty">): StayApiClient {
  return {
    resolveDestination: async (query: string) => ({
      query,
      destId: -1,
      destType: "CITY",
      normalizedQuery: query,
      suggestions: [],
    }),
    searchHotels: async ({ checkin }: { checkin: string }) => {
      const price = pricesByDate[checkin];
      if (price === "error") throw new Error("simulated API error");
      if (price === undefined || price === "empty") return [];
      return [
        {
          hotelId: "HTEST1",
          hotelName: "Test Hotel",
          url: "https://www.booking.com/hotel/test.html",
          minTotalPrice: price,
          currencyCode: "USD",
        },
      ];
    },
  } as unknown as StayApiClient;
}

test("searchFlexibleHotelOffers (priced mode) picks the cheapest date across the window and sorts results", async () => {
  const client = fakeClient({
    "2026-09-01": 300,
    "2026-09-02": 210,
    "2026-09-03": 250,
  });

  const result = await searchFlexibleHotelOffers(client, {
    destination: "Tel Aviv",
    nights: 2,
    earliestCheckIn: "2026-09-01",
    latestCheckIn: "2026-09-03",
    adults: 2,
    roomQuantity: 1,
    maxHotelsPerDate: 15,
    maxResults: 10,
  });

  assert.equal(result.mode, "priced");
  assert.equal(result.datesScanned, 3);
  assert.equal(result.offers.length, 3);
  assert.equal(result.cheapest?.checkInDate, "2026-09-02");
  assert.equal(result.cheapest?.totalPrice, 210);
  assert.equal(result.cheapest?.checkOutDate, "2026-09-04"); // check-in + 2 nights
  // sorted ascending by price
  assert.deepEqual(
    result.offers.map((o) => o.totalPrice),
    [210, 250, 300],
  );
});

test("searchFlexibleHotelOffers (priced mode) records skipped dates instead of failing the whole search", async () => {
  const client = fakeClient({
    "2026-09-01": "error",
    "2026-09-02": "empty",
    "2026-09-03": 199,
  });

  const result = await searchFlexibleHotelOffers(client, {
    destination: "Tel Aviv",
    nights: 1,
    earliestCheckIn: "2026-09-01",
    latestCheckIn: "2026-09-03",
    adults: 1,
    roomQuantity: 1,
    maxHotelsPerDate: 15,
    maxResults: 10,
  });

  assert.equal(result.datesSkipped.length, 2);
  assert.equal(result.offers.length, 1);
  assert.equal(result.cheapest?.checkInDate, "2026-09-03");
});

test("searchFlexibleHotelOffers (priced mode) respects max_results and sets truncated", async () => {
  const client = fakeClient({
    "2026-09-01": 100,
    "2026-09-02": 200,
    "2026-09-03": 300,
  });

  const result = await searchFlexibleHotelOffers(client, {
    destination: "Tel Aviv",
    nights: 1,
    earliestCheckIn: "2026-09-01",
    latestCheckIn: "2026-09-03",
    adults: 1,
    roomQuantity: 1,
    maxHotelsPerDate: 15,
    maxResults: 2,
  });

  assert.equal(result.offers.length, 2);
  assert.equal(result.truncated, true);
});

test("searchFlexibleHotelOffers (priced mode) attaches a working booking_url to every offer (affiliate model, no payment collected)", async () => {
  const client = fakeClient({ "2026-09-01": 150 });

  const result = await searchFlexibleHotelOffers(client, {
    destination: "Tel Aviv",
    nights: 2,
    earliestCheckIn: "2026-09-01",
    latestCheckIn: "2026-09-01",
    adults: 2,
    roomQuantity: 1,
    maxHotelsPerDate: 15,
    maxResults: 10,
  });

  const offer = result.offers[0];
  assert.ok(offer.bookingUrl.startsWith("https://www.booking.com/hotel/test.html"));
});

test("searchFlexibleHotelOffers (priced mode) reuses cached results for a repeated search instead of spending quota again", async () => {
  let resolveCalls = 0;
  let searchCalls = 0;
  const client = {
    resolveDestination: async (query: string) => {
      resolveCalls++;
      return { query, destId: 555, destType: "CITY", normalizedQuery: query, suggestions: [] };
    },
    searchHotels: async () => {
      searchCalls++;
      return [
        { hotelId: "HCACHE1", hotelName: "Cache Test Hotel", url: "https://www.booking.com/hotel/cache.html", minTotalPrice: 200, currencyCode: "USD" },
      ];
    },
  } as unknown as StayApiClient;

  const searchParams = {
    destination: "Cache City",
    nights: 1,
    earliestCheckIn: "2026-10-01",
    latestCheckIn: "2026-10-01",
    adults: 2,
    roomQuantity: 1,
    maxHotelsPerDate: 15,
    maxResults: 10,
  };

  const first = await searchFlexibleHotelOffers(client, searchParams);
  assert.equal(resolveCalls, 1);
  assert.equal(searchCalls, 1);
  assert.match(first.note ?? "", /2 live StayAPI request/);

  // Same destination + same date + same guest count, searched again (e.g. by a different
  // visitor) — must NOT call the fake API a second time, and the note should say so.
  const second = await searchFlexibleHotelOffers(client, searchParams);
  assert.equal(resolveCalls, 1, "destination resolve should be served from cache, not called again");
  assert.equal(searchCalls, 1, "hotel price search should be served from cache, not called again");
  assert.match(second.note ?? "", /0 live StayAPI request.*2 were served from cache/);
  assert.equal(second.offers[0]?.totalPrice, 200);
});

/**
 * StayAPI's real live response has no per-hotel `url` field at all (see the note in
 * stayApiClient.ts) — this mirrors that shape, unlike fakeClient() above.
 */
function fakeClientNoHotelUrl(pricesByDate: Record<string, number>): StayApiClient {
  return {
    resolveDestination: async (query: string) => ({
      query,
      destId: -1,
      destType: "CITY",
      normalizedQuery: query,
      suggestions: [],
    }),
    searchHotels: async ({ checkin }: { checkin: string }) => {
      const price = pricesByDate[checkin];
      if (price === undefined) return [];
      return [
        {
          hotelId: "HTEST2",
          hotelName: "Sea Tower by Isrotel Design",
          minTotalPrice: price,
          currencyCode: "USD",
        },
      ];
    },
  } as unknown as StayApiClient;
}

test("searchFlexibleHotelOffers (priced mode, hotel has no direct url — the real StayAPI shape) builds a booking_url scoped to that hotel's name, not a generic destination search", async () => {
  const client = fakeClientNoHotelUrl({ "2026-09-01": 150 });

  const result = await searchFlexibleHotelOffers(client, {
    destination: "Tel Aviv",
    nights: 1,
    earliestCheckIn: "2026-09-01",
    latestCheckIn: "2026-09-01",
    adults: 2,
    roomQuantity: 1,
    maxHotelsPerDate: 15,
    maxResults: 10,
  });

  const offer = result.offers[0];
  const url = new URL(offer.bookingUrl);
  assert.equal(url.origin + url.pathname, "https://www.booking.com/searchresults.html");
  // The critical regression check: the search string must include the specific hotel's
  // name (not just the destination), and the exact dates — otherwise the click-through
  // lands the guest on a generic city-wide search page instead of this hotel.
  assert.ok(url.searchParams.get("ss")?.includes("Sea Tower by Isrotel Design"));
  assert.equal(url.searchParams.get("checkin"), "2026-09-01");
  assert.equal(url.searchParams.get("checkout"), "2026-09-02");
});

test("searchFlexibleHotelOffers (link-only mode, no client) returns one link per date with no price data", async () => {
  const result = await searchFlexibleHotelOffers(null, {
    destination: "Tel Aviv",
    nights: 3,
    earliestCheckIn: "2026-09-01",
    latestCheckIn: "2026-09-04",
    adults: 2,
    roomQuantity: 1,
    maxHotelsPerDate: 15,
    maxResults: 10,
  });

  assert.equal(result.mode, "link_only");
  assert.equal(result.offers.length, 4);
  assert.equal(result.cheapest, null);
  for (const offer of result.offers) {
    assert.equal(offer.priceKnown, false);
    assert.ok(offer.bookingUrl.startsWith("https://www.booking.com/searchresults.html?"));
  }
});

test("buildBookingUrl produces a valid Booking.com search link without an affiliate id by default", () => {
  const url = buildBookingUrl({
    hotelName: "Hilton Tel Aviv",
    cityCode: "TLV",
    checkInDate: "2026-09-01",
    checkOutDate: "2026-09-04",
    adults: 2,
    roomQuantity: 1,
  });
  const parsed = new URL(url);
  assert.equal(parsed.hostname, "www.booking.com");
  assert.equal(parsed.searchParams.get("ss"), "Hilton Tel Aviv, TLV");
  assert.equal(parsed.searchParams.get("checkin"), "2026-09-01");
  assert.equal(parsed.searchParams.get("checkout"), "2026-09-04");
  assert.equal(parsed.searchParams.has("aid"), false);
});

test("buildBookingUrl appends the affiliate id when provided, for commission tracking", () => {
  const url = buildBookingUrl({
    hotelName: "Hilton Tel Aviv",
    cityCode: "TLV",
    checkInDate: "2026-09-01",
    checkOutDate: "2026-09-04",
    adults: 2,
    roomQuantity: 1,
    affiliateId: "123456",
  });
  assert.equal(new URL(url).searchParams.get("aid"), "123456");
});

test("buildBookingDestinationUrl produces a valid destination-only search link", () => {
  const url = buildBookingDestinationUrl({
    destination: "Tel Aviv",
    checkInDate: "2026-09-01",
    checkOutDate: "2026-09-04",
    adults: 2,
    roomQuantity: 1,
  });
  const parsed = new URL(url);
  assert.equal(parsed.hostname, "www.booking.com");
  assert.equal(parsed.searchParams.get("ss"), "Tel Aviv");
  assert.equal(parsed.searchParams.get("checkin"), "2026-09-01");
});
