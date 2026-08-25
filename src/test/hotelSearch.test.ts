/**
 * Smoke tests for the pure flexible-date search logic, run with Node's built-in
 * test runner against a mocked StayApiClient (no network / API key required), plus
 * the free link-only mode (client = null).
 *
 * Run with: npm run build && npm test
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addDays,
  daysBetween,
  buildCandidateCheckInDates,
  searchFlexibleHotelOffers,
} from "../services/hotelSearch.js";
import { buildBookingUrl, buildBookingDestinationUrl } from "../services/affiliateLink.js";
import type { StayApiClient } from "../services/stayApiClient.js";

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
