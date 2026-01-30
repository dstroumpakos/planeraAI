import React, { Component, ReactNode, ErrorInfo } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Constants from "expo-constants";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

// Fallback screen shown when the app crashes
function FallbackScreen({ 
  error, 
  errorInfo, 
  onReload 
}: { 
  error: Error | null; 
  errorInfo: ErrorInfo | null;
  onReload: () => void;
}) {
  const isDev = __DEV__;

  return (
    <SafeAreaView style={fallbackStyles.container}>
      <View style={fallbackStyles.content}>
        <Text style={fallbackStyles.icon}>⚠️</Text>
        <Text style={fallbackStyles.title}>Something went wrong</Text>
        <Text style={fallbackStyles.subtitle}>
          The app encountered an unexpected error during startup.
        </Text>

        {isDev && error && (
          <ScrollView style={fallbackStyles.errorBox} contentContainerStyle={fallbackStyles.errorContent}>
            <Text style={fallbackStyles.errorLabel}>Error:</Text>
            <Text style={fallbackStyles.errorText}>{error.message}</Text>
            
            {error.stack && (
              <>
                <Text style={fallbackStyles.errorLabel}>Stack trace:</Text>
                <Text style={fallbackStyles.stackText}>{error.stack}</Text>
              </>
            )}

            {errorInfo?.componentStack && (
              <>
                <Text style={fallbackStyles.errorLabel}>Component stack:</Text>
                <Text style={fallbackStyles.stackText}>{errorInfo.componentStack}</Text>
              </>
            )}
          </ScrollView>
        )}

        {isDev && (
          <View style={fallbackStyles.diagnostics}>
            <Text style={fallbackStyles.diagnosticsTitle}>Dev Diagnostics:</Text>
            <DiagnosticsPanel />
          </View>
        )}

        <TouchableOpacity style={fallbackStyles.reloadButton} onPress={onReload}>
          <Text style={fallbackStyles.reloadButtonText}>Reload App</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

// Dev-only diagnostics panel
function DiagnosticsPanel() {
  // Safe checks that won't crash
  const hasConvexUrl = !!process.env.EXPO_PUBLIC_CONVEX_URL;
  const hasSiteUrl = !!process.env.EXPO_PUBLIC_CONVEX_SITE_URL;
  
  let expoConfigExists = false;
  let schemeValue = "N/A";
  
  try {
    expoConfigExists = !!Constants.expoConfig;
    const scheme = Constants.expoConfig?.scheme;
    schemeValue = Array.isArray(scheme) ? scheme[0] || "not set" : scheme || "not set";
  } catch {
    // Ignore - Constants may not be available
  }

  return (
    <View style={fallbackStyles.diagnosticsBox}>
      <Text style={fallbackStyles.diagItem}>
        • EXPO_PUBLIC_CONVEX_URL: {hasConvexUrl ? "✅ set" : "❌ missing"}
      </Text>
      <Text style={fallbackStyles.diagItem}>
        • EXPO_PUBLIC_CONVEX_SITE_URL: {hasSiteUrl ? "✅ set" : "❌ missing"}
      </Text>
      <Text style={fallbackStyles.diagItem}>
        • Constants.expoConfig: {expoConfigExists ? "✅ exists" : "❌ missing"}
      </Text>
      <Text style={fallbackStyles.diagItem}>
        • Scheme: {schemeValue}
      </Text>
    </View>
  );
}

// Main Error Boundary class component
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    // Update state so the next render shows the fallback UI
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // Log error for debugging
    console.error("[ErrorBoundary] Caught error:", error);
    console.error("[ErrorBoundary] Error info:", errorInfo);
    
    this.setState({
      error,
      errorInfo,
    });
  }

  handleReload = () => {
    // Reset state and try to re-render
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });

    // Try to reload using Expo Updates if available
    try {
      // Dynamically import to avoid crashes if not available
      const Updates = require("expo-updates");
      if (Updates.reloadAsync) {
        Updates.reloadAsync().catch((e: Error) => {
          console.warn("[ErrorBoundary] Failed to reload with expo-updates:", e);
        });
      }
    } catch {
      // expo-updates not available (e.g., in dev mode)
      console.log("[ErrorBoundary] expo-updates not available, state reset only");
    }
  };

  render() {
    if (this.state.hasError) {
      // Check if custom fallback is provided
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <FallbackScreen
          error={this.state.error}
          errorInfo={this.state.errorInfo}
          onReload={this.handleReload}
        />
      );
    }

    return this.props.children;
  }
}

const fallbackStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#FFF8E7",
  },
  content: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  icon: {
    fontSize: 64,
    marginBottom: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#1a1a1a",
    marginBottom: 8,
    textAlign: "center",
  },
  subtitle: {
    fontSize: 16,
    color: "#666",
    textAlign: "center",
    marginBottom: 24,
    lineHeight: 22,
  },
  errorBox: {
    maxHeight: 200,
    width: "100%",
    backgroundColor: "#fff",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e0e0e0",
    marginBottom: 16,
  },
  errorContent: {
    padding: 12,
  },
  errorLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: "#d32f2f",
    marginBottom: 4,
    marginTop: 8,
  },
  errorText: {
    fontSize: 13,
    color: "#d32f2f",
    fontFamily: "monospace",
  },
  stackText: {
    fontSize: 10,
    color: "#666",
    fontFamily: "monospace",
  },
  diagnostics: {
    width: "100%",
    marginBottom: 24,
  },
  diagnosticsTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: "#1a1a1a",
    marginBottom: 8,
  },
  diagnosticsBox: {
    backgroundColor: "#f5f5f5",
    borderRadius: 8,
    padding: 12,
  },
  diagItem: {
    fontSize: 12,
    color: "#333",
    marginBottom: 4,
    fontFamily: "monospace",
  },
  reloadButton: {
    backgroundColor: "#FFE500",
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  reloadButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#1a1a1a",
  },
});

export default ErrorBoundary;
