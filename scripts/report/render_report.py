#!/usr/bin/env python3
"""
Renders the weekly Epping Forest report from a small, structured JSON file
instead of an LLM hand-authoring ~700 lines of HTML (including a giant SVG
map path) from scratch every run. The research and writing still needs a
person or an LLM -- this script only owns turning that content into the
finished page: the map, the stats, the layout and the design system.

Usage:
    python3 scripts/report/render_report.py <report-data.json> [output-path]

If output-path is omitted, writes to
reports/epping-forest-ledger-<report-data date>.html.

See report-data.schema.md (next to this file) for the input format.
"""
import json
import subprocess
import sys
from pathlib import Path
from urllib.parse import quote

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))
    from scripts.report import places, png_icon, svg_map, template  # noqa: E402
    from scripts.report.categories import CATEGORY_STYLES, style_for  # noqa: E402
    from scripts.report.jargon_guard import assert_reader_friendly  # noqa: E402
    from scripts.report.text_utils import oxford_comma_join, pluralize_label  # noqa: E402
else:
    from . import places, png_icon, svg_map, template
    from .categories import CATEGORY_STYLES, style_for
    from .jargon_guard import assert_reader_friendly
    from .text_utils import oxford_comma_join, pluralize_label

SITE_BASE = "https://www.eppingforestfinds.uk"
DEFAULT_APP_LINK = SITE_BASE + "/app"
SOCIAL_IMAGE_URL = SITE_BASE + "/data/icons/icon-512.png"

# The cattle on the report's map are drawn with the app's own cow icon, shrunk
# to pin size and written into the page itself rather than linked. A report is
# read on a phone with no signal, saved for later and forwarded by email, and a
# linked image turns into a broken-image box in all three.
COW_ICON_SOURCE = Path("data") / "icons" / "cow.png"
COW_ICON_SIZE_PX = 64
# Used only when the icon isn't there to read (the report's own tests render
# against a stand-in folder holding just the map data).
COW_ICON_FALLBACK_URL = SITE_BASE + "/data/icons/cow.png"
INVENTORY_ICON_SOURCES = {
    "nature": Path("data") / "icons" / "nature.png",
    "food": Path("data") / "icons" / "food.png",
    "transport": Path("data") / "icons" / "bus.png",
    "history": Path("data") / "icons" / "history.png",
    "locations": Path("data") / "icons" / "pin.png",
    "stories": Path("data") / "icons" / "legends.png",
    "always": Path("data") / "icons" / "gate.png",
    "trees": Path("data") / "icons" / "tree.png",
    "ponds_streams": Path("data") / "icons" / "ponds.png",
    "pubs": Path("data") / "icons" / "beer.png",
    "restaurants": Path("data") / "icons" / "restaurant.png",
    "cafes": Path("data") / "icons" / "cafe.png",
    "shops": Path("data") / "icons" / "shop.png",
    "bus": Path("data") / "icons" / "bus.png",
    "underground": Path("data") / "icons" / "underground.png",
    "national_rail": Path("data") / "icons" / "national-rail.png",
    "parking": Path("data") / "icons" / "landmark-parking.png",
    "historic": Path("data") / "icons" / "historic.png",
    "plaques": Path("data") / "icons" / "plaques.png",
    "monuments": Path("data") / "icons" / "landmark-monument.png",
    "ww2": Path("data") / "icons" / "historic.png",
    "churches": Path("data") / "icons" / "church.png",
    "education": Path("data") / "icons" / "education.png",
    "medicine": Path("data") / "icons" / "medicine.png",
    "campsites": Path("data") / "icons" / "campsite.png",
    "legends": Path("data") / "icons" / "legends.png",
    "literature": Path("data") / "icons" / "literature.png",
    "film_tv": Path("data") / "icons" / "film.png",
    "art": Path("data") / "icons" / "art.png",
}
INVENTORY_ICON_SIZE_PX = 64
DEFAULT_ABOUT_NOTE = (
    "This report is put together each week from council and City of London updates, "
    "local news, an open map of shops and small businesses (OpenStreetMap), and the "
    "live tracker for the forest's grazing cattle. It won't catch everything — if "
    "you spot something wrong or missing, we'd like to know."
)
AI_DISCLAIMER = (
    "This report is researched and written automatically by AI. It reads public "
    "sources each week and it can get things wrong — a date misread, a shop listed "
    "as closed when it is still trading, or something missed altogether. Please "
    "check anything important before you rely on it."
)

