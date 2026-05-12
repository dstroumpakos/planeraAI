/**
 * Admin: OTA partner packages management screen.
 * Lists partners + their packages, allows creating/editing both.
 */
import React, { useState, useMemo } from "react";
import {
    View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator,
    StatusBar, Modal, TextInput, KeyboardAvoidingView, Platform, Alert, Switch,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useToken } from "@/lib/useAuthenticatedMutation";
import { useTheme } from "@/lib/ThemeContext";

const INCLUDE_OPTIONS = [
    "flights","hotel","transfers","breakfast","half_board","full_board",
    "all_inclusive","tours","activities","insurance","guide",
];

export default function AdminPackagesScreen() {
    const router = useRouter();
    const { token } = useToken();
    const { colors, isDarkMode } = useTheme();

    const partners = useQuery((api as any).otaAdmin.listPartners, token ? { token } : "skip");
    const packages = useQuery((api as any).otaAdmin.listAllPackages, token ? { token } : "skip");

    const createPartner = useMutation((api as any).otaAdmin.createPartner);
    const updatePartner = useMutation((api as any).otaAdmin.updatePartner);
    const createPkg = useMutation((api as any).otaAdmin.createPackage);
    const updatePkg = useMutation((api as any).otaAdmin.updatePackage);
    const deletePkg = useMutation((api as any).otaAdmin.deletePackage);

    const [partnerModal, setPartnerModal] = useState<any>(null);
    const [packageModal, setPackageModal] = useState<any>(null);

    const groupedPackages = useMemo(() => {
        if (!packages) return {};
        const g: Record<string, any[]> = {};
        for (const p of packages) {
            const pid = String(p.partnerId);
            if (!g[pid]) g[pid] = [];
            g[pid].push(p);
        }
        return g;
    }, [packages]);

    const loading = partners === undefined || packages === undefined;

    return (
        <>
            <StatusBar barStyle={isDarkMode ? "light-content" : "dark-content"} />
            <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
                <View style={[styles.header, { borderBottomColor: colors.border }]}>
                    <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn}>
                        <Ionicons name="chevron-back" size={24} color={colors.text} />
                    </TouchableOpacity>
                    <Text style={[styles.headerTitle, { color: colors.text }]}>OTA Packages</Text>
                    <TouchableOpacity
                        style={[styles.headerCta, { backgroundColor: colors.primary }]}
                        onPress={() => setPartnerModal({})}
                    >
                        <Ionicons name="add" size={18} color="#fff" />
                        <Text style={styles.headerCtaText}>Partner</Text>
                    </TouchableOpacity>
                </View>

                {loading ? (
                    <View style={styles.loading}>
                        <ActivityIndicator size="large" color={colors.primary} />
                    </View>
                ) : (
                    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
                        {partners?.length === 0 ? (
                            <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                                <Ionicons name="briefcase-outline" size={36} color={colors.textMuted} />
                                <Text style={[styles.emptyTitle, { color: colors.text }]}>No partners yet</Text>
                                <Text style={[styles.emptyDesc, { color: colors.textMuted }]}>Add your first OTA partner to begin listing packages.</Text>
                                <TouchableOpacity
                                    style={[styles.primaryBtn, { backgroundColor: colors.primary }]}
                                    onPress={() => setPartnerModal({})}
                                >
                                    <Text style={styles.primaryBtnText}>Add Partner</Text>
                                </TouchableOpacity>
                            </View>
                        ) : partners.map((p: any) => {
                            const partnerPkgs = groupedPackages[String(p._id)] || [];
                            return (
                                <View key={p._id} style={[styles.partnerCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                                    <View style={styles.partnerHeader}>
                                        <View style={{ flex: 1 }}>
                                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                                                <Text style={[styles.partnerName, { color: colors.text }]}>{p.name}</Text>
                                                {!p.active && (
                                                    <View style={styles.inactivePill}>
                                                        <Text style={styles.inactivePillText}>INACTIVE</Text>
                                                    </View>
                                                )}
                                            </View>
                                            <Text style={[styles.partnerMeta, { color: colors.textMuted }]}>
                                                {p.contactEmail} · {partnerPkgs.length} package{partnerPkgs.length === 1 ? '' : 's'}
                                            </Text>
                                        </View>
                                        <TouchableOpacity onPress={() => setPartnerModal(p)} style={styles.iconBtn}>
                                            <Ionicons name="create-outline" size={20} color={colors.textMuted} />
                                        </TouchableOpacity>
                                    </View>

                                    {partnerPkgs.map((pkg: any) => (
                                        <TouchableOpacity
                                            key={pkg._id}
                                            style={[styles.pkgRow, { borderTopColor: colors.border }]}
                                            onPress={() => setPackageModal({ ...pkg, partnerId: pkg.partnerId })}
                                        >
                                            <View style={[styles.pkgIcon, { backgroundColor: isDarkMode ? 'rgba(14,165,233,0.18)' : '#dbeafe' }]}>
                                                <Ionicons name="airplane" size={18} color="#0EA5E9" />
                                            </View>
                                            <View style={{ flex: 1 }}>
                                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                                                    <Text style={[styles.pkgTitle, { color: colors.text }]} numberOfLines={1}>{pkg.title}</Text>
                                                    {!pkg.active && <View style={styles.inactivePill}><Text style={styles.inactivePillText}>OFF</Text></View>}
                                                </View>
                                                <Text style={[styles.pkgMeta, { color: colors.textMuted }]} numberOfLines={1}>
                                                    {pkg.destinationCity ? `${pkg.destinationCity}, ` : ''}{pkg.destinationCountry} · {pkg.durationDays}d · {pkg.priceCurrency} {pkg.priceFrom}
                                                </Text>
                                                <Text style={[styles.pkgStats, { color: colors.textMuted }]}>
                                                    👁 {pkg.viewCount ?? 0} · ✉ {pkg.leadCount ?? 0}
                                                </Text>
                                            </View>
                                            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                                        </TouchableOpacity>
                                    ))}

                                    <TouchableOpacity
                                        style={[styles.addPkgBtn, { borderColor: colors.border }]}
                                        onPress={() => setPackageModal({ partnerId: p._id, active: true, includes: [], imageUrls: [], priceCurrency: 'EUR', priceUnit: 'per_person' })}
                                    >
                                        <Ionicons name="add" size={16} color={colors.primary} />
                                        <Text style={[styles.addPkgText, { color: colors.primary }]}>Add Package</Text>
                                    </TouchableOpacity>
                                </View>
                            );
                        })}
                    </ScrollView>
                )}

                {/* Partner editor */}
                <PartnerEditorModal
                    visible={!!partnerModal}
                    initial={partnerModal}
                    onClose={() => setPartnerModal(null)}
                    onSave={async (data) => {
                        if (!token) return;
                        try {
                            if (data._id) {
                                await updatePartner({ token, partnerId: data._id, ...data });
                            } else {
                                await createPartner({ token, ...data });
                            }
                            setPartnerModal(null);
                        } catch (e: any) {
                            Alert.alert("Error", e?.message || "Failed to save partner");
                        }
                    }}
                />

                {/* Package editor */}
                <PackageEditorModal
                    visible={!!packageModal}
                    initial={packageModal}
                    onClose={() => setPackageModal(null)}
                    onSave={async (data) => {
                        if (!token) return;
                        try {
                            if (data._id) {
                                await updatePkg({ token, packageId: data._id, ...data });
                            } else {
                                await createPkg({ token, ...data });
                            }
                            setPackageModal(null);
                        } catch (e: any) {
                            Alert.alert("Error", e?.message || "Failed to save package");
                        }
                    }}
                    onDelete={async (id) => {
                        if (!token) return;
                        Alert.alert("Delete package?", "It will be deactivated (soft-delete).", [
                            { text: "Cancel", style: "cancel" },
                            { text: "Delete", style: "destructive", onPress: async () => {
                                try {
                                    await deletePkg({ token, packageId: id });
                                    setPackageModal(null);
                                } catch (e: any) {
                                    Alert.alert("Error", e?.message || "Failed");
                                }
                            } }
                        ]);
                    }}
                />
            </SafeAreaView>
        </>
    );
}

// ─────────────────────────────────────────────────────────
// Partner editor modal
// ─────────────────────────────────────────────────────────

function PartnerEditorModal({ visible, initial, onClose, onSave }: any) {
    const { colors, isDarkMode } = useTheme();
    const [name, setName] = useState("");
    const [slug, setSlug] = useState("");
    const [description, setDescription] = useState("");
    const [logoUrl, setLogoUrl] = useState("");
    const [websiteUrl, setWebsiteUrl] = useState("");
    const [contactEmail, setContactEmail] = useState("");
    const [phone, setPhone] = useState("");
    const [disclaimer, setDisclaimer] = useState("");
    const [active, setActive] = useState(true);

    React.useEffect(() => {
        if (visible) {
            setName(initial?.name || "");
            setSlug(initial?.slug || "");
            setDescription(initial?.description || "");
            setLogoUrl(initial?.logoUrl || "");
            setWebsiteUrl(initial?.websiteUrl || "");
            setContactEmail(initial?.contactEmail || "");
            setPhone(initial?.phone || "");
            setDisclaimer(initial?.disclaimer || "");
            setActive(initial?.active ?? true);
        }
    }, [visible, initial]);

    const submit = () => {
        if (!name.trim() || !slug.trim() || !contactEmail.trim()) {
            Alert.alert("Missing fields", "Name, slug, and contact email are required.");
            return;
        }
        onSave({
            _id: initial?._id,
            name, slug, description, logoUrl, websiteUrl, contactEmail, phone, disclaimer, active,
        });
    };

    const inputStyle = [
        styles.input,
        { backgroundColor: isDarkMode ? "rgba(255,255,255,0.05)" : "#f9fafb", color: colors.text, borderColor: colors.border },
    ];

    return (
        <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
            <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
                <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
                    <TouchableOpacity onPress={onClose}><Text style={[styles.cancelText, { color: colors.textMuted }]}>Cancel</Text></TouchableOpacity>
                    <Text style={[styles.modalTitle, { color: colors.text }]}>{initial?._id ? "Edit Partner" : "New Partner"}</Text>
                    <TouchableOpacity onPress={submit}><Text style={[styles.saveText, { color: colors.primary }]}>Save</Text></TouchableOpacity>
                </View>
                <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
                    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60 }}>
                        <Label color={colors.textMuted}>Name *</Label>
                        <TextInput style={inputStyle} value={name} onChangeText={setName} placeholder="Acme Travel" placeholderTextColor={colors.textMuted} />
                        <Label color={colors.textMuted}>Slug *</Label>
                        <TextInput style={inputStyle} value={slug} onChangeText={(v) => setSlug(v.toLowerCase().replace(/[^a-z0-9-]/g, ''))} placeholder="acme-travel" placeholderTextColor={colors.textMuted} autoCapitalize="none" editable={!initial?._id} />
                        <Label color={colors.textMuted}>Contact email *</Label>
                        <TextInput style={inputStyle} value={contactEmail} onChangeText={setContactEmail} placeholder="leads@partner.com" placeholderTextColor={colors.textMuted} keyboardType="email-address" autoCapitalize="none" />
                        <Label color={colors.textMuted}>Phone</Label>
                        <TextInput style={inputStyle} value={phone} onChangeText={setPhone} placeholder="+30 210..." placeholderTextColor={colors.textMuted} />
                        <Label color={colors.textMuted}>Website</Label>
                        <TextInput style={inputStyle} value={websiteUrl} onChangeText={setWebsiteUrl} placeholder="https://..." placeholderTextColor={colors.textMuted} autoCapitalize="none" />
                        <Label color={colors.textMuted}>Logo URL</Label>
                        <TextInput style={inputStyle} value={logoUrl} onChangeText={setLogoUrl} placeholder="https://..." placeholderTextColor={colors.textMuted} autoCapitalize="none" />
                        <Label color={colors.textMuted}>Description</Label>
                        <TextInput style={[inputStyle, { minHeight: 80 }]} value={description} onChangeText={setDescription} multiline textAlignVertical="top" placeholderTextColor={colors.textMuted} />
                        <Label color={colors.textMuted}>Disclaimer</Label>
                        <TextInput style={[inputStyle, { minHeight: 60 }]} value={disclaimer} onChangeText={setDisclaimer} multiline textAlignVertical="top" placeholderTextColor={colors.textMuted} />
                        <View style={styles.switchRow}>
                            <Text style={{ color: colors.text, fontSize: 15, fontWeight: '600' }}>Active</Text>
                            <Switch value={active} onValueChange={setActive} />
                        </View>
                    </ScrollView>
                </KeyboardAvoidingView>
            </SafeAreaView>
        </Modal>
    );
}

