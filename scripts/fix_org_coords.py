#!/usr/bin/env python3
"""Fix organisation coordinates in companies_extracted.json.

For every org without a valid lat/lon (missing, or at null-island (0,0)):
  1. Look up (country, city) in scripts/city_geocache.json
  2. If that fails, fall back to the country centroid (below)
  3. Apply a small deterministic jitter (~few km) so orgs in the same city
     don't all stack on the exact same pixel — this keeps cluster counts
     meaningful when zoomed in.

Idempotent: never touches orgs that already have valid non-zero coords.
"""
import json
import hashlib
import math
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SOURCE = REPO / 'companies_extracted.json'
CACHE = REPO / 'scripts' / 'city_geocache.json'

# Country centroids (approx geographic centres) — used as last-resort fallback
COUNTRY_CENTROID = {
    'AT': (47.5162, 14.5501),  'BE': (50.5039,  4.4699),  'BG': (42.7339, 25.4858),
    'HR': (45.1000, 15.2000),  'CY': (35.1264, 33.4299),  'CZ': (49.8175, 15.4730),
    'DK': (56.2639,  9.5018),  'EE': (58.5953, 25.0136),  'FI': (61.9241, 25.7482),
    'FR': (46.6034,  1.8883),  'DE': (51.1657, 10.4515),  'GR': (39.0742, 21.8243),
    'HU': (47.1625, 19.5033),  'IE': (53.4129, -8.2439),  'IT': (41.8719, 12.5674),
    'LV': (56.8796, 24.6032),  'LT': (55.1694, 23.8813),  'LU': (49.8153,  6.1296),
    'MT': (35.9375, 14.3754),  'NL': (52.1326,  5.2913),  'NO': (60.4720,  8.4689),
    'PL': (51.9194, 19.1451),  'PT': (39.3999, -8.2245),  'RO': (45.9432, 24.9668),
    'SK': (48.6690, 19.6990),  'SI': (46.1512, 14.9955),  'ES': (40.4637, -3.7492),
    'SE': (60.1282, 18.6435),  'UK': (55.3781, -3.4360),  'GB': (55.3781, -3.4360),
    'CH': (46.8182,  8.2275),  'IS': (64.9631, -19.0208), 'LI': (47.1660,  9.5554),
}

def is_num(x):
    return isinstance(x, (int, float))

def has_valid_coord(o):
    return is_num(o.get('lat')) and is_num(o.get('lon')) and not (o['lat'] == 0 and o['lon'] == 0)

def jitter(seed_str, amount_deg=0.015):
    """Deterministic small offset (about ±1.5 km at European latitudes)."""
    h = hashlib.md5(seed_str.encode('utf-8')).digest()
    # Two 16-bit ints -> [-1, +1]
    dx = (int.from_bytes(h[0:2], 'big') / 65535.0) * 2 - 1
    dy = (int.from_bytes(h[2:4], 'big') / 65535.0) * 2 - 1
    return dx * amount_deg, dy * amount_deg

def main():
    orgs = json.loads(SOURCE.read_text(encoding='utf-8'))
    cache = json.loads(CACHE.read_text(encoding='utf-8'))

    stats = {'total': len(orgs), 'already_ok': 0, 'by_city': 0, 'by_country': 0, 'unresolved': 0}

    for o in orgs:
        if has_valid_coord(o):
            stats['already_ok'] += 1
            continue

        country = o.get('country')
        city = o.get('city')

        base = None
        jitter_amt = 0.015  # ~1.5 km in the city
        if country and city:
            entry = cache.get(f'{country}|{city}')
            if entry and is_num(entry.get('lat')) and is_num(entry.get('lon')):
                base = (entry['lat'], entry['lon'])
                stats['by_city'] += 1

        if base is None and country in COUNTRY_CENTROID:
            base = COUNTRY_CENTROID[country]
            jitter_amt = 0.6  # ~60 km so country-centroid orgs spread across the country
            stats['by_country'] += 1

        if base is None:
            stats['unresolved'] += 1
            continue

        seed = f"{o.get('name','')}|{country}|{city}"
        dlat, dlon = jitter(seed, amount_deg=jitter_amt)
        o['lat'] = round(base[0] + dlat, 6)
        o['lon'] = round(base[1] + dlon, 6)

    SOURCE.write_text(json.dumps(orgs, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(stats, indent=2))

if __name__ == '__main__':
    main()
