#!/usr/bin/env python3
"""Geocode (country, city) pairs via Nominatim (OSM) with caching + rate limiting.

Reads companies_extracted.json, collects distinct (country, city) pairs missing
valid lat/lon, geocodes them, writes scripts/city_geocache.json.
"""
import json
import time
import urllib.parse
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
CACHE = REPO / 'scripts' / 'city_geocache.json'
SOURCE = REPO / 'companies_extracted.json'

# ISO2 → English country name for Nominatim queries (matches our data)
COUNTRY_NAME = {
    'AT':'Austria','BE':'Belgium','BG':'Bulgaria','HR':'Croatia','CY':'Cyprus',
    'CZ':'Czech Republic','DK':'Denmark','EE':'Estonia','FI':'Finland','FR':'France',
    'DE':'Germany','GR':'Greece','HU':'Hungary','IE':'Ireland','IT':'Italy',
    'LV':'Latvia','LT':'Lithuania','LU':'Luxembourg','MT':'Malta','NL':'Netherlands',
    'NO':'Norway','PL':'Poland','PT':'Portugal','RO':'Romania','SK':'Slovakia',
    'SI':'Slovenia','ES':'Spain','SE':'Sweden','UK':'United Kingdom','GB':'United Kingdom',
    'CH':'Switzerland','IS':'Iceland','LI':'Liechtenstein',
}

def is_num(x):
    return isinstance(x, (int, float))

def has_valid_coord(o):
    return is_num(o.get('lat')) and is_num(o.get('lon')) and not (o['lat']==0 and o['lon']==0)

def load_cache():
    if CACHE.exists():
        return json.loads(CACHE.read_text(encoding='utf-8'))
    return {}

def save_cache(cache):
    CACHE.write_text(json.dumps(cache, ensure_ascii=False, indent=2), encoding='utf-8')

def geocode(country_iso, city):
    country_name = COUNTRY_NAME.get(country_iso, country_iso)
    q = f"{city}, {country_name}"
    url = "https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode({
        'q': q, 'format': 'json', 'limit': 1,
    })
    req = urllib.request.Request(url, headers={'User-Agent': 'ESRF.net-atlas/1.0 (hello@esrf.net)'})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            data = json.loads(r.read())
        if data:
            return float(data[0]['lat']), float(data[0]['lon'])
    except Exception as e:
        print(f'  ! error for {q}: {e}')
    return None

def main():
    orgs = json.loads(SOURCE.read_text(encoding='utf-8'))
    cache = load_cache()

    # Collect distinct (country, city) pairs for orgs missing valid coords
    pairs = set()
    for o in orgs:
        if not has_valid_coord(o):
            c = o.get('country'); city = o.get('city')
            if c and city:
                pairs.add((c, city))

    pairs = sorted(pairs)
    total = len(pairs)
    print(f'Distinct pairs to geocode: {total}')

    hits = 0
    misses = 0
    for i, (country, city) in enumerate(pairs, 1):
        key = f'{country}|{city}'
        if key in cache:
            hits += 1
            continue
        result = geocode(country, city)
        if result:
            cache[key] = {'lat': result[0], 'lon': result[1], 'source': 'nominatim'}
            misses += 1
        else:
            cache[key] = None  # mark as tried
            misses += 1
        if i % 25 == 0:
            print(f'  {i}/{total} | cached={hits} newly_fetched={misses}')
            save_cache(cache)
        # Nominatim policy: ≤1 req/s
        time.sleep(1.05)

    save_cache(cache)
    print(f'Done. Cache size: {len(cache)}')

if __name__ == '__main__':
    main()
