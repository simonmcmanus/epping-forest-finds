"""
Shared geography for the weekly report's SVG map.

SEARCH_BBOX is the single source of truth for "the area this report searches
for updates in": it matches the bounding box already used by
data/local-landmarks.overpassql (and the sibling local-*.overpassql
queries), and scripts/osm_business_diff.py queries Overpass against this
same box. The map draws this exact box as its "search area" outline, so
there is nothing to keep in sync by hand between what's searched and what's
shown.
"""
import math

SEARCH_BBOX = {"south": 51.545, "west": -0.035, "north": 51.745, "east": 0.145}

VIEWBOX_WIDTH = 480
# Inset the search area from the SVG edges so its outline (and any pin near
# the edge) never touches the border.
BBOX_PADDING_FRACTION = 0.06


def mercator_xy(lon, lat):
    """Web Mercator, matching js/app.js's projectLonLat / js/admin.js."""
    clamped = max(-85.0, min(85.0, lat))
    rad = math.radians(clamped)
    return lon, -math.log(math.tan(math.pi / 4 + rad / 2)) * 180 / math.pi


def padded_bbox(bbox, fraction):
    lat_pad = (bbox["north"] - bbox["south"]) * fraction
    lon_pad = (bbox["east"] - bbox["west"]) * fraction
    return {
        "south": bbox["south"] - lat_pad,
        "north": bbox["north"] + lat_pad,
        "west": bbox["west"] - lon_pad,
        "east": bbox["east"] + lon_pad,
    }


class MapProjection:
    """Projects lon/lat into a fixed SVG viewBox covering `bbox`, padded."""

    def __init__(self, bbox=None, width=VIEWBOX_WIDTH, padding_fraction=BBOX_PADDING_FRACTION):
        bbox = bbox or SEARCH_BBOX
        padded = padded_bbox(bbox, padding_fraction)
        min_x, min_y = mercator_xy(padded["west"], padded["north"])
        max_x, max_y = mercator_xy(padded["east"], padded["south"])
        # min_y corresponds to the northern edge (Mercator y is more
        # negative further north with this sign convention), max_y to the
        # southern edge -- that ordering makes the plain linear scale below
        # put north at the top of the SVG without any extra flip.
        self.bbox = bbox
        self.padded_bbox = padded
        self.min_x, self.max_x = min_x, max_x
        self.min_y, self.max_y = min_y, max_y
        self.width = width
        x_range = self.max_x - self.min_x
        y_range = self.max_y - self.min_y
        self.scale = (width / x_range) if x_range else 1.0
        self.height = round(y_range * self.scale, 1)

    def project(self, lon, lat):
        x, y = mercator_xy(lon, lat)
        return (
            round((x - self.min_x) * self.scale, 1),
            round((y - self.min_y) * self.scale, 1),
        )

    def project_ring(self, ring):
        return [self.project(pt[0], pt[1]) for pt in ring]

    def search_area_corners(self):
        """The (unpadded) SEARCH_BBOX corners, projected -- the rectangle
        drawn on the map to show what area this report searches."""
        b = self.bbox
        return self.project_ring([
            (b["west"], b["north"]),
            (b["east"], b["north"]),
            (b["east"], b["south"]),
            (b["west"], b["south"]),
        ])


def haversine_metres(lon1, lat1, lon2, lat2):
    R = 6371000.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 2 * R * math.asin(min(1.0, math.sqrt(a)))


def nearest_place(lon, lat, places):
    """places: iterable of {"name", "lat", "lon"}. Returns (place, distance_m)."""
    best, best_dist = None, None
    for place in places:
        d = haversine_metres(lon, lat, place["lon"], place["lat"])
        if best_dist is None or d < best_dist:
            best, best_dist = place, d
    return best, best_dist


def simplify_points(points, tolerance):
    """Ramer-Douglas-Peucker simplification of a list of (x, y) points.

    Applied in already-projected SVG-pixel space (not lon/lat), so a single
    `tolerance` in pixels behaves the same everywhere on the map regardless
    of latitude. Used to keep the forest boundary path a reasonable size --
    the raw source geometry has tens of thousands of points, far more detail
    than a schematic report map needs or than is worth spending bytes on.
    """
    if len(points) < 3:
        return list(points)

    def perpendicular_distance(pt, a, b):
        (px, py), (ax, ay), (bx, by) = pt, a, b
        dx, dy = bx - ax, by - ay
        if dx == 0 and dy == 0:
            return math.hypot(px - ax, py - ay)
        t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)
        proj_x, proj_y = ax + t * dx, ay + t * dy
        return math.hypot(px - proj_x, py - proj_y)

    def rdp(pts):
        if len(pts) < 3:
            return pts
        start, end = pts[0], pts[-1]
        max_dist, index = -1.0, -1
        for i in range(1, len(pts) - 1):
            dist = perpendicular_distance(pts[i], start, end)
            if dist > max_dist:
                max_dist, index = dist, i
        if max_dist > tolerance:
            left = rdp(pts[: index + 1])
            right = rdp(pts[index:])
            return left[:-1] + right
        return [start, end]

    return rdp(list(points))
