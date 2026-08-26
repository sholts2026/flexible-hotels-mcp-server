/**
 * Core "flexible date" search logic.
 *
 * No hotel API answers "what's cheapest for N nights sometime in the next month" —
 * they all only answer "what does it cost for THIS exact check-in -> check-out range".
 * This module provides that missing capability: given a stay length (nights) and a
 * window of possible check-in dates, it fans out one search call per candidate
 * check-in date and returns everything sorted by price so the caller can see which
 * dates are cheapest.
 *
 * Two modes, chosen automatically based on whether a STAYAPI_KEY is configured:
 *
 *  - "priced" mode (StayApiClient provided): each candidate date triggers one real
 *    StayAPI Booking.com search call, returning live per-hotel prices. Free-trial
 *    StayAPI keys only get 50 one-time requests total, so this is deliberately not
 *    the default — see the tool description for the cost-per-search warning.
 *
 *  - "link_only" mode (no StayApiClient, the free-forever default): no API is called
 *    at all. One Booking.com search link is generated per candidate date so the guest
 *    can see live prices by clicking through — no price comparison happens on our end,
 *    but this mode has no quota and never breaks.
 */

import { MAX_WINDOW_DAYS, REQUEST_THROTTLE_MS } from "../constants.js";
import type { HotelOfferRoom, FlexibleSearchResult } from "../types.js";
import type { StayApiClient } from "./stayApiClient.js";
import { buildBookingDestinationUrl, buildBookingUrl, appendAffiliateId } from "./affiliateLink.js";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function assertValidDateString(value: string, fieldName: string): void {
  if (!DATE_RE.test(value) || Number.isNaN(Date.parse(value))) {
    throw new Error(`${fieldName} must be a valid date in YYYY-MM-DD format, got "${value}"`);
  }
}

/** Adds `days` calendar days to a YYYY-MM-DD date string, returning a new YYYY-MM-DD string. */
export function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Whole number of calendar days between two YYYY-MM-DD dates (b - a). */
export function daysBetween(a: string, b: string): number {
  const da = new Date(`${a}T00:00:00Z`).getTime();
  const db = new Date(`${b}T00:00:00Z`).getTime();
  return Math.round((db - da) / 86_400_000);
}

/**
 * Builds the list of candidate check-in dates to scan: every date from
 * earliestCheckIn to latestCheckIn inclusive, capped at MAX_WINDOW_DAYS
 * candidates so a single search can't trigger an unbounded number of API calls.
 */
