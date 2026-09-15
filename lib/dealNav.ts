/**
 * Route params for `/deal-trip` from a Low-Fare Radar deal document.
 *
 * The deal-trip screen reads every field back out of the URL (it has no
 * query of its own), so this is the one place that knows the mapping — the
 * home radar, the watched-fares row and notification taps all build the
 * same params from it.
 */
export function dealTripParams(deal: any): Record<string, string> {
    return {
        dealId: deal._id,
        origin: deal.origin,
        originCity: deal.originCity,
        destination: deal.destination,
        destinationCity: deal.destinationCity,
        airline: deal.airline,
        outboundDate: deal.outboundDate,
        outboundDeparture: deal.outboundDeparture,
        outboundArrival: deal.outboundArrival,
        returnDate: deal.returnDate || "",
        returnDeparture: deal.returnDeparture || "",
        returnArrival: deal.returnArrival || "",
        returnAirline: deal.returnAirline || "",
        price: String(deal.price),
        totalPrice: deal.totalPrice ? String(deal.totalPrice) : "",
        currency: deal.currency,
        outboundStops: String(deal.outboundStops ?? 0),
        returnStops: String(deal.returnStops ?? 0),
        outboundSegments: deal.outboundSegments ? JSON.stringify(deal.outboundSegments) : "",
        returnSegments: deal.returnSegments ? JSON.stringify(deal.returnSegments) : "",
    };
}
