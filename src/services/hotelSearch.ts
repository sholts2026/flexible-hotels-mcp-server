/**
 * Core "flexible date" search logic.
 *
 * Amadeus (like virtually every hotel API) only answers "what does it cost for
 * THIS exact check-in -> check-out range". There is no native "I want N nights
 * sometime in the next month, tell me the cheapest window" query.
 *
 * This module provides that missing capability: given a stay length (nights)
 * and a window of possible check-in dates, it fans out one Amadeus Hotel
 * Search call per candidate check-in date (throttled to respect the free
 * tier's rate limit), collects the cheapest offer per date, and returns
 * everything sorted by price so the caller can see which dates are cheapest.
 */

import { MAX_WINDOW_DAYS, REQUEST_THROTTLE_MS } from "../constants.js";
import type { HotelOfferRoom, FlexibleSearchResult } from "../types.js";
import type { AmadeusClient } from "./amadeusClient.js";
import { buildBookingUrl } from "./affiliateLink.js";

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

/** Extracts the cheapest priced offer(s) from one raw Amadeus hotel-offers response entry. */
function extractOffers(
  rawHotelEntries: any[],
  checkInDate: string,
  checkOutDate: string,
  nights: number,
  linkContext: { cityCode: string; adults: number; roomQuantity: number },
): HotelOfferRoom[] {
  const results: HotelOfferRoom[] = [];
  for (const entry of rawHotelEntries) {
    const hotel = entry.hotel;
    const offers = entry.offers as any[] | undefined;
    if (!hotel || !offers?.length) continue;

    // Amadeus returns offers already filtered to the cheapest with bestRateOnly=true,
    // but defensively pick the minimum priced offer among whatever comes back.
    let best: any = offers[0];
    for (const offer of offers) {
      const price = Number.parseFloat(offer.price?.total ?? "Infinity");
      const bestPrice = Number.parseFloat(best.price?.total ?? "Infinity");
      if (price < bestPrice) best = offer;
    }

    const totalPrice = Number.parseFloat(best.price?.total ?? "NaN");
    if (Number.isNaN(totalPrice)) continue;

    results.push({
      offerId: best.id,
      hotelId: hotel.hotelId,
      hotelName: hotel.name,
      checkInDate,
      checkOutDate,
      nights,
      currency: best.price?.currency ?? "UNKNOWN",
      totalPrice,
      basePrice: best.price?.base ? Number.parseFloat(best.price.base) : undefined,
      boardType: best.boardType,
      roomDescription: best.room?.description?.text ?? best.room?.typeEstimated?.category,
      cancellationDeadline: best.policies?.cancellations?.[0]?.deadline,
      rating: hotel.rating,
      latitude: hotel.latitude,
      longitude: hotel.longitude,
      bookingUrl: buildBookingUrl({
        hotelName: hotel.name,
        cityCode: linkContext.cityCode,
        checkInDate,
        checkOutDate,
        adults: linkContext.adults,
        roomQuantity: linkContext.roomQuantity,
      }),
    });
  }
  return results;
}

export interface FlexibleSearchParams {
  cityCode: string;
  nights: number;
  earliestCheckIn: string;
  latestCheckIn: string;
  hotelIds: string[];
  adults: number;
  roomQuantity: number;
  currency?: string;
  maxResults: number;
}

/**
 * Runs the flexible-date search: for every candidate check-in date in the
 * window, fetch offers for the given hotels and stay length, then merge and
 * sort everything by total price ascending.
 */
export async function searchFlexibleHotelOffers(
  client: AmadeusClient,
  params: FlexibleSearchParams,
): Promise<FlexibleSearchResult> {
  const candidateDates = buildCandidateCheckInDates(params.earliestCheckIn, params.latestCheckIn);

  const allOffers: HotelOfferRoom[] = [];
  const skipped: { date: string; reason: string }[] = [];

  for (let i = 0; i < candidateDates.length; i++) {
    const checkInDate = candidateDates[i];
    const checkOutDate = addDays(checkInDate, params.nights);
    try {
      const raw = await client.hotelOffersForDates({
        hotelIds: params.hotelIds,
        checkInDate,
        checkOutDate,
        adults: params.adults,
        roomQuantity: params.roomQuantity,
        currency: params.currency,
      });
      const offers = extractOffers(raw, checkInDate, checkOutDate, params.nights, {
        cityCode: params.cityCode,
        adults: params.adults,
        roomQuantity: params.roomQuantity,
      });
      if (offers.length === 0) {
        skipped.push({ date: checkInDate, reason: "No available offers for this date" });
      } else {
        allOffers.push(...offers);
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

  allOffers.sort((a, b) => a.totalPrice - b.totalPrice);

  const truncated = allOffers.length > params.maxResults;
  const offers = allOffers.slice(0, params.maxResults);

  return {
    cityCode: params.cityCode,
    nights: params.nights,
    earliestCheckIn: params.earliestCheckIn,
    latestCheckIn: params.latestCheckIn,
    datesScanned: candidateDates.length,
    datesWithOffers: candidateDates.length - skipped.length,
    datesSkipped: skipped,
    hotelsConsidered: params.hotelIds.length,
    offers,
    cheapest: offers[0] ?? null,
    truncated,
  };
}
