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

import {
  MAX_WINDOW_DAYS,
  REQUEST_THROTTLE_MS,
  DESTINATION_CACHE_TTL_MS,
  PRICE_CACHE_TTL_MS,
  MAX_LIVE_PRICE_CALLS_PER_SEARCH,
} from "../constants.js";
import type { HotelOfferRoom, FlexibleSearchResult } from "../types.js";
import type { StayApiClient } from "./stayApiClient.js";
import { buildBookingDestinationUrl, buildBookingUrl, appendAffiliateId } from "./affiliateLink.js";
import { getOrFetch, peek } from "./priceCache.js";

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

/**
 * Picks up to `cap` dates out of `dates` (which must already be sorted), spread as evenly
 * as possible across the full list — always including the first and last date when
 * `cap >= 2` — so a capped search still gets real prices across the whole requested window
 * instead of just clustering on its first few days. If the list already fits within the
 * cap, every date is picked (no sampling needed).
 */
function selectSampledDates(dates: string[], cap: number): Set<string> {
  if (dates.length <= cap) return new Set(dates);
  if (cap <= 1) return new Set(dates.length ? [dates[0]] : []);
  const picked = new Set<string>();
  for (let i = 0; i < cap; i++) {
    const idx = Math.round((i * (dates.length - 1)) / (cap - 1));
    picked.add(dates[idx]);
  }
  return picked;
}

/** Recognizes StayAPI's "out of credits" / rate-limit style failures, e.g. "402 You've used all your free credits." */
function isQuotaExhaustedError(message: string): boolean {
  return /credits|quota|402|429|rate.?limit/i.test(message);
}

/**
 * Builds a graceful fallback offer for a candidate date whose live price lookup failed or
 * was skipped (quota exhausted, transient API error, etc.) — a plain Booking.com
 * destination-search link with no price attached, same shape as free "link-only" mode.
 * This is what keeps a "priced" search useful even when some (or all) dates couldn't be
 * priced: the guest always gets something to click, never a dead end.
 */
