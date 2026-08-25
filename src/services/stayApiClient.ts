/**
 * Thin, authenticated HTTP client for StayAPI (https://stayapi.com), a multi-provider
 * hospitality data aggregator. Only the two Booking.com endpoints this server needs are
 * wrapped here:
 *  - Destinations Lookup  (resolve a free-text place name to a Booking.com dest_id)
 *  - Hotel Search         (real-time availability + pricing for a dest_id and date pair)
 *
 * StayAPI's free tier gives 50 one-time requests (no credit card, not a recurring monthly
 * quota) — see https://stayapi.com. This client is only ever constructed when a
 * STAYAPI_KEY is configured; without one, the server runs in free "link-only" mode
 * instead (see hotelSearch.ts) and never touches this file.
 */

import axios, { AxiosError, AxiosInstance } from "axios";
import { STAYAPI_BASE_URL } from "../constants.js";
import type { ResolvedDestination, StayApiHotelResult } from "../types.js";

export class StayApiError extends Error {
              constructor(
                              message: string,
                              public readonly status?: number,
                            ) {
                              super(message);
                              this.name = "StayApiError";
              }
}

export class StayApiClient {
              private readonly http: AxiosInstance;

  constructor(private readonly apiKey: string) {
                  this.http = axios.create({
                                    baseURL: STAYAPI_BASE_URL,
                                    timeout: 30_000,
                                    headers: { "x-api-key": apiKey },
                  });
  }

  private async get<T>(path: string, params: Record<string, unknown>): Promise<T> {
                  try {
                                    const response = await this.http.get<T>(path, { params });
                                    return response.data;
                  } catch (error) {
                                    throw this.wrapError(error, `StayAPI request to ${path} failed`);
                  }
  }

  private wrapError(error: unknown, context: string): StayApiError {
                  if (axios.isAxiosError(error)) {
                                    const err = error as AxiosError<{ message?: string }>;
                                    const status = err.response?.status;
                                    let hint = "";
                                    if (status === 401 || status === 403) {
                                                        hint = " Check that STAYAPI_KEY is correct.";
                                    } else if (status === 429) {
                                                        hint = " StayAPI free-trial quota (50 one-time requests) may be exhausted — check your usage at stayapi.com.";
                                    } else if (status === 404) {
                                                        hint = " No matching data found for the given parameters.";
                                    }
                                    const apiMessage = err.response?.data?.message;
                                    return new StayApiError(
                                                        `${context}: ${status ?? "network error"} ${apiMessage ?? err.message}.${hint}`,
                                                        status,
                                                      );
                  }
                  return new StayApiError(`${context}: ${error instanceof Error ? error.message : String(error)}`);
  }

  /** Resolve a free-text place name (e.g. "Tel Aviv") to a Booking.com destination id. */
  async resolveDestination(query: string, language = "en-us"): Promise<ResolvedDestination | null> {
                  const data = await this.get<{
                                    success: boolean;
                                    query: string;
                                    dest_id?: number | string;
                                    dest_type?: string;
                                    normalized_query?: string;
                                    suggestions?: Array<{ dest_id: number | string; dest_type?: string; label?: string }>;
                  }>("/booking/destinations/lookup", { query, language });

                if (!data.success || data.dest_id === undefined || data.dest_id === null) {
                                  return null;
                }

                return {
                                  query: data.query ?? query,
                                  destId: data.dest_id,
                                  destType: data.dest_type ?? "CITY",
                                  normalizedQuery: data.normalized_query,
                                  suggestions: (data.suggestions ?? []).map((s) => ({
                                                      destId: s.dest_id,
                                                      destType: s.dest_type,
                                                      label: s.label,
                                  })),
                };
  }

