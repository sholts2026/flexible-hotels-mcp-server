/** Shared TypeScript types for the flexible-hotels-mcp-server. */

/** A single destination suggestion returned by StayAPI's Booking.com destination lookup. */
export interface StayApiDestinationSuggestion {
  destId: number | string;
  destType?: string;
  label?: string;
}

/** Result of resolving a free-text place name (e.g. "Tel Aviv") to a Booking.com destination id. */
export interface ResolvedDestination {
  query: string;
  destId: number | string;
  destType: string;
  normalizedQuery?: string;
  suggestions: StayApiDestinationSuggestion[];
}

/** One hotel result from StayAPI's Booking.com Hotel Search endpoint, for a single check-in/check-out pair. */
export interface StayApiHotelResult {
  hotelId: string | number;
  hotelName: string;
  url?: string;
  imageUrl?: string;
  starRating?: number;
  reviewScore?: number;
  reviewCount?: number;
  reviewScoreWord?: string;
  address?: string;
  minTotalPrice?: number;
  currencyCode?: string;
  isFreeCancellable?: boolean;
}

/**
 * A single flexible-search result row: either a priced offer for one hotel on one date
 * (when a STAYAPI_KEY is configured), or a link-only entry for one date (free-forever
 * mode, no price data). `priceKnown` distinguishes the two.
 */
export interface HotelOfferRoom {
  hotelId?: string | number;
  hotelName?: string;
  checkInDate: string;
  checkOutDate: string;
  nights: number;
  /** true when totalPrice comes from a real, live StayAPI quote; false in free link-only mode. */
  priceKnown: boolean;
  currency?: string;
  totalPrice?: number;
  starRating?: number;
  reviewScore?: number;
  reviewCount?: number;
  address?: string;
  /**
   * Click-through link to see live prices / complete the booking on the real site
   * (Booking.com by default). This server is an AFFILIATE tool — it never collects
   * payment details itself.
   */
  bookingUrl: string;
}

export interface FlexibleSearchResult {
  destination: string;
  /** "priced" when a STAYAPI_KEY is configured and live prices were fetched, "link_only" otherwise. */
  mode: "priced" | "link_only";
  nights: number;
  earliestCheckIn: string;
  latestCheckIn: string;
  datesScanned: number;
  datesWithOffers: number;
  datesSkipped: { date: string; reason: string }[];
  offers: HotelOfferRoom[];
  cheapest: HotelOfferRoom | null;
  truncated: boolean;
  note?: string;
}
