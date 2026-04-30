/**
 * WorldGlobe — true 3D rotating globe via WebView + globe.gl.
 *
 * Renders an HTML canvas inside a WebView. The same `GlobeVisit` props
 * are forwarded to JS via postMessage so the screen code is unchanged.
 */

import React, { useEffect, useRef, useState, forwardRef, useImperativeHandle } from "react";
import { StyleSheet, View, Platform } from "react-native";
import { WebView, WebViewMessageEvent } from "react-native-webview";
import { Asset } from "expo-asset";

export type GlobeVisit = {
  cityId: string;
  city: {
    id: string;
    name: string;
    country: string;
    countryCode: string;
    lat: number;
    lng: number;
  };
  status: "claimed" | "planned" | "verified" | "holographic";
};

type Props = {
  visits: GlobeVisit[];
  signatureColor: string;
  dimLevel?: number;
  onCityPress?: (cityId: string) => void;
  style?: any;
};

export interface WorldGlobeHandle {
  /** Capture the current globe canvas as a base64 data URL (PNG). */
  captureSnapshot: (timeoutMs?: number) => Promise<string | null>;
}

// eslint-disable-next-line @typescript-eslint/no-var-requires
const GLOBE_HTML = require("../assets/globe/globe.html");

const WorldGlobe = forwardRef<WorldGlobeHandle, Props>(function WorldGlobe(
  { visits, signatureColor, dimLevel = 0, onCityPress, style },
  ref
) {
  const webRef = useRef<WebView>(null);
  const readyRef = useRef(false);
  const [htmlUri, setHtmlUri] = useState<string | null>(null);
  const pendingSnapshotsRef = useRef<
    Map<string, { resolve: (v: string | null) => void; timer: any }>
  >(new Map());

  // Resolve the bundled HTML file to a local URI we can load.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const asset = Asset.fromModule(GLOBE_HTML);
        await asset.downloadAsync();
        if (!cancelled) setHtmlUri(asset.localUri || asset.uri);
      } catch {
        if (!cancelled) setHtmlUri(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Push state into the webview whenever inputs change (after ready).
  const pushState = () => {
    if (!webRef.current || !readyRef.current) return;
    const payload = JSON.stringify({
      type: "setState",
      visits,
      signatureColor,
      dimLevel,
    });
    const escaped = JSON.stringify(payload);
    webRef.current.injectJavaScript(
      `(function(){try{window.postMessage(${escaped}, '*');document.dispatchEvent(new MessageEvent('message',{data:${escaped}}));}catch(e){};true;})();`
    );
  };

  useEffect(() => {
    pushState();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visits, signatureColor, dimLevel]);

  const handleMessage = (e: WebViewMessageEvent) => {
    let msg: any;
    try {
      msg = JSON.parse(e.nativeEvent.data);
    } catch {
      return;
    }
    if (msg?.type === "ready") {
      readyRef.current = true;
      pushState();
    } else if (msg?.type === "cityPress" && msg.cityId) {
      onCityPress?.(msg.cityId);
    } else if (msg?.type === "log") {
      // eslint-disable-next-line no-console
      console.log("[WorldGlobe]", msg.level || "log", ...(msg.args || []));
    } else if (msg?.type === "error") {
      // eslint-disable-next-line no-console
      console.warn("[WorldGlobe error]", msg.message, msg.source, msg.line);
    } else if (msg?.type === "snapshot") {
      const pending = pendingSnapshotsRef.current.get(msg.requestId);
      if (pending) {
        clearTimeout(pending.timer);
        pendingSnapshotsRef.current.delete(msg.requestId);
        pending.resolve(msg.error ? null : msg.dataUrl ?? null);
      }
    }
  };

  useImperativeHandle(
    ref,
    () => ({
      captureSnapshot: (timeoutMs = 2500) =>
        new Promise<string | null>((resolve) => {
          if (!webRef.current || !readyRef.current) {
            resolve(null);
            return;
          }
          const requestId = `snap_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          const timer = setTimeout(() => {
            pendingSnapshotsRef.current.delete(requestId);
            resolve(null);
          }, timeoutMs);
          pendingSnapshotsRef.current.set(requestId, { resolve, timer });
          const payload = JSON.stringify({ type: "snapshot", requestId });
          const escaped = JSON.stringify(payload);
          webRef.current.injectJavaScript(
            `(function(){try{window.postMessage(${escaped}, '*');document.dispatchEvent(new MessageEvent('message',{data:${escaped}}));}catch(e){};true;})();`
          );
        }),
    }),
    []
  );

  if (!htmlUri) {
    return <View style={[styles.container, style, { backgroundColor: "#050A14" }]} />;
  }

  return (
    <View style={[styles.container, style]}>
      <WebView
        ref={webRef}
        source={{ uri: htmlUri }}
        style={styles.web}
        originWhitelist={["*"]}
        javaScriptEnabled
        domStorageEnabled
        allowFileAccess
        allowFileAccessFromFileURLs
        allowUniversalAccessFromFileURLs
        mixedContentMode="always"
        onMessage={handleMessage}
        scrollEnabled={false}
        bounces={false}
        overScrollMode="never"
        androidLayerType="hardware"
        setSupportMultipleWindows={false}
        textZoom={100}
        contentMode={Platform.OS === "ios" ? ("mobile" as any) : undefined}
      />
    </View>
  );
});

export default WorldGlobe;

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#050A14",
    overflow: "hidden",
  },
  web: {
    flex: 1,
    backgroundColor: "#050A14",
  },
});
