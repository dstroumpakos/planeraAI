import React, { useEffect } from "react";
import { StyleSheet, Dimensions, Image, ImageSourcePropType } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Animated, {
    useSharedValue,
    useAnimatedStyle,
    withTiming,
    withSequence,
    withRepeat,
    cancelAnimation,
    Easing,
    runOnJS,
    type SharedValue,
} from "react-native-reanimated";

const { height: SCREEN_H } = Dimensions.get("window");
const PLANE = 64;    // icon fallback size
const IMG = 150;     // custom-image size (large + clearly visible)
const WIGGLE = 6;

interface AirplaneIntroProps {
    /** Window coordinates of the target (search field) center. */
    targetX: number;
    targetY: number;
    color: string;
    /** Optional custom plane image. When set, it's flown instead of the icon. */
    imageSource?: ImageSourcePropType;
    /** Fired the moment the plane reaches the field (for the field's glow pulse). */
    onArrive?: () => void;
    onDone?: () => void;
}

// A single fading dot in the plane's comet trail.
function TrailDot({
    translateY,
    wiggleX,
    opacity,
    scale,
    targetX,
    size,
    offset,
    baseOpacity,
    color,
}: {
    translateY: SharedValue<number>;
    wiggleX: SharedValue<number>;
    opacity: SharedValue<number>;
    scale: SharedValue<number>;
    targetX: number;
    size: number;
    offset: number;
    baseOpacity: number;
    color: string;
}) {
    const style = useAnimatedStyle(() => ({
        opacity: opacity.value * baseOpacity,
        transform: [
            { translateX: targetX - size / 2 + wiggleX.value * 0.6 },
            { translateY: translateY.value + offset },
            { scale: scale.value },
        ],
    }));
    return (
        <Animated.View
            pointerEvents="none"
            style={[{ position: "absolute", top: 0, left: 0, width: size, height: size, borderRadius: size / 2, backgroundColor: color }, style]}
        />
    );
}

/**
 * Intro flourish, rendered BEHIND the Home content: a big airplane lifts up from
 * below, banks gently as it climbs trailing a comet tail, and flies up the page
 * to tuck UNDER the "where to go?" search field (the field occludes it), leaving
 * a soft ripple. Non-interactive; no zIndex so paint order keeps it behind the UI.
 */
export default function AirplaneIntro({ targetX, targetY, color, imageSource, onArrive, onDone }: AirplaneIntroProps) {
    const size = imageSource ? IMG : PLANE;
    const baseRotation = imageSource ? 0 : -45; // the image is already nose-up; the icon needs rotating

    const translateY = useSharedValue(SCREEN_H + 80);
    const opacity = useSharedValue(0);
    const scale = useSharedValue(1);
    const wiggleX = useSharedValue(0);

    useEffect(() => {
        opacity.value = withTiming(1, { duration: 180 });
        wiggleX.value = withRepeat(
            withSequence(
                withTiming(WIGGLE, { duration: 380, easing: Easing.inOut(Easing.sin) }),
                withTiming(-WIGGLE, { duration: 380, easing: Easing.inOut(Easing.sin) })
            ),
            -1,
            true
        );
        // Shrinks as it climbs (stays big most of the way, then tucks small into
        // the field), so by the time it reaches the bar it fits inside it.
        scale.value = withTiming(0.22, { duration: 1100, easing: Easing.in(Easing.cubic) });
        translateY.value = withTiming(
            targetY - size / 2,
            { duration: 1100, easing: Easing.out(Easing.cubic) },
            (finished) => {
                if (finished) {
                    if (onArrive) runOnJS(onArrive)();
                    cancelAnimation(wiggleX);
                    wiggleX.value = withTiming(0, { duration: 120 });
                    scale.value = withTiming(0.08, { duration: 260, easing: Easing.in(Easing.quad) });
                    opacity.value = withTiming(0, { duration: 260 }, (done) => {
                        if (done && onDone) runOnJS(onDone)();
                    });
                }
            }
        );
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const planeStyle = useAnimatedStyle(() => ({
        opacity: opacity.value,
        transform: [
            { translateX: targetX - size / 2 + wiggleX.value },
            { translateY: translateY.value },
            { rotate: `${baseRotation + wiggleX.value * 0.8}deg` }, // bank into the wiggle
            { scale: scale.value },
        ],
    }));

    return (
        <>
            {/* Comet trail (rendered below the plane). */}
            <TrailDot translateY={translateY} wiggleX={wiggleX} opacity={opacity} scale={scale} targetX={targetX} size={12} offset={size * 0.62} baseOpacity={0.45} color={color} />
            <TrailDot translateY={translateY} wiggleX={wiggleX} opacity={opacity} scale={scale} targetX={targetX} size={8} offset={size * 0.82} baseOpacity={0.28} color={color} />
            <TrailDot translateY={translateY} wiggleX={wiggleX} opacity={opacity} scale={scale} targetX={targetX} size={5} offset={size * 1.0} baseOpacity={0.16} color={color} />
            {/* The plane itself — custom image if provided, else the icon. */}
            <Animated.View pointerEvents="none" style={[styles.plane, planeStyle]}>
                {imageSource ? (
                    <Image source={imageSource} style={{ width: size, height: size }} resizeMode="contain" />
                ) : (
                    <Ionicons name="airplane" size={size} color={color} />
                )}
            </Animated.View>
        </>
    );
}

const styles = StyleSheet.create({
    plane: {
        position: "absolute",
        top: 0,
        left: 0,
    },
});
