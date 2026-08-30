#!/usr/bin/env python3
"""
Turn the Greek travel-agency directory export into the JSON the Convex importer
expects.

    python scripts/agency-outreach/extract-leads.py \
        --xlsx "C:\\Users\\nioni\\Desktop\\tourist_agencies_greece_547.xlsx" \
        --out scripts/agency-outreach/leads.json

The sheet is a scrape of public business directories, so it carries the usual
damage: duplicate rows, formula cells, addresses with stray angle brackets, and
a handful of entries that are not addresses at all. Everything is cleaned and
de-duplicated HERE rather than at send time — a bad address that reaches
Postmark costs sender reputation, and reputation is the one thing this campaign
cannot buy back.
"""

import argparse
import json
import re
import sys
from pathlib import Path

import openpyxl

EMAIL_RE = re.compile(r"^[^\s@,;<>()\[\]\\]+@[^\s@,;<>()\[\]\\]+\.[a-z]{2,}$", re.I)

# Local parts that are almost always a directory placeholder rather than a
# monitored mailbox.
BAD_LOCALS = re.compile(r"^(example|test|noreply|no-reply|donotreply|postmaster|abuse)\b", re.I)
BAD_DOMAINS = re.compile(r"^(example\.|test\.|localhost|domain\.)", re.I)

HEADER_ROW = 4  # 1-based; data starts on the next row
COLUMNS = {
    "agencyName": "Επωνυμία",
    "city": "Πόλη / Περιοχή",
    "email": "Email",
    "website": "Website",
    "phone": "Τηλέφωνο",
    "agencyType": "Τύπος",
    "services": "Υπηρεσίες / Ειδίκευση",
    "sourceName": "Κύρια πηγή",
    "sourceUrl": "URL πηγής",
}


def clean(value):
    if value is None:
        return None
    text = str(value).strip()
    # Formula cells come back as "=IF(...)" with data_only=False; they are
    # derived columns we do not import.
    if not text or text.startswith("="):
        return None
    return re.sub(r"\s+", " ", text)


def valid_email(email: str) -> bool:
    if not email or len(email) > 254:
        return False
    if not EMAIL_RE.match(email):
        return False
    local, _, domain = email.partition("@")
    if len(local) > 64 or ".." in domain or domain.startswith("-"):
        return False
    return not (BAD_LOCALS.match(local) or BAD_DOMAINS.match(domain))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--xlsx", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--sheet", default="Leads")
    parser.add_argument("--language", default="el")
    args = parser.parse_args()

    wb = openpyxl.load_workbook(args.xlsx, read_only=True, data_only=False)
    ws = wb[args.sheet]

    rows = list(ws.iter_rows(values_only=True))
    header = [clean(c) for c in rows[HEADER_ROW - 1]]
    index = {}
    for key, label in COLUMNS.items():
        if label not in header:
            print(f"! column not found: {label}", file=sys.stderr)
            return 1
        index[key] = header.index(label)

    leads, seen = [], set()
    dropped_invalid = dropped_dupe = 0

    for row in rows[HEADER_ROW:]:
        raw_email = clean(row[index["email"]])
        if not raw_email:
            continue
        email = raw_email.lower()
        if not valid_email(email):
            dropped_invalid += 1
            continue
        if email in seen:
            dropped_dupe += 1
            continue
        seen.add(email)

        name = clean(row[index["agencyName"]]) or email
        leads.append(
            {
                "email": email,
                "agencyName": name,
                "city": clean(row[index["city"]]),
                "website": clean(row[index["website"]]),
                "phone": clean(row[index["phone"]]),
                "agencyType": clean(row[index["agencyType"]]),
                "services": clean(row[index["services"]]),
                "sourceName": clean(row[index["sourceName"]]),
                "sourceUrl": clean(row[index["sourceUrl"]]),
                "language": args.language,
            }
        )

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(leads, ensure_ascii=False, indent=1), encoding="utf-8")

    print(f"kept {len(leads)} leads -> {out}")
    print(f"dropped {dropped_invalid} invalid, {dropped_dupe} duplicate")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
