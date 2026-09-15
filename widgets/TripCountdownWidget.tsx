import { HStack, Image, Spacer, Text, VStack } from "@expo/ui/swift-ui";
import { font, foregroundStyle, frame, lineLimit, padding, widgetURL, monospacedDigit, opacity } from "@expo/ui/swift-ui/modifiers";
import { createWidget, type WidgetEnvironment } from "expo-widgets";
import type { TripWidgetProps } from "@/lib/tripWidgetModel";

/**
 * Home-screen widget: "Lisbon · in 12 days" before a trip, "Day 3 of 5 ·
 * next: Alfama walk 09:30" during it. Fed a timeline by lib/useTripWidgets.ts
 * so it keeps counting without the app being opened.
 *
 * Widget functions run in the widget extension: no hooks, no closures over
 * module scope, only @expo/ui/swift-ui components. Everything it needs comes
 * in through `props`.
 */
const TripCountdownWidget = (props: TripWidgetProps, env: WidgetEnvironment) => {
    "widget";
    const small = env.widgetFamily === "systemSmall" || env.widgetFamily === "accessoryRectangular";
    const accessory = env.widgetFamily === "accessoryRectangular";
    const ink = accessory ? "primary" : env.colorScheme === "dark" ? "white" : "#1A1A1A";
    const muted = accessory ? "secondary" : env.colorScheme === "dark" ? "#B3B3B3" : "#6B6B6B";
    const accent = accessory ? "primary" : "#C9A800";
    const url = props.tripId ? `planeraai://trip/${props.tripId}` : "planeraai://";

    if (props.mode === "idle" || !props.destination) {
        return (
            <VStack alignment="leading" spacing={4} modifiers={[padding({ all: accessory ? 0 : 14 }), widgetURL("planeraai://create-trip")]}>
                <HStack spacing={6}>
                    <Image systemName="airplane" modifiers={[foregroundStyle(accent), font({ size: 14, weight: "semibold" })]} />
                    <Text modifiers={[font({ size: 13, weight: "semibold" }), foregroundStyle(ink)]}>Planera</Text>
                </HStack>
                <Spacer />
                <Text modifiers={[font({ size: small ? 15 : 18, weight: "bold" }), foregroundStyle(ink), lineLimit(2)]}>
                    Where to next?
                </Text>
                <Text modifiers={[font({ size: 12 }), foregroundStyle(muted), lineLimit(1)]}>
                    Plan a trip in 60 seconds
                </Text>
            </VStack>
        );
    }

    if (props.mode === "done") {
        return (
            <VStack alignment="leading" spacing={4} modifiers={[padding({ all: accessory ? 0 : 14 }), widgetURL(`planeraai://trip-recap?tripId=${props.tripId}`)]}>
                <HStack spacing={6}>
                    <Image systemName="photo.on.rectangle.angled" modifiers={[foregroundStyle(accent), font({ size: 14, weight: "semibold" })]} />
                    <Text modifiers={[font({ size: 12, weight: "semibold" }), foregroundStyle(muted)]}>Recap ready</Text>
                </HStack>
                <Spacer />
                <Text modifiers={[font({ size: small ? 18 : 22, weight: "bold" }), foregroundStyle(ink), lineLimit(1)]}>
                    {props.destination}
                </Text>
                <Text modifiers={[font({ size: 12 }), foregroundStyle(muted), lineLimit(1)]}>
                    See your trip recap
                </Text>
            </VStack>
        );
    }

    const live = props.mode === "live";
    const headline = live ? `Day ${props.day} of ${props.total}` : props.daysUntil === 1 ? "Tomorrow" : `In ${props.daysUntil} days`;
    const detail = props.nextTitle
        ? `${props.nextTime ? props.nextTime + " · " : ""}${props.nextTitle}`
        : live ? "A free day" : props.dateRange;

    return (
        <VStack alignment="leading" spacing={3} modifiers={[padding({ all: accessory ? 0 : 14 }), widgetURL(url)]}>
            <HStack spacing={6}>
                <Image
                    systemName={live ? "location.fill" : "airplane.departure"}
                    modifiers={[foregroundStyle(accent), font({ size: 13, weight: "semibold" })]}
                />
                <Text modifiers={[font({ size: 12, weight: "semibold" }), foregroundStyle(muted), lineLimit(1)]}>
                    {headline}
                </Text>
                <Spacer />
                {props.weather ? (
                    <Text modifiers={[font({ size: 12, weight: "semibold" }), foregroundStyle(muted), monospacedDigit()]}>
                        {props.weather}
                    </Text>
                ) : null}
            </HStack>
            <Spacer />
            <Text modifiers={[font({ size: small ? 20 : 26, weight: "bold" }), foregroundStyle(ink), lineLimit(1)]}>
                {props.destination}
            </Text>
            <Text modifiers={[font({ size: small ? 12 : 13 }), foregroundStyle(muted), lineLimit(small ? 1 : 2)]}>
                {detail}
            </Text>
            {!small && !live ? (
                <Text modifiers={[font({ size: 11 }), foregroundStyle(muted), opacity(0.8), lineLimit(1)]}>
                    {props.dateRange}
                </Text>
            ) : null}
            {!small && live && props.stops > 0 ? (
                <Text modifiers={[font({ size: 11 }), foregroundStyle(muted), opacity(0.8), lineLimit(1), frame({ maxWidth: 400, alignment: "leading" })]}>
                    {`${props.stops} stops today`}
                </Text>
            ) : null}
        </VStack>
    );
};

export default createWidget<TripWidgetProps>("TripCountdownWidget", TripCountdownWidget);
