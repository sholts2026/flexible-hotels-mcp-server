import { z } from "zod";
import { MAX_HOTELS_PER_SEARCH, MAX_WINDOW_DAYS } from "../constants.js";

export enum ResponseFormat {
  MARKDOWN = "markdown",
  JSON = "json",
}

const responseFormatField = z
  .nativeEnum(ResponseFormat)
  .default(ResponseFormat.MARKDOWN)
  .describe("Output format: 'markdown' for human-readable or 'json' for machine-readable");

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be an ISO date in YYYY-MM-DD format")
  .describe("Date in YYYY-MM-DD format");

export const ResolveCityInputSchema = z
  .object({
    keyword: z
      .string()
      .min(2, "keyword must be at least 2 characters")
      .max(100)
      .describe("Free-text city name or the start of it, e.g. 'Tel Aviv', 'Par', 'New York'"),
    max_results: z.number().int().min(1).max(20).default(10).describe("Maximum cities to return"),
    response_format: responseFormatField,
  })
  .strict();

export const ListHotelsInputSchema = z
  .object({
    city_code: z
      .string()
      .length(3, "city_code must be a 3-letter IATA city code, e.g. 'TLV', 'PAR', 'NYC'")
      .toUpperCase()
      .describe("IATA city code, e.g. 'TLV' for Tel Aviv, 'PAR' for Paris (use resolve_city_code to find it)"),
    radius_km: z.number().int().min(1).max(300).default(20).describe("Search radius around the city center, in kilometers"),
    max_results: z.number().int().min(1).max(MAX_HOTELS_PER_SEARCH).default(20).describe("Maximum hotels to return"),
    response_format: responseFormatField,
  })
  .strict();

export const SearchFlexibleOffersInputSchema = z
  .object({
    city_code: z
      .string()
      .length(3, "city_code must be a 3-letter IATA city code, e.g. 'TLV', 'PAR', 'NYC'")
      .toUpperCase()
      .describe("IATA city code to search in, e.g. 'TLV' for Tel Aviv (use resolve_city_code to find it from a name)"),
    nights: z
      .number()
      .int()
      .min(1, "nights must be at least 1")
      .max(28, "nights must be at most 28")
      .describe("Exact number of consecutive nights the guest wants to stay, e.g. 3"),
    earliest_check_in: isoDate.describe(
      "Earliest allowed check-in date, YYYY-MM-DD. The search scans every possible check-in date from this date through latest_check_in.",
    ),
    latest_check_in: isoDate.describe(
      `Latest allowed check-in date, YYYY-MM-DD. Must be no more than ${MAX_WINDOW_DAYS} days after earliest_check_in.`,
    ),
    hotel_ids: z
      .array(z.string())
      .max(MAX_HOTELS_PER_SEARCH)
      .optional()
      .describe(
        "Optional list of specific Amadeus hotelIds to restrict the search to (from list_hotels_in_city). " +
          "If omitted, the tool automatically looks up hotels in city_code and checks up to max_hotels of them.",
      ),
    max_hotels: z
      .number()
      .int()
      .min(1)
      .max(MAX_HOTELS_PER_SEARCH)
      .default(15)
      .describe(
        `When hotel_ids is not provided, how many hotels in the city to check (higher = more thorough but slower, capped at ${MAX_HOTELS_PER_SEARCH})`,
      ),
    adults: z.number().int().min(1).max(9).default(2).describe("Number of adult guests per room"),
    room_quantity: z.number().int().min(1).max(9).default(1).describe("Number of rooms to book"),
    currency: z
      .string()
      .length(3)
      .toUpperCase()
      .optional()
      .describe("Optional 3-letter ISO currency code to request prices in, e.g. 'USD', 'EUR', 'ILS'"),
    max_results: z.number().int().min(1).max(50).default(10).describe("Maximum number of offers to return, sorted cheapest first"),
    response_format: responseFormatField,
  })
  .strict();

export const GetOfferDetailsInputSchema = z
  .object({
    offer_id: z.string().min(1).describe("The Amadeus offer id returned by search_flexible_hotel_offers, e.g. 'XYZ123'"),
    response_format: responseFormatField,
  })
  .strict();

export type ResolveCityInput = z.infer<typeof ResolveCityInputSchema>;
export type ListHotelsInput = z.infer<typeof ListHotelsInputSchema>;
export type SearchFlexibleOffersInput = z.infer<typeof SearchFlexibleOffersInputSchema>;
export type GetOfferDetailsInput = z.infer<typeof GetOfferDetailsInputSchema>;
