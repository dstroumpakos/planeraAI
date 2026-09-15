import { HStack, Image, Spacer, Text, VStack } from "@expo/ui/swift-ui";
import { font, foregroundStyle, lineLimit, padding, monospacedDigit, opacity } from "@expo/ui/swift-ui/modifiers";
import { createLiveActivity } from "expo-widgets";
import type { LiveActivityEnvironment } from "expo-widgets/build/Widgets.types";
import type { TripWidgetProps } from "@/lib/tripWidgetModel";

/**
 * Lock-screen / Dynamic Island Live Activity for a trip day: "Day 3 in Lisbon
 * · next: Alfama walk 09:30". Started by lib/useTripWidgets.ts whenever the
 * app is opened during a live trip, and ended after the trip.
 */
const TripLiveActivity = (props: TripWidgetProps, env: LiveActivityEnvironment) => {
    "widget";
    const ink = env.colorScheme === "dark" ? "white" : "#1A1A1A";
    const muted = env.colorScheme === "dark" ? "#B3B3B3" : "#6B6B6B";
    const accent = "#FFE500";
    const headline = props.mode === "live" ? `Day ${props.day} of ${props.total}` : props.daysUntil === 1 ? "Tomorrow" : `In ${props.daysUntil} days`;
    const next = props.nextTitle ? `${props.nextTime ? props.nextTime + " · " : ""}${props.nextTitle}` : "A free day";

    return {
        banner: (
            <HStack spacing={12} modifiers={[padding({ all: 14 })]}>
                <VStack alignment="leading" spacing={4}>
                    <HStack spacing={6}>
                        <Image systemName="location.fill" modifiers={[foregroundStyle(accent), font({ size: 13, weight: "semibold" })]} />
                        <Text modifiers={[font({ size: 12, weight: "semibold" }), foregroundStyle(muted)]}>{headline}</Text>
                        {props.weather ? (
                            <Text modifiers={[font({ size: 12, weight: "semibold" }), foregroundStyle(muted), monospacedDigit()]}>
                                {`· ${props.weather}`}
                            </Text>
                        ) : null}
                    </HStack>
                    <Text modifiers={[font({ size: 22, weight: "bold" }), foregroundStyle(ink), lineLimit(1)]}>{props.destination}</Text>
                    <Text modifiers={[font({ size: 13 }), foregroundStyle(muted), lineLimit(2)]}>{next}</Text>
                </VStack>
                <Spacer />
                <VStack alignment="trailing" spacing={2}>
                    <Text modifiers={[font({ size: 28, weight: "bold" }), foregroundStyle(ink), monospacedDigit()]}>
                        {String(props.mode === "live" ? props.day : props.daysUntil)}
                    </Text>
                    <Text modifiers={[font({ size: 11 }), foregroundStyle(muted), opacity(0.9)]}>
                        {props.mode === "live" ? `of ${props.total}` : "days"}
                    </Text>
                </VStack>
            </HStack>
        ),
        compactLeading: <Image systemName="airplane" modifiers={[foregroundStyle(accent)]} />,
        compactTrailing: (
            <Text modifiers={[font({ size: 13, weight: "semibold" }), monospacedDigit()]}>
                {props.mode === "live" ? `D${props.day}` : `${props.daysUntil}d`}
            </Text>
        ),
        minimal: <Image systemName="airplane" modifiers={[foregroundStyle(accent)]} />,
        expandedLeading: (
            <VStack alignment="leading" spacing={2} modifiers={[padding({ leading: 6 })]}>
                <Text modifiers={[font({ size: 11, weight: "semibold" }), opacity(0.7)]}>{headline}</Text>
                <Text modifiers={[font({ size: 16, weight: "bold" }), lineLimit(1)]}>{props.destination}</Text>
            </VStack>
        ),
        expandedTrailing: props.weather ? (
            <Text modifiers={[font({ size: 14, weight: "semibold" }), monospacedDigit(), padding({ trailing: 6 })]}>{props.weather}</Text>
        ) : (
            <Image systemName="map" modifiers={[foregroundStyle(accent), padding({ trailing: 6 })]} />
        ),
        expandedBottom: (
            <Text modifiers={[font({ size: 13 }), opacity(0.85), lineLimit(1), padding({ horizontal: 6, bottom: 4 })]}>{next}</Text>
        ),
    };
};

export default createLiveActivity<TripWidgetProps>("TripLiveActivity", TripLiveActivity);
