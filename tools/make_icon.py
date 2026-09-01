"""Render the Aemeth Terminal app icon.

Design: geometric line-built "Æ" monogram (the app's brand glyph) on a
near-black rounded square with a hairline border. The Æ's middle bar is a
DETACHED pink dash — reads as the letter stroke and a subtle cursor nod.
Everything else is the brand purple gradient.
Renders at 2048 with numpy gradients, downsamples with LANCZOS.
"""
from __future__ import annotations

import os

import numpy as np
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
N = 2048  # master render size

# ---- palette -------------------------------------------------------------
BG = (11, 14, 20)            # #0b0e14
BORDER = (39, 44, 58)        # #272c3a hairline
PURPLE_A = (143, 127, 245)   # #8f7ff5
PURPLE_B = (90, 78, 214)     # #5a4ed6
PINK_TOP = (255, 122, 184)   # #ff7ab8
PINK_BOT = (255, 47, 142)    # #ff2f8e

# ---- geometry (in 1024 units, scaled to master) ---------------------------
S = N / 1024.0
R_CORNER = int(0.219 * N)                 # favicon-like 14/64 radius
BORDER_W = int(6 * S)
W = int(90 * S)                           # monogram stroke width

APEX = (468, 284)                         # Æ top junction
DIAG_END = (240, 740)                     # A left leg, bottom-left
STEM_END = (468, 740)                     # shared vertical stem, bottom
TOP_END = (764, 284)                      # E top arm
BOT_END = (764, 740)                      # E bottom arm
PINK_A = (552, 512)                       # detached middle dash (the pink stroke)
PINK_B = (712, 512)


def _pt(p):
    return (p[0] * S, p[1] * S)


def diag_gradient(c1, c2) -> Image.Image:
    ys, xs = np.mgrid[0:N, 0:N]
    t = (xs + ys) / (2 * (N - 1))
    arr = np.empty((N, N, 4), dtype=np.uint8)
    for i in range(3):
        arr[:, :, i] = c1[i] * (1 - t) + c2[i] * t
    arr[:, :, 3] = 255
    return Image.fromarray(arr, "RGBA")


def stroke_mask(draw_pairs, width) -> Image.Image:
    """Lines with rounded caps, drawn white on black."""
    mask = Image.new("L", (N, N), 0)
    d = ImageDraw.Draw(mask)
    r = width / 2
    for a, b in draw_pairs:
        a, b = _pt(a), _pt(b)
        d.line([a, b], fill=255, width=width)
        for p in (a, b):
            d.ellipse([p[0] - r, p[1] - r, p[0] + r, p[1] + r], fill=255)
    return mask


def render_master() -> Image.Image:
    canvas = Image.new("RGBA", (N, N), (0, 0, 0, 0))

    # 1) near-black rounded square
    bg_mask = Image.new("L", (N, N), 0)
    ImageDraw.Draw(bg_mask).rounded_rectangle([0, 0, N - 1, N - 1], R_CORNER, fill=255)
    canvas = Image.composite(Image.new("RGBA", (N, N), BG + (255,)), canvas, bg_mask)

    # 2) faint diagonal purple tint for depth
    ys, xs = np.mgrid[0:N, 0:N]
    t = (xs + ys) / (2 * (N - 1))
    tint = np.zeros((N, N, 4), dtype=np.uint8)
    tint[:, :, 0], tint[:, :, 1], tint[:, :, 2] = 124, 108, 240
    tint[:, :, 3] = (30 * (1 - t)).astype(np.uint8)
    canvas = Image.alpha_composite(
        canvas, Image.composite(Image.fromarray(tint, "RGBA"),
                                Image.new("RGBA", (N, N), (0, 0, 0, 0)), bg_mask)
    )

    d = ImageDraw.Draw(canvas)

    # 3) hairline border
    o = BORDER_W / 2
    d.rounded_rectangle([o, o, N - 1 - o, N - 1 - o], R_CORNER - int(o),
                        outline=BORDER + (255,), width=BORDER_W)

    # 4) Æ body in purple gradient: left leg, stem, top arm, bottom arm
    purple_mask = stroke_mask(
        [(DIAG_END, APEX), (APEX, STEM_END), (APEX, TOP_END), (STEM_END, BOT_END)],
        W,
    )
    purple = Image.composite(diag_gradient(PURPLE_A, PURPLE_B),
                             Image.new("RGBA", (N, N), (0, 0, 0, 0)), purple_mask)
    canvas = Image.alpha_composite(canvas, purple)

    # 5) THE pink stroke — detached middle dash with vertical pink gradient
    pink_mask = stroke_mask([(PINK_A, PINK_B)], W)
    y0, y1 = int(_pt(PINK_A)[1] - W / 2), int(_pt(PINK_A)[1] + W / 2)
    tv = np.clip((np.arange(y0, y1) - y0) / max(y1 - y0 - 1, 1), 0, 1)
    band = np.zeros((y1 - y0, N, 4), dtype=np.uint8)
    for i in range(3):
        band[:, :, i] = (PINK_TOP[i] * (1 - tv) + PINK_BOT[i] * tv)[:, None]
    band[:, :, 3] = 255
    pink_img = Image.new("RGBA", (N, N), (0, 0, 0, 0))
    pink_img.paste(Image.fromarray(band, "RGBA"), (0, y0))
    canvas = Image.alpha_composite(
        canvas, Image.composite(pink_img, Image.new("RGBA", (N, N), (0, 0, 0, 0)), pink_mask)
    )
    return canvas


def main() -> None:
    master = render_master()

    master_1024 = master.resize((1024, 1024), Image.LANCZOS)
    src_png = os.path.join(HERE, "icon-src.png")
    master_1024.save(src_png)

    sizes = [16, 24, 32, 48, 64, 128, 256]
    layers = {s: master.resize((s, s), Image.LANCZOS) for s in sizes}

    ico_path = os.path.join(ROOT, "src-tauri", "icons", "icon.ico")
    layers[256].save(ico_path, sizes=[(s, s) for s in sizes])
    print("wrote", ico_path)
    for s in (32, 128):
        p = os.path.join(HERE, f"preview-{s}.png")
        layers[s].save(p)
        print("wrote", p)


if __name__ == "__main__":
    main()
