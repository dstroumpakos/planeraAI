import React, { useState, useCallback, useImperativeHandle, forwardRef, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  Platform,
  ActivityIndicator,
  Alert,
  TouchableOpacity,
  Modal,
  Dimensions,
} from "react-native";
import ViewShot, { captureRef } from "react-native-view-shot";
import * as Sharing from "expo-sharing";
import { File, Paths } from "expo-file-system";
import * as MediaLibrary from "expo-media-library";
import { useTranslation } from "react-i18next";
import { ShareRouteCardBody, CARD_W, CARD_H, type ShareRouteData } from "./ShareRouteCardBody";

export type { ShareRouteData, RouteStop } from "./ShareRouteCardBody";

const WHITE = "#FFFFFF";
const DARK = "#121212";
const AMBER = "#FFE500";
const SANS = Platform.select({ ios: "System", default: "sans-serif" });

export interface ShareRouteCardHandle {
  open: (data: ShareRouteData) => void;
}

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get("window");
// The card is 9:16, so on most phones the preview area's height — not the
// screen width — is what limits how big it can be drawn. Fit against both.
const PREVIEW_MAX_W = SCREEN_W - 32;
const PREVIEW_MAX_H = SCREEN_H * 0.62;
const PREVIEW_SCALE = Math.min(PREVIEW_MAX_W / CARD_W, PREVIEW_MAX_H / CARD_H);
const PREVIEW_W = CARD_W * PREVIEW_SCALE;
const PREVIEW_H = CARD_H * PREVIEW_SCALE;

const ShareRouteCard = forwardRef<ShareRouteCardHandle, {}>((_props, ref) => {
  const { t } = useTranslation();
  const shotRef = useRef<ViewShot | null>(null);
  const [data, setData] = useState<ShareRouteData | null>(null);
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);

  useImperativeHandle(ref, () => ({
    open: (d: ShareRouteData) => {
      setData(d);
      setVisible(true);
    },
  }));

  const capture = useCallback(async (): Promise<string | null> => {
    await new Promise((resolve) => setTimeout(resolve, 600));
    if (!shotRef.current) return null;
    try {
      return await captureRef(shotRef, {
        format: "png",
        quality: 1.0,
        width: 1080,
        height: 1920,
      });
    } catch (err) {
      console.error("Route card capture failed:", err);
      return null;
    }
  }, []);

  const doShare = useCallback(async () => {
    try {
      setBusy(true);
      const uri = await capture();
      if (!uri) {
        Alert.alert(t("common.error"), t("shareCard.generationFailed"));
        return;
      }
      const fileName = `planera-route-day-${data?.dayNumber || 1}.png`;
      const source = new File(uri);
      const dest = new File(Paths.cache, fileName);
      if (dest.exists) dest.delete();
      source.copy(dest);

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(dest.uri, {
          mimeType: "image/png",
          dialogTitle: t("shareRoute.title"),
          UTI: "public.png",
        });
      }
      setVisible(false);
    } catch (err: any) {
      if (err?.message !== "User did not share") {
        console.error("Route share failed:", err);
        Alert.alert(t("common.error"), t("shareCard.shareFailed"));
      }
    } finally {
      setBusy(false);
    }
  }, [capture, data?.dayNumber, t]);

  const doSave = useCallback(async () => {
    try {
      setBusy(true);
      const { status } = await MediaLibrary.requestPermissionsAsync();
      if (status !== "granted") {
        Alert.alert(t("common.error"), t("shareCard.galleryPermission"));
        return;
      }
      const uri = await capture();
      if (!uri) {
        Alert.alert(t("common.error"), t("shareCard.generationFailed"));
        return;
      }
      await MediaLibrary.saveToLibraryAsync(uri);
      Alert.alert(t("common.success"), t("shareCard.savedToGallery"));
      setVisible(false);
    } catch (err) {
      console.error("Route save failed:", err);
      Alert.alert(t("common.error"), t("shareCard.saveFailed"));
    } finally {
      setBusy(false);
    }
  }, [capture, t]);

  return (
    <>
      {/* Off-screen capture target */}
      <View style={styles.offscreen} pointerEvents="none">
        <ViewShot
          ref={(r) => { shotRef.current = r; }}
          options={{ format: "png", quality: 1.0, width: 1080, height: 1920 }}
        >
          {data && <ShareRouteCardBody data={data} />}
        </ViewShot>
      </View>

      <Modal visible={visible} animationType="slide" onRequestClose={() => setVisible(false)}>
        <View style={styles.modal}>
          <View style={styles.modalHeader}>
            <TouchableOpacity style={styles.closeBtn} onPress={() => setVisible(false)}>
              <Text style={styles.closeBtnText}>✕</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>{t("shareRoute.title")}</Text>
            <View style={{ width: 36 }} />
          </View>

          <View style={styles.previewArea}>
            <View style={[styles.previewFrame, { width: PREVIEW_W, height: PREVIEW_H }]}>
              <View style={{ transform: [{ scale: PREVIEW_SCALE }], transformOrigin: "0% 0%" }}>
                {data && <ShareRouteCardBody data={data} />}
              </View>
            </View>
          </View>

          <View style={styles.actions}>
            <TouchableOpacity style={styles.shareBtn} onPress={doShare} disabled={busy}>
              {busy ? <ActivityIndicator size="small" color={DARK} /> : (
                <Text style={styles.shareBtnText}>{t("shareRoute.shareDay")}</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity style={styles.saveBtn} onPress={doSave} disabled={busy}>
              <Text style={styles.saveBtnText}>{t("shareCard.saveToGallery")}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </>
  );
});

ShareRouteCard.displayName = "ShareRouteCard";
export default ShareRouteCard;

const styles = StyleSheet.create({
  offscreen: { position: "absolute", left: -9999, top: -9999 },

  // ── Modal ──
  modal: {
    flex: 1,
    backgroundColor: "#111118",
    paddingTop: Platform.OS === "ios" ? 56 : 24,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.1)",
    alignItems: "center",
    justifyContent: "center",
  },
  closeBtnText: { color: WHITE, fontSize: 18, fontWeight: "600" },
  modalTitle: { fontFamily: SANS, fontSize: 17, fontWeight: "600", color: WHITE },
  previewArea: { flex: 1, alignItems: "center", justifyContent: "center" },
  previewFrame: {
    borderRadius: 16,
    overflow: "hidden",
    backgroundColor: "#000",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 20,
    elevation: 12,
  },
  actions: {
    paddingHorizontal: 16,
    paddingBottom: Platform.OS === "ios" ? 40 : 24,
    paddingTop: 12,
    gap: 10,
  },
  shareBtn: {
    height: 50,
    backgroundColor: AMBER,
    borderRadius: 25,
    alignItems: "center",
    justifyContent: "center",
  },
  shareBtnText: { fontFamily: SANS, fontWeight: "700", fontSize: 16, color: DARK },
  saveBtn: {
    height: 50,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: 25,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
  },
  saveBtnText: { fontFamily: SANS, fontWeight: "600", fontSize: 16, color: WHITE },
});
