#!/usr/bin/env python3
"""Generate the app icons: the oak leaf on a gold tile.

The leaf is not drawn here -- it is `data/icons/trees/oak.png`, the same
hand-drawn art the tree inspector uses and the homepage shows top left
(`assets/home/map-icons/oak.png`). That oak is the logo everywhere: it is
composited onto a gold ground for the home screen icon and the favicon,
and copied bare to `trees/logo.png` for the loading screen and the
onboarding welcome step.
"""

from PIL import Image, ImageDraw
import os
import shutil

OUT = os.path.join(os.path.dirname(__file__), "../data/icons")
HOME = os.path.join(os.path.dirname(__file__), "../assets/home")

LEAF        = "trees/oak.png"   # the English oak leaf, drawn at 256 px
GOLD_TOP    = (247, 220, 130)   # #f7dc82 -- gradient starts top-left
GOLD_BOTTOM = (226, 161, 60)    # #e2a13c -- and ends bottom-right
LEAF_HEIGHT = 0.62              # leaf height as a fraction of the tile
MASKABLE_LEAF_HEIGHT = 0.50     # smaller, to clear Android's circular crop
FAVICON_LEAF_HEIGHT = 0.72      # larger: a browser tab draws this at 16 px


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


if __name__ == "__main__":
    print("Generating oak-leaf app icons…")
    make_icon(192, os.path.join(OUT, "icon-192.png"))
    make_icon(512, os.path.join(OUT, "icon-512.png"))
    make_icon(512, os.path.join(OUT, "icon-maskable-512.png"),
              shape="square", height_fraction=MASKABLE_LEAF_HEIGHT)
    make_icon(180, os.path.join(OUT, "apple-touch-icon.png"), shape="square")
    make_icon(128, os.path.join(OUT, "favicon.png"), shape="square",
              height_fraction=FAVICON_LEAF_HEIGHT)

    # The bare oak is the logo on the loading screen and onboarding welcome.
    shutil.copyfile(os.path.join(OUT, LEAF), os.path.join(OUT, "trees/logo.png"))

    # The homepage keeps independent copies: it never loads app assets.
    shutil.copyfile(os.path.join(OUT, "favicon.png"), os.path.join(HOME, "favicon.png"))
    shutil.copyfile(os.path.join(OUT, "apple-touch-icon.png"),
                    os.path.join(HOME, "apple-touch-icon.png"))

    print("Done.")
