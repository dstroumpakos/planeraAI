export const DEALS = [
    {
        id: "1",
        destination: "Bali, Indonesia",
        image: "https://images.unsplash.com/photo-1537996194471-e657df975ab4",
        price: 899,
        originalPrice: 1299,
        dates: "Next Weekend",
        discount: "30% OFF",
        description: "Experience the magic of Bali with this exclusive package. Includes flights, 5-star accommodation, and daily tours.",
        flights: {
            outbound: {
                airline: "Garuda Indonesia",
                flightNumber: "GA881",
                departure: "10:00 AM",
                arrival: "08:00 PM",
                duration: "10h 00m"
            },
            return: {
                airline: "Garuda Indonesia",
                flightNumber: "GA882",
                departure: "09:00 PM",
                arrival: "07:00 AM",
                duration: "10h 00m"
            },
            luggage: "30kg included"
        },
        hotels: [
            {
                name: "The Kayon Jungle Resort",
                rating: 5,
                price: "€200/night",
                image: "https://images.unsplash.com/photo-1571896349842-6e5c48dc52e3",
                address: "Ubud, Bali"
            },
            {
                name: "Padma Resort Ubud",
                rating: 4.8,
                price: "€180/night",
                image: "https://images.unsplash.com/photo-1582719508461-905c673771fd",
                address: "Payangan, Bali"
            },
            {
                name: "Viceroy Bali",
                rating: 5,
                price: "€350/night",
                image: "https://images.unsplash.com/photo-1542314831-068cd1dbfeeb",
                address: "Ubud, Bali"
            }
        ],
        itinerary: [
            {
                day: 1,
                activities: [
                    { time: "10:00 AM", title: "Arrival & Check-in", description: "Welcome drink and settle in" },
                    { time: "02:00 PM", title: "Ubud Market Tour", description: "Explore local crafts and food" },
                    { time: "07:00 PM", title: "Welcome Dinner", description: "Traditional Balinese cuisine" }
                ]
            },
            {
                day: 2,
                activities: [
                    { time: "09:00 AM", title: "Tegalalang Rice Terrace", description: "Famous scenic rice paddies" },
                    { time: "01:00 PM", title: "Monkey Forest", description: "Visit the sacred sanctuary" }
                ]
            }
        ]
    },
    {
        id: "2",
        destination: "Santorini, Greece",
        image: "https://images.unsplash.com/photo-1613395877344-13d4c280d288",
        price: 1199,
        originalPrice: 1599,
        dates: "Oct 15 - Oct 22",
        discount: "25% OFF",
        description: "Watch the world's most famous sunset in Oia. A romantic getaway with breathtaking views.",
        flights: {
            outbound: {
                airline: "Aegean Airlines",
                flightNumber: "A3350",
                departure: "08:00 AM",
                arrival: "02:00 PM",
                duration: "6h 00m"
            },
            return: {
                airline: "Aegean Airlines",
                flightNumber: "A3351",
                departure: "04:00 PM",
                arrival: "10:00 PM",
                duration: "6h 00m"
            },
            luggage: "23kg included"
        },
        hotels: [
            {
                name: "Canaves Oia",
                rating: 5,
                price: "€400/night",
                image: "https://images.unsplash.com/photo-1566073771259-6a8506099945",
                address: "Oia, Santorini"
            },
            {
                name: "Mystique",
                rating: 5,
                price: "€500/night",
                image: "https://images.unsplash.com/photo-1520250497591-112f2f40a3f4",
                address: "Oia, Santorini"
            },
            {
                name: "Katikies",
                rating: 4.9,
                price: "€450/night",
                image: "https://images.unsplash.com/photo-1445019980597-93fa8acb246c",
                address: "Oia, Santorini"
            }
        ],
        itinerary: [
            {
                day: 1,
                activities: [
                    { time: "02:00 PM", title: "Arrival", description: "Transfer to hotel" },
                    { time: "06:00 PM", title: "Sunset in Oia", description: "Best view in the world" }
                ]
            }
        ]
    },
    {
        id: "3",
        destination: "Kyoto, Japan",
        image: "https://images.unsplash.com/photo-1493976040374-85c8e12f0c0e",
        price: 1499,
        originalPrice: 1899,
        dates: "Nov 1 - Nov 10",
        discount: "20% OFF",
        description: "Immerse yourself in ancient Japanese culture during the beautiful autumn season.",
        flights: {
            outbound: {
                airline: "JAL",
                flightNumber: "JL001",
                departure: "11:00 AM",
                arrival: "03:00 PM (+1)",
                duration: "13h 00m"
            },
            return: {
                airline: "JAL",
                flightNumber: "JL002",
                departure: "05:00 PM",
                arrival: "11:00 AM",
                duration: "13h 00m"
            },
            luggage: "2x 23kg included"
        },
        hotels: [
            {
                name: "Ritz-Carlton Kyoto",
                rating: 5,
                price: "€600/night",
                image: "https://images.unsplash.com/photo-1618773928121-c32242e63f39",
                address: "Nakagyo Ward, Kyoto"
            },
            {
                name: "Hotel The Mitsui",
                rating: 5,
                price: "€550/night",
                image: "https://images.unsplash.com/photo-1590073242678-cfea533fc063",
                address: "Nakagyo Ward, Kyoto"
            },
            {
                name: "Park Hyatt Kyoto",
                rating: 5,
                price: "€700/night",
                image: "https://images.unsplash.com/photo-1542314831-068cd1dbfeeb",
                address: "Higashiyama Ward, Kyoto"
            }
        ],
        itinerary: [
            {
                day: 1,
                activities: [
                    { time: "03:00 PM", title: "Check-in", description: "Traditional tea ceremony" },
                    { time: "06:00 PM", title: "Gion District", description: "Geisha spotting and dinner" }
                ]
            }
        ]
    },
    {
        id: "4",
        destination: "New York, USA",
        image: "https://images.unsplash.com/photo-1496442226666-8d4d0e62e6e9",
        price: 799,
        originalPrice: 999,
        dates: "Dec 5 - Dec 10",
        discount: "20% OFF",
        description: "Christmas in New York! Skating at Rockefeller Center and holiday shopping on 5th Ave.",
        flights: {
            outbound: {
                airline: "Delta",
                flightNumber: "DL404",
                departure: "07:00 AM",
                arrival: "10:00 AM",
                duration: "3h 00m"
            },
            return: {
                airline: "Delta",
                flightNumber: "DL405",
                departure: "08:00 PM",
                arrival: "11:00 PM",
                duration: "3h 00m"
            },
            luggage: "23kg included"
        },
        hotels: [
            {
                name: "The Plaza",
                rating: 5,
                price: "€800/night",
                image: "https://images.unsplash.com/photo-1551882547-ff40c63fe5fa",
                address: "5th Avenue, NY"
            },
            {
                name: "1 Hotel Central Park",
                rating: 4.8,
                price: "€500/night",
                image: "https://images.unsplash.com/photo-1566073771259-6a8506099945",
                address: "6th Avenue, NY"
            },
            {
                name: "Arlo NoMad",
                rating: 4.5,
                price: "€300/night",
                image: "https://images.unsplash.com/photo-1582719508461-905c673771fd",
                address: "NoMad, NY"
            }
        ],
        itinerary: [
            {
                day: 1,
                activities: [
                    { time: "12:00 PM", title: "Arrival", description: "Check in to hotel" },
                    { time: "04:00 PM", title: "Rockefeller Center", description: "See the tree and skate" }
                ]
            }
        ]
    }
];

