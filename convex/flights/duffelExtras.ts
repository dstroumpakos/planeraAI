"use node";

/**
 * Duffel Extras API - Baggage, Seats, and Policy handling
 * This module extends the core Duffel integration with support for:
 * - Fetching available baggage services
 * - Fetching seat maps and availability
 * - Extracting offer conditions (change/refund policies)
 */

const DUFFEL_API_BASE = "https://api.duffel.com";

function getDuffelConfig() {
  const token = process.env.DUFFEL_ACCESS_TOKEN;
  if (!token) throw new Error("DUFFEL_ACCESS_TOKEN not configured");
  return { accessToken: token };
}

function getHeaders(config: { accessToken: string }) {
  return {
    "Authorization": `Bearer ${config.accessToken}`,
    "Content-Type": "application/json",
    "Duffel-Version": "v2",
  };
}

// ============================================================================
// DUFFEL API RESPONSE TYPES
// ============================================================================

interface DuffelService {
  id: string;
  type: string;
  passenger_id: string;
  segment_ids?: string[];
  maximum_quantity?: number;
  total_amount?: string;
  total_currency?: string;
  metadata?: {
    type?: string;
    maximum_weight_kg?: string;
  };
}

interface DuffelBaggage {
  type: string;
  quantity?: number;
  weight?: string;
}

interface DuffelPassengerSegment {
  passenger_id: string;
  baggages?: DuffelBaggage[];
}

interface DuffelSegment {
  id: string;
  passengers?: DuffelPassengerSegment[];
}

interface DuffelSlice {
  segments?: DuffelSegment[];
}

interface DuffelConditionDetail {
  allowed: boolean;
  penalty_amount?: string;
  penalty_currency?: string;
}

interface DuffelConditions {
  change_before_departure?: DuffelConditionDetail;
  refund_before_departure?: DuffelConditionDetail;
}

interface DuffelOffer {
  id: string;
  conditions?: DuffelConditions;
  slices?: DuffelSlice[];
  available_services?: DuffelService[];
  passengers?: Array<{ id: string; age?: number }>;
  total_amount?: string;
  total_currency?: string;
}

interface DuffelSeatService {
  id: string;
  passenger_id: string;
  total_amount?: string;
  total_currency?: string;
}

interface DuffelSeatElement {
  type: string;
  designator?: string;
  name?: string;
  disclosures?: string[];
  available_services?: DuffelSeatService[];
}

interface DuffelSeatSection {
  elements?: DuffelSeatElement[];
}

interface DuffelSeatRow {
  sections?: DuffelSeatSection[];
}

interface DuffelSeatCabin {
  cabin_class: string;
  deck?: number;
  rows?: DuffelSeatRow[];
  wings?: {
    first_row_index: number;
    last_row_index: number;
  };
}

interface DuffelSeatMap {
  segment_id: string;
  slice_id: string;
  cabins?: DuffelSeatCabin[];
}

// ============================================================================
// TYPES
// ============================================================================

export interface BaggageService {
  id: string;
  passengerId: string;
  segmentIds: string[];
  type: "checked" | "carry_on";
  maxQuantity: number;
  priceCents: number;
  currency: string;
  weight?: {
    amount: number;
    unit: string;
  };
}

export interface IncludedBaggage {
  segmentId: string;
  passengerId: string;
  cabin?: {
    quantity: number;
    type?: string;
  };
  checked?: {
    quantity: number;
    weight?: {
      amount: number;
      unit: string;
    };
  };
}

export interface SeatMap {
  segmentId: string;
  sliceId: string;
  cabins: SeatCabin[];
}

export interface SeatCabin {
  cabinClass: string;
  deck: number;
  rows: SeatRow[];
  wings?: {
    firstRowIndex: number;
    lastRowIndex: number;
  };
}

export interface SeatRow {
  sections: SeatSection[];
}

export interface SeatSection {
  elements: SeatElement[];
}

export interface SeatElement {
  type: "seat" | "bassinet" | "empty" | "exit_row" | "lavatory" | "galley" | "closet" | "stairs";
  designator?: string;
  name?: string;
  disclosures?: string[];
  availableServices?: SeatService[];
}

export interface SeatService {
  id: string;
  passengerId: string;
  priceCents: number;
  currency: string;
}

export interface OfferConditions {
  changeBeforeDeparture?: {
    allowed: boolean;
    penaltyAmount?: string;
    penaltyCurrency?: string;
  };
  refundBeforeDeparture?: {
    allowed: boolean;
    penaltyAmount?: string;
    penaltyCurrency?: string;
  };
}

