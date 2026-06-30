import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import * as SecureStore from "expo-secure-store";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useConvexAuth } from "@/lib/auth-components";
import { useAuthenticatedMutation } from "@/lib/useAuthenticatedMutation";
import { LIGHT_COLORS } from "@/lib/ThemeContext";
import { useTranslation } from "react-i18next";

const COLORS = LIGHT_COLORS;

// Stash key used to resume an invite after the user signs in (see app/index.tsx).
export const PENDING_INVITE_KEY = "pendingInviteToken";

/**
 * Deep-link target for trip invite links (https://planeraai.app/invite/<token>,
 * opened via iOS Universal Links). Accepts the invite for the signed-in user and
 * navigates to the trip. If the user isn't signed in yet, the token is stashed
 * and they're routed to auth; index.tsx resumes here after login.
 */
export default function InviteDeepLink() {
  const { token: inviteToken } = useLocalSearchParams<{ token: string }>();
  const router = useRouter();
  const { t } = useTranslation();
  const { isAuthenticated, isLoading } = useConvexAuth();
  const acceptInvite = useAuthenticatedMutation(api.tripCollaborators.acceptInvite as any);

  const invite = useQuery(
    api.tripCollaborators.getInviteInfo as any,
    inviteToken ? { inviteToken } : "skip"
  );

  const [phase, setPhase] = useState<"idle" | "joining" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  // Not signed in → stash the token and send to the auth gate.
  useEffect(() => {
    if (isLoading || isAuthenticated || !inviteToken) return;
    SecureStore.setItemAsync(PENDING_INVITE_KEY, String(inviteToken))
      .catch(() => {})
      .finally(() => router.replace("/"));
  }, [isAuthenticated, isLoading, inviteToken, router]);

  // Signed in → accept the invite, then open the trip.
  useEffect(() => {
    if (!isAuthenticated || invite === undefined || phase !== "idle") return;
    // We're handling it now; clear any stashed token so we don't loop.
    SecureStore.deleteItemAsync(PENDING_INVITE_KEY).catch(() => {});

    if (invite === null) {
      setPhase("error");
      setMessage(t("invite.invalid", { defaultValue: "This invite is invalid or has already been used." }));
      return;
    }

    setPhase("joining");
    acceptInvite({ inviteToken })
      .then((res: any) => {
        router.replace(`/trip/${res.tripId}`);
      })
      .catch((e: any) => {
        const msg = String(e?.message || "");
        // Already a member (or already used by this user): just open the trip.
        if (msg.includes("Already a collaborator") || msg.includes("already used")) {
          router.replace(`/trip/${invite.tripId}`);
          return;
        }
        setPhase("error");
        setMessage(t("invite.failed", { defaultValue: "Couldn't join this trip. Ask the owner for a new invite." }));
      });
  }, [isAuthenticated, invite, phase, inviteToken, acceptInvite, router, t]);

  if (phase === "error") {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>{t("invite.cantJoin", { defaultValue: "Can't join trip" })}</Text>
        <Text style={styles.subtitle}>{message}</Text>
        <TouchableOpacity style={styles.button} onPress={() => router.replace("/(tabs)")}>
          <Text style={styles.buttonText}>{t("common.goHome", { defaultValue: "Go to Home" })}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color={COLORS.primary} />
      <Text style={styles.subtitle}>
        {t("invite.joining", { defaultValue: "Joining trip…" })}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: COLORS.background, paddingHorizontal: 32, gap: 14 },
  title: { fontSize: 20, fontWeight: "800", color: COLORS.text, textAlign: "center" },
  subtitle: { fontSize: 15, color: COLORS.textSecondary, textAlign: "center", lineHeight: 22 },
  button: { marginTop: 8, backgroundColor: COLORS.primary, paddingVertical: 14, paddingHorizontal: 28, borderRadius: 14 },
  buttonText: { fontSize: 16, fontWeight: "700", color: COLORS.text },
});
