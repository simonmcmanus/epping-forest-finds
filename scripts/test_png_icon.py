#!/usr/bin/env python3
"""
Unit tests for scripts/report/png_icon.py -- the dependency-free PNG
reader/writer the weekly report uses to inline one of the app's map icons.

Run with:  python3 scripts/test_png_icon.py
"""
import base64
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from scripts.report import png_icon  # noqa: E402

REAL_COW_ICON = Path(__file__).resolve().parent.parent / "data" / "icons" / "cow.png"


def solid_rgba(width, height, colour):
    return bytes(colour) * (width * height)


class RoundTripTests(unittest.TestCase):
    def test_an_image_survives_being_written_and_read_back(self):
        pixels = bytearray()
        for y in range(4):
            for x in range(4):
                pixels += bytes((x * 60 % 256, y * 60 % 256, 20, 255))
        encoded = png_icon.encode_png(4, 4, bytes(pixels))
        width, height, decoded = png_icon.load_rgba(encoded)
        self.assertEqual((width, height), (4, 4))
        self.assertEqual(decoded, bytes(pixels))

    def test_what_it_writes_is_a_real_png(self):
        encoded = png_icon.encode_png(2, 2, solid_rgba(2, 2, (10, 20, 30, 255)))
        self.assertTrue(encoded.startswith(png_icon.PNG_SIGNATURE))
        self.assertIn(b"IHDR", encoded)
        self.assertIn(b"IDAT", encoded)
        self.assertTrue(encoded.endswith(b"IEND\xae\x42\x60\x82"))


class DownscaleTests(unittest.TestCase):
    def test_a_flat_colour_keeps_its_colour(self):
        width, height, out = png_icon.downscale(4, 4, solid_rgba(4, 4, (12, 34, 56, 255)), 2)
        self.assertEqual((width, height), (2, 2))
        self.assertEqual(out, solid_rgba(2, 2, (12, 34, 56, 255)))

    def test_transparent_pixels_do_not_darken_their_neighbours(self):
        """Averaging colour without weighting it by alpha is what gives a
        naively-resized icon its dark fringe."""
        opaque_red = (255, 0, 0, 255)
        clear_black = (0, 0, 0, 0)
        pixels = bytes(opaque_red) + bytes(clear_black) + bytes(clear_black) + bytes(clear_black)
        _, _, out = png_icon.downscale(2, 2, pixels, 2)
        self.assertEqual(tuple(out[:3]), (255, 0, 0))  # colour unchanged
        self.assertEqual(out[3], 63)  # a quarter covered

    def test_a_factor_that_does_not_divide_evenly_is_refused(self):
        with self.assertRaises(ValueError):
            png_icon.downscale(5, 5, solid_rgba(5, 5, (0, 0, 0, 255)), 2)

    def test_a_factor_of_one_returns_the_image_untouched(self):
        pixels = solid_rgba(3, 3, (1, 2, 3, 4))
        self.assertEqual(png_icon.downscale(3, 3, pixels, 1), (3, 3, pixels))


class UnsupportedFormatTests(unittest.TestCase):
    def test_something_that_is_not_a_png_is_refused(self):
        with self.assertRaises(png_icon.UnsupportedPng):
            png_icon.load_rgba(b"not a png at all")


class AppIconTests(unittest.TestCase):
    """The one real use: shrinking the app's cow icon to map-pin size."""

    def test_the_apps_cow_icon_shrinks_to_something_small_enough_to_inline(self):
        uri = png_icon.icon_data_uri(REAL_COW_ICON, 64)
        self.assertTrue(uri.startswith("data:image/png;base64,"))
        self.assertLess(len(uri), 20_000, "an inlined icon has to stay small")

    def test_the_shrunk_icon_is_still_a_readable_square_png(self):
        uri = png_icon.icon_data_uri(REAL_COW_ICON, 64)
        raw = base64.b64decode(uri.split(",", 1)[1])
        width, height, _ = png_icon.load_rgba(raw)
        self.assertEqual((width, height), (64, 64))


if __name__ == "__main__":
    unittest.main()