export interface OfferExtras {
  offerId: string;
  conditions: OfferConditions;
  includedBaggage: IncludedBaggage[];
  availableBaggageServices: BaggageService[];
  seatMapsAvailable: boolean;
}

// ============================================================================
// API FUNCTIONS
// ============================================================================

/**
 * Get complete offer details including conditions and included baggage
 */
export async function getOfferWithExtras(offerId: string): Promise<OfferExtras | null> {
  const config = getDuffelConfig();
  const headers = getHeaders(config);

  try {
    console.log(`🔍 Fetching offer extras for ${offerId}...`);
    
    // Fetch offer with return_available_services to get baggage options
    const response = await fetch(
      `${DUFFEL_API_BASE}/air/offers/${offerId}?return_available_services=true`,
      { method: "GET", headers }
    );

    if (!response.ok) {
      const errorData = await response.text();
      console.error(`Duffel Get Offer Error: ${response.status} - ${errorData}`);
      return null;
    }

    const data = await response.json();
    const offer: DuffelOffer = data.data;

    // DEBUG: Log what Duffel returns for available services
    console.log(`📦 Duffel available_services count: ${offer.available_services?.length || 0}`);
    if (offer.available_services && offer.available_services.length > 0) {
      console.log(`📦 Service types: ${offer.available_services.map((s: DuffelService) => s.type).join(', ')}`);
    } else {
      console.log(`⚠️ NO EXTRAS AVAILABLE - This is common in Duffel test mode!`);
      console.log(`   Test mode airlines often don't provide baggage/seat services.`);
    }

    // Extract conditions (change/refund policies)
    const conditions: OfferConditions = {
      changeBeforeDeparture: offer.conditions?.change_before_departure ? {
        allowed: offer.conditions.change_before_departure.allowed,
        penaltyAmount: offer.conditions.change_before_departure.penalty_amount,
        penaltyCurrency: offer.conditions.change_before_departure.penalty_currency,
      } : undefined,
      refundBeforeDeparture: offer.conditions?.refund_before_departure ? {
        allowed: offer.conditions.refund_before_departure.allowed,
        penaltyAmount: offer.conditions.refund_before_departure.penalty_amount,
        penaltyCurrency: offer.conditions.refund_before_departure.penalty_currency,
      } : undefined,
    };

    // Extract included baggage per passenger per segment
    const includedBaggage: IncludedBaggage[] = [];
    for (const slice of offer.slices || []) {
      for (const segment of slice.segments || []) {
        for (const passenger of segment.passengers || []) {
          const baggage: IncludedBaggage = {
            segmentId: segment.id,
            passengerId: passenger.passenger_id,
          };

          // Extract cabin baggage
          if (passenger.baggages) {
            const cabinBag = passenger.baggages.find((b: DuffelBaggage) => b.type === "carry_on");
            const checkedBag = passenger.baggages.find((b: DuffelBaggage) => b.type === "checked");

            if (cabinBag) {
              baggage.cabin = {
                quantity: cabinBag.quantity || 0,
                type: cabinBag.type,
              };
            }

            if (checkedBag) {
              baggage.checked = {
                quantity: checkedBag.quantity || 0,
                weight: checkedBag.weight ? {
                  amount: parseFloat(checkedBag.weight),
                  unit: "kg",
                } : undefined,
              };
            }
          }

          includedBaggage.push(baggage);
        }
      }
    }

    // Extract available baggage services
    const availableBaggageServices: BaggageService[] = [];
    for (const service of offer.available_services || []) {
      if (service.type === "baggage") {
        const metadata = service.metadata || {};
        availableBaggageServices.push({
          id: service.id,
          passengerId: service.passenger_id,
          segmentIds: service.segment_ids || [],
          type: (metadata.type as "checked" | "carry_on") || "checked",
          maxQuantity: service.maximum_quantity || 1,
          priceCents: Math.round(parseFloat(service.total_amount || "0") * 100),
          currency: service.total_currency || "EUR",
          weight: metadata.maximum_weight_kg ? {
            amount: parseFloat(metadata.maximum_weight_kg),
            unit: "kg",
          } : undefined,
        });
      }
    }

    // Check if seat selection is available
    const seatMapsAvailable = offer.available_services?.some(
      (s: DuffelService) => s.type === "seat"
    ) || false;

    console.log(`✅ Offer extras fetched:`);
    console.log(`   - Conditions: change=${conditions.changeBeforeDeparture?.allowed}, refund=${conditions.refundBeforeDeparture?.allowed}`);
    console.log(`   - Included baggage entries: ${includedBaggage.length}`);
    console.log(`   - Available bag services: ${availableBaggageServices.length}`);
    console.log(`   - Seat maps available: ${seatMapsAvailable}`);

    return {
      offerId,
      conditions,
      includedBaggage,
      availableBaggageServices,
      seatMapsAvailable,
    };
  } catch (error) {
    console.error("Get Offer Extras Error:", error);
    return null;
  }
}

