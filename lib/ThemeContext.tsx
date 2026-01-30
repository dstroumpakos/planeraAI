import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { useConvexAuth } from 'convex/react';

// Planera Colors - Light Mode (cream/yellow theme)
export const LIGHT_COLORS = {
    primary: "#FFE500",
    secondary: "#FFF8E1",
    background: "#FAF9F6",
    backgroundSecondary: "#FFFFFF",
    text: "#1A1A1A",
    textSecondary: "#6B6B6B",
    textMuted: "#9B9B9B",
    white: "#FFFFFF",
    border: "#E8E6E1",
    error: "#EF4444",
    card: "#FFFFFF",
    cardBackground: "#FFFFFF",
    inputBackground: "#FFFFFF",
    lightGray: "#F2F2F7",
    tabBar: "#2C2C2E",
    inactive: "#8E8E93",
};

// Dark Mode - Inverted colors with dark backgrounds and light text
export const DARK_COLORS = {
    primary: "#FFE500",
    secondary: "#3D3A2A",
    background: "#121212",
    backgroundSecondary: "#1E1E1E",
    text: "#FFFFFF",
    textSecondary: "#B3B3B3",
    textMuted: "#808080",
    white: "#FFFFFF",
    border: "#2C2C2C",
    error: "#FF6B6B",
    card: "#1E1E1E",
    cardBackground: "#1E1E1E",
    inputBackground: "#2A2A2A",
    lightGray: "#2A2A2A",
    tabBar: "#121212",
    inactive: "#666666",
};

interface ThemeContextType {
    isDarkMode: boolean;
    toggleDarkMode: () => void;
    colors: typeof LIGHT_COLORS;
}

const ThemeContext = createContext<ThemeContextType>({
    isDarkMode: false,
    toggleDarkMode: () => {},
    colors: LIGHT_COLORS,
});

export function ThemeProvider({ children }: { children: ReactNode }) {
    const { isAuthenticated } = useConvexAuth();
    const userSettings = useQuery(
        api.users.getSettings,
        isAuthenticated ? {} : "skip"
    );
    const updateDarkMode = useMutation(api.users.updateDarkMode);
    const [isDarkMode, setIsDarkMode] = useState(false);

    useEffect(() => {
        if (userSettings?.darkMode !== undefined) {
            setIsDarkMode(userSettings.darkMode);
        }
    }, [userSettings?.darkMode]);

    const toggleDarkMode = async () => {
        const newValue = !isDarkMode;
        setIsDarkMode(newValue);
        if (isAuthenticated) {
            try {
                await updateDarkMode({ darkMode: newValue });
            } catch (error) {
                console.error("Failed to save dark mode preference:", error);
            }
        }
    };

    const colors = isDarkMode ? DARK_COLORS : LIGHT_COLORS;

    return (
        <ThemeContext.Provider value={{ isDarkMode, toggleDarkMode, colors }}>
            {children}
        </ThemeContext.Provider>
    );
}

export function useTheme() {
    return useContext(ThemeContext);
}
