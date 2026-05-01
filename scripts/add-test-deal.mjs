// Adds a test multi-segment deal to the dev Convex deployment.
// Run: node scripts/add-test-deal.mjs
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";

const CONVEX_URL = "https://giddy-sandpiper-781.convex.cloud";
const ADMIN_KEY = "17852012Dd!!/";

const client = new ConvexHttpClient(CONVEX_URL);

const deal = {
  adminKey: ADMIN_KEY,
  origin: "ATH",
  originCity: "Athens",
  destination: "FRA",
  destinationCity: "Frankfurt",
  airline: "Air Serbia",
  flightNumber: "JU533",
  // Outbound: ATH → BEG → FRA (1 stop)
  outboundDate: "2026-10-19",
  outboundDeparture: "16:30",
  outboundArrival: "09:00",
  outboundDuration: "16h 30m",
  outboundStops: 1,
  outboundSegments: [
    {
      airline: "Air Serbia",
      flightNumber: "JU533",
      departureAirport: "ATH",
      departureTime: "16:30",
      arrivalAirport: "BEG",
      arrivalTime: "17:10",
      duration: "1h 40m",
    },
    {
      airline: "Air Serbia",
      flightNumber: "JU350",
      departureAirport: "BEG",
      departureTime: "06:55",
      arrivalAirport: "FRA",
      arrivalTime: "09:00",
      duration: "2h 5m",
    },
  ],
  // Return: FRA → ATH direct
  returnDate: "2026-10-21",
  returnDeparture: "14:25",
  returnArrival: "18:10",
  returnDuration: "2h 45m",
  returnAirline: "SKY express",
  returnFlightNumber: "GQ861",
  returnStops: 0,
  price: 143.5,
  totalPrice: 287,
  originalPrice: 320,
  currency: "EUR",
  cabinBaggage: "1x 8kg",
  checkedBaggage: "No checked baggage",
  isRecommended: false,
  bookingUrl: "https://www.airserbia.com",
  notes: "Multi-segment outbound test deal",
  travelMonthFrom: "2026-10",
  travelMonthTo: "2026-10",
};

try {
  const id = await client.mutation(api.lowFareRadar.create, deal);
  console.log("✓ Deal created:", id);
} catch (err) {
  console.error("✗ Failed:", err.message || err);
  process.exit(1);
}
