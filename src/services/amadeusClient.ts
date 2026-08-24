/**
 * Thin, authenticated HTTP client for the Amadeus for Developers self-service APIs
 * (free "test" sandbox environment by default; can be switched to "production").
 *
 * Handles OAuth2 client-credentials auth (with token caching/refresh) and exposes
 * the specific reference-data and shopping endpoints this server needs:
 *  - City Search        (resolve a free-text city name to an IATA city code)
 *  - Hotel List by City  (find hotelIds for a given city code)
 *  - Hotel Search (v3)   (get priced offers for a set of hotelIds and a date range)
 */

import axios, { AxiosError, AxiosInstance } from "axios";
import { AMADEUS_HOSTS, TOKEN_REFRESH_MARGIN_MS } from "../constants.js";
import type { AmadeusCity, AmadeusHotelListing, AmadeusTokenResponse } from "../types.js";

export class AmadeusApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly amadeusErrors?: unknown,
  ) {
    super(message);
    this.name = "AmadeusApiError";
  }
}

export interface AmadeusClientConfig {
  clientId: string;
  clientSecret: string;
  env: "test" | "production";
}

export class AmadeusClient {
  private readonly http: AxiosInstance;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly baseUrl: string;
  private tokenCache: { token: string; expiresAt: number } | null = null;
  /** "test" = free sandbox (default), "production" = paid, real-time, real bookings. */
  public readonly env: "test" | "production";

  constructor(config: AmadeusClientConfig) {
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
    this.env = config.env;
    this.baseUrl = AMADEUS_HOSTS[config.env];
    this.http = axios.create({ baseURL: this.baseUrl, timeout: 30_000 });
  }

  /** Returns a valid bearer token, fetching or refreshing it as needed. */
  private async getAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.tokenCache && this.tokenCache.expiresAt - TOKEN_REFRESH_MARGIN_MS > now) {
      return this.tokenCache.token;
    }

    try {
      const body = new URLSearchParams({
        grant_type: "client_credentials",
        client_id: this.clientId,
        client_secret: this.clientSecret,
      });
      const response = await this.http.post<AmadeusTokenResponse>(
        "/v1/security/oauth2/token",
        body.toString(),
        { headers: { "Content-Type": "application/x-www-form-urlencoded" } },
      );
      const { access_token, expires_in } = response.data;
      this.tokenCache = {
        token: access_token,
        expiresAt: now + expires_in * 1000,
      };
      return access_token;
    } catch (error) {
      throw this.wrapError(error, "Failed to authenticate with Amadeus");
    }
  }

  private async authedGet<T>(path: string, params: Record<string, unknown>): Promise<T> {
    const token = await this.getAccessToken();
    try {
      const response = await this.http.get<T>(path, {
        params,
        headers: { Authorization: `Bearer ${token}` },
      });
      return response.data;
    } catch (error) {
      throw this.wrapError(error, `Amadeus request to ${path} failed`);
    }
  }

  private wrapError(error: unknown, context: string): AmadeusApiError {
    if (axios.isAxiosError(error)) {
      const err = error as AxiosError<{ errors?: unknown }>;
      const status = err.response?.status;
      const amadeusErrors = err.response?.data?.errors;
      let hint = "";
      if (status === 401) {
        hint =
          " Check that AMADEUS_CLIENT_ID / AMADEUS_CLIENT_SECRET are correct and match AMADEUS_ENV (test vs production).";
      } else if (status === 429) {
        hint = " Rate limit exceeded (test env allows ~10 requests/sec) — retry after a short pause.";
      } else if (status === 404) {
        hint = " No matching data found for the given parameters.";
      }
      return new AmadeusApiError(
        `${context}: ${status ?? "network error"} ${err.message}.${hint}`,
        status,
        amadeusErrors,
      );
    }
    return new AmadeusApiError(`${context}: ${error instanceof Error ? error.message : String(error)}`);
  }

  /** Resolve a free-text city name (e.g. "Tel Aviv") to Amadeus IATA city codes (e.g. "TLV"). */
  async searchCities(keyword: string, max = 10): Promise<AmadeusCity[]> {
    const data = await this.authedGet<{ data: any[] }>("/v1/reference-data/locations/cities", {
      keyword,
      max,
    });
    return (data.data || []).map((c) => ({
      name: c.name,
      iataCode: c.iataCode,
      countryCode: c.address?.countryCode,
      subType: c.subType,
      latitude: c.geoCode?.latitude,
      longitude: c.geoCode?.longitude,
    }));
  }

  /** List hotels (with their Amadeus hotelIds) located in a given IATA city code. */
  async hotelsByCity(cityCode: string, radiusKm = 20): Promise<AmadeusHotelListing[]> {
    const data = await this.authedGet<{ data: any[] }>(
      "/v1/reference-data/locations/hotels/by-city",
      { cityCode, radius: radiusKm, radiusUnit: "KM" },
    );
    return (data.data || []).map((h) => ({
      hotelId: h.hotelId,
      name: h.name,
      chainCode: h.chainCode,
      iataCode: h.iataCode,
      latitude: h.geoCode?.latitude,
      longitude: h.geoCode?.longitude,
      address: h.address ? { countryCode: h.address.countryCode } : undefined,
    }));
  }

  /**
   * Get priced offers for a specific set of hotels and a specific check-in/check-out
   * date pair. This is the single-date primitive that the flexible-date search loops
   * over — Amadeus itself only supports one fixed date range per call.
   */
  async hotelOffersForDates(params: {
    hotelIds: string[];
    checkInDate: string;
    checkOutDate: string;
    adults: number;
    roomQuantity?: number;
    currency?: string;
  }): Promise<any[]> {
    const data = await this.authedGet<{ data: any[]; warnings?: unknown[] }>(
      "/v3/shopping/hotel-offers",
      {
        hotelIds: params.hotelIds.join(","),
        checkInDate: params.checkInDate,
        checkOutDate: params.checkOutDate,
        adults: params.adults,
        roomQuantity: params.roomQuantity ?? 1,
        currency: params.currency,
        bestRateOnly: true,
      },
    );
    return data.data || [];
  }

  /** Fetch full, current details (including cancellation policy) for a single offer id. */
  async offerById(offerId: string): Promise<any> {
    const data = await this.authedGet<{ data: any }>(
      `/v3/shopping/hotel-offers/${encodeURIComponent(offerId)}`,
      {},
    );
    return data.data;
  }
}
