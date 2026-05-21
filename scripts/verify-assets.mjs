#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathExists, readJsonFile, readPlan, resolveProjectPath } from "./lib/quality.mjs";

async function main() {
  const cwd = process.cwd();
  const plan = await readPlan(cwd);
  const issues = [];
  const panelById = new Map();
  const shotIds = new Set();

  if (plan.version === 2) {
    if (!plan.panel_pack) {
      issues.push("Motion plan v2 must include panel_pack");
    } else {
      try {
        const panelPack = await readJsonFile(cwd, plan.panel_pack, "panel_pack");
        const planPanelIds = sortedIds(plan.panels ?? [], "panel_id");
        const packPanelIds = sortedIds(panelPack.panels ?? [], "panel_id");
        if (planPanelIds.join("\n") !== packPanelIds.join("\n")) {
          issues.push(
            `panel_pack drift: motion_plan panels [${planPanelIds.join(", ")}] do not match ${plan.panel_pack} panels [${packPanelIds.join(", ")}]`,
          );
        } else {
          const packPanelById = new Map((panelPack.panels ?? []).map((panel) => [panel.panel_id, panel]));
          for (const panel of plan.panels ?? []) {
            const packPanel = packPanelById.get(panel.panel_id);
            for (const field of panelPackDriftFields) {
              if (stableJson(panel[field]) !== stableJson(packPanel?.[field])) {
                issues.push(
                  `panel_pack drift: panel ${panel.panel_id} ${field} differs between motion_plan and ${plan.panel_pack}: expected ${stableJson(panel[field])}, got ${stableJson(packPanel?.[field])}`,
                );
              }
            }
          }
        }
      } catch (error) {
        issues.push(error.message);
      }
    }

    if (!Array.isArray(plan.pages) || plan.pages.length === 0) {
      issues.push("Motion plan v2 must include a non-empty pages array");
    }
    if (!Array.isArray(plan.panels) || plan.panels.length === 0) {
      issues.push("Motion plan v2 must include a non-empty panels array");
    } else {
      for (const panel of plan.panels) {
        if (!panel.panel_id) {
          issues.push("Panel is missing panel_id");
          continue;
        }
        if (panelById.has(panel.panel_id)) {
          issues.push(`Duplicate panel_id: ${panel.panel_id}`);
        }
        panelById.set(panel.panel_id, panel);
        if (!panel.crop_asset) {
          issues.push(`Panel ${panel.panel_id} is missing crop_asset`);
        } else if (!(await pathExists(resolveProjectPath(cwd, panel.crop_asset)))) {
          issues.push(`Missing panel crop for ${panel.panel_id}: ${panel.crop_asset}`);
        }
      }
    }
  }

  for (const shot of plan.shots) {
    if (!shot.shot_id) {
      issues.push("Shot is missing shot_id");
      continue;
    }
    if (shotIds.has(shot.shot_id)) {
      issues.push(`Duplicate shot_id: ${shot.shot_id}`);
    }
    shotIds.add(shot.shot_id);

    if (plan.version === 2) {
      if (!shot.panel_id) {
        issues.push(`Shot ${shot.shot_id} is missing panel_id`);
      } else if (!panelById.has(shot.panel_id)) {
        issues.push(`Unknown panel_id for ${shot.shot_id}: ${shot.panel_id}`);
      } else {
        const panel = panelById.get(shot.panel_id);
        if (shot.source_image !== panel.crop_asset) {
          issues.push(
            `Shot ${shot.shot_id} source_image must match panel crop ${shot.panel_id}: expected ${panel.crop_asset}, got ${shot.source_image}`,
          );
        }
      }
    }

    if (!shot.source_image) {
      issues.push(`Missing source image for ${shot.shot_id}: source_image is empty`);
    } else {
      const sourcePath = resolveProjectPath(cwd, shot.source_image);
      if (!(await pathExists(sourcePath))) {
        issues.push(`Missing source image for ${shot.shot_id}: ${shot.source_image}`);
      }
    }

    const manifestRelativePath = path.join(
      "project_output",
      "assets",
      shot.shot_id,
      "layer_manifest.json",
    );
    const manifestPath = resolveProjectPath(cwd, manifestRelativePath);
    if (!(await pathExists(manifestPath))) {
      issues.push(`Missing layer manifest for ${shot.shot_id}: ${manifestRelativePath}`);
      continue;
    }

    let manifest;
    try {
      manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    } catch (error) {
      issues.push(`Invalid layer manifest for ${shot.shot_id}: ${error.message}`);
      continue;
    }

    const manifestDir = path.dirname(manifestPath);
    if (manifest.source_image) {
      const manifestSourcePath = path.isAbsolute(manifest.source_image)
        ? manifest.source_image
        : resolveProjectPath(cwd, manifest.source_image);
      if (!(await pathExists(manifestSourcePath))) {
        issues.push(`Missing manifest source image for ${shot.shot_id}: ${manifest.source_image}`);
      }
    }

    if (!Array.isArray(manifest.layers) || manifest.layers.length === 0) {
      issues.push(`Layer manifest for ${shot.shot_id} must include at least one layer`);
      continue;
    }

    for (const layer of manifest.layers) {
      if (!layer.layer_id) {
        issues.push(`Layer manifest for ${shot.shot_id} includes a layer without layer_id`);
      }
      if (!layer.source) {
        issues.push(`Layer ${layer.layer_id ?? "unknown"} for ${shot.shot_id} is missing source`);
        continue;
      }
      const layerPath = path.isAbsolute(layer.source)
        ? layer.source
        : path.join(manifestDir, layer.source);
      if (!(await pathExists(layerPath))) {
        issues.push(`Missing layer source for ${shot.shot_id}/${layer.layer_id}: ${layer.source}`);
      }
    }
  }

  if (issues.length > 0) {
    console.error(issues.join("\n"));
    process.exitCode = 1;
    return;
  }

  console.log(`Verified ${plan.shots.length} shot asset set(s).`);
}

function sortedIds(items, field) {
  return items.map((item) => item?.[field]).filter(Boolean).sort();
}

const panelPackDriftFields = [
  "crop_asset",
  "bbox_px",
  "bbox_pct",
  "reading_order",
  "safe_frame",
  "page_id",
];

function stableJson(value) {
  if (value === undefined) {
    return "undefined";
  }
  return JSON.stringify(sortObjectKeys(value));
}

function sortObjectKeys(value) {
  if (Array.isArray(value)) {
    return value.map(sortObjectKeys);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, sortObjectKeys(child)]),
    );
  }
  return value;
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
