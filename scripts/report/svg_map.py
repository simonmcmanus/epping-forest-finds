"""
Builds the report's "This week on the map" SVG deterministically from the
forest boundary data and this run's findings -- replacing what used to be an
LLM hand-copying (and slowly re-typing, token by token) the previous week's
SVG path data. Same viewBox size and CSS class names as the existing report
template, so the CSS in template.py doesn't need to change to match.

Public entry point: render_map_svg(forest_geojson, findings, projection=None)
"""
from .categories import style_for
from .geo import MapProjection, simplify_points
from .places import TOWNS

VIEWBOX_HEIGHT_FALLBACK = 860  # only used if a projection somehow reports 0

# The source forest-boundary geometry has tens of thousands of points --
# far more detail than a 480px-wide schematic map can show or than is worth
# spending report bytes on. Simplify each ring to this many SVG pixels of
# tolerance, and drop rings smaller than MIN_RING_SPAN_PX (stray slivers/
# holes that would be invisible at this scale anyway).
FOREST_SIMPLIFY_TOLERANCE_PX = 0.6
MIN_RING_SPAN_PX = 1.0


def _iter_rings(geometry):
    gtype = geometry.get("type")
    coords = geometry.get("coordinates", [])
    if gtype == "Polygon":
        for ring in coords:
            yield ring
    elif gtype == "MultiPolygon":
        for polygon in coords:
            for ring in polygon:
                yield ring


def _ring_span(points):
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    return max(xs) - min(xs), max(ys) - min(ys)


def build_forest_path(forest_geojson, projection, simplify_tolerance=FOREST_SIMPLIFY_TOLERANCE_PX,
                       min_ring_span=MIN_RING_SPAN_PX):
    """Returns the `d` attribute for the forest-fill <path>."""
    pieces = []
    for feature in forest_geojson.get("features", []):
        geometry = feature.get("geometry") or {}
        for ring in _iter_rings(geometry):
            points = projection.project_ring(ring)
            if len(points) < 2:
                continue
            span_x, span_y = _ring_span(points)
            if span_x < min_ring_span and span_y < min_ring_span:
                continue
            if simplify_tolerance:
                points = simplify_points(points, simplify_tolerance)
            if len(points) < 2:
                continue
            commands = [f"M {points[0][0]},{points[0][1]}"]
            commands += [f"L {x},{y}" for x, y in points[1:]]
            commands.append("Z")
            pieces.append(" ".join(commands))
    return " ".join(pieces)


def build_search_area_path(projection):
    """Returns the `d` attribute for the dashed "area searched" rectangle."""
    corners = projection.search_area_corners()
    commands = [f"M {corners[0][0]},{corners[0][1]}"]
    commands += [f"L {x},{y}" for x, y in corners[1:]]
    commands.append("Z")
    return " ".join(commands)


def build_towns_markup(projection, towns=None):
    towns = towns or TOWNS
    parts = []
    for town in towns:
        x, y = projection.project(town["lon"], town["lat"])
        label_y = round(y + 14.2, 1)
        parts.append(
            f'<circle class="town-dot" cx="{x}" cy="{y}" r="2.4"/>'
            f'<text class="town-label" x="{x}" y="{label_y}" text-anchor="middle">{escape_text(town["name"])}</text>'
        )
    return "\n            ".join(parts)


def build_compass_markup():
    return (
        '<g class="compass" transform="translate(440,40)">'
        '<line x1="0" y1="14" x2="0" y2="-10"/>'
        '<line x1="0" y1="-10" x2="-4" y2="-3"/>'
        '<line x1="0" y1="-10" x2="4" y2="-3"/>'
        '<text x="0" y="26" text-anchor="middle">N</text>'
        "</g>"
    )


def build_pins_markup(findings, projection):
    """findings: list of {number, lon, lat, category, title, place}."""
    parts = []
    for finding in findings:
        lon, lat = finding.get("lon"), finding.get("lat")
        if lon is None or lat is None:
            continue
        x, y = projection.project(lon, lat)
        style = style_for(finding.get("category"))
        title = escape_text(f'{finding["number"]} — {finding.get("title", "")}')
        text_style = ""
        if style["css_class"] == "warning":
            text_style = ' style="fill:var(--status-warning-ink)"'
        parts.append(
            "<g>"
            f"<title>{title}</title>"
            f'<circle class="pin-ring" cx="{x}" cy="{y}" r="9" style="fill:var({style["css_var"]})"/>'
            f'<text class="pin-num" x="{x}" y="{round(y + 0.4, 1)}"{text_style}>{finding["number"]}</text>'
            "</g>"
        )
    return "\n          ".join(parts)


def escape_text(value):
    return (
        str(value)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def render_map_svg(forest_geojson, findings, projection=None):
    projection = projection or MapProjection()
    forest_d = build_forest_path(forest_geojson, projection)
    search_area_d = build_search_area_path(projection)
    towns = build_towns_markup(projection)
    compass = build_compass_markup()
    pins = build_pins_markup(findings, projection)
    height = projection.height or VIEWBOX_HEIGHT_FALLBACK

    return f'''<svg viewBox="0 0 {projection.width} {height}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Map of Epping Forest and the surrounding area covered by this report">
          <path class="search-area" d="{search_area_d}"/>
          <path class="forest-fill" d="{forest_d}"/>

          <!-- towns -->
          <g>
            {towns}
          </g>

          <!-- compass -->
          {compass}

          <!-- pins -->
          {pins}
        </svg>'''
