"""Build the Tauri app icon source PNG.

Takes the chroma-keyed wax seal render, removes the magenta background,
and composites the seal onto a 1024x1024 dark-graphite rounded square
with transparent corners. Output is a single icon-source.png suitable
for `npx tauri icon`.
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "assets" / "seal-chroma.png"

# Asset generation lives outside the workspace in Cursor's project metadata.
# Fall back to that location if the in-repo copy doesn't exist yet.
if not SRC.exists():
    SRC = Path(
        r"C:\Users\et2bo\.cursor\projects"
        r"\c-Users-et2bo-Desktop-Projects-GatesAI-Chat\assets\seal-chroma.png"
    )

OUT = ROOT / "assets" / "icon-source.png"

CANVAS = 1024
RADIUS = 224  # ~22% — matches macOS Big Sur / Windows 11 app-icon shape
GRAPHITE = (13, 15, 16, 255)  # #0d0f10
CHROMA = (255, 0, 255)  # magenta key
CHROMA_TOLERANCE = 80  # squared-distance threshold for keying


def chroma_key(img: Image.Image) -> Image.Image:
    """Replace magenta pixels with transparent alpha; soften edges."""
    img = img.convert("RGBA")
    pixels = img.load()
    w, h = img.size
    kr, kg, kb = CHROMA
    tol_sq = CHROMA_TOLERANCE * CHROMA_TOLERANCE
    for y in range(h):
        for x in range(w):
            r, g, b, _ = pixels[x, y]
            dr, dg, db = r - kr, g - kg, b - kb
            dist_sq = dr * dr + dg * dg + db * db
            if dist_sq < tol_sq:
                pixels[x, y] = (0, 0, 0, 0)
            elif r > 200 and b > 200 and g < 120:
                # Magenta fringe bleed — keep RGB but soften alpha.
                falloff = max(0, 255 - (g * 2))
                pixels[x, y] = (r, g, b, 255 - falloff)
    return img


def rounded_square(size: int, radius: int, fill: tuple[int, int, int, int]) -> Image.Image:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    draw.rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=fill)
    return img


def trim_to_content(img: Image.Image) -> Image.Image:
    bbox = img.getbbox()
    return img.crop(bbox) if bbox else img


def main() -> None:
    if not SRC.exists():
        raise SystemExit(f"missing source: {SRC}")

    seal = chroma_key(Image.open(SRC))
    seal = trim_to_content(seal)

    # Fit seal to ~88% of the canvas while preserving aspect ratio.
    target = int(CANVAS * 0.88)
    sw, sh = seal.size
    scale = min(target / sw, target / sh)
    new_size = (max(1, int(sw * scale)), max(1, int(sh * scale)))
    seal = seal.resize(new_size, Image.LANCZOS)

    canvas = rounded_square(CANVAS, RADIUS, GRAPHITE)

    # Mask the seal with the rounded-square alpha so nothing bleeds past
    # the container shape (preserves transparent corners).
    container_alpha = canvas.split()[3]
    sx = (CANVAS - new_size[0]) // 2
    sy = (CANVAS - new_size[1]) // 2

    seal_layer = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    seal_layer.paste(seal, (sx, sy), seal)

    seal_alpha = seal_layer.split()[3]
    clipped_alpha = Image.eval(
        Image.merge("L", (Image.eval(seal_alpha, lambda v: v),)),
        lambda v: v,
    )
    # Multiply seal alpha by container alpha so seal can't overhang corners.
    final_alpha = Image.new("L", (CANVAS, CANVAS), 0)
    sa = seal_alpha.load()
    ca = container_alpha.load()
    fa = final_alpha.load()
    for y in range(CANVAS):
        for x in range(CANVAS):
            fa[x, y] = (sa[x, y] * ca[x, y]) // 255
    seal_layer.putalpha(final_alpha)

    out = Image.alpha_composite(canvas, seal_layer)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    out.save(OUT, "PNG", optimize=True)
    print(f"wrote {OUT} ({out.size[0]}x{out.size[1]})")

    public = ROOT / "public"
    public.mkdir(parents=True, exist_ok=True)
    favicon_sizes = [16, 32, 48, 180, 192, 512]
    rendered: dict[int, Image.Image] = {}
    for size in favicon_sizes:
        rendered[size] = out.resize((size, size), Image.LANCZOS)
        rendered[size].save(public / f"favicon-{size}.png", "PNG", optimize=True)
    rendered[180].save(public / "apple-touch-icon.png", "PNG", optimize=True)
    rendered[16].save(
        public / "favicon.ico",
        sizes=[(16, 16), (32, 32), (48, 48)],
    )
    print(f"wrote favicons to {public}")


if __name__ == "__main__":
    main()