export function buildCandidateCheckInDates(
  earliestCheckIn: string,
  latestCheckIn: string,
  maxWindowDays: number = MAX_WINDOW_DAYS,
): string[] {
  assertValidDateString(earliestCheckIn, "earliestCheckIn");
  assertValidDateString(latestCheckIn, "latestCheckIn");

  const span = daysBetween(earliestCheckIn, latestCheckIn);
  if (span < 0) {
    throw new Error("latestCheckIn must be on or after earliestCheckIn");
  }
  if (span + 1 > maxWindowDays) {
    throw new Error(
      `Date window is ${span + 1} days, which exceeds the maximum of ${maxWindowDays}. ` +
        `Narrow earliestCheckIn/latestCheckIn to at most ${maxWindowDays} days apart.`,
    );
  }

  const dates: string[] = [];
  for (let i = 0; i <= span; i++) {
    dates.push(addDays(earliestCheckIn, i));
  }
  return dates;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface FlexibleSearchParams {
  destination: string;
  nights: number;
  earliestCheckIn: string;
  latestCheckIn: string;
  adults: number;
  roomQuantity: number;
  currency?: string;
  maxHotelsPerDate: number;
  maxResults: number;
}

/**
 * Runs the flexible-date search in free "link-only" mode: no API calls, just one
 * Booking.com destination-search link generated per candidate check-in date.
 */
function searchLinkOnly(params: FlexibleSearchParams): FlexibleSearchResult {
  const candidateDates = buildCandidateCheckInDates(params.earliestCheckIn, params.latestCheckIn);

  const offers: HotelOfferRoom[] = candidateDates.map((checkInDate) => {
    const checkOutDate = addDays(checkInDate, params.nights);
    return {
      checkInDate,
      checkOutDate,
      nights: params.nights,
      priceKnown: false,
      bookingUrl: buildBookingDestinationUrl({
        destination: params.destination,
        checkInDate,
        checkOutDate,
        adults: params.adults,
        roomQuantity: params.roomQuantity,
      }),
    };
  });

  const truncated = offers.length > params.maxResults;
  const limited = offers.slice(0, params.maxResults);

  return {
    destination: params.destination,
    mode: "link_only",
    nights: params.nights,
    earliestCheckIn: params.earliestCheckIn,
    latestCheckIn: params.latestCheckIn,
    datesScanned: candidateDates.length,
    datesWithOffers: candidateDates.length,
    datesSkipped: [],
    offers: limited,
    cheapest: null,
    truncated,
    note:
      "Free link-only mode: no STAYAPI_KEY configured, so no live prices were fetched. " +
      "Each link opens Booking.com pre-filled with the destination and dates — real prices " +
      "are visible after clicking through. Configure STAYAPI_KEY for automatic price comparison.",
  };
}

/**
 * Runs the flexible-date search in "priced" mode: resolves the destination once, then
 * fetches real StayAPI offers for every candidate check-in date (one API call each).
 */
async function searchWithStayApi(
  client: StayApiClient,
  params: FlexibleSearchParams,
): Promise<FlexibleSearchResult> {
  const candidateDates = buildCandidateCheckInDates(params.earliestCheckIn, params.latestCheckIn);

  const destination = await client.resolveDestination(params.destination);
  if (!destination) {
    throw new Error(
      `Could not resolve destination "${params.destination}" via StayAPI. Try a more specific or differently spelled place name.`,
    );
  }

  const allOffers: HotelOfferRoom[] = [];
  const skipped: { date: string; reason: string }[] = [];

  for (let i = 0; i < candidateDates.length; i++) {
    const checkInDate = candidateDates[i];
    const checkOutDate = addDays(checkInDate, params.nights);
    try {
      const hotels = await client.searchHotels({
        destId: destination.destId,
        destType: destination.destType,
        checkin: checkInDate,
        checkout: checkOutDate,
        adults: params.adults,
        rooms: params.roomQuantity,
        currency: params.currency,
        rowsPerPage: params.maxHotelsPerDate,
      });

      if (hotels.length === 0) {
        skipped.push({ date: checkInDate, reason: "No available offers for this date" });
        continue;
      }

      for (const hotel of hotels) {
        if (hotel.minTotalPrice === undefined || Number.isNaN(hotel.minTotalPrice)) continue;
        allOffers.push({
          hotelId: hotel.hotelId,
          hotelName: hotel.hotelName,
          checkInDate,
          checkOutDate,
          nights: params.nights,
          priceKnown: true,
          currency: hotel.currencyCode ?? params.currency ?? "USD",
          totalPrice: hotel.minTotalPrice,
          starRating: hotel.starRating,
          reviewScore: hotel.reviewScore,
          reviewCount: hotel.reviewCount,
          address: hotel.address,
          // StayAPI's live response doesn't actually include a per-hotel `url` (see the
          // note in stayApiClient.ts), so this almost always falls through to building a
          // Booking.com link scoped to this exact hotel name (not just the destination),
          // with the right dates — that's what lets the click-through land on the right
          // hotel instead of a generic city-wide search results page.
          bookingUrl: hotel.url
            ? appendAffiliateId(hotel.url)
            : hotel.hotelName
              ? buildBookingUrl({
                  hotelName: hotel.hotelName,
                  cityCode: params.destination,
                  checkInDate,
                  checkOutDate,
                  adults: params.adults,
                  roomQuantity: params.roomQuantity,
                })
              : buildBookingDestinationUrl({
                  destination: params.destination,
                  checkInDate,
                  checkOutDate,
                  adults: params.adults,
                  roomQuantity: params.roomQuantity,
                }),
        });
      }
    } catch (error) {
      skipped.push({
        date: checkInDate,
        reason: error instanceof Error ? error.message : String(error),
      });
    }

    if (i < candidateDates.length - 1) {
      await sleep(REQUEST_THROTTLE_MS);
    }
  }

  allOffers.sort((a, b) => (a.totalPrice ?? Infinity) - (b.totalPrice ?? Infinity));

  const truncated = allOffers.length > params.maxResults;
  const offers = allOffers.slice(0, params.maxResults);

  return {
    destination: params.destination,
    mode: "priced",
    nights: params.nights,
    earliestCheckIn: params.earliestCheckIn,
    latestCheckIn: params.latestCheckIn,
    datesScanned: candidateDates.length,
    datesWithOffers: candidateDates.length - skipped.length,
    datesSkipped: skipped,
    offers,
    cheapest: offers[0] ?? null,
    truncated,
    note: `Used ${candidateDates.length + 1} StayAPI request(s) (1 destination lookup + ${candidateDates.length} date scan(s)) against your free-trial quota.`,
  };
}

export async function searchFlexibleHotelOffers(
  client: StayApiClient | null,
  params: FlexibleSearchParams,
): Promise<FlexibleSearchResult> {
  if (client) {
    return searchWithStayApi(client, params);
  }
  return searchLinkOnly(params);
}
