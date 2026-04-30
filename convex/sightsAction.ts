"use node";

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import OpenAI from "openai";

// Internal action to generate sights with AI
export const generateSightsAction = internalAction({
    args: {
        tripId: v.id("trips"),
        destination: v.string(),
        language: v.optional(v.string()),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        const { tripId, destination, language } = args;
        
        // Language mapping for the AI prompt
        const LANGUAGE_NAMES: Record<string, string> = {
            en: "English",
            el: "Greek",
            es: "Spanish",
            fr: "French",
            de: "German",
            ar: "Arabic",
        };
        const contentLanguage = language || "en";
        const languageName = LANGUAGE_NAMES[contentLanguage] || "English";
        const isNonEnglish = contentLanguage !== "en";
        
        // Include language in cache key so each language gets its own cached sights
        const destinationKey = isNonEnglish 
            ? normalizeDestinationKey(destination) + `-${contentLanguage}`
            : normalizeDestinationKey(destination);
        
        console.log(`🏛️ Generating sights for: ${destination}`);
        
        // Check if we have a recent cached full set for this destination
        const existingSights = await ctx.runMutation(internal.sights.getCachedSights, { destinationKey });
        if (existingSights && existingSights.sights.length >= 15) {
            console.log(`Using cached sights for destination (${existingSights.sights.length} sights)`);
            // Link to this trip
            await ctx.runMutation(internal.sights.saveSights, {
                tripId,
                destinationKey,
                sights: existingSights.sights,
            });
            return null;
        }
        
        // Generate with OpenAI
        const openaiKey = process.env.OPENAI_API_KEY;
        if (!openaiKey) {
            console.warn("OpenAI API key not configured, using fallback sights");
            const fallbackSights = getFallbackSights(destination);
            await ctx.runMutation(internal.sights.saveSights, {
                tripId,
                destinationKey,
                sights: fallbackSights,
            });
            return null;
        }
        
        try {
            const openai = new OpenAI({ apiKey: openaiKey });
            
            const languageInstruction = isNonEnglish 
                ? `\n\n**LANGUAGE REQUIREMENT:** ALL text content (name, shortDescription, neighborhoodOrArea, bestTimeToVisit) MUST be written in ${languageName}. JSON keys/field names stay in English. Only the string VALUES should be in ${languageName}.`
                : '';
            
            const prompt = `Generate a comprehensive list of ALL the must-see sights, attractions, and noteworthy places for ${destination}. Include as many as you can — aim for 20 to 30 sights.${languageInstruction}
            
For each sight, provide:
1. name: The official name of the sight${isNonEnglish ? ` (in ${languageName})` : ''}
2. shortDescription: 1-2 sentences describing what makes it special${isNonEnglish ? ` (in ${languageName})` : ''}
3. neighborhoodOrArea: The neighborhood or area where it's located (if applicable)${isNonEnglish ? ` (in ${languageName})` : ''}
4. bestTimeToVisit: Best time of day or season to visit${isNonEnglish ? ` (in ${languageName})` : ''}
5. estDurationHours: Estimated time to spend there (e.g., "2-3" or "1-2")
6. latitude: The exact latitude of the sight (decimal number, e.g. 48.8584)
7. longitude: The exact longitude of the sight (decimal number, e.g. 2.2945)

IMPORTANT:
- Return as many sights as possible (20-30 minimum)
- Start with the most iconic, then include increasingly local / hidden gems
- Choose diverse sights (cultural, historical, nature, neighborhoods, viewpoints, parks, markets, streets, bridges, gardens)
- Include famous landmarks, lesser-known local favorites, hidden gems, scenic walks, and unique experiences
- Do NOT include any booking URLs, prices, or "tickets available" language
- These are informational recommendations only

Return ONLY valid JSON in this exact format:
{
  "sights": [
    {
      "name": "Sight Name",
      "shortDescription": "Brief description of the sight",
      "neighborhoodOrArea": "Neighborhood name",
      "bestTimeToVisit": "Morning/Sunset/etc",
      "estDurationHours": "2-3",
      "latitude": 48.8584,
      "longitude": 2.2945
    }
  ]
}

IMPORTANT: The latitude and longitude MUST be the exact coordinates of each sight's real-world location. Do NOT approximate or use neighborhood centers — use the precise coordinates of the actual building, monument, or entrance.`;

            const completion = await openai.chat.completions.create({
                messages: [
                    { role: "system", content: `You are a travel expert providing informational recommendations. Return only valid JSON.${isNonEnglish ? ` All text content in the response must be written in ${languageName}. Keep JSON field names in English.` : ''}` },
                    { role: "user", content: prompt },
                ],
                model: "gpt-5.5",
                response_format: { type: "json_object" },
            });
            
            const content = completion.choices[0].message.content;
            if (!content) {
                throw new Error("OpenAI returned empty response");
            }
            
            const data = JSON.parse(content);
            const sights = data.sights || [];
            
            if (sights.length === 0) {
                throw new Error("OpenAI returned no sights");
            }
            
            console.log(`✅ Generated ${sights.length} sights for ${destination}`);
            
            // Save all the sights (no limit)
            await ctx.runMutation(internal.sights.saveSights, {
                tripId,
                destinationKey,
                sights,
            });
            
        } catch (error) {
            console.error("Error generating sights:", error);
            // Use fallback
            const fallbackSights = getFallbackSights(destination);
            await ctx.runMutation(internal.sights.saveSights, {
                tripId,
                destinationKey,
                sights: fallbackSights,
            });
        }
        
        return null;
    },
});

