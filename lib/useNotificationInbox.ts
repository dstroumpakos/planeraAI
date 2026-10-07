import { useEffect, useState } from "react";
import { useConvex } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useToken } from "@/lib/useAuthenticatedMutation";

export type InboxItem = {
    _id: string;
    type: string;
    category: "deals" | "trips" | "account" | "general";
    title: string;
    body: string;
    sentAt: number;
    read: boolean;
    data: Record<string, string> | null;
};

export type InboxPage = { items: InboxItem[]; hasMore: boolean; unread: number };

/**
 * Subscribe to a query without letting a server error throw into the tree.
 *
 * `useQuery` rethrows function errors during render. The unread count is read
 * from the root layout, so an app build that reaches users before the matching
 * Convex deploy (function not found) would take the whole app down instead of
 * just showing no badge. Here an error surfaces as `{ error: true }`.
 */
function useTolerantQuery<T>(query: any, args: Record<string, any> | "skip"): { data: T | undefined; error: boolean } {
    const convex = useConvex();
    const [state, setState] = useState<{ data: T | undefined; error: boolean }>({ data: undefined, error: false });
    const argsKey = args === "skip" ? "skip" : JSON.stringify(args);

    useEffect(() => {
        if (args === "skip") {
            setState({ data: undefined, error: false });
            return;
        }
        const watch = convex.watchQuery(query, args as any);
        const read = () => {
            try {
                const value = watch.localQueryResult() as T | undefined;
                if (value !== undefined) setState({ data: value, error: false });
            } catch (e) {
                console.warn("[NotificationInbox] query failed:", e);
                setState((s) => ({ data: s.data, error: true }));
            }
        };
        read();
        const unsubscribe = watch.onUpdate(read);
        return () => unsubscribe();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [convex, argsKey]);

    return state;
}

/** Unread inbox count for badges. 0 while loading, signed out or on error. */
export function useUnreadNotificationCount(): number {
    const { token } = useToken();
    const { data } = useTolerantQuery<number | null>(
        (api as any).notifications.getUnreadCount,
        token && token !== "skip" ? { token } : "skip"
    );
    return typeof data === "number" ? data : 0;
}

/** Newest-first inbox; grow `limit` for "load more". */
export function useNotificationInbox(limit: number): { page: InboxPage | undefined; error: boolean } {
    const { token } = useToken();
    const { data, error } = useTolerantQuery<InboxPage | null>(
        (api as any).notifications.listMine,
        token && token !== "skip" ? { token, limit } : "skip"
    );
    return { page: data ?? undefined, error };
}

/** "99+" style label for a badge. */
export function badgeLabel(count: number): string {
    return count > 99 ? "99+" : String(count);
}
