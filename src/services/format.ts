/** Shared markdown formatting helpers, kept separate so tools don't duplicate presentation logic. */

import type { AmadeusCity, AmadeusHotelListing, FlexibleSearchResult, HotelOfferRoom } from "../types.js";
import { buildBookingUrl } from "./affiliateLink.js";

export function formatCitiesMarkdown(keyword: string, cities: AmadeusCity[]): string {
  if (!cities.length) {
    return `No cities found matching "${keyword}". Try a different spelling or a shorter keyword.`;
  }
  const lines = [`# Cities matching "${keyword}"`, ""];
  for (const c of cities) {
    lines.push(`- **${c.name}** (${c.iataCode})${c.countryCode ? ` — ${c.countryCode}` : ""}`);
  }
  lines.push("", "Use the `iataCode` as `city_code` in list_hotels_in_city or search_flexible_hotel_offers.");
  return lines.join("\n");
}

export function formatHotelsMarkdown(cityCode: string, hotels: AmadeusHotelListing[]): string {
  if (!hotels.length) {
    return `No hotels found for city code "${cityCode}".`;
  }
  const lines = [`# Hotels in ${cityCode}`, "", `Found ${hotels.length} hotels.`, ""];
  for (const h of hotels) {
    lines.push(`- **${h.name}** — hotelId: \`${h.hotelId}\`${h.chainCode ? ` (chain: ${h.chainCode})` : ""}`);
  }
  lines.push(
    "",
    "Pass some of these `hotelId` values as `hotel_ids` to search_flexible_hotel_offers to search only among them.",
  );
  return lines.join("\n");
}

function formatOfferLine(offer: HotelOfferRoom, rank: number): string {
  const parts = [
    `${rank}. **${offer.hotelName}** — ${offer.totalPrice.toFixed(2)} ${offer.currency}`,
    `   Check-in ${offer.checkInDate} → check-out ${offer.checkOutDate} (${offer.nights} nights)`,
  ];
  if (offer.roomDescription) parts.push(`   Room: ${offer.roomDescription}`);
  if (offer.boardType) parts.push(`   Board: ${offer.boardType}`);
  parts.push(`   Book here: ${offer.bookingUrl}`);
  parts.push(`   offerId: \`${offer.offerId}\` · hotelId: \`${offer.hotelId}\``);
  return parts.join("\n");
}

export function formatFlexibleSearchMarkdown(result: FlexibleSearchResult): string {
  const lines = [
    `# Flexible hotel search: ${result.cityCode}, ${result.nights} nights`,
    "",
    `Scanned check-in dates from ${result.earliestCheckIn} to ${result.latestCheckIn} ` +
      `(${result.datesScanned} candidate dates, ${result.hotelsConsidered} hotels considered).`,
    "",
  ];

  if (!result.offers.length) {
    lines.push(
      "No offers were found in this window.",
      result.datesSkipped.length
        ? `All ${result.datesSkipped.length} dates were skipped, e.g.: ${result.datesSkipped
            .slice(0, 3)
            .map((s) => `${s.date} (${s.reason})`)
            .join("; ")}`
        : "",
    );
    return lines.filter(Boolean).join("\n");
  }

  lines.push(
    `## Best offers (cheapest first)`,
    "_Prices are found via Amadeus; each \"Book here\" link goes to the real site to complete the booking, if the guest chooses to._",
    "",
  );
  result.offers.forEach((offer, i) => lines.push(formatOfferLine(offer, i + 1), ""));

  if (result.truncated) {
    lines.push(`_Showing top ${result.offers.length} offers; more were found — increase max_results to see them._`, "");
  }
  if (result.datesSkipped.length) {
    lines.push(
      `_${result.datesSkipped.length} of ${result.datesScanned} candidate dates returned no offers or errored._`,
    );
  }
  return lines.join("\n");
}

export function formatOfferDetailsMarkdown(raw: any): string {
  const hotel = raw?.hotel;
  const offers = raw?.offers as any[] | undefined;
  if (!hotel || !offers?.length) {
    return "No details found for this offer id. It may have expired — Amadeus test-environment offers are only valid for a short time after being returned by search.";
  }
  const offer = offers[0];
  const bookingUrl = buildBookingUrl({
    hotelName: hotel.name,
    cityCode: hotel.cityCode ?? "",
    checkInDate: offer.checkInDate,
    checkOutDate: offer.checkOutDate,
    adults: offer.guests?.adults ?? 1,
    roomQuantity: 1,
  });
  const lines = [
    `# ${hotel.name}`,
    "",
    `- Price: **${offer.price?.total} ${offer.price?.currency}**`,
    `- Check-in: ${offer.checkInDate}`,
    `- Check-out: ${offer.checkOutDate}`,
    offer.room?.description?.text ? `- Room: ${offer.room.description.text}` : "",
    offer.boardType ? `- Board: ${offer.boardType}` : "",
    offer.policies?.cancellations?.[0]?.deadline
      ? `- Free cancellation until: ${offer.policies.cancellations[0].deadline}`
      : "- Cancellation policy: not specified",
    offer.rateFamilyEstimated?.type ? `- Rate type: ${offer.rateFamilyEstimated.type}` : "",
    `- Book here: ${bookingUrl}`,
  ];
  return lines.filter(Boolean).join("\n");
}
