"""
A tiny, dependency-free PNG reader/writer, used to shrink one of the app's own
map icons down to report size and inline it in the page.

Why this exists: the report shows the cattle with the app's cow icon, and that
icon has to be *in* the page rather than fetched from a web address. A report
gets read on a phone in the forest, saved for later, and forwarded by email --
all places where a remote image quietly turns into a broken-image box. The
source icon is 256x256 and about 46 KB, far more than a 15-pixel map pin needs,
so it is box-filtered down to icon size first, which brings it under 5 KB.

Doing that with an image library would mean the report could no longer be built
from a plain checkout, which is the one thing the weekly build has to be able to
do. The subset of PNG handled here is exactly what the app's own icons are:
8 bits per channel, RGBA, not interlaced.

Public entry points: load_rgba, downscale, encode_png, icon_data_uri.
"""
import base64
import struct
import zlib

PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
BYTES_PER_PIXEL = 4  # 8-bit RGBA


class UnsupportedPng(ValueError):
    """Raised for any PNG outside the narrow subset described above."""


def _iter_chunks(data):
    if data[:8] != PNG_SIGNATURE:
        raise UnsupportedPng("not a PNG file")
    offset = 8
    while offset < len(data):
        (length,) = struct.unpack(">I", data[offset:offset + 4])
        chunk_type = data[offset + 4:offset + 8]
        payload = data[offset + 8:offset + 8 + length]
        yield chunk_type, payload
        offset += 12 + length


def _unfilter(raw, width, height):
    """Undoes PNG's per-scanline filters, returning flat RGBA bytes.

    Each scanline arrives prefixed with the filter type used on it; filters
    predict a byte from its left neighbour (a), the byte above (b) and the one
    above-left (c), and store only the difference.
    """
    stride = width * BYTES_PER_PIXEL
    out = bytearray(stride * height)
    previous = bytearray(stride)
    pos = 0
    for row in range(height):
        filter_type = raw[pos]
        pos += 1
        line = bytearray(raw[pos:pos + stride])
        pos += stride
        if filter_type == 1:  # Sub
            for i in range(BYTES_PER_PIXEL, stride):
                line[i] = (line[i] + line[i - BYTES_PER_PIXEL]) & 0xFF
        elif filter_type == 2:  # Up
            for i in range(stride):
                line[i] = (line[i] + previous[i]) & 0xFF
        elif filter_type == 3:  # Average
            for i in range(stride):
                left = line[i - BYTES_PER_PIXEL] if i >= BYTES_PER_PIXEL else 0
                line[i] = (line[i] + ((left + previous[i]) >> 1)) & 0xFF
        elif filter_type == 4:  # Paeth
            for i in range(stride):
                left = line[i - BYTES_PER_PIXEL] if i >= BYTES_PER_PIXEL else 0
                up = previous[i]
                up_left = previous[i - BYTES_PER_PIXEL] if i >= BYTES_PER_PIXEL else 0
                p = left + up - up_left
                pa, pb, pc = abs(p - left), abs(p - up), abs(p - up_left)
                if pa <= pb and pa <= pc:
                    predictor = left
                elif pb <= pc:
                    predictor = up
                else:
                    predictor = up_left
                line[i] = (line[i] + predictor) & 0xFF
        elif filter_type != 0:
            raise UnsupportedPng(f"unknown scanline filter {filter_type}")
        out[row * stride:(row + 1) * stride] = line
        previous = line
    return bytes(out)


def load_rgba(png_bytes):
    """Returns (width, height, rgba_bytes) for an 8-bit RGBA PNG."""
    header = None
    idat = bytearray()
    for chunk_type, payload in _iter_chunks(png_bytes):
        if chunk_type == b"IHDR":
            header = struct.unpack(">IIBBBBB", payload)
        elif chunk_type == b"IDAT":
            idat += payload
        elif chunk_type == b"IEND":
            break
    if header is None:
        raise UnsupportedPng("no image header")
    width, height, bit_depth, colour_type, _, _, interlace = header
    if bit_depth != 8 or colour_type != 6 or interlace != 0:
        raise UnsupportedPng(
            "only 8-bit RGBA, non-interlaced PNGs are supported "
            f"(got bit depth {bit_depth}, colour type {colour_type}, interlace {interlace})"
        )
    return width, height, _unfilter(zlib.decompress(bytes(idat)), width, height)


def downscale(width, height, rgba, factor):
    """Box-filters an RGBA image down by an integer factor.

    Colour is averaged with alpha weighting -- a fully transparent pixel has no
    colour worth averaging in, and letting it drag the average towards black is
    what gives naively-resized icons their dark fringe.
    """
    if factor < 1 or width % factor or height % factor:
        raise ValueError(f"{width}x{height} does not divide evenly by {factor}")
    if factor == 1:
        return width, height, rgba

    new_width, new_height = width // factor, height // factor
    out = bytearray(new_width * new_height * BYTES_PER_PIXEL)
    samples = factor * factor
    for y in range(new_height):
        for x in range(new_width):
            r = g = b = alpha_sum = 0
            for dy in range(factor):
                row_start = ((y * factor + dy) * width + x * factor) * BYTES_PER_PIXEL
                for dx in range(factor):
                    i = row_start + dx * BYTES_PER_PIXEL
                    a = rgba[i + 3]
                    r += rgba[i] * a
                    g += rgba[i + 1] * a
                    b += rgba[i + 2] * a
                    alpha_sum += a
            o = (y * new_width + x) * BYTES_PER_PIXEL
            if alpha_sum:
                out[o] = r // alpha_sum
                out[o + 1] = g // alpha_sum
                out[o + 2] = b // alpha_sum
            out[o + 3] = alpha_sum // samples
    return new_width, new_height, bytes(out)


def _chunk(chunk_type, payload):
    return (
        struct.pack(">I", len(payload))
        + chunk_type
        + payload
        + struct.pack(">I", zlib.crc32(chunk_type + payload) & 0xFFFFFFFF)
    )


def encode_png(width, height, rgba):
    """Writes an 8-bit RGBA PNG. Every scanline uses the "up" filter, which
    costs nothing to compute and compresses flat-coloured artwork well."""
    stride = width * BYTES_PER_PIXEL
    raw = bytearray()
    previous = bytes(stride)
    for row in range(height):
        line = rgba[row * stride:(row + 1) * stride]
        raw.append(2)  # Up
        raw += bytes((line[i] - previous[i]) & 0xFF for i in range(stride))
        previous = line
    header = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    return (
        PNG_SIGNATURE
        + _chunk(b"IHDR", header)
        + _chunk(b"IDAT", zlib.compress(bytes(raw), 9))
        + _chunk(b"IEND", b"")
    )


def icon_data_uri(path, size):
    """Reads an app icon and returns it as a `data:` address at `size` pixels
    square, ready to drop straight into the page."""
    width, height, rgba = load_rgba(path.read_bytes())
    if width != height:
        raise UnsupportedPng(f"icon is not square ({width}x{height})")
    factor = max(1, width // size)
    while factor > 1 and width % factor:
        factor -= 1
    width, height, rgba = downscale(width, height, rgba, factor)
    encoded = base64.b64encode(encode_png(width, height, rgba)).decode("ascii")
    return f"data:image/png;base64,{encoded}"
