/** Shared TypeScript types for the flexible-hotels-mcp-server. */

export interface AmadeusCity {
  name: string;
  iataCode: string;
  countryCode?: string;
  subType?: string;
  latitude?: number;
  longitude?: number;
}

export interface AmadeusHotelListing {
  hotelId: string;
  name: string;
  chainCode?: string;
  iataCode?: string;
  latitude?: number;
  longitude?: number;
  address?: {
    countryCode?: string;
  };
}

export interface HotelOfferRoom {
  offerId: string;
  hotelId: string;
  hotelName: string;
  checkInDate: string;
  checkOutDate: string;
  nights: number;
  currency: string;
  totalPrice: number;
  basePrice?: number;
  boardType?: string;
  roomDescription?: string;
  cancellationDeadline?: string;
  rating?: string;
  latitude?: number;
  longitude?: number;
  /**
   * Click-through link to complete the booking on the real hotel/OTA site.
   * This server is an AFFILIATE tool — it never collects payment details itself.
   */
  bookingUrl: string;
}

export interface FlexibleSearchResult {
  cityCode: string;
  nights: number;
  earliestCheckIn: string;
  latestCheckIn: string;
  datesScanned: number;
  datesWithOffers: number;
  datesSkipped: { date: string; reason: string }[];
  hotelsConsidered: number;
  offers: HotelOfferRoom[];
  cheapest: HotelOfferRoom | null;
  truncated: boolean;
}

export interface AmadeusTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}
