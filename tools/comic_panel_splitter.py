#!/usr/bin/env python3
"""Split a comic page into panel crops using gutter/background detection."""

from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

import numpy as np
from PIL import Image, ImageDraw

Background = Literal["auto", "light", "dark"]
Rect = tuple[int, int, int, int]


@dataclass(frozen=True)
class Panel:
    index: int
    box: Rect

    @property
    def width(self) -> int:
        return self.box[2] - self.box[0]

    @property
    def height(self) -> int:
        return self.box[3] - self.box[1]

    def to_manifest_entry(self, file_name: str | None = None) -> dict:
        entry = {
            "id": f"panel_{self.index:03d}",
            "box": list(self.box),
            "width": self.width,
            "height": self.height,
        }
        if file_name:
            entry["file"] = file_name
        return entry


def detect_panels(
    image: Image.Image,
    *,
    background: Background = "auto",
    background_tolerance: int = 8,
    separator_ratio: float = 0.9,
    min_gutter: int = 4,
    min_panel_width: int = 32,
    min_panel_height: int = 32,
    min_panel_area: int = 5_000,
    padding: int = 0,
    filter_profile_card: bool = True,
    filter_text_strips: bool = True,
) -> list[Panel]:
    """Return panel rectangles sorted in reading order.

    Boxes use Pillow crop coordinates: ``(left, top, right, bottom)`` where the
    right and bottom edges are exclusive.
    """

    rects = _detect_panel_rects(
        image,
        background=background,
        background_tolerance=background_tolerance,
        separator_ratio=separator_ratio,
        min_gutter=min_gutter,
        min_panel_width=min_panel_width,
        min_panel_height=min_panel_height,
        min_panel_area=min_panel_area,
        padding=padding,
    )
    if filter_profile_card:
        rects, _ = _filter_profile_card_region(rects, image.size)
    if filter_text_strips:
        rects, _ = _filter_text_artifacts(rects, image.size)
    return _panels_from_rects(rects)


def _detect_panel_rects(
    image: Image.Image,
    *,
    background: Background,
    background_tolerance: int,
    separator_ratio: float,
    min_gutter: int,
    min_panel_width: int,
    min_panel_height: int,
    min_panel_area: int,
    padding: int,
) -> list[Rect]:
    grayscale = image.convert("L")
    pixels = np.asarray(grayscale)
    resolved_background = _resolve_background(pixels, background)
    background_mask = _make_background_mask(
        pixels,
        resolved_background,
        background_tolerance,
    )
    content_box = _bounding_box(~background_mask)
    if content_box is None:
        return []

    leaves = _split_rect(
        content_box,
        background_mask,
        separator_ratio=separator_ratio,
        min_gutter=min_gutter,
        min_panel_width=min_panel_width,
        min_panel_height=min_panel_height,
    )

    panels: list[Rect] = []
    for rect in leaves:
        refined = _refine_to_content(rect, background_mask, padding, pixels.shape)
        if refined is None:
            continue
        if _rect_area(refined) < min_panel_area:
            continue
        if refined[2] - refined[0] < min_panel_width:
            continue
        if refined[3] - refined[1] < min_panel_height:
            continue
        panels.append(refined)

    panels = _dedupe_rects(panels)
    return _sort_reading_order(panels)


def _panels_from_rects(rects: list[Rect]) -> list[Panel]:
    return [Panel(index=index + 1, box=box) for index, box in enumerate(rects)]


