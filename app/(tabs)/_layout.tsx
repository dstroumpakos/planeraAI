import { Tabs } from "expo-router";
import { useTranslation } from "react-i18next";
import FloatingTabBar from "@/components/FloatingTabBar";
import { TabBarVisibilityProvider } from "@/lib/tabBarVisibility";

export default function TabLayout() {
    const { t } = useTranslation();

    return (
        <TabBarVisibilityProvider>
            <Tabs
                screenOptions={{ headerShown: false }}
                tabBar={(props) => <FloatingTabBar {...props} />}
            >
                <Tabs.Screen name="index" options={{ title: t("tabs.home") }} />
                <Tabs.Screen name="trips" options={{ title: t("tabs.trips") }} />
                <Tabs.Screen name="create" options={{ title: "" }} />
                <Tabs.Screen name="insights" options={{ title: t("tabs.atlas") }} />
                <Tabs.Screen name="profile" options={{ title: t("tabs.profile") }} />
            </Tabs>
        </TabBarVisibilityProvider>
    );
}