  /** Search hotels with real-time availability/pricing for a specific dest_id and date pair. */
  async searchHotels(params: {
                  destId: number | string;
                  destType?: string;
                  checkin: string;
                  checkout: string;
                  adults?: number;
                  rooms?: number;
                  children?: number;
                  currency?: string;
                  rowsPerPage?: number;
  }): Promise<StayApiHotelResult[]> {
                  const data = await this.get<{
                                    success: boolean;
                                    data?: { hotels?: unknown; hotels_found?: number } | unknown[] | null;
                                    message?: string;
                  }>("/booking/search", {
                                    dest_id: params.destId,
                                    dest_type: params.destType ?? "CITY",
                                    checkin: params.checkin,
                                    checkout: params.checkout,
                                    adults: params.adults ?? 2,
                                    rooms: params.rooms ?? 1,
                                    children: params.children ?? 0,
                                    currency: params.currency,
                                    rows_per_page: params.rowsPerPage ?? 25,
                  });

                // StayAPI's docs suggest `data` is directly an array of hotel results, but the
                // live response actually nests the array one level deeper, as `data.hotels`
                // (confirmed 2026-08-25 by inspecting a real response: top-level keys were
                // success/url/hotel_id/data/message/retrieved_at, and `data` itself was an
                // object with keys hotels/pagination/hotels_found/search_url/metadata — not
                // an array). Support both shapes defensively: prefer `data.hotels` if present,
                // fall back to `data` itself being the array (per the documented shape), and
                // otherwise treat it as zero results rather than crashing.
                let results: any[];
                  if (Array.isArray(data.data)) {
                                    results = data.data;
                  } else if (data.data && Array.isArray((data.data as { hotels?: unknown }).hotels)) {
                                    results = (data.data as { hotels: any[] }).hotels;
                  } else {
                                    results = [];
                  }

                // Real hotel object field names (confirmed live 2026-08-25 via a safe
                // Object.keys() diagnostic — StayAPI's docs described different names
                // than what the live Booking.com-backed response actually returns):
                //   hotel_id, name, address, city, display_location, distance, latitude,
                //   longitude, star_rating, price, rating, image_url, free_cancellation,
                //   no_prepayment, is_sold_out, room_name
                // Notably there is no hotel_name/min_total_price/review_score/review_count/
                // currency_code/url/is_free_cancellable — those were all guesses based on
                // the (wrong) documented shape. `price` itself may be a plain number or a
                // nested object depending on the search, so it's handled defensively too.
                return results
                    .filter((h) => !h.is_sold_out)
                    .map((h) => {
                             const rawPrice = h.price;
                                        const priceValue =
                                                              typeof rawPrice === "number"
                                            ? rawPrice
                                                                : typeof rawPrice === "string"
                                              ? Number.parseFloat(rawPrice)
                                                                  : rawPrice && typeof rawPrice === "object"
                                                ? Number(
                                                                                (rawPrice as Record<string, unknown>).amount ??
                                                                                  (rawPrice as Record<string, unknown>).value ??
                                                                                  (rawPrice as Record<string, unknown>).total ??
                                                                                  Number.NaN,
                                                                              )
                                                                    : Number.NaN;
                                        const currencyFromPrice =
                                                              rawPrice && typeof rawPrice === "object"
                                            ? ((rawPrice as Record<string, unknown>).currency as string | undefined)
                                                                : undefined;

                                 return {
                                                       hotelId: h.hotel_id,
                                                       hotelName: h.name,
                                                       url: h.url,
                                                       imageUrl: h.image_url,
                                                       starRating: h.star_rating,
                                                       reviewScore: typeof h.rating === "number" ? h.rating : Number.parseFloat(h.rating),
                                                       reviewCount: h.review_count,
                                                       reviewScoreWord: h.review_score_word,
                                                       address: h.address ?? h.display_location,
                                                       minTotalPrice: priceValue,
                                                       currencyCode: currencyFromPrice ?? h.currency_code,
                                                       isFreeCancellable: Boolean(h.free_cancellation),
                                 };
                    });
  }
}
