filter-nature
A simple sprig with three leaves

filter-food
A plate with fork and knife

filter-transport
A front-facing bus

filter-history
A rolled historical scroll

filter-locations
A map pin

filter-stories
Three sparkles

filter-trees
A veteran ancient oak tree with a broad canopy

filter-cows
A grazing cow in side profile

filter-waymarked-trails
A hiking boot

filter-ponds-streams
A single water droplet

filter-pubs
A beer mug

filter-restaurants
A plate with fork and knife

filter-cafes
A coffee cup

filter-shops
A shopping basket

filter-bus
A front-facing bus

filter-parking
A parked car

filter-historic-places
A classical building with columns

filter-royal
A crown

filter-ww2
A military helmet

filter-social-history
A woven basket

filter-plaques
A commemorative plaque

filter-blue-plaques
A circular heritage plaque

filter-celebrity
A five-point star

filter-science
A telescope

filter-education
A graduation cap

filter-medicine
A medical cross

filter-literature
A stack of books

filter-theatre
Comedy and tragedy masks

filter-politics
A civic building with columns

filter-art
An artist palette

filter-church
A church with a steeple

filter-legends
Three magical sparkles

filter-film-tv
A film clapperboard

inspector-map-overview
A folded map

inspector-forest-land
A conifer tree

inspector-buffer-land
A shield containing a leaf

inspector-motorway
A motorway with central divider

inspector-trunk-road
A primary road

inspector-road
A small car

inspector-subway
An underground train

inspector-tram
A tram

inspector-light-rail
A light rail vehicle

inspector-railway
A railway train

landmark-parking
A parked car

landmark-bicycle-parking
A bicycle

landmark-bench
A park bench

landmark-toilets
A public toilet facility

landmark-drinking-water
A water tap

landmark-information
An information board

landmark-memorial
A memorial candle

landmark-monument
A standing stone

landmark-archaeological
An ancient amphora

landmark-museum
A museum building with columns

landmark-campsite
A camping tent

landmark-picnic
A picnic basket

landmark-viewpoint
A telescope

landmark-taxi
A taxi cab

landmark-telephone
A telephone handset

landmark-events-venue
An admission ticket

landmark-alcohol
A wine glass

landmark-chemist
A medical cross

landmark-dry-cleaning
A collared shirt

landmark-cafe
A coffee cup

landmark-gate
A wooden gate

landmark-barrier
An access barrier

landmark-default
A map pin

ui-search
A magnifying glass

ui-report
A pencil writing a mark

ui-settings
A gear cog

ui-back
A left-pointing arrow

ui-location-gate
A friendly map pin

ui-distance-warning
A folded map

ui-compass-arrow
A compass arrow

tree-common-beech
A single beech leaf with smooth wavy edges

tree-english-oak
A single oak leaf with rounded lobes

tree-hornbeam
A single hornbeam leaf with toothed edges

tree-holly
A single holly leaf with spiny edges

tree-wild-service
A single wild service leaf with deep lobes

tree-field-maple
A single field maple leaf with five compact lobes

tree-ash
A single ash compound leaf with paired leaflets
## Generated app icon assets

`scripts/generate-app-icon.py` composites `trees/oak.png` — the English oak
leaf — onto a gold gradient tile (#f7dc82 top-left to #e2a13c bottom-right)
and writes:

- `icon-192.png`, `icon-512.png` — manifest `purpose: any`. Corners rounded at
  19% and knocked out to transparency, so the tile sits on any wallpaper.
- `icon-maskable-512.png` — manifest `purpose: maskable`. Gold bleeds to the
  edge and the leaf is drawn at 50% of the tile height to clear Android's
  circular crop.
- `apple-touch-icon.png` — 180px, square and opaque: iOS ignores transparency
  and applies its own mask.
- `favicon.png` — 128px, square, leaf at 72% so it still reads at 16px. Linked
  from `index.html`, `admin.html`, `terms.html` and the generated reports index.

`trees/logo.png` is not part of this set. It stays the location pin, and is
used by the onboarding welcome step and the loading screen.
