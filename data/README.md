# Offline Map Feature Data

This folder stores local GeoJSON files used by the PWA when offline.

## Sources

- `epping-forest-land.geojson`
  - Source layer: City of London ArcGIS REST, `INSPIRE/MapServer/143`
  - Layer name: `Epping Forest - Forest Land`
  - Description from source: boundary of Epping Forest, with some boundary discrepancies still to be accurately determined.
  - Downloaded as GeoJSON in WGS84 coordinates.

- `epping-buffer-land.geojson`
  - Source layer: City of London ArcGIS REST, `INSPIRE/MapServer/144`
  - Layer name: `Epping Forest - Buffer Land`
  - Description from source: City of London Buffer Land boundaries surrounding Epping Forest.
  - Downloaded as GeoJSON in WGS84 coordinates.

- `local-landmarks.geojson`
  - Source: OpenStreetMap via Overpass API.
  - Query: `local-landmarks.overpassql`
  - Contents: pubs, bars, cafés/tea huts, transport links (train/bus/taxi), access infrastructure (gates, entrances, parking, toilets, cycle parking, benches), and historic/tourism landmarks around the Epping Forest tree dataset extent.
  - Licence: OpenStreetMap data is available under the Open Data Commons Open Database License (ODbL). Attribute OpenStreetMap contributors when using this layer.

- `local-paths.geojson`
  - Source: OpenStreetMap via Overpass API.
  - Query: `local-paths.overpassql`
  - Contents: paths, footways, bridleways, byways, permissive paths, waymarked trails, cycleways, and tracks in the Epping Forest area, including names/refs where available.
  - Licence: OpenStreetMap data is available under the Open Data Commons Open Database License (ODbL). Attribute OpenStreetMap contributors when using this layer.

- `local-roads.geojson`
  - Source: OpenStreetMap via Overpass API.
  - Query: `local-roads.overpassql`
  - Contents: roads around Epping Forest including motorways, primary, secondary, tertiary, residential, and service roads.
  - Licence: OpenStreetMap data is available under the Open Data Commons Open Database License (ODbL). Attribute OpenStreetMap contributors when using this layer.

- `local-environment.geojson`
  - Source: OpenStreetMap via Overpass API.
  - Query: `local-environment.overpassql`
  - Contents: hydrology features (streams, rivers, ditches, water areas/wetlands) and nature designation polygons (protected areas, nature reserves, SSSI-related tags).
  - Licence: OpenStreetMap data is available under the Open Data Commons Open Database License (ODbL). Attribute OpenStreetMap contributors when using this layer.

Source endpoint:

```text
https://www.mapping.cityoflondon.gov.uk/arcgis/rest/services/INSPIRE/MapServer
```

OpenStreetMap attribution:

```text
Contains OpenStreetMap data © OpenStreetMap contributors, available under the Open Database License.
```
