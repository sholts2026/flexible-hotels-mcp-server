/** Shared markdown formatting helpers, kept separate so tools don't duplicate presentation logic. */

import type { FlexibleSearchResult, HotelOfferRoom, ResolvedDestination } from "../types.js";

export function formatDestinationMarkdown(query: string, resolved: ResolvedDestination | null): string {
  if (!resolved) {
    return (
      `Could not resolve "${query}" to a Booking.com destination. Try a different spelling or a more specific name.\n\n` +
      `Note: this lookup is only needed if you want to disambiguate a place name before searching — ` +
      `search_flexible_hotel_offers accepts any free-text destination directly.`
    );
  }
  const lines = [
    `# Destination match for "${query}"`,
    "",
    `**${resolved.normalizedQuery ?? resolved.query}** — dest_id \`${resolved.destId}\` (${resolved.destType})`,
  ];
  if (resolved.suggestions.length > 1) {
    lines.push("", "Other possible matches:");
    for (const s of resolved.suggestions.slice(0, 5)) {
      lines.push(`- ${s.label ?? s.destId} — dest_id \`${s.destId}\`${s.destType ? ` (${s.destType})` : ""}`);
    }
  }
  lines.push(
    "",
    "You don't need to pass a dest_id anywhere — just use this place name (or a more specific one from the list above) as the `destination` argument to search_flexible_hotel_offers.",
  );
  return lines.join("\n");
}

function formatPricedOfferLine(offer: HotelOfferRoom, rank: number): string {
  const parts = [
    `${rank}. **${offer.hotelName}** — ${offer.totalPrice?.toFixed(2)} ${offer.currency}`,
    `   Check-in ${offer.checkInDate} → check-out ${offer.checkOutDate} (${offer.nights} nights)`,
  ];
  if (offer.starRating) parts.push(`   Stars: ${offer.starRating}`);
  if (offer.reviewScore) parts.push(`   Review score: ${offer.reviewScore}${offer.reviewCount ? ` (${offer.reviewCount} reviews)` : ""}`);
  if (offer.address) parts.push(`   Address: ${offer.address}`);
  parts.push(`   Book here: ${offer.bookingUrl}`);
  return parts.join("\n");
}

function formatLinkOnlyLine(offer: HotelOfferRoom, rank: number): string {
  return [
    `${rank}. **${offer.checkInDate} → ${offer.checkOutDate}** (${offer.nights} nights) — price unknown, view live: ${offer.bookingUrl}`,
  ].join("\n");
}

export function formatFlexibleSearchMarkdown(result: FlexibleSearchResult): string {
  const lines = [
    `# Flexible hotel search: ${result.destination}, ${result.nights} nights`,
    "",
    `Scanned check-in dates from ${result.earliestCheckIn} to ${result.latestCheckIn} (${result.datesScanned} candidate dates).`,
    result.mode === "link_only"
      ? "_Mode: free link-only (no STAYAPI_KEY configured) — no live prices, one Booking.com link per date._"
      : "_Mode: priced (via StayAPI) — real live prices, sorted cheapest first._",
    "",
  ];

  if (!result.offers.length) {
    lines.push(
      "No results were found in this window.",
      result.datesSkipped.length
        ? `All ${result.datesSkipped.length} dates were skipped, e.g.: ${result.datesSkipped
            .slice(0, 3)
            .map((s) => `${s.date} (${s.reason})`)
            .join("; ")}`
        : "",
    );
    return lines.filter(Boolean).join("\n");
  }

  lines.push(`## ${result.mode === "priced" ? "Best offers (cheapest first)" : "Links by date"}`, "");
  result.offers.forEach((offer, i) =>
    lines.push(result.mode === "priced" ? formatPricedOfferLine(offer, i + 1) : formatLinkOnlyLine(offer, i + 1), ""),
  );

  if (result.truncated) {
    lines.push(`_Showing ${result.offers.length} results; more were found — increase max_results to see them._`, "");
  }
  if (result.datesSkipped.length) {
    lines.push(
      `_${result.datesSkipped.length} of ${result.datesScanned} candidate dates returned no results or errored._`,
      "",
    );
  }
  if (result.note) {
    lines.push(`_${result.note}_`);
  }
  return lines.join("\n");
}
