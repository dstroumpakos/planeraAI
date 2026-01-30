"use node";

/**
 * Fallback flight generation when Duffel is unavailable
 * Uses AI-generated realistic flight data based on route and preferences
 */

// Generate realistic flight data using AI and real airline routes (fallback when Duffel unavailable)
export async function generateRealisticFlights(
    origin: string,
    originCode: string,
    destination: string,
    destCode: string,
    departureDate: string,
    returnDate: string,
    adults: number,
    preferredFlightTime: string = "any"
) {
    console.log("🤖 Generating realistic flight data with AI...");
    console.log(`   Preferred time: ${preferredFlightTime}`);
    
    // Get realistic airlines for this route
    const airlines = getRealisticAirlinesForRoute(originCode, destCode);
    
    // Calculate realistic flight duration based on distance
    const duration = calculateFlightDuration(originCode, destCode);
    
    // Define time slots based on preference
    const timeSlots = [
        { name: "morning", departure: "06:30 AM", label: "Early Morning" },
        { name: "morning", departure: "09:15 AM", label: "Morning" },
        { name: "afternoon", departure: "13:45 PM", label: "Afternoon" },
        { name: "evening", departure: "18:30 PM", label: "Evening" },
        { name: "night", departure: "22:15 PM", label: "Night" },
    ];
    
    // Calculate base price
    const basePrice = calculateRealisticPrice(originCode, destCode);
    
    // Generate a booking URL (Skyscanner deep link)
    const depDateStr = departureDate.slice(2).replace(/-/g, '');
    const retDateStr = returnDate.slice(2).replace(/-/g, '');
    const bookingUrl = `https://www.skyscanner.com/transport/flights/${originCode}/${destCode}/${depDateStr}/${retDateStr}`;

    // Generate multiple flight options
    const flightOptions = [];
    
    // Generate 4 different flight options with varying times and prices
    const selectedSlots = preferredFlightTime === "any" 
        ? [timeSlots[1], timeSlots[2], timeSlots[3], timeSlots[0]] // Morning, Afternoon, Evening, Early
        : [
            timeSlots.find(s => s.name === preferredFlightTime) || timeSlots[1],
            ...timeSlots.filter(s => s.name !== preferredFlightTime).slice(0, 3)
        ];
    
    let bestPrice = Infinity;
    
    // First pass to find best price
    for (let i = 0; i < 4; i++) {
        // Price varies: early morning and night are cheaper, afternoon is most expensive
        const priceMultiplier = i === 0 ? 1.0 : i === 1 ? 1.15 : i === 2 ? 1.25 : 0.9;
        const price = Math.round(basePrice * priceMultiplier);
        if (price < bestPrice) bestPrice = price;
    }
    
    for (let i = 0; i < 4; i++) {
        const slot = selectedSlots[i] || timeSlots[i];
        const airline = airlines[i % airlines.length];
        
        // Price varies: early morning and night are cheaper, afternoon is most expensive
        const priceMultiplier = i === 0 ? 1.0 : i === 1 ? 1.15 : i === 2 ? 1.25 : 0.9;
        const price = Math.round(basePrice * priceMultiplier);
        
        const outboundDeparture = slot.departure;
        const outboundArrival = addHoursToTime(outboundDeparture, duration);
        
        // Return flight times (different from outbound)
        const returnSlot = timeSlots[(i + 2) % timeSlots.length];
        const returnDeparture = returnSlot.departure;
        const returnArrival = addHoursToTime(returnDeparture, duration);
        
        flightOptions.push({
            id: i + 1,
            outbound: {
                airline: airline.name,
                airlineCode: airline.code,
                flightNumber: `${airline.code}${Math.floor(Math.random() * 9000) + 1000}`,
                duration: `${Math.floor(duration)}h ${Math.round((duration % 1) * 60)}m`,
                departure: outboundDeparture,
                arrival: outboundArrival,
                stops: i === 3 ? 1 : 0, // Last option has 1 stop (cheaper)
                departureTime: `${departureDate}T${convertTo24Hour(outboundDeparture)}:00`,
            },
            return: {
                airline: airline.name,
                airlineCode: airline.code,
                flightNumber: `${airline.code}${Math.floor(Math.random() * 9000) + 1000}`,
                duration: `${Math.floor(duration)}h ${Math.round((duration % 1) * 60)}m`,
                departure: returnDeparture,
                arrival: returnArrival,
                stops: i === 3 ? 1 : 0,
                departureTime: `${returnDate}T${convertTo24Hour(returnDeparture)}:00`,
            },
            luggage: i < 2 ? "1 checked bag included" : "Cabin bag only",
            cabinBaggage: "1 cabin bag (8kg) included",
            checkedBaggageIncluded: i < 2, // First 2 options include checked bag
            checkedBaggagePrice: i < 2 ? 0 : (25 + Math.floor(Math.random() * 20)), // €25-45 if not included
            pricePerPerson: price,
            totalPrice: price * adults,
            currency: "EUR",
            isBestPrice: price === bestPrice,
            timeCategory: slot.name,
            matchesPreference: preferredFlightTime === "any" || slot.name === preferredFlightTime,
            label: slot.label,
            bookingUrl,
        });
    }
    
    // Sort by preference match first, then by price
    flightOptions.sort((a, b) => {
        if (a.matchesPreference && !b.matchesPreference) return -1;
        if (!a.matchesPreference && b.matchesPreference) return 1;
        return a.pricePerPerson - b.pricePerPerson;
    });
    
    return {
        options: flightOptions,
        bestPrice,
        preferredTime: preferredFlightTime,
        dataSource: "ai-generated",
    };
}