SECTION_TITLES = {
    "business": ("Shops, cafés, restaurants & pubs", "What's opened, closed, or might have."),
    "road": ("Road closures & access", "Things that might affect getting around the forest."),
    "event": ("Events in the forest", "What's on this week."),
}

# Sections that always appear, even with nothing to report, each with the line
# shown when the week turned up nothing. A missing section reads as "we forgot
# to look"; an explicit "nothing this week" reads as "we looked".
EMPTY_SECTION_NOTES = {
    "business": ("Nothing to report this week", "No likely openings or closures turned up this week."),
    "road": ("No closures to report this week", "Nothing new was announced for the roads around the forest this week."),
    "event": ("No events listed this week", "Nothing had been listed for the forest this week when this report was put together. Organisers often add things at short notice, so it is worth a look closer to the weekend."),
}

# Anchor names in the published page. Kept as they were so links people have
# already shared into a past report still land in the right place.
SECTION_IDS = {"business": "businesses", "road": "road", "event": "event"}

BUSINESS_CATEGORIES = {"opening", "closing"}


def load_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def load_map_inventory(repo_root):
    """Counts of everything the app can draw, grouped the way the app's own
    Filter screen groups them.

    Delegated to scripts/report/map-inventory.js because a place's group is
    decided by the app's classification rules, which are written in
    JavaScript and shared with the app itself. Re-stating those rules here
    would let the report's numbers drift away from what the map shows -- the
    exact problem this section exists to fix.
    """
    script = Path(__file__).resolve().parent / "map-inventory.js"
    result = subprocess.run(
        ["node", str(script), "--root", str(repo_root)],
        capture_output=True,
        text=True,
        check=True,
    )
    return json.loads(result.stdout)


def compute_food_stats(food_geojson):
    """Turns the raw food/shop map data into a plain-English count line,
    e.g. "687 places to eat, drink and shop, including 211 restaurants, ..."
    Computed here so the report-data JSON never has to carry (and risk
    getting out of sync with) point counts by hand."""
    features = food_geojson.get("features", [])
    counts = {}
    for feature in features:
        props = feature.get("properties") or {}
        label = props.get("categoryLabel") or props.get("category") or "Other"
        counts[label] = counts.get(label, 0) + 1
    ordered = sorted(counts.items(), key=lambda kv: kv[1], reverse=True)
    return {"total": len(features), "by_label": ordered}


def food_stats_sentence(stats):
    if not stats["total"]:
        return ""
    parts = []
    for label, count in stats["by_label"]:
        word = label if count == 1 else pluralize_label(label)
        parts.append(f"{count} {word.lower()}")
    return (
        f"There are currently {stats['total']} places to eat, drink and shop around the "
        f"forest, including {oxford_comma_join(parts)}."
    )


