#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Regenerate convex/unwtoCountryStats.ts from a UN Tourism (UNWTO) bulk download.

Usage:
    python scripts/gen-unwto-stats.py "/path/to/UN_Tourism_bulk_data_download_XX_YYYY"

Expects the standard bulk layout with a `Bulk/02_Inbound/` folder containing:
    01_Total_arrivals/UN_Tourism_inbound_arrivals_*.xlsx
    02_Expenditure/UN_Tourism_inbound_expenditure_*.xlsx
    06_Accommodation_guests_and_overnights/UN_Tourism_inbound_accommodation_*.xlsx

Computes per country (partner = World):
    spendPerTripEUR = inbound 'travel' expenditure (BoP visitor spend in-country)
                      / overnight-tourist arrivals, latest year in [MIN_YEAR..now]
                      excluding COVID years, USD->EUR at USD2EUR, rounded to 10.
    stayDays        = commercial-accommodation overnights / guests, same window.

Requires: openpyxl  (pip install openpyxl)
"""
import sys, os, re, io, glob
import openpyxl

USD2EUR = 0.92
SKIP_YEARS = {2020, 2021}
MIN_YEAR = 2015

EXP_CODE = "INBD_EXPD_BPAY_TRVL_VSTR"   # inbound travel expenditure (visitors)
ARR_CODE = "INBD_TRIP_TOTL_TOTL_TOUR"   # inbound overnight tourists
NGT_CODE = "INBD_ACCM_COMM_NGHT"        # commercial accommodation overnights
GUE_CODE = "INBD_ACCM_COMM_GUES"        # commercial accommodation guests

ALIASES = {
    "United States of America": ["usa", "united-states", "us"],
    "United Kingdom of Great Britain and Northern Ireland": ["united-kingdom", "uk", "great-britain", "england"],
    "Republic of Korea": ["south-korea", "korea"],
    "China, Hong Kong Special Administrative Region": ["hong-kong"],
    "China, Macao Special Administrative Region": ["macao", "macau"],
    "Taiwan Province of China": ["taiwan"],
    "Russian Federation": ["russia"], "Viet Nam": ["vietnam"],
    "Czechia": ["czech-republic", "czechia"], "United Arab Emirates": ["uae"],
    "Netherlands (Kingdom of the)": ["netherlands", "holland"],
    "Tanzania, United Republic of": ["tanzania"], "Iran (Islamic Republic of)": ["iran"],
    "Bolivia (Plurinational State of)": ["bolivia"], "Venezuela (Bolivarian Republic of)": ["venezuela"],
    "Lao People's Democratic Republic": ["laos"], "Syrian Arab Republic": ["syria"],
    "Moldova, Republic of": ["moldova"], "Brunei Darussalam": ["brunei"], "Cabo Verde": ["cape-verde"],
    "Democratic Republic of the Congo": ["dr-congo"], "Türkiye": ["turkey"], "Turkiye": ["turkey"],
    "Curaçao": ["curacao"], "Côte d'Ivoire": ["ivory-coast"],
}


def find(base, sub, pat):
    hits = glob.glob(os.path.join(base, "Bulk", "02_Inbound", sub, pat))
    if not hits:
        sys.exit(f"Missing file: {sub}/{pat}")
    return hits[0]


def load(path, code):
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    ws = wb["Data"]
    d = {}
    for row in ws.iter_rows(min_row=2, values_only=True):
        c, l, pv, rc, rl, pc, pl, y, v, fl, fll, u, n = row
        if c != code or v is None:
            continue
        if pc not in (999, None):  # World only
            continue
        d.setdefault(rl, {})[y] = v
    return d


def latest(a, b, floor):
    for y in [y for y in sorted(set(a) & set(b), reverse=True) if y not in SKIP_YEARS and y >= floor]:
        if a[y] and b[y]:
            return a[y] / b[y], y
    return None, None


def norm(s):
    return re.sub(r'^-|-$', '', re.sub(r'[^a-z0-9]+', '-', s.lower()))


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    base = sys.argv[1]
    out = os.path.join(os.path.dirname(__file__), "..", "convex", "unwtoCountryStats.ts")

    exp = load(find(base, "02_Expenditure", "*expenditure*.xlsx"), EXP_CODE)
    arr = load(find(base, "01_Total_arrivals", "*arrivals*.xlsx"), ARR_CODE)
    ngt = load(find(base, "06_Accommodation_guests_and_overnights", "*accommodation*.xlsx"), NGT_CODE)
    gue = load(find(base, "06_Accommodation_guests_and_overnights", "*accommodation*.xlsx"), GUE_CODE)

    entries = {}
    for c in sorted(set(exp) | set(arr)):
        if c not in exp or c not in arr:
            continue
        r, y = latest(exp[c], arr[c], MIN_YEAR)
        if not r:
            continue
        spend = round((r * 1000 * USD2EUR) / 10) * 10
        if spend <= 0:
            continue
        stay = None
        if c in ngt and c in gue:
            s, _ = latest(ngt[c], gue[c], MIN_YEAR)
            if s and s > 0:
                stay = round(s, 1)
        toks = {norm(c)} | set(ALIASES.get(c, []))
        val = {"spend": spend, "stay": stay, "year": int(y)}
        for t in toks:
            if t not in entries or val["year"] > entries[t]["year"]:
                entries[t] = val

    H = ['/**',
         ' * UN Tourism (UNWTO) per-country inbound tourism figures - REAL data bundled from the',
         " * UNWTO bulk dataset (inbound 'travel' expenditure & overnight arrivals).",
         ' *',
         " *   spendPerTripEUR := inbound travel expenditure (BoP visitor spending in-country) /",
         f" *                      overnight-tourist arrivals, latest year in [{MIN_YEAR}..now] excluding",
         f" *                      COVID years 2020-2021, converted USD->EUR at {USD2EUR:.2f}, rounded to 10.",
         " *   stayDays        := commercial-accommodation overnights / guests (avg length of stay),",
         " *                      same window, when UNWTO reports it (else null; caller falls back).",
         ' *',
         ' * Source: UN Tourism (UNWTO), https://www.unwto.org/tourism-statistics .',
         ' * Regenerate: python scripts/gen-unwto-stats.py <bulk-download-folder>',
         ' */', '',
         'export type UnwtoCountryStat = { spendPerTripEUR: number; stayDays: number | null; refYear: number };', '',
         'export const UNWTO_COUNTRY_STATS: Record<string, UnwtoCountryStat> = {']
    for t in sorted(entries):
        v = entries[t]
        stay = "null" if v["stay"] is None else str(v["stay"])
        H.append('  "%s": { spendPerTripEUR: %d, stayDays: %s, refYear: %d },' % (t, v["spend"], stay, v["year"]))
    H += ['};', '']
    with io.open(out, "w", encoding="utf-8") as fh:
        fh.write("\n".join(H))
    print(f"Wrote {os.path.abspath(out)} with {len(entries)} country tokens.")


if __name__ == "__main__":
    main()
