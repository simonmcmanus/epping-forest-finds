#!/usr/bin/env python3
"""Generate the app icons: the oak leaf on a gold tile.

The leaf is not drawn here -- it is `data/icons/trees/oak.png`, the same
hand-drawn art the tree inspector uses, composited onto a gold ground so
the home screen icon and the favicon share the app's mark.

The location-pin logo (`trees/logo.png`) is still generated below; it is a
different job -- the onboarding welcome step and the loading screen use it.
"""

from PIL import Image, ImageDraw
import math
import os

OUT = os.path.join(os.path.dirname(__file__), "../data/icons")

BG       = (36, 56, 47)       # #24382f — app dark green
PIN_FILL = (243, 211, 107)    # #f3d36b — golden (matches current tree icon)
DOT_DARK = (36, 56, 47)       # #24382f — inner circle fill
DOT_RING = (243, 211, 107)    # golden ring around inner dot

LEAF        = "trees/oak.png"   # the English oak leaf, drawn at 256 px
GOLD_TOP    = (247, 220, 130)   # #f7dc82 -- gradient starts top-left
GOLD_BOTTOM = (226, 161, 60)    # #e2a13c -- and ends bottom-right
LEAF_HEIGHT = 0.56              # leaf height as a fraction of the tile
MASKABLE_LEAF_HEIGHT = 0.50     # smaller, to clear Android's circular crop
FAVICON_LEAF_HEIGHT = 0.72      # larger: a browser tab draws this at 16 px


def draw_pin_icon(draw, size, cx, cy, r, tip_y, pin_fill, dot_dark, dot_ring, stroke_w=0, stroke_color=None):
    """Draw a location pin centred horizontally at cx, circle centre at cy with radius r, tip at tip_y."""

    d = tip_y - cy  # distance from circle centre to tip

    # Tangent point offsets
    tx = r * math.sqrt(max(0, 1 - (r / d) ** 2))
    ty = cy + (r * r) / d

    # --- pin body (filled) ---
    if stroke_w and stroke_color:
        # Draw stroke version first (slightly larger)
        s = stroke_w
        s_r = r + s
        s_d = (tip_y + s) - cy
        s_tx = s_r * math.sqrt(max(0, 1 - (s_r / s_d) ** 2))
        s_ty = cy + (s_r * s_r) / s_d

        draw.ellipse([cx - s_r, cy - s_r, cx + s_r, cy + s_r], fill=stroke_color)
        draw.polygon([(cx - s_tx, s_ty), (cx, tip_y + s), (cx + s_tx, s_ty)], fill=stroke_color)

    # Filled circle (top part of pin)
    draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=pin_fill)
    # Filled triangle stem
    draw.polygon([(cx - tx, ty), (cx, tip_y), (cx + tx, ty)], fill=pin_fill)

    # --- inner ring & dot ---
    ring_r  = r * 0.46
    inner_r = r * 0.24

    draw.ellipse([cx - ring_r, cy - ring_r, cx + ring_r, cy + ring_r], fill=dot_dark)
    draw.ellipse([cx - inner_r, cy - inner_r, cx + inner_r, cy + inner_r], fill=dot_ring)


def gold_tile(size):
    """A square of the gold gradient, top-left to bottom-right."""
    tile = Image.new("RGB", (size, size))
    pixels = tile.load()
    span = max(1, (size - 1) * 2)
    for y in range(size):
        for x in range(size):
            t = (x + y) / span
            pixels[x, y] = tuple(
                round(a + (b - a) * t) for a, b in zip(GOLD_TOP, GOLD_BOTTOM)
            )
    return tile


def round_corners(tile, radius):
    """Knock the corners out of a tile so it sits on any wallpaper."""
    mask = Image.new("L", tile.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [0, 0, tile.size[0] - 1, tile.size[1] - 1], radius=radius, fill=255
    )
    out = tile.convert("RGBA")
    out.putalpha(mask)
    return out


def place_leaf(tile, height_fraction):
    """Centre the oak leaf on the tile, scaled by its own height."""
    leaf = Image.open(os.path.join(OUT, LEAF)).convert("RGBA")
    box = leaf.getbbox()                      # the art, minus its transparent margin
    leaf = leaf.crop(box)

    size = tile.size[0]
    scale = (size * height_fraction) / leaf.height
    leaf = leaf.resize(
        (max(1, round(leaf.width * scale)), max(1, round(leaf.height * scale))),
        Image.LANCZOS,
    )

    tile.alpha_composite(
        leaf, ((size - leaf.width) // 2, (size - leaf.height) // 2)
    )
    return tile


def make_icon(size, path, shape="rounded", height_fraction=LEAF_HEIGHT):
    """Write one leaf-on-gold icon.

    shape="rounded" leaves the corners transparent, for the manifest icons.
    shape="square" bleeds the gold to the edge: Apple ignores transparency and
    Android crops the maskable icon to a circle, so neither wants corners.
    """
    tile = gold_tile(size)
    if shape == "rounded":
        tile = round_corners(tile, max(4, int(size * 0.19)))
    else:
        tile = tile.convert("RGBA")

    tile = place_leaf(tile, height_fraction)

    if shape == "square":
        tile = tile.convert("RGB")
    tile.save(path, "PNG", optimize=True)
    print(f"  wrote {path}")


def make_transparent_logo(size, path):
    """Transparent pin logo for the loading screen and onboarding welcome."""
    img  = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    inset = int(size * 0.06)
    cx    = size / 2
    r     = (size - 2 * inset) / 2 * 0.78
    cy    = inset + r * 1.10
    tip_y = size - inset - size * 0.04
    stroke = max(1, int(r * 0.10))

    draw_pin_icon(draw, size, cx, cy, r, tip_y,
                  pin_fill=tuple(BG),          # dark fill for light bg
                  dot_dark=(247, 248, 244),    # cream dot
                  dot_ring=tuple(BG),
                  stroke_w=0, stroke_color=None)

    img.save(path, "PNG", optimize=True)
    print(f"  wrote {path}")


if __name__ == "__main__":
    print("Generating oak-leaf app icons…")
    make_icon(192, os.path.join(OUT, "icon-192.png"))
    make_icon(512, os.path.join(OUT, "icon-512.png"))
    make_icon(512, os.path.join(OUT, "icon-maskable-512.png"),
              shape="square", height_fraction=MASKABLE_LEAF_HEIGHT)
    make_icon(180, os.path.join(OUT, "apple-touch-icon.png"), shape="square")
    make_icon(128, os.path.join(OUT, "favicon.png"), shape="square",
              height_fraction=FAVICON_LEAF_HEIGHT)

    # The loading screen and the onboarding welcome step keep the pin logo.
    make_transparent_logo(256, os.path.join(OUT, "trees/logo.png"))

    print("Done.")