/**
 * Get seat maps for an offer
 * Returns seat availability and pricing for each segment
 */
export async function getSeatMaps(offerId: string): Promise<SeatMap[] | null> {
  const config = getDuffelConfig();
  const headers = getHeaders(config);

  try {
    console.log(`🪑 Fetching seat maps for offer ${offerId}...`);

    const response = await fetch(
      `${DUFFEL_API_BASE}/air/seat_maps?offer_id=${offerId}`,
      { method: "GET", headers }
    );

    if (!response.ok) {
      const errorData = await response.text();
      // 404 or specific errors mean seat maps not available - this is expected for some offers
      if (response.status === 404 || errorData.includes("not_found")) {
        console.log(`ℹ️ Seat maps not available for this offer`);
        return null;
      }
      console.error(`Duffel Seat Maps Error: ${response.status} - ${errorData}`);
      return null;
    }

    const data = await response.json();
    const seatMaps: SeatMap[] = [];

    for (const seatMap of (data.data as DuffelSeatMap[]) || []) {
      const cabins: SeatCabin[] = [];

      for (const cabin of seatMap.cabins || []) {
        const rows: SeatRow[] = [];

        for (const row of cabin.rows || []) {
          const sections: SeatSection[] = [];

          for (const section of row.sections || []) {
            const elements: SeatElement[] = [];

            for (const element of section.elements || []) {
              const seatElement: SeatElement = {
                type: element.type as SeatElement["type"],
                designator: element.designator,
                name: element.name,
                disclosures: element.disclosures,
              };

              // Extract available seat services (pricing)
              if (element.available_services && element.available_services.length > 0) {
                seatElement.availableServices = element.available_services.map((s: DuffelSeatService) => ({
                  id: s.id,
                  passengerId: s.passenger_id,
                  priceCents: Math.round(parseFloat(s.total_amount || "0") * 100),
                  currency: s.total_currency || "EUR",
                }));
              }

              elements.push(seatElement);
            }

            sections.push({ elements });
          }

          rows.push({ sections });
        }

        cabins.push({
          cabinClass: cabin.cabin_class,
          deck: cabin.deck || 1,
          rows,
          wings: cabin.wings ? {
            firstRowIndex: cabin.wings.first_row_index,
            lastRowIndex: cabin.wings.last_row_index,
          } : undefined,
        });
      }

      seatMaps.push({
        segmentId: seatMap.segment_id,
        sliceId: seatMap.slice_id,
        cabins,
      });
    }

    console.log(`✅ Fetched ${seatMaps.length} seat maps`);
    return seatMaps;
  } catch (error) {
    console.error("Get Seat Maps Error:", error);
    return null;
  }
}

/**
 * Create an order with selected services (bags and seats)
 * This extends the base createOrder to include service selections
 */
