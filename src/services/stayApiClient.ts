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
    const data = await this.get<{ success: boolean; data?: any[] }>("/booking/search", {
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

    return (data.data ?? []).map((h) => ({
      hotelId: h.hotel_id,
      hotelName: h.hotel_name,
      url: h.url,
      imageUrl: h.image_url,
      starRating: h.star_rating,
      reviewScore: h.review_score,
      reviewCount: h.review_count,
      reviewScoreWord: h.review_score_word,
      address: h.address,
      minTotalPrice: typeof h.min_total_price === "number" ? h.min_total_price : Number.parseFloat(h.min_total_price),
      currencyCode: h.currency_code,
      isFreeCancellable: Boolean(h.is_free_cancellable),
    }));
  }
}
