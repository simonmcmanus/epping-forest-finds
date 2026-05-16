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
  - Contents: pubs, bars, cafés/tea huts, transport links (train/bus/taxi), and named tourism/historic landmarks around the Epping Forest tree dataset extent.
  - Licence: OpenStreetMap data is available under the Open Data Commons Open Database License (ODbL). Attribute OpenStreetMap contributors when using this layer.

Source endpoint:

```text
https://www.mapping.cityoflondon.gov.uk/arcgis/rest/services/INSPIRE/MapServer
```

OpenStreetMap attribution:

```text
Contains OpenStreetMap data © OpenStreetMap contributors, available under the Open Database License.
```