export async function createOrderWithServices(params: {
  offerId: string;
  passengers: Array<{
    id: string;
    given_name: string;
    family_name: string;
    born_on: string;
    gender: "m" | "f";
    email: string;
    phone_number: string;
    title: "mr" | "ms" | "mrs" | "miss" | "dr";
    passport_number?: string;
    passport_issuing_country?: string;
    passport_expiry_date?: string;
  }>;
  selectedServices?: string[]; // Array of service IDs (bags and seats)
  paymentIntentId?: string;
  metadata?: Record<string, string>;
}) {
  const config = getDuffelConfig();
  const headers = getHeaders(config);

  // First get the offer to know the amount and passenger details
  const offerResponse = await fetch(
    `${DUFFEL_API_BASE}/air/offers/${params.offerId}`,
    { method: "GET", headers }
  );

  if (!offerResponse.ok) {
    throw new Error("Offer not found or expired");
  }

  const offerData = await offerResponse.json();
  const offer: DuffelOffer = offerData.data;

  // Build payments array
  const payments = params.paymentIntentId
    ? [{ type: "payment_intent", payment_intent_id: params.paymentIntentId }]
    : [{ type: "balance", currency: offer.total_currency || "GBP", amount: offer.total_amount }];

  // Define passenger data type
  interface PassengerData {
    id: string;
    given_name: string;
    family_name: string;
    born_on: string;
    gender: "m" | "f";
    email: string;
    phone_number: string;
    title: "mr" | "ms" | "mrs" | "miss" | "dr";
    age: number;
    identity_documents?: Array<{
      type: string;
      unique_identifier: string;
      issuing_country_code: string;
      expires_on: string;
    }>;
  }

  // Map passengers with ages from offer
  const offerPassengers = offer.passengers || [];
  const passengersWithAge: PassengerData[] = params.passengers.map((p, index) => {
    const offerPassenger = offerPassengers[index];
    const passengerData: PassengerData = {
      id: offerPassenger?.id || p.id,
      given_name: p.given_name,
      family_name: p.family_name,
      born_on: p.born_on,
      gender: p.gender,
      email: p.email,
      phone_number: p.phone_number,
      title: p.title,
      age: offerPassenger?.age || 30,
    };

    if (p.passport_number && p.passport_issuing_country && p.passport_expiry_date) {
      passengerData.identity_documents = [{
        type: "passport",
        unique_identifier: p.passport_number,
        issuing_country_code: p.passport_issuing_country,
        expires_on: p.passport_expiry_date,
      }];
    }

    return passengerData;
  });

  // Build request payload
  interface OrderPayload {
    data: {
      type: string;
      selected_offers: string[];
      passengers: PassengerData[];
      payments: Array<{ type: string; payment_intent_id?: string; currency?: string; amount?: string }>;
      metadata: Record<string, string>;
      services?: Array<{ id: string; quantity: number }>;
    };
  }

  const payload: OrderPayload = {
    data: {
      type: "instant",
      selected_offers: [params.offerId],
      passengers: passengersWithAge,
      payments,
      metadata: params.metadata || {},
    },
  };

  // Add selected services if any
  if (params.selectedServices && params.selectedServices.length > 0) {
    payload.data.services = params.selectedServices.map(id => ({
      id,
      quantity: 1,
    }));
  }

  console.log(`📝 Creating Duffel Order with services...`);
  console.log(`   - Offer: ${params.offerId}`);
  console.log(`   - Passengers: ${passengersWithAge.length}`);
  console.log(`   - Services: ${params.selectedServices?.length || 0}`);

  const response = await fetch(`${DUFFEL_API_BASE}/air/orders`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorData = await response.text();
    console.error(`Duffel Create Order Error: ${response.status} - ${errorData}`);
    throw new Error(`Failed to create order: ${response.status} - ${errorData}`);
  }

  const data = await response.json();
  console.log(`✅ Order created: ${data.data.id}, Booking Ref: ${data.data.booking_reference}`);

  return {
    id: data.data.id,
    bookingReference: data.data.booking_reference,
    status: data.data.status,
    totalAmount: parseFloat(data.data.total_amount),
    currency: data.data.total_currency,
    passengers: data.data.passengers,
    slices: data.data.slices,
    services: data.data.services,
    createdAt: data.data.created_at,
  };
}

/**
 * Format policy conditions for display
 */
export function formatConditionsForDisplay(conditions: OfferConditions): {
  canChange: boolean;
  canRefund: boolean;
  changePolicy: string;
  refundPolicy: string;
} {
  const canChange = conditions.changeBeforeDeparture?.allowed ?? false;
  const canRefund = conditions.refundBeforeDeparture?.allowed ?? false;

  let changePolicy = "Changes not allowed";
  if (canChange) {
    if (conditions.changeBeforeDeparture?.penaltyAmount) {
      const amount = conditions.changeBeforeDeparture.penaltyAmount;
      const currency = conditions.changeBeforeDeparture.penaltyCurrency || "EUR";
      changePolicy = `Changes allowed with ${currency} ${amount} fee`;
    } else {
      changePolicy = "Free changes allowed";
    }
  }

  let refundPolicy = "Non-refundable";
  if (canRefund) {
    if (conditions.refundBeforeDeparture?.penaltyAmount) {
      const amount = conditions.refundBeforeDeparture.penaltyAmount;
      const currency = conditions.refundBeforeDeparture.penaltyCurrency || "EUR";
      refundPolicy = `Refundable with ${currency} ${amount} fee`;
    } else {
      refundPolicy = "Fully refundable";
    }
  }

  return { canChange, canRefund, changePolicy, refundPolicy };
}

/**
 * Calculate total extras price from selections
 */
export function calculateExtrasTotal(
  selectedBags: Array<{ priceCents: number; quantity: number }>,
  selectedSeats: Array<{ priceCents: number }>
): number {
  const bagsTotal = selectedBags.reduce((sum, bag) => sum + (bag.priceCents * bag.quantity), 0);
  const seatsTotal = selectedSeats.reduce((sum, seat) => sum + seat.priceCents, 0);
  return bagsTotal + seatsTotal;
}
