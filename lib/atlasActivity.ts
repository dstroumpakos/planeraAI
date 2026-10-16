import { useSyncExternalStore } from "react";

// Whether Atlas is working on a reply. Set by the Atlas screen, read by the tab
// bar so its Atlas icon keeps spinning the globe even after the user switches tabs.
let busy = false;
const listeners = new Set<() => void>();

export function setAtlasBusy(value: boolean) {
    if (busy === value) return;
    busy = value;
    listeners.forEach((l) => l());
}

const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
};
const getSnapshot = () => busy;

export function useAtlasBusy() {
    return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
