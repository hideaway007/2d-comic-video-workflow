#!/usr/bin/env node

import { writeFile } from "node:fs/promises";
import path from "node:path";
import { PNG } from "pngjs";
import { ensureDir } from "./lib/planning.mjs";

const cwd = process.env.MOTION_COMIC_TEST_ROOT || process.cwd();
const pagesDir = path.join(cwd, "input", "pages");
const scriptDir = path.join(cwd, "input", "script");

function paintPage({ width, height, palette, accent, pageNumber }) {
  const png = new PNG({ width, height });

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = (width * y + x) << 2;
      const gradient = y / height;
      png.data[idx] = Math.round(palette[0] * (1 - gradient) + accent[0] * gradient);
      png.data[idx + 1] = Math.round(palette[1] * (1 - gradient) + accent[1] * gradient);
      png.data[idx + 2] = Math.round(palette[2] * (1 - gradient) + accent[2] * gradient);
      png.data[idx + 3] = 255;
    }
  }

  const panels = [
    { x: 72, y: 68, w: 470, h: 392 },
    { x: 586, y: 68, w: 470, h: 392 },
    { x: 72, y: 502, w: 984, h: 178 },
  ];

  for (const [panelIndex, panel] of panels.entries()) {
    fillRect(png, panel.x, panel.y, panel.w, panel.h, [245, 242, 232, 255]);
    strokeRect(png, panel.x, panel.y, panel.w, panel.h, [26, 28, 32, 255], 7);
    const cx = panel.x + Math.round(panel.w * (0.35 + panelIndex * 0.12));
    const cy = panel.y + Math.round(panel.h * 0.55);
    fillCircle(png, cx, cy, 42 + pageNumber * 5, [accent[0], accent[1], accent[2], 255]);
    fillRect(png, panel.x + 38, panel.y + 34, 170 + pageNumber * 12, 18, [28, 30, 34, 255]);
  }

  fillRect(png, 806, 554, 192, 54, [255, 255, 255, 255]);
  strokeRect(png, 806, 554, 192, 54, [26, 28, 32, 255], 4);
  fillRect(png, 832, 574, 118, 12, [26, 28, 32, 255]);

  return PNG.sync.write(png);
}

function fillRect(png, x, y, width, height, rgba) {
  for (let py = y; py < y + height; py += 1) {
    for (let px = x; px < x + width; px += 1) {
      setPixel(png, px, py, rgba);
    }
  }
}

function strokeRect(png, x, y, width, height, rgba, thickness) {
  fillRect(png, x, y, width, thickness, rgba);
  fillRect(png, x, y + height - thickness, width, thickness, rgba);
  fillRect(png, x, y, thickness, height, rgba);
  fillRect(png, x + width - thickness, y, thickness, height, rgba);
}

function fillCircle(png, cx, cy, radius, rgba) {
  const radiusSquared = radius * radius;
  for (let y = cy - radius; y <= cy + radius; y += 1) {
    for (let x = cx - radius; x <= cx + radius; x += 1) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= radiusSquared) {
        setPixel(png, x, y, rgba);
      }
    }
  }
}

function setPixel(png, x, y, rgba) {
  if (x < 0 || y < 0 || x >= png.width || y >= png.height) {
    return;
  }
  const idx = (png.width * y + x) << 2;
  png.data[idx] = rgba[0];
  png.data[idx + 1] = rgba[1];
  png.data[idx + 2] = rgba[2];
  png.data[idx + 3] = rgba[3];
}

await ensureDir(pagesDir);
await ensureDir(scriptDir);

const samples = [
  {
    file: "page_001.png",
    palette: [80, 113, 145],
    accent: [228, 92, 72],
  },
  {
    file: "page_002.png",
    palette: [50, 132, 115],
    accent: [236, 180, 76],
  },
  {
    file: "page_003.png",
    palette: [118, 92, 150],
    accent: [94, 181, 214],
  },
];

for (const [index, sample] of samples.entries()) {
  const png = paintPage({
    width: 1200,
    height: 720,
    palette: sample.palette,
    accent: sample.accent,
    pageNumber: index + 1,
  });
  await writeFile(path.join(pagesDir, sample.file), png);
}

await writeFile(
  path.join(scriptDir, "story.md"),
  [
    "# Sample Motion Comic Input",
    "",
    "- page_001: 角色发现异常光源，镜头缓慢推近。",
    "- page_002: 场景切到街角，前景做轻微视差漂移。",
    "- page_003: 情绪停顿，保留整帧回退分层。",
    "",
  ].join("\n"),
  "utf8",
);

console.log(`Created sample input in ${path.join(cwd, "input")}`);