// Helper to normalize destination to a cache key
function normalizeDestinationKey(destination: string): string {
    return destination
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
}

// Fallback sights for common destinations
function getFallbackSights(destination: string): Array<{
    name: string;
    shortDescription: string;
    neighborhoodOrArea?: string;
    bestTimeToVisit?: string;
    estDurationHours?: string;
    latitude?: number;
    longitude?: number;
}> {
    const destLower = destination.toLowerCase();
    
    const fallbacks: Record<string, Array<{
        name: string;
        shortDescription: string;
        neighborhoodOrArea?: string;
        bestTimeToVisit?: string;
        estDurationHours?: string;
        latitude?: number;
        longitude?: number;
    }>> = {
        "paris": [
            { name: "Eiffel Tower", shortDescription: "Iconic iron lattice tower offering panoramic city views from its observation decks.", neighborhoodOrArea: "7th arrondissement", bestTimeToVisit: "Sunset", estDurationHours: "2-3", latitude: 48.8584, longitude: 2.2945 },
            { name: "Louvre Museum", shortDescription: "World's largest art museum, home to the Mona Lisa and countless masterpieces.", neighborhoodOrArea: "1st arrondissement", bestTimeToVisit: "Morning", estDurationHours: "3-4", latitude: 48.8606, longitude: 2.3376 },
            { name: "Montmartre & Sacré-Cœur", shortDescription: "Bohemian hilltop neighborhood with stunning basilica and artist heritage.", neighborhoodOrArea: "18th arrondissement", bestTimeToVisit: "Early morning", estDurationHours: "2-3", latitude: 48.8867, longitude: 2.3431 },
            { name: "Notre-Dame Cathedral", shortDescription: "Medieval Gothic cathedral, a masterpiece of French architecture (view from outside during restoration).", neighborhoodOrArea: "Île de la Cité", bestTimeToVisit: "Afternoon", estDurationHours: "1", latitude: 48.8530, longitude: 2.3499 },
            { name: "Le Marais", shortDescription: "Historic district with medieval streets, trendy boutiques, and vibrant café culture.", neighborhoodOrArea: "3rd & 4th arrondissements", bestTimeToVisit: "Afternoon", estDurationHours: "2-3", latitude: 48.8593, longitude: 2.3622 },
            { name: "Musée d'Orsay", shortDescription: "Impressionist art museum housed in a stunning Beaux-Arts railway station.", neighborhoodOrArea: "7th arrondissement", bestTimeToVisit: "Afternoon", estDurationHours: "2-3", latitude: 48.8600, longitude: 2.3266 },
            { name: "Jardin du Luxembourg", shortDescription: "Elegant palace gardens beloved by Parisians for strolling, sailing toy boats, and people-watching.", neighborhoodOrArea: "6th arrondissement", bestTimeToVisit: "Morning", estDurationHours: "1-2", latitude: 48.8462, longitude: 2.3372 },
            { name: "Palais Royal", shortDescription: "Hidden gem with striped columns, serene gardens, and a quiet escape from the bustle.", neighborhoodOrArea: "1st arrondissement", bestTimeToVisit: "Morning", estDurationHours: "1", latitude: 48.8638, longitude: 2.3375 },
            { name: "Canal Saint-Martin", shortDescription: "Trendy canal-side neighborhood with iron footbridges, quirky boutiques, and local cafés.", neighborhoodOrArea: "10th arrondissement", bestTimeToVisit: "Afternoon", estDurationHours: "1-2", latitude: 48.8711, longitude: 2.3653 },
            { name: "Père Lachaise Cemetery", shortDescription: "Hauntingly beautiful cemetery and open-air museum with graves of Jim Morrison, Oscar Wilde, and Chopin.", neighborhoodOrArea: "20th arrondissement", bestTimeToVisit: "Morning", estDurationHours: "1-2", latitude: 48.8613, longitude: 2.3933 },
        ],
        "rome": [
            { name: "Colosseum", shortDescription: "Ancient Roman amphitheater, once hosting gladiatorial contests for 50,000 spectators.", neighborhoodOrArea: "Centro Storico", bestTimeToVisit: "Early morning", estDurationHours: "2-3", latitude: 41.8902, longitude: 12.4922 },
            { name: "Vatican City & St. Peter's Basilica", shortDescription: "World's smallest country housing priceless art and the stunning Renaissance basilica.", neighborhoodOrArea: "Vatican", bestTimeToVisit: "Morning", estDurationHours: "3-4", latitude: 41.9022, longitude: 12.4539 },
            { name: "Roman Forum", shortDescription: "Ancient ruins of Rome's political and social center for centuries.", neighborhoodOrArea: "Centro Storico", bestTimeToVisit: "Morning", estDurationHours: "2", latitude: 41.8925, longitude: 12.4853 },
            { name: "Trevi Fountain", shortDescription: "Baroque masterpiece where visitors toss coins to ensure a return to Rome.", neighborhoodOrArea: "Trevi", bestTimeToVisit: "Early morning or late evening", estDurationHours: "0.5-1", latitude: 41.9009, longitude: 12.4833 },
            { name: "Trastevere", shortDescription: "Charming neighborhood with cobblestone streets, trattorias, and authentic Roman atmosphere.", neighborhoodOrArea: "Trastevere", bestTimeToVisit: "Evening", estDurationHours: "2-3", latitude: 41.8895, longitude: 12.4700 },
            { name: "Pantheon", shortDescription: "Remarkably preserved ancient temple with the world's largest unreinforced concrete dome.", neighborhoodOrArea: "Centro Storico", bestTimeToVisit: "Morning", estDurationHours: "1", latitude: 41.8986, longitude: 12.4769 },
            { name: "Borghese Gallery & Gardens", shortDescription: "Stunning art collection by Bernini and Caravaggio set in Rome's most beautiful park.", neighborhoodOrArea: "Villa Borghese", bestTimeToVisit: "Morning", estDurationHours: "2-3", latitude: 41.9142, longitude: 12.4921 },
            { name: "Piazza Navona", shortDescription: "Lively baroque square built on an ancient stadium, featuring Bernini's Fountain of the Four Rivers.", neighborhoodOrArea: "Centro Storico", bestTimeToVisit: "Evening", estDurationHours: "1", latitude: 41.8992, longitude: 12.4731 },
            { name: "Aventine Hill & Orange Garden", shortDescription: "Peaceful hilltop with the famous keyhole view of St. Peter's dome and fragrant orange trees.", neighborhoodOrArea: "Aventino", bestTimeToVisit: "Sunset", estDurationHours: "1", latitude: 41.8835, longitude: 12.4794 },
            { name: "Testaccio", shortDescription: "Rome's authentic working-class neighborhood known for its food market and genuine local trattorias.", neighborhoodOrArea: "Testaccio", bestTimeToVisit: "Afternoon", estDurationHours: "2", latitude: 41.8764, longitude: 12.4756 },
        ],
        "barcelona": [
            { name: "Sagrada Familia", shortDescription: "Gaudí's unfinished masterpiece basilica with stunning organic architecture and light-filled interior.", neighborhoodOrArea: "Eixample", bestTimeToVisit: "Morning", estDurationHours: "2", latitude: 41.4036, longitude: 2.1744 },
            { name: "Park Güell", shortDescription: "Whimsical public park featuring Gaudí's colorful mosaic work and city views.", neighborhoodOrArea: "Gràcia", bestTimeToVisit: "Early morning", estDurationHours: "2", latitude: 41.4145, longitude: 2.1527 },
            { name: "La Rambla & Gothic Quarter", shortDescription: "Famous tree-lined pedestrian street leading to medieval narrow alleyways.", neighborhoodOrArea: "Ciutat Vella", bestTimeToVisit: "Morning or evening", estDurationHours: "2-3", latitude: 41.3809, longitude: 2.1734 },
            { name: "Casa Batlló", shortDescription: "Gaudí's fantastical building with dragon-inspired roof and skeleton-like facade.", neighborhoodOrArea: "Passeig de Gràcia", bestTimeToVisit: "Afternoon", estDurationHours: "1.5", latitude: 41.3916, longitude: 2.1650 },
            { name: "Barceloneta Beach", shortDescription: "City's most popular beach with Mediterranean vibes and seafood restaurants nearby.", neighborhoodOrArea: "Barceloneta", bestTimeToVisit: "Morning or sunset", estDurationHours: "2-3", latitude: 41.3784, longitude: 2.1925 },
            { name: "La Boqueria Market", shortDescription: "Vibrant covered food market bursting with fresh fruit, seafood, and tapas stalls.", neighborhoodOrArea: "La Rambla", bestTimeToVisit: "Morning", estDurationHours: "1-2", latitude: 41.3816, longitude: 2.1719 },
            { name: "Montjuïc", shortDescription: "Hilltop park with castle, gardens, the Olympic stadium, and sweeping harbor views.", neighborhoodOrArea: "Montjuïc", bestTimeToVisit: "Afternoon", estDurationHours: "3-4", latitude: 41.3636, longitude: 2.1586 },
            { name: "El Born & Picasso Museum", shortDescription: "Trendy medieval neighborhood housing Picasso's early works and bustling cocktail bars.", neighborhoodOrArea: "El Born", bestTimeToVisit: "Afternoon", estDurationHours: "2-3", latitude: 41.3851, longitude: 2.1808 },
            { name: "Bunkers del Carmel", shortDescription: "Secret hilltop viewpoint with 360° panoramic views — a local favorite away from tourists.", neighborhoodOrArea: "El Carmel", bestTimeToVisit: "Sunset", estDurationHours: "1-2", latitude: 41.4184, longitude: 2.1594 },
            { name: "Palau de la Música Catalana", shortDescription: "Jaw-dropping Art Nouveau concert hall with stained glass and ornate sculptures.", neighborhoodOrArea: "Sant Pere", bestTimeToVisit: "Morning", estDurationHours: "1", latitude: 41.3876, longitude: 2.1753 },
        ],
        "tokyo": [
            { name: "Senso-ji Temple", shortDescription: "Tokyo's oldest and most significant Buddhist temple with iconic red gate.", neighborhoodOrArea: "Asakusa", bestTimeToVisit: "Early morning", estDurationHours: "1-2", latitude: 35.7148, longitude: 139.7967 },
            { name: "Shibuya Crossing", shortDescription: "World's busiest pedestrian crossing, an icon of Tokyo's energy.", neighborhoodOrArea: "Shibuya", bestTimeToVisit: "Evening", estDurationHours: "1", latitude: 35.6595, longitude: 139.7004 },
            { name: "Meiji Shrine", shortDescription: "Peaceful Shinto shrine surrounded by tranquil forest in the heart of the city.", neighborhoodOrArea: "Harajuku", bestTimeToVisit: "Morning", estDurationHours: "1-2", latitude: 35.6764, longitude: 139.6993 },
            { name: "Shinjuku Gyoen", shortDescription: "Stunning imperial garden blending Japanese, English, and French landscape styles.", neighborhoodOrArea: "Shinjuku", bestTimeToVisit: "Morning", estDurationHours: "2", latitude: 35.6852, longitude: 139.7100 },
            { name: "Tsukiji Outer Market", shortDescription: "Vibrant food market offering fresh seafood, street food, and culinary delights.", neighborhoodOrArea: "Tsukiji", bestTimeToVisit: "Morning", estDurationHours: "1-2", latitude: 35.6654, longitude: 139.7707 },
            { name: "TeamLab Borderless", shortDescription: "Immersive digital art museum where projections flow between rooms in a dreamlike experience.", neighborhoodOrArea: "Azabudai", bestTimeToVisit: "Afternoon", estDurationHours: "2-3", latitude: 35.6585, longitude: 139.7383 },
            { name: "Akihabara", shortDescription: "Electric Town — the epicenter of anime, gaming, and electronics culture.", neighborhoodOrArea: "Akihabara", bestTimeToVisit: "Afternoon", estDurationHours: "2-3", latitude: 35.7023, longitude: 139.7745 },
            { name: "Imperial Palace East Gardens", shortDescription: "Serene gardens on the grounds of the Imperial Palace with seasonal flowers and historic ruins.", neighborhoodOrArea: "Chiyoda", bestTimeToVisit: "Morning", estDurationHours: "1-2", latitude: 35.6852, longitude: 139.7528 },
            { name: "Yanaka", shortDescription: "Old-Tokyo neighborhood with narrow alleys, independent shops, and a nostalgic shitamachi atmosphere.", neighborhoodOrArea: "Yanaka", bestTimeToVisit: "Afternoon", estDurationHours: "2", latitude: 35.7264, longitude: 139.7677 },
            { name: "Odaiba", shortDescription: "Futuristic waterfront island with the life-size Gundam statue, shopping, and Tokyo Bay views.", neighborhoodOrArea: "Odaiba", bestTimeToVisit: "Evening", estDurationHours: "2-3", latitude: 35.6267, longitude: 139.7753 },
        ],
    };
    
    // Check for matching city
    for (const [city, sights] of Object.entries(fallbacks)) {
        if (destLower.includes(city)) {
            return sights;
        }
    }
    
    // Generic fallback
    return [
        { name: "Historic City Center", shortDescription: "Explore the heart of the city with its main squares, historic buildings, and local atmosphere.", bestTimeToVisit: "Morning", estDurationHours: "2-3" },
        { name: "Main Cathedral/Temple", shortDescription: "The city's most significant religious building, showcasing local architecture and history.", bestTimeToVisit: "Morning", estDurationHours: "1" },
        { name: "Local Market", shortDescription: "Vibrant market where locals shop for fresh produce, crafts, and traditional foods.", bestTimeToVisit: "Morning", estDurationHours: "1-2" },
        { name: "Scenic Viewpoint", shortDescription: "The best spot for panoramic views of the city and surrounding landscape.", bestTimeToVisit: "Sunset", estDurationHours: "1" },
        { name: "Local Neighborhood Walk", shortDescription: "Authentic neighborhood with local shops, cafés, and genuine cultural experiences.", bestTimeToVisit: "Afternoon", estDurationHours: "2" },
        { name: "Museum of Local History", shortDescription: "Discover the region's story through artifacts, art, and interactive exhibits.", bestTimeToVisit: "Morning", estDurationHours: "1-2" },
        { name: "Riverside or Waterfront Promenade", shortDescription: "Scenic walk along the water with local life, street performers, and photo opportunities.", bestTimeToVisit: "Afternoon", estDurationHours: "1-2" },
        { name: "City Park or Botanical Garden", shortDescription: "Green oasis perfect for a peaceful break from sightseeing.", bestTimeToVisit: "Morning", estDurationHours: "1-2" },
        { name: "Traditional Craft District", shortDescription: "Neighborhood where local artisans still practice centuries-old crafts and trades.", bestTimeToVisit: "Afternoon", estDurationHours: "1-2" },
        { name: "Sunset Hilltop or Rooftop", shortDescription: "Elevated spot favored by locals for golden-hour views over the city skyline.", bestTimeToVisit: "Sunset", estDurationHours: "1" },
    ];
}