// ─────────────────────────────────────────────────────────
// Package editor modal
// ─────────────────────────────────────────────────────────

function PackageEditorModal({ visible, initial, onClose, onSave, onDelete }: any) {
    const { colors, isDarkMode } = useTheme();
    const [title, setTitle] = useState("");
    const [subtitle, setSubtitle] = useState("");
    const [description, setDescription] = useState("");
    const [destinationCity, setDestinationCity] = useState("");
    const [destinationCountry, setDestinationCountry] = useState("");
    const [destinationCountryCode, setDestinationCountryCode] = useState("");
    const [durationDays, setDurationDays] = useState("");
    const [minDurationDays, setMinDurationDays] = useState("");
    const [maxDurationDays, setMaxDurationDays] = useState("");
    const [priceFrom, setPriceFrom] = useState("");
    const [priceCurrency, setPriceCurrency] = useState("EUR");
    const [priceUnit, setPriceUnit] = useState<"per_person" | "per_couple" | "total">("per_person");
    const [includes, setIncludes] = useState<string[]>([]);
    const [highlights, setHighlights] = useState("");
    const [imageUrls, setImageUrls] = useState("");
    const [externalUrl, setExternalUrl] = useState("");
    const [badge, setBadge] = useState("");
    const [active, setActive] = useState(true);

    React.useEffect(() => {
        if (visible) {
            setTitle(initial?.title || "");
            setSubtitle(initial?.subtitle || "");
            setDescription(initial?.description || "");
            setDestinationCity(initial?.destinationCity || "");
            setDestinationCountry(initial?.destinationCountry || "");
            setDestinationCountryCode(initial?.destinationCountryCode || "");
            setDurationDays(initial?.durationDays?.toString() || "");
            setMinDurationDays(initial?.minDurationDays?.toString() || "");
            setMaxDurationDays(initial?.maxDurationDays?.toString() || "");
            setPriceFrom(initial?.priceFrom?.toString() || "");
            setPriceCurrency(initial?.priceCurrency || "EUR");
            setPriceUnit(initial?.priceUnit || "per_person");
            setIncludes(initial?.includes || []);
            setHighlights((initial?.highlights || []).join("\n"));
            setImageUrls((initial?.imageUrls || []).join("\n"));
            setExternalUrl(initial?.externalUrl || "");
            setBadge(initial?.badge || "");
            setActive(initial?.active ?? true);
        }
    }, [visible, initial]);

    const submit = () => {
        if (!title.trim() || !destinationCountry.trim() || !durationDays || !priceFrom) {
            Alert.alert("Missing fields", "Title, country, duration, and price are required.");
            return;
        }
        const imgs = imageUrls.split(/\n+/).map(s => s.trim()).filter(Boolean);
        const hls = highlights.split(/\n+/).map(s => s.trim()).filter(Boolean);
        onSave({
            _id: initial?._id,
            partnerId: initial?.partnerId,
            title, subtitle, description,
            destinationCity: destinationCity || undefined,
            destinationCountry,
            destinationCountryCode: destinationCountryCode || undefined,
            durationDays: Number(durationDays),
            minDurationDays: minDurationDays ? Number(minDurationDays) : undefined,
            maxDurationDays: maxDurationDays ? Number(maxDurationDays) : undefined,
            priceFrom: Number(priceFrom),
            priceCurrency: priceCurrency.toUpperCase(),
            priceUnit,
            includes,
            highlights: hls.length ? hls : undefined,
            imageUrls: imgs,
            heroImageUrl: imgs[0],
            externalUrl: externalUrl || undefined,
            badge: badge || undefined,
            active,
        });
    };

    const toggleInclude = (k: string) => {
        setIncludes(prev => prev.includes(k) ? prev.filter(x => x !== k) : [...prev, k]);
    };

    const inputStyle = [
        styles.input,
        { backgroundColor: isDarkMode ? "rgba(255,255,255,0.05)" : "#f9fafb", color: colors.text, borderColor: colors.border },
    ];

    return (
        <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
            <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
                <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
                    <TouchableOpacity onPress={onClose}><Text style={[styles.cancelText, { color: colors.textMuted }]}>Cancel</Text></TouchableOpacity>
                    <Text style={[styles.modalTitle, { color: colors.text }]}>{initial?._id ? "Edit Package" : "New Package"}</Text>
                    <TouchableOpacity onPress={submit}><Text style={[styles.saveText, { color: colors.primary }]}>Save</Text></TouchableOpacity>
                </View>
                <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
                    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60 }}>
                        <Label color={colors.textMuted}>Title *</Label>
                        <TextInput style={inputStyle} value={title} onChangeText={setTitle} placeholderTextColor={colors.textMuted} placeholder="7-Day Santorini Escape" />
                        <Label color={colors.textMuted}>Subtitle / tagline</Label>
                        <TextInput style={inputStyle} value={subtitle} onChangeText={setSubtitle} placeholderTextColor={colors.textMuted} placeholder="Sunset views, half-board, all transfers" />
                        <Label color={colors.textMuted}>Description</Label>
                        <TextInput style={[inputStyle, { minHeight: 100 }]} value={description} onChangeText={setDescription} multiline textAlignVertical="top" placeholderTextColor={colors.textMuted} />

                        <View style={{ flexDirection: 'row', gap: 8 }}>
                            <View style={{ flex: 1 }}>
                                <Label color={colors.textMuted}>City</Label>
                                <TextInput style={inputStyle} value={destinationCity} onChangeText={setDestinationCity} placeholderTextColor={colors.textMuted} placeholder="Santorini" />
                            </View>
                            <View style={{ flex: 1 }}>
                                <Label color={colors.textMuted}>Country *</Label>
                                <TextInput style={inputStyle} value={destinationCountry} onChangeText={setDestinationCountry} placeholderTextColor={colors.textMuted} placeholder="Greece" />
                            </View>
                            <View style={{ width: 70 }}>
                                <Label color={colors.textMuted}>ISO</Label>
                                <TextInput style={inputStyle} value={destinationCountryCode} onChangeText={(v) => setDestinationCountryCode(v.toLowerCase())} placeholderTextColor={colors.textMuted} placeholder="gr" autoCapitalize="none" maxLength={2} />
                            </View>
                        </View>

                        <View style={{ flexDirection: 'row', gap: 8 }}>
                            <View style={{ flex: 1 }}>
                                <Label color={colors.textMuted}>Duration (days) *</Label>
                                <TextInput style={inputStyle} value={durationDays} onChangeText={setDurationDays} placeholderTextColor={colors.textMuted} keyboardType="number-pad" />
                            </View>
                            <View style={{ flex: 1 }}>
                                <Label color={colors.textMuted}>Min</Label>
                                <TextInput style={inputStyle} value={minDurationDays} onChangeText={setMinDurationDays} placeholderTextColor={colors.textMuted} keyboardType="number-pad" />
                            </View>
                            <View style={{ flex: 1 }}>
                                <Label color={colors.textMuted}>Max</Label>
                                <TextInput style={inputStyle} value={maxDurationDays} onChangeText={setMaxDurationDays} placeholderTextColor={colors.textMuted} keyboardType="number-pad" />
                            </View>
                        </View>

                        <View style={{ flexDirection: 'row', gap: 8 }}>
                            <View style={{ flex: 2 }}>
                                <Label color={colors.textMuted}>Price from *</Label>
                                <TextInput style={inputStyle} value={priceFrom} onChangeText={setPriceFrom} placeholderTextColor={colors.textMuted} keyboardType="decimal-pad" placeholder="599" />
                            </View>
                            <View style={{ flex: 1 }}>
                                <Label color={colors.textMuted}>Currency</Label>
                                <TextInput style={inputStyle} value={priceCurrency} onChangeText={(v) => setPriceCurrency(v.toUpperCase())} placeholderTextColor={colors.textMuted} autoCapitalize="characters" maxLength={3} />
                            </View>
                        </View>

                        <Label color={colors.textMuted}>Price unit</Label>
                        <View style={{ flexDirection: 'row', gap: 8 }}>
                            {(["per_person", "per_couple", "total"] as const).map(u => (
                                <TouchableOpacity
                                    key={u}
                                    style={[styles.segItem, { borderColor: priceUnit === u ? colors.primary : colors.border, backgroundColor: priceUnit === u ? colors.primary : 'transparent' }]}
                                    onPress={() => setPriceUnit(u)}
                                >
                                    <Text style={{ color: priceUnit === u ? '#fff' : colors.text, fontSize: 12, fontWeight: '600' }}>{u.replace('_', ' ')}</Text>
                                </TouchableOpacity>
                            ))}
                        </View>

                        <Label color={colors.textMuted}>What's included</Label>
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                            {INCLUDE_OPTIONS.map(opt => {
                                const on = includes.includes(opt);
                                return (
                                    <TouchableOpacity
                                        key={opt}
                                        style={[styles.includeChip, { borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primary : 'transparent' }]}
                                        onPress={() => toggleInclude(opt)}
                                    >
                                        <Text style={{ fontSize: 11, fontWeight: '600', color: on ? '#fff' : colors.text }}>{opt.replace('_', ' ')}</Text>
                                    </TouchableOpacity>
                                );
                            })}
                        </View>

                        <Label color={colors.textMuted}>Highlights (one per line)</Label>
                        <TextInput style={[inputStyle, { minHeight: 80 }]} value={highlights} onChangeText={setHighlights} multiline textAlignVertical="top" placeholderTextColor={colors.textMuted} />

                        <Label color={colors.textMuted}>Image URLs (one per line)</Label>
                        <TextInput style={[inputStyle, { minHeight: 80 }]} value={imageUrls} onChangeText={setImageUrls} multiline textAlignVertical="top" placeholderTextColor={colors.textMuted} autoCapitalize="none" />

                        <Label color={colors.textMuted}>Badge (e.g. "Best Seller")</Label>
                        <TextInput style={inputStyle} value={badge} onChangeText={setBadge} placeholderTextColor={colors.textMuted} />

                        <Label color={colors.textMuted}>External URL</Label>
                        <TextInput style={inputStyle} value={externalUrl} onChangeText={setExternalUrl} placeholderTextColor={colors.textMuted} autoCapitalize="none" />

                        <View style={styles.switchRow}>
                            <Text style={{ color: colors.text, fontSize: 15, fontWeight: '600' }}>Active</Text>
                            <Switch value={active} onValueChange={setActive} />
                        </View>

                        {initial?._id && (
                            <TouchableOpacity
                                style={[styles.deleteBtn, { borderColor: '#ef4444' }]}
                                onPress={() => onDelete(initial._id)}
                            >
                                <Ionicons name="trash" size={16} color="#ef4444" />
                                <Text style={{ color: '#ef4444', fontWeight: '700' }}>Deactivate Package</Text>
                            </TouchableOpacity>
                        )}
                    </ScrollView>
                </KeyboardAvoidingView>
            </SafeAreaView>
        </Modal>
    );
}