function buildFallbackOffer(params: FlexibleSearchParams, checkInDate: string, checkOutDate: string): HotelOfferRoom {
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

  // Cached: a city's dest_id essentially never changes, so once resolved it's reused for
  // a week rather than spending a fresh request every single search.
  const destinationCacheKey = `dest:${params.destination.trim().toLowerCase()}`;
  let destination;
  let destinationFromCache = false;
  try {
    ({ value: destination, fromCache: destinationFromCache } = await getOrFetch(destinationCacheKey, DESTINATION_CACHE_TTL_MS, () =>
      client.resolveDestination(params.destination),
    ));
  } catch (error) {
    // This is the very first StayAPI call a search makes — if the key/quota is dead, THIS
    // is where it fails (e.g. "402 You've used all your free credits"). Rather than hard-
    // erroring the whole search, fall all the way back to free link-only mode: every
    // candidate date still gets a real, working Booking.com link, just no live price.
    const result = searchLinkOnly(params);
    const reason = error instanceof Error ? error.message : String(error);
    return { ...result, note: `Live prices unavailable (${reason}) — showing booking links instead.` };
  }
  if (!destination) {
    // StayAPI understood the request but genuinely couldn't match this place name to a
    // destination — same graceful fallback, since a plain destination-search link still
    // works fine for whatever the guest typed.
    const result = searchLinkOnly(params);
    return {
      ...result,
      note: `Could not resolve "${params.destination}" to a specific destination — showing a general booking link for this search term instead. Try a more specific or differently spelled place name for live prices.`,
    };
  }

  const allOffers: HotelOfferRoom[] = [];
  const skipped: { date: string; reason: string }[] = [];
  const fallbackDates: string[] = [];
  let requestsSpent = destinationFromCache ? 0 : 1;
  let servedFromCache = destinationFromCache ? 1 : 0;
  // Once one date's live call fails with a quota/rate-limit error, every remaining date
  // would fail the exact same way — so stop attempting live calls for the rest of this
  // search (still checking cache first) instead of burning time hammering a dead key.
  let quotaExhausted = false;
  // Bounds how many live calls one search can spend, no matter how wide the window is —
  // see MAX_LIVE_PRICE_CALLS_PER_SEARCH's comment in constants.ts. Dates outside the
  // sample still get a real booking link, just no on-site price.
  const liveSampleDates = selectSampledDates(candidateDates, MAX_LIVE_PRICE_CALLS_PER_SEARCH);
  const sampledOutCount = candidateDates.length - liveSampleDates.size;

  for (let i = 0; i < candidateDates.length; i++) {
    const checkInDate = candidateDates[i];
    const checkOutDate = addDays(checkInDate, params.nights);
    let madeLiveCall = false;
    // Cached per exact (destination, dates, guests, currency) combo: the same or an
    // overlapping search run again by anyone within the TTL window costs nothing.
    const priceCacheKey = [
      "price",
      destination.destId,
      destination.destType,
      checkInDate,
      checkOutDate,
      params.adults,
      params.roomQuantity,
      params.currency ?? "default",
      params.maxHotelsPerDate,
    ].join("|");

    if ((quotaExhausted || !liveSampleDates.has(checkInDate)) && peek(priceCacheKey) === undefined) {
      // Either this date already can't be priced this search (quota dead — skip straight
      // to the fallback instead of re-failing a live call), or it's simply outside this
      // search's sampling budget. Either way, if nobody has ever cached this exact date
      // before we still fall back rather than spend a live call on it.
      allOffers.push(buildFallbackOffer(params, checkInDate, checkOutDate));
      fallbackDates.push(checkInDate);
      continue;
    }

    try {
      const { value: hotels, fromCache: priceFromCache } = await getOrFetch(priceCacheKey, PRICE_CACHE_TTL_MS, () => {
        madeLiveCall = true;
        return client.searchHotels({
          destId: destination.destId,
          destType: destination.destType,
          checkin: checkInDate,
          checkout: checkOutDate,
          adults: params.adults,
          rooms: params.roomQuantity,
          currency: params.currency,
          rowsPerPage: params.maxHotelsPerDate,
        });
      });
      if (priceFromCache) {
        servedFromCache++;
      } else {
        requestsSpent++;
      }

      if (hotels.length === 0) {
        skipped.push({ date: checkInDate, reason: "No available offers for this date" });
        allOffers.push(buildFallbackOffer(params, checkInDate, checkOutDate));
        fallbackDates.push(checkInDate);
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
      if (madeLiveCall) requestsSpent++;
      const reason = error instanceof Error ? error.message : String(error);
      if (isQuotaExhaustedError(reason)) quotaExhausted = true;
      skipped.push({ date: checkInDate, reason });
      // Never leave a date as a dead end: fall back to a plain booking-search link (same
      // as free link-only mode) instead of just dropping it.
      allOffers.push(buildFallbackOffer(params, checkInDate, checkOutDate));
      fallbackDates.push(checkInDate);
    }

    // Only throttle after a real API call — no reason to slow down cache hits.
    if (madeLiveCall && i < candidateDates.length - 1) {
      await sleep(REQUEST_THROTTLE_MS);
    }
  }

  allOffers.sort((a, b) => (a.totalPrice ?? Infinity) - (b.totalPrice ?? Infinity));

  const truncated = allOffers.length > params.maxResults;
  const offers = allOffers.slice(0, params.maxResults);
  // A STAYAPI_KEY is configured, but if every single offer ended up being a fallback (e.g.
  // the quota was already dead before this search even started), report this result as
  // link_only rather than priced — that's what it actually is, and it keeps the website's
  // "sorted cheapest to priciest" summary line honest instead of overclaiming.
  const anyPriceKnown = offers.some((o) => o.priceKnown);

  return {
    destination: params.destination,
    mode: anyPriceKnown ? "priced" : "link_only",
    nights: params.nights,
    earliestCheckIn: params.earliestCheckIn,
    latestCheckIn: params.latestCheckIn,
    datesScanned: candidateDates.length,
    datesWithOffers: candidateDates.length - skipped.length,
    datesSkipped: skipped,
    offers,
    cheapest: offers[0] ?? null,
    truncated,
    note: [
      servedFromCache > 0
        ? `${requestsSpent} live StayAPI request(s) spent; ${servedFromCache} were served from cache (free, no quota used).`
        : `${requestsSpent} live StayAPI request(s) spent (none of this search was cached yet).`,
      fallbackDates.length > 0
        ? `${fallbackDates.length} of ${candidateDates.length} date(s) couldn't be priced${quotaExhausted ? " (API quota appears exhausted)" : ""} and fell back to a plain booking link instead.`
        : "",
      !quotaExhausted && sampledOutCount > 0
        ? `To keep quota usage bounded, only ${liveSampleDates.size} of ${candidateDates.length} dates (spread across the window) were checked for a live price this search; the others show a booking link instead.`
        : "",
    ]
      .filter(Boolean)
      .join(" "),
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
