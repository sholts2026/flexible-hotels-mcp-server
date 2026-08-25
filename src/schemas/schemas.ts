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

export const ResolveDestinationInputSchema = z
  .object({
    query: z
      .string()
      .min(2, "query must be at least 2 characters")
      .max(100)
      .describe("Free-text place name, e.g. 'Tel Aviv', 'Barcelona', 'Phuket'"),
    response_format: responseFormatField,
  })
  .strict();

export const SearchFlexibleOffersInputSchema = z
  .object({
    destination: z
      .string()
      .min(2, "destination must be at least 2 characters")
      .max(100)
      .describe("Free-text destination, e.g. 'Tel Aviv', 'Paris', 'Barcelona'. No city-code lookup needed."),
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
    adults: z.number().int().min(1).max(9).default(2).describe("Number of adult guests per room"),
    room_quantity: z.number().int().min(1).max(9).default(1).describe("Number of rooms to book"),
    currency: z
      .string()
      .length(3)
      .toUpperCase()
      .optional()
      .describe("Optional 3-letter ISO currency code to request prices in, e.g. 'USD', 'EUR', 'ILS' (priced mode only)"),
    max_hotels_per_date: z
      .number()
      .int()
      .min(1)
      .max(MAX_HOTELS_PER_SEARCH)
      .default(15)
      .describe("Priced mode only: how many hotels to consider per candidate date (higher = more thorough, same 1 API call either way)"),
    max_results: z.number().int().min(1).max(50).default(10).describe("Maximum number of results to return"),
    response_format: responseFormatField,
  })
  .strict();

export type ResolveDestinationInput = z.infer<typeof ResolveDestinationInputSchema>;
export type SearchFlexibleOffersInput = z.infer<typeof SearchFlexibleOffersInputSchema>;