export const INTERESTS = [
    "Adventure", 
    "Culinary", 
    "Culture", 
    "Relaxation", 
    "Nightlife", 
    "Nature", 
    "History", 
    "Shopping", 
    "Luxury", 
    "Family"
];

export const COUNTRIES = [
  { code: "US", name: "United States" },
  { code: "GB", name: "United Kingdom" },
  { code: "CA", name: "Canada" },
  { code: "AU", name: "Australia" },
  { code: "DE", name: "Germany" },
  { code: "FR", name: "France" },
  { code: "IT", name: "Italy" },
  { code: "ES", name: "Spain" },
  { code: "NL", name: "Netherlands" },
  { code: "BE", name: "Belgium" },
  { code: "AT", name: "Austria" },
  { code: "CH", name: "Switzerland" },
  { code: "SE", name: "Sweden" },
  { code: "NO", name: "Norway" },
  { code: "DK", name: "Denmark" },
  { code: "FI", name: "Finland" },
  { code: "IE", name: "Ireland" },
  { code: "PT", name: "Portugal" },
  { code: "GR", name: "Greece" },
  { code: "PL", name: "Poland" },
  { code: "CZ", name: "Czech Republic" },
  { code: "JP", name: "Japan" },
  { code: "KR", name: "South Korea" },
  { code: "CN", name: "China" },
  { code: "IN", name: "India" },
  { code: "BR", name: "Brazil" },
  { code: "MX", name: "Mexico" },
  { code: "AR", name: "Argentina" },
  { code: "ZA", name: "South Africa" },
  { code: "AE", name: "United Arab Emirates" },
  { code: "SG", name: "Singapore" },
  { code: "NZ", name: "New Zealand" },
  { code: "TH", name: "Thailand" },
  { code: "MY", name: "Malaysia" },
  { code: "PH", name: "Philippines" },
  { code: "ID", name: "Indonesia" },
  { code: "VN", name: "Vietnam" },
  { code: "EG", name: "Egypt" },
  { code: "TR", name: "Turkey" },
  { code: "RU", name: "Russia" },
  { code: "SA", name: "Saudi Arabia" },
  { code: "IL", name: "Israel" },
].sort((a, b) => a.name.localeCompare(b.name));
