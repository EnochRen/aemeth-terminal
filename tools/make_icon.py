"""Render the Aemeth Terminal app icon.

Design: Vercel-grade minimal "swiss-army knife" mark on a near-black rounded
square with a hairline border. Two elements only:
  * a white horizontal handle bar,
  * a pink tapered blade unfolding from it (the pink accent / 一撇).
Renders at 2048 with numpy gradients, downsamples with LANCZOS.
"""
from __future__ import annotations

import math
import os

import numpy as np
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
N = 2048  # master render size

# ---- palette -------------------------------------------------------------
BG = (11, 14, 20)          # #0b0e14
BORDER = (39, 44, 58)      # #272c3a hairline
WHITE = (245, 245, 245)    # #f5f5f5 handle
PINK_TOP = (255, 122, 184)  # #ff7ab8
PINK_BOT = (255, 47, 142)   # #ff2f8e

# ---- geometry (in 1024 units) ---------------------------------------------
S = N / 1024.0
R_CORNER = int(0.219 * N)
BORDER_W = int(6 * S)

HANDLE_W = 104                       # handle stroke width (dominant body)
HANDLE_A = (272, 600)
HANDLE_B = (752, 600)

BLADE_ROOT_W = 88                    # blade width at pivot (slimmer than handle)
BLADE_TIP_W = 28                     # tapered tip
PIVOT = (312, 600)                   # blade hinge at handle's left end
TIP = (640, 380)                     # shallow ~34° unfold, shorter than handle


def _pt(p):
    return (p[0] * S, p[1] * S)


def render_master() -> Image.Image:
    canvas = Image.new("RGBA", (N, N), (0, 0, 0, 0))

    # 1) flat near-black rounded square (Vercel: no gloss, no tint)
    bg_mask = Image.new("L", (N, N), 0)
    ImageDraw.Draw(bg_mask).rounded_rectangle([0, 0, N - 1, N - 1], R_CORNER, fill=255)
    canvas = Image.composite(Image.new("RGBA", (N, N), BG + (255,)), canvas, bg_mask)

    d = ImageDraw.Draw(canvas)

    # 2) hairline border
    o = BORDER_W / 2
    d.rounded_rectangle([o, o, N - 1 - o, N - 1 - o], R_CORNER - int(o),
                        outline=BORDER + (255,), width=BORDER_W)

    # 3) white handle bar, rounded caps
    a, b = _pt(HANDLE_A), _pt(HANDLE_B)
    r = HANDLE_W * S / 2
    d.line([a, b], fill=WHITE + (255,), width=int(HANDLE_W * S))
    d.ellipse([a[0] - r, a[1] - r, a[0] + r, a[1] + r], fill=WHITE + (255,))
    d.ellipse([b[0] - r, b[1] - r, b[0] + r, b[1] + r], fill=WHITE + (255,))

    # 4) pink tapered blade unfolding from the handle
    dx, dy = TIP[0] - PIVOT[0], TIP[1] - PIVOT[1]
    length = math.hypot(dx, dy)
    ux, uy = dx / length, dy / length          # blade direction
    px, py = -uy, ux                           # perpendicular
    rw, tw = BLADE_ROOT_W / 2, BLADE_TIP_W / 2
    p1 = (PIVOT[0] + px * rw, PIVOT[1] + py * rw)
    p2 = (TIP[0] + px * tw, TIP[1] + py * tw)
    p3 = (TIP[0] - px * tw, TIP[1] - py * tw)
    p4 = (PIVOT[0] - px * rw, PIVOT[1] - py * rw)

    blade_mask = Image.new("L", (N, N), 0)
    bd = ImageDraw.Draw(blade_mask)
    bd.polygon([_pt(p1), _pt(p2), _pt(p3), _pt(p4)], fill=255)
    rp, rt = rw * S, tw * S
    pv, tp = _pt(PIVOT), _pt(TIP)
    bd.ellipse([pv[0] - rp, pv[1] - rp, pv[0] + rp, pv[1] + rp], fill=255)  # hinge rivet
    bd.ellipse([tp[0] - rt, tp[1] - rt, tp[0] + rt, tp[1] + rt], fill=255)  # rounded tip

    y0, y1 = int(_pt(TIP)[1] - rt), int(_pt(PIVOT)[1] + rp)
    tv = np.clip((np.arange(y0, y1) - y0) / max(y1 - y0 - 1, 1), 0, 1)
    band = np.zeros((y1 - y0, N, 4), dtype=np.uint8)
    for i in range(3):
        band[:, :, i] = (PINK_TOP[i] * (1 - tv) + PINK_BOT[i] * tv)[:, None]
    band[:, :, 3] = 255
    pink_img = Image.new("RGBA", (N, N), (0, 0, 0, 0))
    pink_img.paste(Image.fromarray(band, "RGBA"), (0, y0))
    canvas = Image.alpha_composite(
        canvas, Image.composite(pink_img, Image.new("RGBA", (N, N), (0, 0, 0, 0)), blade_mask)
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