// Helper to convert 12-hour time to 24-hour format
export function convertTo24Hour(time12h: string): string {
    const [time, period] = time12h.split(' ');
    const [hoursStr, minutesStr] = time.split(':');
    let hours = Number(hoursStr);
    const minutes = Number(minutesStr);
    
    if (period === 'PM' && hours !== 12) hours += 12;
    if (period === 'AM' && hours === 12) hours = 0;
    
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

// Get realistic airlines that operate on a specific route
export function getRealisticAirlinesForRoute(originCode: string, destCode: string): Array<{ code: string; name: string }> {
    // Map of major airlines by region
    const airlinesByRegion: Record<string, Array<{ code: string; name: string }>> = {
        EU: [
            { code: "LH", name: "Lufthansa" },
            { code: "AF", name: "Air France" },
            { code: "BA", name: "British Airways" },
            { code: "IB", name: "Iberia" },
            { code: "KL", name: "KLM" },
            { code: "SQ", name: "Singapore Airlines" },
            { code: "EK", name: "Emirates" },
        ],
        US: [
            { code: "AA", name: "American Airlines" },
            { code: "UA", name: "United Airlines" },
            { code: "DL", name: "Delta Air Lines" },
            { code: "SW", name: "Southwest Airlines" },
        ],
        ASIA: [
            { code: "SQ", name: "Singapore Airlines" },
            { code: "CX", name: "Cathay Pacific" },
            { code: "NH", name: "All Nippon Airways" },
            { code: "CA", name: "Air China" },
        ],
    };

    // Determine region based on airport codes
    const euCodes = ["LHR", "CDG", "AMS", "FCO", "MAD", "BCN", "VIE", "ZRH", "MUC", "ORY"];
    const usCodes = ["JFK", "LAX", "ORD", "DFW", "ATL", "MIA", "SFO", "BOS"];
    const asiaCodes = ["SIN", "HKG", "NRT", "HND", "PVG", "PEK", "BKK", "ICN"];

    let region = "EU";
    if (usCodes.includes(originCode) || usCodes.includes(destCode)) region = "US";
    if (asiaCodes.includes(originCode) || asiaCodes.includes(destCode)) region = "ASIA";
    if (euCodes.includes(originCode) || euCodes.includes(destCode)) region = "EU";

    return airlinesByRegion[region] || airlinesByRegion["EU"];
}

// Calculate realistic flight duration based on airport codes (simplified)
export function calculateFlightDuration(originCode: string, destCode: string): number {
    // Approximate flight times between major cities (in hours)
    const distances: Record<string, Record<string, number>> = {
        LHR: { CDG: 1.25, AMS: 1.25, FCO: 2.5, MAD: 2.5, BCN: 2.5, VIE: 2.5, ZRH: 1.5, MUC: 2, ORY: 1.25 },
        CDG: { LHR: 1.25, AMS: 1.25, FCO: 2.5, MAD: 2.5, BCN: 2.5, VIE: 2.5, ZRH: 1.5, MUC: 2, ORY: 0.5 },
        AMS: { LHR: 1.25, CDG: 1.25, FCO: 2.5, MAD: 2.5, BCN: 2.5, VIE: 2.5, ZRH: 1.5, MUC: 2 },
        FCO: { LHR: 2.5, CDG: 2.5, AMS: 2.5, MAD: 3, BCN: 2.5, VIE: 2, ZRH: 2, MUC: 2 },
        MAD: { LHR: 2.5, CDG: 2.5, AMS: 2.5, FCO: 3, BCN: 2, VIE: 3, ZRH: 2.5, MUC: 2.5 },
        BCN: { LHR: 2.5, CDG: 2.5, AMS: 2.5, FCO: 2.5, MAD: 2, VIE: 3, ZRH: 2.5, MUC: 2.5 },
        VIE: { LHR: 2.5, CDG: 2.5, AMS: 2.5, FCO: 2, MAD: 3, BCN: 3, ZRH: 1.5, MUC: 1.5 },
        ZRH: { LHR: 1.5, CDG: 1.5, AMS: 1.5, FCO: 2, MAD: 2.5, BCN: 2.5, VIE: 1.5, MUC: 1 },
        MUC: { LHR: 2, CDG: 2, AMS: 2, FCO: 2, MAD: 2.5, BCN: 2.5, VIE: 1.5, ZRH: 1 },
    };

    // Default to 2.5 hours if route not found
    return distances[originCode]?.[destCode] || 2.5;
}

// Calculate realistic pricing based on route
export function calculateRealisticPrice(originCode: string, destCode: string): number {
    // Base prices for different route types (in EUR)
    const shortHaul = 80;  // < 2 hours
    const mediumHaul = 150; // 2-4 hours
    const longHaul = 400;   // > 4 hours

    const duration = calculateFlightDuration(originCode, destCode);

    if (duration < 2) return shortHaul + Math.random() * 40;
    if (duration < 4) return mediumHaul + Math.random() * 100;
    return longHaul + Math.random() * 200;
}

// Helper to add hours to a time string
export function addHoursToTime(time: string, hours: number): string {
    const [timePart, period] = time.split(' ');
    let [h, m] = timePart.split(':').map(Number);

    // Convert to 24-hour format
    if (period === 'PM' && h !== 12) h += 12;
    if (period === 'AM' && h === 12) h = 0;

    // Add hours
    h += Math.floor(hours);
    m += Math.round((hours % 1) * 60);

    // Handle minute overflow
    if (m >= 60) {
        h += Math.floor(m / 60);
        m = m % 60;
    }

    // Handle hour overflow
    h = h % 24;

    // Convert back to 12-hour format
    const newPeriod = h >= 12 ? 'PM' : 'AM';
    const newH = h % 12 || 12;

    return `${String(newH).padStart(2, '0')}:${String(m).padStart(2, '0')} ${newPeriod}`;
}