def split_file(
    image_path: Path,
    output_dir: Path,
    *,
    background: Background = "auto",
    background_tolerance: int = 8,
    separator_ratio: float = 0.9,
    min_gutter: int = 4,
    min_panel_width: int = 32,
    min_panel_height: int = 32,
    min_panel_area: int = 5_000,
    padding: int = 0,
    filter_profile_card: bool = True,
    filter_text_strips: bool = True,
    debug_overlay: Path | None = None,
    debug_candidates_overlay: Path | None = None,
) -> list[Panel]:
    image = Image.open(image_path).convert("RGB")
    candidate_boxes = _detect_panel_rects(
        image,
        background=background,
        background_tolerance=background_tolerance,
        separator_ratio=separator_ratio,
        min_gutter=min_gutter,
        min_panel_width=min_panel_width,
        min_panel_height=min_panel_height,
        min_panel_area=min_panel_area,
        padding=padding,
    )
    if filter_profile_card:
        right_candidate_boxes, profile_removed = _filter_profile_card_region(candidate_boxes, image.size)
    else:
        right_candidate_boxes = candidate_boxes
        profile_removed = []
    if filter_text_strips:
        final_boxes, removed = _filter_text_artifacts(right_candidate_boxes, image.size)
    else:
        final_boxes = right_candidate_boxes
        removed = []
    candidate_panels = _panels_from_rects(candidate_boxes)
    panels = _panels_from_rects(final_boxes)

    output_dir.mkdir(parents=True, exist_ok=True)
    manifest_panels = []
    for panel in panels:
        file_name = f"panel_{panel.index:03d}.png"
        image.crop(panel.box).save(output_dir / file_name)
        manifest_panels.append(panel.to_manifest_entry(file_name))

    manifest = {
        "source": str(image_path),
        "image_width": image.width,
        "image_height": image.height,
        "settings": {
            "background": background,
            "background_tolerance": background_tolerance,
            "separator_ratio": separator_ratio,
            "min_gutter": min_gutter,
            "min_panel_width": min_panel_width,
            "min_panel_height": min_panel_height,
            "min_panel_area": min_panel_area,
            "padding": padding,
            "filter_profile_card": filter_profile_card,
            "filter_text_strips": filter_text_strips,
        },
        "profile_filter": {
            "enabled": filter_profile_card,
            "candidate_count": len(candidate_boxes),
            "kept_right_candidate_count": len(right_candidate_boxes),
            "removed_count": len(profile_removed),
            "split_x_px": _profile_card_split_x(image.size) if _looks_like_profile_card_spread(image.size) else None,
            "removed": profile_removed,
        },
        "post_filter": {
            "enabled": filter_text_strips,
            "raw_count": len(right_candidate_boxes),
            "filtered_count": len(panels),
            "removed_count": len(removed),
            "rules": _text_artifact_filter_rules(image.size),
            "removed": removed,
        },
        "panels": manifest_panels,
    }
    (output_dir / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    if debug_candidates_overlay:
        _write_debug_overlay(image, candidate_panels, debug_candidates_overlay)

    if debug_overlay:
        _write_debug_overlay(image, panels, debug_overlay)

    return panels


def _filter_profile_card_region(rects: list[Rect], image_size: tuple[int, int]) -> tuple[list[Rect], list[dict]]:
    if not _looks_like_profile_card_spread(image_size):
        return rects, []

    split_x = _profile_card_split_x(image_size)
    kept: list[Rect] = []
    removed: list[dict] = []
    for index, rect in enumerate(rects, start=1):
        center_x = (rect[0] + rect[2]) / 2
        if center_x <= split_x:
            removed.append(_removed_manifest_entry(index, rect, "left_profile_card"))
            continue
        kept.append(rect)
    return kept, removed


def _looks_like_profile_card_spread(image_size: tuple[int, int]) -> bool:
    image_width, image_height = image_size
    aspect_ratio = image_width / max(1, image_height)
    return image_width >= 1400 and image_height >= 800 and 1.65 <= aspect_ratio <= 1.9


def _profile_card_split_x(image_size: tuple[int, int]) -> int:
    image_width, _ = image_size
    return round(image_width * 0.39)


def _filter_text_artifacts(rects: list[Rect], image_size: tuple[int, int]) -> tuple[list[Rect], list[dict]]:
    kept: list[Rect] = []
    removed: list[dict] = []
    for index, rect in enumerate(rects, start=1):
        reason = _text_artifact_reason(rect, image_size)
        if reason:
            removed.append(_removed_manifest_entry(index, rect, reason))
            continue
        kept.append(rect)
    return kept, removed


def _text_artifact_filter_rules(image_size: tuple[int, int]) -> dict:
    image_width, image_height = image_size
    return {
        "short_strip_max_height_px": _short_strip_max_height(image_height),
        "short_strip_min_aspect_ratio": 2.0,
        "narrow_sliver_max_width_px": _narrow_sliver_max_width(image_width),
        "narrow_sliver_max_height_px": _narrow_sliver_max_height(image_height),
        "narrow_sliver_min_aspect_ratio": 2.0,
        "tiny_artifact_max_area_px": _tiny_artifact_max_area(image_width, image_height),
    }


def _text_artifact_reason(rect: Rect, image_size: tuple[int, int]) -> str | None:
    image_width, image_height = image_size
    width = rect[2] - rect[0]
    height = rect[3] - rect[1]
    area = width * height
    aspect_ratio = width / max(1, height)
    inverse_aspect_ratio = height / max(1, width)

    if height <= _short_strip_max_height(image_height) and aspect_ratio >= 2.0:
        return "text_or_caption_strip"
    if (
        width <= _narrow_sliver_max_width(image_width)
        and height <= _narrow_sliver_max_height(image_height)
        and inverse_aspect_ratio >= 2.0
    ):
        return "narrow_text_or_caption_sliver"
    if area <= _tiny_artifact_max_area(image_width, image_height) and (
        height <= _short_strip_max_height(image_height)
        or width <= _narrow_sliver_max_width(image_width)
        or aspect_ratio >= 3.0
        or inverse_aspect_ratio >= 3.0
    ):
        return "small_text_or_decoration_fragment"
    return None


def _short_strip_max_height(image_height: int) -> int:
    return int(max(48, min(90, round(image_height * 0.085))))


def _narrow_sliver_max_width(image_width: int) -> int:
    return int(max(64, min(120, round(image_width * 0.07))))


def _narrow_sliver_max_height(image_height: int) -> int:
    return int(max(140, min(260, round(image_height * 0.28))))


def _tiny_artifact_max_area(image_width: int, image_height: int) -> int:
    return int(max(12_000, min(20_000, round(image_width * image_height * 0.012))))


def _removed_manifest_entry(index: int, rect: Rect, reason: str) -> dict:
    width = rect[2] - rect[0]
    height = rect[3] - rect[1]
    return {
        "id": f"candidate_{index:03d}",
        "box": list(rect),
        "width": width,
        "height": height,
        "area": width * height,
        "aspect_ratio": round(width / max(1, height), 4),
        "reason": reason,
    }


def _resolve_background(pixels: np.ndarray, background: Background) -> Literal["light", "dark"]:
    if background != "auto":
        return background

    edge = max(3, min(pixels.shape) // 80)
    samples = np.concatenate(
        [
            pixels[:edge, :].ravel(),
            pixels[-edge:, :].ravel(),
            pixels[:, :edge].ravel(),
            pixels[:, -edge:].ravel(),
        ]
    )
    return "light" if float(np.median(samples)) >= 128 else "dark"


def _make_background_mask(
    pixels: np.ndarray,
    background: Literal["light", "dark"],
    tolerance: int,
) -> np.ndarray:
    if background == "light":
        return pixels >= 255 - tolerance
    return pixels <= tolerance


def _split_rect(
    rect: Rect,
    background_mask: np.ndarray,
    *,
    separator_ratio: float,
    min_gutter: int,
    min_panel_width: int,
    min_panel_height: int,
) -> list[Rect]:
    x1, y1, x2, y2 = rect
    width = x2 - x1
    height = y2 - y1
    if width < min_panel_width * 2 or height < min_panel_height * 2:
        return [rect]

    region = background_mask[y1:y2, x1:x2]
    horizontal = _separator_bands(
        region.mean(axis=1),
        threshold=separator_ratio,
        min_gutter=min_gutter,
        min_before=min_panel_height,
        min_after=min_panel_height,
        total=height,
    )
    if horizontal:
        return _split_by_bands(
            rect,
            horizontal,
            axis="horizontal",
            background_mask=background_mask,
            separator_ratio=separator_ratio,
            min_gutter=min_gutter,
            min_panel_width=min_panel_width,
            min_panel_height=min_panel_height,
        )

    vertical = _separator_bands(
        region.mean(axis=0),
        threshold=separator_ratio,
        min_gutter=min_gutter,
        min_before=min_panel_width,
        min_after=min_panel_width,
        total=width,
    )
    if vertical:
        return _split_by_bands(
            rect,
            vertical,
            axis="vertical",
            background_mask=background_mask,
            separator_ratio=separator_ratio,
            min_gutter=min_gutter,
            min_panel_width=min_panel_width,
            min_panel_height=min_panel_height,
        )

    return [rect]


def _separator_bands(
    ratios: np.ndarray,
    *,
    threshold: float,
    min_gutter: int,
    min_before: int,
    min_after: int,
    total: int,
) -> list[tuple[int, int]]:
    hits = np.flatnonzero(ratios >= threshold)
    if len(hits) == 0:
        return []

    bands: list[tuple[int, int]] = []
    start = int(hits[0])
    previous = int(hits[0])
    for value in hits[1:]:
        current = int(value)
        if current == previous + 1:
            previous = current
            continue
        bands.append((start, previous + 1))
        start = current
        previous = current
    bands.append((start, previous + 1))

    return [
        (start, end)
        for start, end in bands
        if end - start >= min_gutter
        and start >= min_before
        and total - end >= min_after
    ]


def _split_by_bands(
    rect: Rect,
    bands: list[tuple[int, int]],
    *,
    axis: Literal["horizontal", "vertical"],
    background_mask: np.ndarray,
    separator_ratio: float,
    min_gutter: int,
    min_panel_width: int,
    min_panel_height: int,
) -> list[Rect]:
    x1, y1, x2, y2 = rect
    cursor = 0
    pieces: list[Rect] = []
    limit = y2 - y1 if axis == "horizontal" else x2 - x1

    for start, end in bands:
        if start > cursor:
            pieces.append(_rect_slice(rect, cursor, start, axis))
        cursor = end
    if cursor < limit:
        pieces.append(_rect_slice(rect, cursor, limit, axis))

    result: list[Rect] = []
    for piece in pieces:
        if piece[2] - piece[0] < min_panel_width:
            continue
        if piece[3] - piece[1] < min_panel_height:
            continue
        result.extend(
            _split_rect(
                piece,
                background_mask,
                separator_ratio=separator_ratio,
                min_gutter=min_gutter,
                min_panel_width=min_panel_width,
                min_panel_height=min_panel_height,
            )
        )
    return result or [rect]


def _rect_slice(rect: Rect, start: int, end: int, axis: Literal["horizontal", "vertical"]) -> Rect:
    x1, y1, x2, y2 = rect
    if axis == "horizontal":
        return (x1, y1 + start, x2, y1 + end)
    return (x1 + start, y1, x1 + end, y2)


def _refine_to_content(
    rect: Rect,
    background_mask: np.ndarray,
    padding: int,
    shape: tuple[int, int],
) -> Rect | None:
    x1, y1, x2, y2 = rect
    local = ~background_mask[y1:y2, x1:x2]
    box = _bounding_box(local)
    if box is None:
        return None
    lx1, ly1, lx2, ly2 = box
    height, width = shape
    return (
        max(0, x1 + lx1 - padding),
        max(0, y1 + ly1 - padding),
        min(width, x1 + lx2 + padding),
        min(height, y1 + ly2 + padding),
    )


def _bounding_box(mask: np.ndarray) -> Rect | None:
    ys, xs = np.nonzero(mask)
    if len(xs) == 0 or len(ys) == 0:
        return None
    return (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1)


def _rect_area(rect: Rect) -> int:
    return max(0, rect[2] - rect[0]) * max(0, rect[3] - rect[1])


def _dedupe_rects(rects: list[Rect]) -> list[Rect]:
    unique: list[Rect] = []
    for rect in rects:
        if any(_iou(rect, existing) > 0.94 for existing in unique):
            continue
        unique.append(rect)
    return unique


def _iou(a: Rect, b: Rect) -> float:
    ix1 = max(a[0], b[0])
    iy1 = max(a[1], b[1])
    ix2 = min(a[2], b[2])
    iy2 = min(a[3], b[3])
    intersection = _rect_area((ix1, iy1, ix2, iy2))
    if intersection == 0:
        return 0.0
    return intersection / float(_rect_area(a) + _rect_area(b) - intersection)


def _sort_reading_order(rects: list[Rect]) -> list[Rect]:
    if not rects:
        return []

    median_height = float(np.median([rect[3] - rect[1] for rect in rects]))
    row_tolerance = max(12.0, median_height * 0.35)
    rows: list[list[Rect]] = []
    for rect in sorted(rects, key=lambda item: (item[1], item[0])):
        center_y = (rect[1] + rect[3]) / 2
        for row in rows:
            row_center = np.mean([(item[1] + item[3]) / 2 for item in row])
            if abs(center_y - row_center) <= row_tolerance:
                row.append(rect)
                break
        else:
            rows.append([rect])

    sorted_rects: list[Rect] = []
    for row in rows:
        sorted_rects.extend(sorted(row, key=lambda item: item[0]))
    return sorted_rects


def _write_debug_overlay(image: Image.Image, panels: list[Panel], path: Path) -> None:
    overlay = image.copy()
    draw = ImageDraw.Draw(overlay)
    for panel in panels:
        x1, y1, x2, y2 = panel.box
        draw.rectangle((x1, y1, x2 - 1, y2 - 1), outline=(255, 0, 0), width=4)
        draw.text((x1 + 6, y1 + 6), str(panel.index), fill=(255, 0, 0))
    path.parent.mkdir(parents=True, exist_ok=True)
    overlay.save(path)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Automatically split a comic page into panel image crops.",
    )
    parser.add_argument("image", type=Path, help="Input comic page image.")
    parser.add_argument(
        "-o",
        "--output-dir",
        type=Path,
        default=Path("panel_output"),
        help="Directory for panel_001.png crops and manifest.json.",
    )
    parser.add_argument(
        "--background",
        choices=["auto", "light", "dark"],
        default="auto",
        help="Gutter/background color model. Use dark for black gutters like the sample.",
    )
    parser.add_argument("--background-tolerance", type=int, default=8)
    parser.add_argument("--separator-ratio", type=float, default=0.9)
    parser.add_argument("--min-gutter", type=int, default=4)
    parser.add_argument("--min-panel-width", type=int, default=32)
    parser.add_argument("--min-panel-height", type=int, default=32)
    parser.add_argument("--min-panel-area", type=int, default=5_000)
    parser.add_argument("--padding", type=int, default=0)
    parser.add_argument(
        "--keep-profile-card",
        action="store_false",
        dest="filter_profile_card",
        help="Keep the left profile-card area when processing wide control-page spreads.",
    )
    parser.add_argument(
        "--keep-text-strips",
        action="store_false",
        dest="filter_text_strips",
        help="Keep very small text/caption strips instead of applying the default post-filter.",
    )
    parser.add_argument(
        "--debug-overlay",
        type=Path,
        help="Optional image with detected panel boxes drawn in red.",
    )
    parser.add_argument(
        "--debug-candidates-overlay",
        type=Path,
        help="Optional image with pre-filter candidate boxes drawn in red.",
    )
    return parser


def main() -> int:
    args = build_parser().parse_args()
    panels = split_file(
        args.image,
        args.output_dir,
        background=args.background,
        background_tolerance=args.background_tolerance,
        separator_ratio=args.separator_ratio,
        min_gutter=args.min_gutter,
        min_panel_width=args.min_panel_width,
        min_panel_height=args.min_panel_height,
        min_panel_area=args.min_panel_area,
        padding=args.padding,
        filter_profile_card=args.filter_profile_card,
        filter_text_strips=args.filter_text_strips,
        debug_overlay=args.debug_overlay,
        debug_candidates_overlay=args.debug_candidates_overlay,
    )
    print(f"Wrote {len(panels)} panels to {args.output_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
