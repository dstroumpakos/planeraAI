import { View, Text, StyleSheet } from "react-native";

// This is a placeholder screen - the tab press is intercepted to navigate to /create-trip
export default function CreateScreen() {
    return (
        <View style={styles.container}>
            <Text>Redirecting...</Text>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        justifyContent: "center",
        alignItems: "center",
    },
});
