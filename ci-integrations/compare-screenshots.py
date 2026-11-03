"""Compare runner-produced PNGs against an explicitly chosen baseline."""
import argparse
import json

from PIL import Image, ImageChops


def load_png(path):
    with Image.open(path, formats=["PNG"]) as image:
        if image.width * image.height > 16_000_000 or getattr(image, "is_animated", False):
            raise ValueError("Use a single PNG frame of at most 16 million pixels.")
        rgba = image.convert("RGBA")
        background = Image.new("RGBA", rgba.size, "white")
        return Image.alpha_composite(background, rgba).convert("RGB")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("baseline", help="Previously approved PNG")
    parser.add_argument("actual", help="Screenshot from the current run")
    parser.add_argument("diff", help="New PNG output path")
    parser.add_argument("--max-changed-pixels", type=int, default=0)
    args = parser.parse_args()
    if args.max_changed_pixels < 0:
        parser.error("--max-changed-pixels must be nonnegative")
    try:
        baseline, actual = load_png(args.baseline), load_png(args.actual)
        if baseline.size != actual.size:
            print(json.dumps({"status": "size-mismatch", "baseline": baseline.size, "actual": actual.size}))
            return 1
        red, green, blue = ImageChops.difference(baseline, actual).split()
        mask = ImageChops.lighter(ImageChops.lighter(red, green), blue).point(
            [0] + [255] * 255
        )
        changed = mask.histogram()[255]
        output = Image.composite(Image.new("RGB", actual.size, "magenta"), actual, mask)
        with open(args.diff, "xb") as file:
            output.save(file, format="PNG")
    except (OSError, ValueError, Image.DecompressionBombError) as error:
        parser.exit(2, f"Comparison failed: {error}\n")
    passed = changed <= args.max_changed_pixels
    print(json.dumps({"status": "pass" if passed else "regression", "changedPixels": changed}))
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
