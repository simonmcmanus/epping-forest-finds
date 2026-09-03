"""
Finding categories shared by the map (pin colour), the legend, and the
report's card sections. Keep this the single place that maps a category to
its colour/label so the map and the write-up can never drift apart.

Colours reuse the CSS custom properties already defined in the report's
design system (see template.py) -- "grazing" reuses --bark, the same warm
brown already used for paths/tracks elsewhere in the app, since it reads
naturally as "cattle/grazing" without introducing a new colour.
"""

CATEGORY_STYLES = {
    "opening": {"css_class": "good", "css_var": "--status-good", "label": "Opening"},
    "closing": {"css_class": "critical", "css_var": "--status-critical", "label": "Closure"},
    "road": {"css_class": "warning", "css_var": "--status-warning", "label": "Road / access"},
    "event": {"css_class": "event", "css_var": "--status-event", "label": "Event"},
    "grazing": {"css_class": "grazing", "css_var": "--bark", "label": "Cattle grazing"},
}

CATEGORY_ORDER = ["opening", "closing", "road", "event", "grazing"]


def style_for(category):
    return CATEGORY_STYLES.get(category, CATEGORY_STYLES["event"])