def escape(value):
    return (
        str(value)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def normalize_findings(report_data):
    """Returns (findings, grazing_finding_or_None) with sequential map
    numbers assigned in a stable order: businesses, then road/access, then
    events, then the grazing update last (only if it changed and has a
    location worth pinning)."""
    raw = list(report_data.get("findings", []))
    grazing = report_data.get("grazing")

    order_key = {"opening": 0, "closing": 0, "road": 1, "event": 2, "grazing": 3}
    raw.sort(key=lambda f: order_key.get(f.get("category"), 9))

    grazing_finding = None
    if grazing and grazing.get("moved") and grazing.get("lon") is not None and grazing.get("lat") is not None:
        grazing_finding = {
            "category": "grazing",
            "title": "Where the cattle are grazing",
            "place": grazing.get("place", ""),
            "status_label": "Moved this week",
            "body": grazing.get("body", ""),
            "lon": grazing.get("lon"),
            "lat": grazing.get("lat"),
            "sources": grazing.get("sources", []),
        }
        raw.append(grazing_finding)

    numbered = []
    n = 1
    for finding in raw:
        item = dict(finding)
        item["number"] = n
        numbered.append(item)
        n += 1

    return numbered, grazing_finding


def render_stat_strip(findings, food_total, grazing):
    def count(category):
        return sum(1 for f in findings if f.get("category") == category)

    stats = [
        # Deliberately specific: this is the food/drink/shop dataset only,
        # not everything on the map. The whole-map total lives in the
        # "What's on the map" section below.
        (str(food_total), "Places to eat, drink & shop"),
        (str(count("opening")), "Openings flagged", "good"),
        (str(count("closing")), "Closures flagged", "critical"),
        (str(count("road")), "Road & access changes", "warning"),
        (str(count("event")), "Events this week", "event"),
    ]
    if grazing is not None:
        moved = grazing.get("moved")
        stats.append((("Moved" if moved else "Unchanged"), "Cattle grazing area", "grazing" if moved else None))

    cells = []
    for stat in stats:
        value, label = stat[0], stat[1]
        css_class = stat[2] if len(stat) > 2 and stat[2] else None
        class_attr = f' {css_class}' if css_class else ""
        cells.append(f'<div class="stat"><div class="n mono{class_attr}">{escape(value)}</div><div class="lbl">{escape(label)}</div></div>')
    strip_class = "stat-strip cols-6" if len(stats) == 6 else "stat-strip"
    return f'<div class="{strip_class}">{"".join(cells)}</div>'


def inventory_icon_uri(repo_root, key):
    source = INVENTORY_ICON_SOURCES.get(key)
    if source is None:
        return ""
    icon = Path(repo_root) / source if repo_root else None
    if icon and icon.exists():
        return png_icon.icon_data_uri(icon, INVENTORY_ICON_SIZE_PX)
    return f'{SITE_BASE}/{source.as_posix()}'


def render_inventory_section(inventory, repo_root=None):
    """The running "what's on the map" total and its breakdown.

    Every number here comes from the map data itself, so the breakdown always
    adds up to the headline total and always matches what someone filtering in
    the app would actually see.
    """
    if not inventory or not inventory.get("total"):
        return ""

    def fmt(n):
        return f"{n:,}"

    group_blocks = []
    for group in inventory.get("groups", []):
        icon = inventory_icon_uri(repo_root, group.get("key"))
        icon_html = f'<img class="inventory-icon" src="{icon}" alt="">' if icon else ""
        rows = ""
        for sub in group.get("subfilters", []):
            sub_icon = inventory_icon_uri(repo_root, sub.get("key"))
            sub_icon_html = f'<img class="inventory-subicon" src="{sub_icon}" alt="">' if sub_icon else ""
            rows += (
                f'<li><span>{sub_icon_html}{escape(sub["label"])}</span>'
                f'<span class="c">{fmt(sub["count"])}</span></li>'
            )
        group_blocks.append(
            '<div class="inventory-group">'
            f'<div class="grp"><span>{icon_html}{escape(group["label"])}</span>'
            f'<span class="c">{fmt(group["count"])}</span></div>'
            f'<ul>{rows}</ul></div>'
        )

    always = inventory.get("alwaysShown") or {}
    if always.get("count"):
        icon = inventory_icon_uri(repo_root, "always")
        icon_html = f'<img class="inventory-icon" src="{icon}" alt="">' if icon else ""
        group_blocks.append(
            '<div class="inventory-group full">'
            f'<div class="grp"><span>{icon_html}{escape(always["label"])}</span>'
            f'<span class="c">{fmt(always["count"])}</span></div>'
            '<ul><li><span>Always shown, whatever you have filtered</span></li></ul>'
            '</div>'
        )

    groups_html = "".join(group_blocks)
    return (
        '<section>\n'
        '  <h2 class="section-title">What\'s on the map</h2>\n'
        '  <p class="section-sub">Everything the app can show you, counted and grouped '
        'exactly the way the app\'s own filters group it.</p>\n'
        '  <div class="inventory-card">\n'
        '    <div class="inventory-head">\n'
        f'      <span class="n">{fmt(inventory["total"])}</span>\n'
        '      <span class="lbl">things you can find on the map today</span>\n'
        '    </div>\n'
        f'    <div class="inventory-groups">{groups_html}</div>\n'
        '  </div>\n'
        '  <p class="section-sub" style="margin-top:14px;">The forest\'s grazing cattle are '
        'tracked live rather than stored with the map, so they are not part of this count. '
        'Neither are the roads, paths and water drawn underneath everything else.</p>\n'
        '</section>\n'
    )


def render_sources_line(sources):
    if not sources:
        return ""
    links = ", ".join(f'<a href="{escape(s["url"])}">{escape(s["label"])}</a>' for s in sources if s.get("url"))
    if not links:
        return ""
    label = "Source" if len(sources) == 1 else "Sources"
    return f'<p class="src">{label}: {links}</p>'


def render_card(finding):
    style = style_for(finding.get("category"))
    css_class = style["css_class"]
    if finding.get("lon") is None:
        chip = ""
    elif finding.get("category") == "grazing":
        chip = cow_marker_html("pin-chip")
    else:
        chip = f'<span class="pin-chip {css_class}">{finding["number"]}</span>'
    status = finding.get("status_label")
    status_html = f'<span class="status-label {css_class}">{escape(status)}</span>' if status else ""
    place_html = f'<p class="addr">{escape(finding["place"])}</p>' if finding.get("place") else ""
    body_html = f'<p>{escape(finding.get("body", ""))}</p>' if finding.get("body") else ""
    sources_html = render_sources_line(finding.get("sources"))
    return (
        f'<div class="card {css_class}">'
        f'<div class="card-head">{chip}<h3>{escape(finding.get("title", ""))}</h3>{status_html}</div>'
        f'{place_html}{body_html}{sources_html}'
        f'</div>'
    )


def render_empty_card(section_key):
    heading, body = EMPTY_SECTION_NOTES[section_key]
    return (
        '<div class="card empty">'
        f'<div class="card-head"><h3>{escape(heading)}</h3></div>'
        f'<p>{escape(body)}</p></div>'
    )


def render_section(section_key, items):
    """A report section. Always rendered, even with nothing in it -- a reader
    who sees no "Events" heading at all can't tell whether the forest was
    quiet or whether nobody looked."""
    title, subtitle = SECTION_TITLES[section_key]
    body = "".join(render_card(f) for f in items) if items else render_empty_card(section_key)
    return (
        f'<section id="{SECTION_IDS[section_key]}"><h2 class="section-title">{escape(title)}</h2>'
        f'<p class="section-sub">{escape(subtitle)}</p>'
        f'<div class="cards">{body}</div></section>'
    )


def render_business_section(findings):
    return render_section("business", [f for f in findings if f.get("category") in BUSINESS_CATEGORIES])


def render_category_section(section_key, category, findings):
    return render_section(section_key, [f for f in findings if f.get("category") == category])


def render_grazing_section(grazing):
    if not grazing:
        return ""
    moved = grazing.get("moved")
    css_class = "grazing" if moved else ""
    status = "Moved this week" if moved else "No change this week"
    place = grazing.get("place", "")
    body = grazing.get("body", "")
    place_html = f'<p class="addr">{escape(place)}</p>' if place else ""
    body_html = f'<p>{escape(body)}</p>' if body else ""
    sources_html = render_sources_line(grazing.get("sources"))
    card = (
        f'<div class="card {css_class}">'
        f'<div class="card-head">{cow_marker_html("pin-chip")}<h3>Where the cattle are grazing</h3><span class="status-label {css_class or "event"}">{escape(status)}</span></div>'
        f'{place_html}{body_html}{sources_html}'
        f'</div>'
    )
    return (
        '<section id="grazing"><h2 class="section-title">The forest\'s grazing cattle</h2>'
        '<p class="section-sub">Epping Forest\'s conservation-grazing cattle move around the forest through the year.</p>'
        f'<div class="cards">{card}</div></section>'
    )


def cow_icon_uri(repo_root):
    """The app's cow icon, shrunk to pin size and ready to inline. Falls back
    to the icon's address on the site if this checkout hasn't got it."""
    icon = Path(repo_root) / COW_ICON_SOURCE
    if not icon.exists():
        return COW_ICON_FALLBACK_URL
    return png_icon.icon_data_uri(icon, COW_ICON_SIZE_PX)


def cow_marker_html(class_name):
    """The app's cow icon in the app's white map-pin surround, for the report's
    HTML (legend, the list beside the map, the cattle card). The icon itself is
    carried once by the page's own `--cow-icon` rule rather than repeated on
    every marker; the map SVG draws the same thing in SVG -- see
    svg_map.build_pins_markup."""
    return f'<span class="{class_name} cow-marker" aria-hidden="true"></span>'


def render_map_legend():
    items = []
    for category, style in CATEGORY_STYLES.items():
        if category == "grazing":
            marker = cow_marker_html("legend-dot")
        else:
            marker = f'<span class="legend-dot" style="background:var({style["css_var"]})"></span>'
        items.append(f'<div class="legend-item">{marker}{escape(style["label"])}</div>')
    return f'<div class="legend">{"".join(items)}</div>'


def render_map_side_list(findings):
    items = []
    for f in findings:
        if f.get("lon") is None:
            continue
        style = style_for(f.get("category"))
        css_class = style["css_class"]
        if f.get("category") == "grazing":
            badge = cow_marker_html("badge")
        else:
            badge = (
                f'<span class="badge{" " + css_class if css_class else ""}" '
                f'style="background:var({style["css_var"]})">{f["number"]}</span>'
            )
        items.append(
            f'<div class="find-mini">{badge}'
            f'<div class="txt"><strong>{escape(f.get("title",""))}</strong><span>{escape(f.get("place",""))}</span></div></div>'
        )
    return "".join(items)


def render_map_section(forest_geojson, findings, cow_icon):
    pinned = [f for f in findings if f.get("lon") is not None]
    svg = svg_map.render_map_svg(forest_geojson, pinned, cow_icon_url=cow_icon)
    legend = render_map_legend()
    side_list = render_map_side_list(findings)
    count_line = (
        f"{len(pinned)} thing{'s' if len(pinned) != 1 else ''} to know about this week. "
        "Full detail is below the map."
    ) if pinned else "Nothing needed a pin on the map this week."
    return f'''<section id="map">
    <h2 class="section-title">This week on the map</h2>
    <p class="section-sub">The dashed box is the area this report searches each week. It is a straight-sided box on purpose: the search covers everything inside it, so it takes in the forest itself and all the towns along its edge, not just the woodland.</p>
    <div class="map-card">
      <div class="map-svg-holder">
        {svg}
        {legend}
      </div>
      <div class="map-side">
        <p>{escape(count_line)}</p>
        {side_list}
      </div>
    </div>
  </section>'''


APP_SELLING_POINTS = [
    ("Works with no signal", "Once it has loaded, the whole map lives on your phone. Deep in the forest, with no bars showing, it still knows exactly where you are."),
    ("Find what is near you", "Tap anywhere and it lists what is within a walk — pubs, cafés, car parks, toilets, benches, gates and stations — with how long each one takes on foot."),
    ("Every veteran tree", "Thousands of the forest's ancient and veteran trees, each one findable by its tag number."),
    ("See where the cattle are", "The forest's grazing cattle wear tracking collars, and the map shows roughly where the herd is right now."),
]


def render_app_promo(app_link, inventory):
    """The advert for the app itself. Deliberately near the end: someone who
    has just read the week's news is far likelier to want the map than
    someone who has only read the headline."""
    total = (inventory or {}).get("total")
    total_line = (
        f"There are {total:,} things on it to find, and it costs nothing to use."
        if total else "Everything in this report is on it, and it costs nothing to use."
    )
    points = "".join(
        f'<li><strong>{escape(head)}</strong><span>{escape(body)}</span></li>'
        for head, body in APP_SELLING_POINTS
    )
    return f'''<section id="app" class="app-promo">
    <h2 class="section-title">Take Epping Forest with you</h2>
    <p class="section-sub">Epping Forest Finds is a free map of the forest that works on your phone
      even when your signal does not. {escape(total_line)}</p>
    <ul class="promo-points">{points}</ul>
    <p class="promo-cta"><a class="app-link" href="{escape(app_link)}">Open the map →</a></p>
    <p class="promo-foot">No app store, no account, nothing to install — it opens in your browser,
      and your phone will offer to add it to your home screen if you want it there.</p>
  </section>'''


def render_ai_note(app_link, date_display):
    """The "this was written by AI, tell us if it is wrong" note, with a link
    straight into the app's own report-a-problem screen, pre-filled so we know
    which week it came from."""
    subject = f"Mistake in the Epping Forest Ledger for {date_display}" if date_display else "Mistake in the Epping Forest Ledger"
    deep_link = f"{app_link.rstrip('/')}#report={quote(subject, safe='')}"
    return (
        '<aside class="ai-note">'
        '<h4>Written by AI — please tell us if it is wrong</h4>'
        f'<p>{escape(AI_DISCLAIMER)}</p>'
        f'<p>If you spot a mistake, <a href="{escape(deep_link)}">report it here</a> — '
        'the link opens the map with a short form already filled in with which report '
        'you are talking about. Every one gets read, and corrections go into the next week\'s report.</p>'
        '</aside>'
    )


def render_about_note(report_data):
    text = report_data.get("about_note") or DEFAULT_ABOUT_NOTE
    return f'<div class="about-note">{escape(text)}</div>'


def meta_description(report_data, findings, coverage_area, date_display):
    """A one-line summary for search results and link previews. Built from
    the week's own numbers so every report reads differently -- a page whose
    description never changes is a page search engines treat as boilerplate."""
    counts = {}
    for f in findings:
        counts[f.get("category")] = counts.get(f.get("category"), 0) + 1
    parts = []
    for category, singular, plural in (
        ("opening", "opening", "openings"),
        ("closing", "closure", "closures"),
        ("road", "road or access change", "road and access changes"),
        ("event", "event", "events"),
    ):
        n = counts.get(category, 0)
        if n:
            parts.append(f"{n} {singular if n == 1 else plural}")
    listed = list(coverage_area)
    towns = oxford_comma_join(listed[:4])
    if len(listed) > 4:
        towns += f" and {len(listed) - 4} more"
    summary = oxford_comma_join(parts) if parts else "no changes of note"
    lead = f"Epping Forest news for {date_display}: " if date_display else "Epping Forest news: "
    return (
        f"{lead}{summary} around {towns}. "
        "Shops, pubs and cafés opening and closing, road closures, events, and where "
        "the forest's grazing cattle have moved to."
    )


def render_head(*, title, description, canonical_url, date, date_display, coverage_area):
    """Head tags. Kept deliberately small: a title, a description, a canonical
    address, link-preview tags, and one block of structured data describing
    the report as a news article about Epping Forest -- enough for a search
    engine to index the page properly without padding the page itself."""
    structured = {
        "@context": "https://schema.org",
        "@type": "NewsArticle",
        "headline": title,
        "description": description,
        "datePublished": date,
        "dateModified": date,
        "inLanguage": "en-GB",
        "url": canonical_url,
        "isAccessibleForFree": True,
        "author": {"@type": "Organization", "name": "Epping Forest Finds", "url": SITE_BASE + "/"},
        "publisher": {
            "@type": "Organization",
            "name": "Epping Forest Finds",
            "url": SITE_BASE + "/",
            "logo": {"@type": "ImageObject", "url": SOCIAL_IMAGE_URL},
        },
        "about": [{"@type": "Place", "name": name} for name in ["Epping Forest"] + list(coverage_area)],
        "isPartOf": {
            "@type": "CreativeWorkSeries",
            "name": "Epping Forest Ledger",
            "url": f"{SITE_BASE}/reports/",
        },
    }
    keywords = ", ".join(
        [f"Epping Forest {w}" for w in ("news", "road closures", "events", "pubs", "walks")]
        + [f"{town} news" for town in coverage_area]
    )
    return f'''<title>{escape(title)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="{escape(description)}">
<meta name="keywords" content="{escape(keywords)}">
<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1">
<link rel="canonical" href="{escape(canonical_url)}">
<link rel="icon" href="{SITE_BASE}/data/icons/trees/logo.png" type="image/png">
<meta property="og:type" content="article">
<meta property="og:site_name" content="Epping Forest Finds">
<meta property="og:locale" content="en_GB">
<meta property="og:title" content="{escape(title)}">
<meta property="og:description" content="{escape(description)}">
<meta property="og:url" content="{escape(canonical_url)}">
<meta property="og:image" content="{SOCIAL_IMAGE_URL}">
<meta property="article:published_time" content="{escape(date)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{escape(title)}">
<meta name="twitter:description" content="{escape(description)}">
<meta name="twitter:image" content="{SOCIAL_IMAGE_URL}">
<script type="application/ld+json">
{json.dumps(structured, ensure_ascii=False, indent=2)}
</script>'''


def render_sources_footer(findings, grazing):
    seen = {}
    for f in findings:
        for s in f.get("sources", []) or []:
            if s.get("url") and s["url"] not in seen:
                seen[s["url"]] = s.get("label", s["url"])
    if grazing:
        for s in grazing.get("sources", []) or []:
            if s.get("url") and s["url"] not in seen:
                seen[s["url"]] = s.get("label", s["url"])
    if not seen:
        return ""
    items = "".join(f'<li><a href="{escape(url)}">{escape(label)}</a></li>' for url, label in seen.items())
    return f'<footer class="sources"><h4>Sources used in this report</h4><ul>{items}</ul></footer>'


def render_report(report_data, repo_root):
    repo_root = Path(repo_root)
    forest_geojson = load_json(repo_root / "data" / "epping-forest-land.geojson")
    food_geojson = load_json(repo_root / "data" / "local-landmarks-food.geojson")
    food_stats = compute_food_stats(food_geojson)

    inventory = load_map_inventory(repo_root)
    cow_icon = cow_icon_uri(repo_root)

    findings, grazing_pin = normalize_findings(report_data)
    grazing = report_data.get("grazing")

    date_display = report_data.get("date_display") or report_data.get("date", "")
    coverage_area = report_data.get("coverage_area") or [t["name"] for t in places.TOWNS]
    intro = report_data.get("intro", "")
    app_link = report_data.get("app_link") or DEFAULT_APP_LINK

    stat_strip = render_stat_strip(findings, food_stats["total"], grazing)
    inventory_section = render_inventory_section(inventory, repo_root)
    map_section = render_map_section(forest_geojson, findings, cow_icon)
    business_section = render_business_section(findings)
    road_section = render_category_section("road", "road", findings)
    event_section = render_category_section("event", "event", findings)
    grazing_section = render_grazing_section(grazing)
    app_promo = render_app_promo(app_link, inventory)
    about_note = render_about_note(report_data)
    ai_note = render_ai_note(app_link, date_display)
    sources_footer = render_sources_footer(findings, grazing)
    food_sentence = food_stats_sentence(food_stats)

    title = f"Epping Forest Ledger — {date_display}" if date_display else "Epping Forest Ledger"
    description = meta_description(report_data, findings, coverage_area, date_display)
    canonical_url = f"{SITE_BASE}/reports/epping-forest-ledger-{report_data.get('date', '')}.html"
    head = render_head(
        title=title,
        description=description,
        canonical_url=canonical_url,
        date=report_data.get("date", ""),
        date_display=date_display,
        coverage_area=coverage_area,
    )

    banner_html = f'<div class="banner">{escape(intro)}</div>' if intro else ""

    html = f'''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
{head}
{template.FONT_LINKS}
<style>
{template.REPORT_CSS}
:root{{--cow-icon:url("{cow_icon}");}}
</style>
</head>
<body>

<header class="masthead">
  <div class="inner">
    <p class="eyebrow">Weekly Epping Forest report</p>
    <h1 class="title">Epping Forest Ledger</h1>
    <div class="meta-row">
      <span>{escape(date_display)}</span>
      <span class="coverage">{escape(" · ".join(coverage_area))}</span>
    </div>
    {banner_html}
  </div>
</header>

<div class="wrap">

  {stat_strip}
  <p class="section-sub" style="margin-top:-8px;">{escape(food_sentence)}</p>

  {map_section}

  {inventory_section}

  {business_section}

  {road_section}

  {event_section}

  {grazing_section}

  {app_promo}

  {about_note}

  {sources_footer}

  {ai_note}

</div>
</body>
</html>
'''
    assert_reader_friendly(html)
    return html


def default_output_path(repo_root, report_data):
    date = report_data.get("date") or "undated"
    return Path(repo_root) / "reports" / f"epping-forest-ledger-{date}.html"


def write_report(report_data, repo_root, out_path=None):
    html = render_report(report_data, repo_root)
    out_path = Path(out_path) if out_path else default_output_path(repo_root, report_data)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(html, encoding="utf-8")
    return out_path


def main():
    if len(sys.argv) not in (2, 3):
        print("Usage: render_report.py <report-data.json> [output-path]", file=sys.stderr)
        sys.exit(1)
    report_data = load_json(sys.argv[1])
    repo_root = Path(__file__).resolve().parent.parent.parent
    out_path = sys.argv[2] if len(sys.argv) == 3 else None
    path = write_report(report_data, repo_root, out_path)
    print(f"Wrote {path}")


if __name__ == "__main__":
    main()
