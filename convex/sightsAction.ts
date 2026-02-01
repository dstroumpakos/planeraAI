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
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        const { tripId, destination } = args;
        const destinationKey = normalizeDestinationKey(destination);
        
        console.log(`🏛️ Generating Top 5 sights for: ${destination}`);
        
        // Check if we have recent cached sights for this destination
        const existingSights = await ctx.runMutation(internal.sights.getCachedSights, { destinationKey });
        if (existingSights) {
            console.log("Using cached sights for destination");
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
            
            const prompt = `Generate the top 5 must-see sights for ${destination}. 
            
For each sight, provide:
1. name: The official name of the sight
2. shortDescription: 1-2 sentences describing what makes it special
3. neighborhoodOrArea: The neighborhood or area where it's located (if applicable)
4. bestTimeToVisit: Best time of day or season to visit
5. estDurationHours: Estimated time to spend there (e.g., "2-3" or "1-2")

IMPORTANT:
- Choose diverse sights (mix of cultural, historical, nature, neighborhood)
- Include both famous landmarks and local favorites
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
      "estDurationHours": "2-3"
    }
  ]
}`;

            const completion = await openai.chat.completions.create({
                messages: [
                    { role: "system", content: "You are a travel expert providing informational recommendations. Return only valid JSON." },
                    { role: "user", content: prompt },
                ],
                model: "gpt-4o",
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
            
            // Save the sights
            await ctx.runMutation(internal.sights.saveSights, {
                tripId,
                destinationKey,
                sights: sights.slice(0, 5), // Ensure max 5
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
}> {
    const destLower = destination.toLowerCase();
    
    const fallbacks: Record<string, Array<{
        name: string;
        shortDescription: string;
        neighborhoodOrArea?: string;
        bestTimeToVisit?: string;
        estDurationHours?: string;
    }>> = {
        "paris": [
            { name: "Eiffel Tower", shortDescription: "Iconic iron lattice tower offering panoramic city views from its observation decks.", neighborhoodOrArea: "7th arrondissement", bestTimeToVisit: "Sunset", estDurationHours: "2-3" },
            { name: "Louvre Museum", shortDescription: "World's largest art museum, home to the Mona Lisa and countless masterpieces.", neighborhoodOrArea: "1st arrondissement", bestTimeToVisit: "Morning", estDurationHours: "3-4" },
            { name: "Montmartre & Sacré-Cœur", shortDescription: "Bohemian hilltop neighborhood with stunning basilica and artist heritage.", neighborhoodOrArea: "18th arrondissement", bestTimeToVisit: "Early morning", estDurationHours: "2-3" },
            { name: "Notre-Dame Cathedral", shortDescription: "Medieval Gothic cathedral, a masterpiece of French architecture (view from outside during restoration).", neighborhoodOrArea: "Île de la Cité", bestTimeToVisit: "Afternoon", estDurationHours: "1" },
            { name: "Le Marais", shortDescription: "Historic district with medieval streets, trendy boutiques, and vibrant café culture.", neighborhoodOrArea: "3rd & 4th arrondissements", bestTimeToVisit: "Afternoon", estDurationHours: "2-3" },
        ],
        "rome": [
            { name: "Colosseum", shortDescription: "Ancient Roman amphitheater, once hosting gladiatorial contests for 50,000 spectators.", neighborhoodOrArea: "Centro Storico", bestTimeToVisit: "Early morning", estDurationHours: "2-3" },
            { name: "Vatican City & St. Peter's Basilica", shortDescription: "World's smallest country housing priceless art and the stunning Renaissance basilica.", neighborhoodOrArea: "Vatican", bestTimeToVisit: "Morning", estDurationHours: "3-4" },
            { name: "Roman Forum", shortDescription: "Ancient ruins of Rome's political and social center for centuries.", neighborhoodOrArea: "Centro Storico", bestTimeToVisit: "Morning", estDurationHours: "2" },
            { name: "Trevi Fountain", shortDescription: "Baroque masterpiece where visitors toss coins to ensure a return to Rome.", neighborhoodOrArea: "Trevi", bestTimeToVisit: "Early morning or late evening", estDurationHours: "0.5-1" },
            { name: "Trastevere", shortDescription: "Charming neighborhood with cobblestone streets, trattorias, and authentic Roman atmosphere.", neighborhoodOrArea: "Trastevere", bestTimeToVisit: "Evening", estDurationHours: "2-3" },
        ],
        "barcelona": [
            { name: "Sagrada Familia", shortDescription: "Gaudí's unfinished masterpiece basilica with stunning organic architecture and light-filled interior.", neighborhoodOrArea: "Eixample", bestTimeToVisit: "Morning", estDurationHours: "2" },
            { name: "Park Güell", shortDescription: "Whimsical public park featuring Gaudí's colorful mosaic work and city views.", neighborhoodOrArea: "Gràcia", bestTimeToVisit: "Early morning", estDurationHours: "2" },
            { name: "La Rambla & Gothic Quarter", shortDescription: "Famous tree-lined pedestrian street leading to medieval narrow alleyways.", neighborhoodOrArea: "Ciutat Vella", bestTimeToVisit: "Morning or evening", estDurationHours: "2-3" },
            { name: "Casa Batlló", shortDescription: "Gaudí's fantastical building with dragon-inspired roof and skeleton-like facade.", neighborhoodOrArea: "Passeig de Gràcia", bestTimeToVisit: "Afternoon", estDurationHours: "1.5" },
            { name: "Barceloneta Beach", shortDescription: "City's most popular beach with Mediterranean vibes and seafood restaurants nearby.", neighborhoodOrArea: "Barceloneta", bestTimeToVisit: "Morning or sunset", estDurationHours: "2-3" },
        ],
        "tokyo": [
            { name: "Senso-ji Temple", shortDescription: "Tokyo's oldest and most significant Buddhist temple with iconic red gate.", neighborhoodOrArea: "Asakusa", bestTimeToVisit: "Early morning", estDurationHours: "1-2" },
            { name: "Shibuya Crossing", shortDescription: "World's busiest pedestrian crossing, an icon of Tokyo's energy.", neighborhoodOrArea: "Shibuya", bestTimeToVisit: "Evening", estDurationHours: "1" },
            { name: "Meiji Shrine", shortDescription: "Peaceful Shinto shrine surrounded by tranquil forest in the heart of the city.", neighborhoodOrArea: "Harajuku", bestTimeToVisit: "Morning", estDurationHours: "1-2" },
            { name: "Shinjuku Gyoen", shortDescription: "Stunning imperial garden blending Japanese, English, and French landscape styles.", neighborhoodOrArea: "Shinjuku", bestTimeToVisit: "Morning", estDurationHours: "2" },
            { name: "Tsukiji Outer Market", shortDescription: "Vibrant food market offering fresh seafood, street food, and culinary delights.", neighborhoodOrArea: "Tsukiji", bestTimeToVisit: "Morning", estDurationHours: "1-2" },
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
    ];
}