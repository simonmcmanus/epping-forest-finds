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
import sys
from pathlib import Path

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))
    from scripts.report import places, svg_map, template  # noqa: E402
    from scripts.report.categories import CATEGORY_STYLES, style_for  # noqa: E402
    from scripts.report.jargon_guard import assert_reader_friendly  # noqa: E402
    from scripts.report.text_utils import oxford_comma_join, pluralize_label  # noqa: E402
else:
    from . import places, svg_map, template
    from .categories import CATEGORY_STYLES, style_for
    from .jargon_guard import assert_reader_friendly
    from .text_utils import oxford_comma_join, pluralize_label

DEFAULT_APP_LINK = "https://epping-forest.netlify.app"
DEFAULT_ABOUT_NOTE = (
    "This report is put together each week from council and City of London updates, "
    "local news, an open map of shops and small businesses (OpenStreetMap), and the "
    "live tracker for the forest's grazing cattle. It won't catch everything — if "
    "you spot something wrong or missing, we'd like to know."
)

SECTION_TITLES = {
    "business": ("Shops, cafés, restaurants & pubs", "What's opened, closed, or might have."),
    "road": ("Road closures & access", "Things that might affect getting around the forest."),
    "event": ("Events in the forest", "What's on this week."),
}

BUSINESS_CATEGORIES = {"opening", "closing"}


def load_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


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
        (str(food_total), "Places on the map"),
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
    chip = f'<span class="pin-chip {css_class}">{finding["number"]}</span>' if finding.get("lon") is not None else ""
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


def render_business_section(findings):
    items = [f for f in findings if f.get("category") in BUSINESS_CATEGORIES]
    title, subtitle = SECTION_TITLES["business"]
    body = "".join(render_card(f) for f in items) if items else (
        '<div class="card"><div class="card-head"><h3 style="font-size:1rem;">Nothing to report this week</h3></div>'
        "<p>No likely openings or closures turned up this run.</p></div>"
    )
    return f'<section id="businesses"><h2 class="section-title">{escape(title)}</h2><p class="section-sub">{escape(subtitle)}</p><div class="cards">{body}</div></section>'


def render_category_section(section_key, category, findings):
    items = [f for f in findings if f.get("category") == category]
    if not items:
        return ""
    title, subtitle = SECTION_TITLES[section_key]
    body = "".join(render_card(f) for f in items)
    return f'<section id="{section_key}"><h2 class="section-title">{escape(title)}</h2><p class="section-sub">{escape(subtitle)}</p><div class="cards">{body}</div></section>'


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
        f'<div class="card-head"><h3>Where the cattle are grazing</h3><span class="status-label {css_class or "event"}">{escape(status)}</span></div>'
        f'{place_html}{body_html}{sources_html}'
        f'</div>'
    )
    return (
        '<section id="grazing"><h2 class="section-title">The forest\'s grazing cattle</h2>'
        '<p class="section-sub">Epping Forest\'s conservation-grazing cattle move around the forest through the year.</p>'
        f'<div class="cards">{card}</div></section>'
    )


def render_map_legend():
    items = []
    for category, style in CATEGORY_STYLES.items():
        items.append(f'<div class="legend-item"><span class="legend-dot" style="background:var({style["css_var"]})"></span>{escape(style["label"])}</div>')
    return f'<div class="legend">{"".join(items)}</div>'


def render_map_side_list(findings):
    items = []
    for f in findings:
        if f.get("lon") is None:
            continue
        style = style_for(f.get("category"))
        css_class = style["css_class"]
        text_style = ' style="color:var(--status-warning-ink)"' if css_class == "warning" else ""
        items.append(
            f'<div class="find-mini"><span class="badge{" " + css_class if css_class else ""}" style="background:var({style["css_var"]})">{f["number"]}</span>'
            f'<div class="txt"><strong>{escape(f.get("title",""))}</strong><span>{escape(f.get("place",""))}</span></div></div>'
        )
    return "".join(items)


def render_map_section(forest_geojson, findings):
    pinned = [f for f in findings if f.get("lon") is not None]
    svg = svg_map.render_map_svg(forest_geojson, pinned)
    legend = render_map_legend()
    side_list = render_map_side_list(findings)
    count_line = f"{len(pinned)} item{'s' if len(pinned) != 1 else ''} flagged this run. Full detail is below the map." if pinned else "Nothing needed a pin on the map this run."
    return f'''<section id="map">
    <h2 class="section-title">This week on the map</h2>
    <p class="section-sub">The dashed line shows the area this report searches for updates in — not just the forest itself, but the towns around its edge.</p>
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


def render_app_link(app_link):
    return (
        f'<a class="app-link" href="{escape(app_link)}">Open the live map →</a>'
    )


def render_about_note(report_data):
    text = report_data.get("about_note") or DEFAULT_ABOUT_NOTE
    return f'<div class="about-note">{escape(text)}</div>'


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

    findings, grazing_pin = normalize_findings(report_data)
    grazing = report_data.get("grazing")

    date_display = report_data.get("date_display") or report_data.get("date", "")
    coverage_area = report_data.get("coverage_area") or [t["name"] for t in places.TOWNS]
    intro = report_data.get("intro", "")
    app_link = report_data.get("app_link") or DEFAULT_APP_LINK

    stat_strip = render_stat_strip(findings, food_stats["total"], grazing)
    map_section = render_map_section(forest_geojson, findings)
    business_section = render_business_section(findings)
    road_section = render_category_section("road", "road", findings)
    event_section = render_category_section("event", "event", findings)
    grazing_section = render_grazing_section(grazing)
    about_note = render_about_note(report_data)
    sources_footer = render_sources_footer(findings, grazing)
    food_sentence = food_stats_sentence(food_stats)

    banner_html = f'<div class="banner">{escape(intro)}</div>' if intro else ""

    html = f'''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Epping Forest Ledger</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
{template.FONT_LINKS}
<style>
{template.REPORT_CSS}
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
    {render_app_link(app_link)}
  </div>
</header>

<div class="wrap">

  {stat_strip}
  <p class="section-sub" style="margin-top:-8px;">{escape(food_sentence)}</p>

  {map_section}

  {business_section}

  {road_section}

  {event_section}

  {grazing_section}

  {about_note}

  {sources_footer}

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
