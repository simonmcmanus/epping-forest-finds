"""
Named places shared by the weekly report's map and its "where have the cattle
moved to" description.

TOWNS are the report's coverage settlements (see weekly-ledger.yml) -- drawn
as labelled dots on the map. FOREST_LOCALITIES adds well-known named spots
*inside* the forest itself, so a cattle-move description can say "near High
Beach" instead of only ever naming a boundary town several km away.
Coordinates are approximate (a reasonable town/locality centre, not a
surveyed point) -- good enough for a schematic map and a plain-English
"roughly near X" description, not for precise navigation.
"""

TOWNS = [
    {"name": "Loughton", "lat": 51.6421, "lon": 0.0537},
    {"name": "Chingford", "lat": 51.6285, "lon": -0.0058},
    {"name": "Buckhurst Hill", "lat": 51.6280, "lon": 0.0296},
    {"name": "Chigwell", "lat": 51.6175, "lon": 0.0755},
    {"name": "Theydon Bois", "lat": 51.6721, "lon": 0.1027},
    {"name": "Epping", "lat": 51.6949, "lon": 0.1135},
    {"name": "Woodford Green", "lat": 51.6099, "lon": 0.0209},
    {"name": "Waltham Abbey", "lat": 51.6879, "lon": -0.0011},
]

FOREST_LOCALITIES = [
    {"name": "High Beach", "lat": 51.6580, "lon": 0.0247},
    {"name": "Chingford Plain", "lat": 51.6396, "lon": 0.0032},
    {"name": "Wanstead Flats", "lat": 51.5624, "lon": 0.0175},
    {"name": "Highams Park", "lat": 51.6083, "lon": -0.0086},
    {"name": "Connaught Water", "lat": 51.6440, "lon": 0.0174},
    {"name": "Ambresbury Banks", "lat": 51.6774, "lon": 0.0224},
    {"name": "Debden", "lat": 51.6444, "lon": 0.0782},
    {"name": "Sewardstone", "lat": 51.6720, "lon": -0.0089},
]

# Used for the cattle-location description; the map itself only plots TOWNS
# to stay legible.
NAMED_PLACES = TOWNS + FOREST_LOCALITIES