function Label({ children, color }: any) {
    return <Text style={{ fontSize: 11, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase', color, marginTop: 14, marginBottom: 6 }}>{children}</Text>;
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1 },
    headerTitle: { fontSize: 17, fontWeight: '700' },
    iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
    headerCta: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999 },
    headerCtaText: { color: '#fff', fontSize: 13, fontWeight: '700' },
    loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    partnerCard: { borderRadius: 14, borderWidth: 1, padding: 14, marginBottom: 14 },
    partnerHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
    partnerName: { fontSize: 16, fontWeight: '700' },
    partnerMeta: { fontSize: 12, marginTop: 2 },
    inactivePill: { backgroundColor: '#9ca3af', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
    inactivePillText: { color: '#fff', fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },
    pkgRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderTopWidth: 1 },
    pkgIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
    pkgTitle: { fontSize: 14, fontWeight: '700', flexShrink: 1 },
    pkgMeta: { fontSize: 12, marginTop: 1 },
    pkgStats: { fontSize: 11, marginTop: 2 },
    addPkgBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderStyle: 'dashed', marginTop: 10 },
    addPkgText: { fontSize: 13, fontWeight: '700' },
    emptyCard: { padding: 28, borderRadius: 16, borderWidth: 1, alignItems: 'center', gap: 8 },
    emptyTitle: { fontSize: 16, fontWeight: '700', marginTop: 6 },
    emptyDesc: { fontSize: 13, textAlign: 'center' },
    primaryBtn: { paddingHorizontal: 18, paddingVertical: 11, borderRadius: 999, marginTop: 12 },
    primaryBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
    modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1 },
    modalTitle: { fontSize: 16, fontWeight: '700' },
    cancelText: { fontSize: 15 },
    saveText: { fontSize: 15, fontWeight: '700' },
    input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 },
    switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 20 },
    segItem: { flex: 1, paddingVertical: 10, borderRadius: 10, borderWidth: 1, alignItems: 'center' },
    includeChip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, borderWidth: 1 },
    deleteBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, borderRadius: 10, borderWidth: 1, marginTop: 24 },
});
