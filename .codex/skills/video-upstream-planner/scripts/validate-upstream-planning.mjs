#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const { runFolderArg, projectRootArg } = parseArgs(process.argv.slice(2));

if (!runFolderArg) {
  console.error("用法：node validate-upstream-planning.mjs <run-folder> [--project-root <repo-root>]");
  process.exit(2);
}

const projectRoot = path.resolve(projectRootArg);
const runFolder = path.resolve(projectRoot, runFolderArg);
const briefDir = path.join(runFolder, "00_brief");
const auditPath = path.join(briefDir, "upstream_planning_audit.json");
const blockers = [];
const warnings = [];
const allowedInputModes = new Set(["idea", "source", "script", "brief"]);
const allowedContentProfiles = new Set([
  "fiction_story",
  "educational_explainer",
  "product_demo",
  "documentary_short",
  "social_ad",
  "custom",
]);

const videoStrategy = await readRequiredJson("video_strategy.json");
const eventSceneMap = await readRequiredJson("event_scene_map.json");
const entityRegistry = await readRequiredJson("entity_registry.json");
const settingRegistry = await readRequiredJson("setting_registry.json");
const assetRegistry = await readRequiredJson("asset_registry.json");
const referenceSelectionPlan = await readRequiredJson("reference_selection_plan.json");
const adaptationPlan = await readTextIfExists(path.join(briefDir, "adaptation_plan.md"));

if (!adaptationPlan?.trim()) {
  blockers.push("adaptation_plan.md is required");
}

const events = Array.isArray(eventSceneMap?.events) ? eventSceneMap.events : [];
const scenes = Array.isArray(eventSceneMap?.scenes) ? eventSceneMap.scenes : [];
const entities = Array.isArray(entityRegistry?.entities) ? entityRegistry.entities : [];
const settings = Array.isArray(settingRegistry?.settings) ? settingRegistry.settings : [];
const assets = Array.isArray(assetRegistry?.assets) ? assetRegistry.assets : [];
const referenceSlots = Array.isArray(referenceSelectionPlan?.reference_slots)
  ? referenceSelectionPlan.reference_slots
  : [];

const eventIds = new Set(events.map((event) => event.event_id).filter(Boolean));
const sceneIds = new Set(scenes.map((scene) => scene.scene_id).filter(Boolean));
const entityIds = new Set(entities.map((entity) => entity.entity_id).filter(Boolean));
const settingIds = new Set(settings.map((setting) => setting.setting_id).filter(Boolean));
const assetIds = new Set(assets.map((asset) => asset.asset_id).filter(Boolean));
const knownSourceIds = new Set([...eventIds, ...sceneIds, ...entityIds, ...settingIds, ...assetIds]);

validateVideoStrategy(videoStrategy);
validateEventSceneMap(eventSceneMap);
validateEntityRegistry(entityRegistry);
validateSettingRegistry(settingRegistry);
validateAssetRegistry(assetRegistry);
validateReferenceSelectionPlan(referenceSelectionPlan);

const audit = {
  version: 1,
  checked_at: new Date().toISOString(),
  run_folder: normalizePath(path.relative(projectRoot, runFolder)),
  input_mode: videoStrategy?.input_mode ?? null,
  mode: videoStrategy?.mode ?? null,
  content_profile: videoStrategy?.route_decision?.content_profile ?? null,
  event_count: events.length,
  scene_count: scenes.length,
  entity_count: entities.length,
  setting_count: settings.length,
  asset_count: assets.length,
  reference_slot_count: referenceSlots.length,
  blockers,
  warnings,
  passed: blockers.length === 0,
};

await mkdir(path.dirname(auditPath), { recursive: true });
await writeFile(auditPath, `${JSON.stringify(audit, null, 2)}\n`, "utf8");

if (blockers.length > 0) {
  console.error(blockers.join("\n"));
  process.exit(1);
}

console.log(`upstream planning audit passed: ${scenes.length} scene(s), ${entities.length} entity/entities`);

function validateVideoStrategy(strategy) {
  if (!isRecord(strategy)) return;
  for (const field of ["version", "input_mode", "mode", "title", "target_output", "audience", "platform"]) {
    if (isBlank(strategy[field])) {
      blockers.push(`video_strategy.json ${field} is required`);
    }
  }
  if (strategy.input_mode && !allowedInputModes.has(strategy.input_mode)) {
    blockers.push(`video_strategy.json input_mode is invalid: ${strategy.input_mode}`);
  }
  if (!isRecord(strategy.narrative_strategy)) {
    blockers.push("video_strategy.json narrative_strategy is required");
  } else {
    for (const field of ["logline", "core_conflict", "audience_hook", "ending_pressure"]) {
      if (isBlank(strategy.narrative_strategy[field])) {
        blockers.push(`video_strategy.json narrative_strategy.${field} is required`);
      }
    }
  }
  const contentProfile = strategy.route_decision?.content_profile;
  if (!isRecord(strategy.route_decision) || isBlank(contentProfile)) {
    blockers.push("video_strategy.json route_decision.content_profile is required");
  } else if (!allowedContentProfiles.has(contentProfile)) {
    blockers.push(`video_strategy.json route_decision.content_profile is invalid: ${contentProfile}`);
  }
}

function validateEventSceneMap(value) {
  if (!isRecord(value)) return;
  if (!Array.isArray(value.events) || value.events.length === 0) {
    blockers.push("event_scene_map.json events must be a non-empty array");
  }
  if (!Array.isArray(value.scenes) || value.scenes.length === 0) {
    blockers.push("event_scene_map.json scenes must be a non-empty array");
  }

  for (const [index, event] of events.entries()) {
    const label = event.event_id || `events[${index}]`;
    for (const field of ["event_id", "dramatic_goal"]) {
      if (isBlank(event[field])) {
        blockers.push(`${label} ${field} is required`);
      }
    }
    if (!Array.isArray(event.process_chain) || event.process_chain.length === 0) {
      blockers.push(`${label} process_chain must be a non-empty array`);
    }
    if (!Array.isArray(event.scene_ids) || event.scene_ids.length === 0) {
      blockers.push(`${label} scene_ids must be a non-empty array`);
      continue;
    }
    for (const sceneId of event.scene_ids) {
      if (!sceneIds.has(sceneId)) {
        blockers.push(`${label} unknown scene_ids reference ${sceneId}`);
      }
      const scene = scenes.find((item) => item.scene_id === sceneId);
      if (scene?.event_id && event.event_id && scene.event_id !== event.event_id) {
        blockers.push(`${label} scene ${sceneId} must refer back to ${event.event_id}`);
      }
    }
  }

  for (const [index, scene] of scenes.entries()) {
    const label = scene.scene_id || `scenes[${index}]`;
    for (const field of ["scene_id", "event_id", "setting_id", "dramatic_function", "scene_summary"]) {
      if (isBlank(scene[field])) {
        blockers.push(`${label} ${field} is required`);
      }
    }
    if (scene.event_id && !eventIds.has(scene.event_id)) {
      blockers.push(`${label} unknown event_id ${scene.event_id}`);
    }
    if (scene.setting_id && !settingIds.has(scene.setting_id)) {
      blockers.push(`${label} unknown setting_id ${scene.setting_id}`);
    }
    validateIdArray(`${label} visible_entity_ids`, scene.visible_entity_ids, entityIds);
    validateIdArray(`${label} key_asset_ids`, scene.key_asset_ids, assetIds);
  }
}

function validateEntityRegistry(value) {
  if (!isRecord(value)) return;
  if (!Array.isArray(value.entities) || value.entities.length === 0) {
    blockers.push("entity_registry.json entities must be a non-empty array");
    return;
  }
  for (const [index, entity] of entities.entries()) {
    const label = entity.entity_id || `entities[${index}]`;
    for (const field of ["entity_id", "name", "stable_features"]) {
      if (isBlank(entity[field])) {
        blockers.push(`${label} ${field} is required`);
      }
    }
    if (!Array.isArray(entity.active_scenes) || entity.active_scenes.length === 0) {
      blockers.push(`${label} active_scenes must be a non-empty array`);
    } else {
      for (const sceneId of entity.active_scenes) {
        if (!sceneIds.has(sceneId)) {
          blockers.push(`${label} unknown active_scenes reference ${sceneId}`);
        }
      }
    }
    if (isRecord(entity.dynamic_features_by_scene)) {
      for (const sceneId of Object.keys(entity.dynamic_features_by_scene)) {
        if (!sceneIds.has(sceneId)) {
          blockers.push(`${label} unknown dynamic_features_by_scene reference ${sceneId}`);
        }
      }
    }
  }
}

function validateSettingRegistry(value) {
  if (!isRecord(value)) return;
  if (!Array.isArray(value.settings) || value.settings.length === 0) {
    blockers.push("setting_registry.json settings must be a non-empty array");
    return;
  }
  for (const [index, setting] of settings.entries()) {
    const label = setting.setting_id || `settings[${index}]`;
    for (const field of ["setting_id", "name", "spatial_description", "lighting_arc"]) {
      if (isBlank(setting[field])) {
        blockers.push(`${label} ${field} is required`);
      }
    }
    if (!Array.isArray(setting.continuity_anchors) || setting.continuity_anchors.length === 0) {
      blockers.push(`${label} continuity_anchors must be a non-empty array`);
    }
  }
}

function validateAssetRegistry(value) {
  if (!isRecord(value)) return;
  if (!Array.isArray(value.assets) || value.assets.length === 0) {
    blockers.push("asset_registry.json assets must be a non-empty array");
    return;
  }
  for (const [index, asset] of assets.entries()) {
    const label = asset.asset_id || `assets[${index}]`;
    for (const field of ["asset_id", "name", "visual_signature", "first_scene_id"]) {
      if (isBlank(asset[field])) {
        blockers.push(`${label} ${field} is required`);
      }
    }
    if (asset.first_scene_id && !sceneIds.has(asset.first_scene_id)) {
      blockers.push(`${label} unknown first_scene_id ${asset.first_scene_id}`);
    }
    if (!isRecord(asset.state_by_scene) || Object.keys(asset.state_by_scene).length === 0) {
      blockers.push(`${label} state_by_scene is required`);
    } else {
      for (const sceneId of Object.keys(asset.state_by_scene)) {
        if (!sceneIds.has(sceneId)) {
          blockers.push(`${label} unknown state_by_scene reference ${sceneId}`);
        }
      }
    }
  }
}

function validateReferenceSelectionPlan(value) {
  if (!isRecord(value)) return;
  if (!Array.isArray(value.reference_slots) || value.reference_slots.length === 0) {
    blockers.push("reference_selection_plan.json reference_slots must be a non-empty array");
    return;
  }
  if (
    value.max_runtime_reference_images_per_page !== undefined &&
    Number(value.max_runtime_reference_images_per_page) > 8
  ) {
    blockers.push("reference_selection_plan.json max_runtime_reference_images_per_page must be <= 8");
  }
  for (const [index, slot] of referenceSlots.entries()) {
    const label = slot.reference_id || `reference_slots[${index}]`;
    for (const field of ["reference_id", "purpose", "selection_rule"]) {
      if (isBlank(slot[field])) {
        blockers.push(`${label} ${field} is required`);
      }
    }
    if (!Array.isArray(slot.source_ids) || slot.source_ids.length === 0) {
      blockers.push(`${label} source_ids must be a non-empty array`);
      continue;
    }
    for (const sourceId of slot.source_ids) {
      if (!knownSourceIds.has(sourceId)) {
        blockers.push(`${label} unknown source_ids reference ${sourceId}`);
      }
    }
  }
}

function validateIdArray(label, values, validIds) {
  if (values === undefined) return;
  if (!Array.isArray(values)) {
    blockers.push(`${label} must be an array`);
    return;
  }
  for (const value of values) {
    if (!validIds.has(value)) {
      blockers.push(`${label} unknown reference ${value}`);
    }
  }
}

async function readRequiredJson(filename) {
  const filePath = path.join(briefDir, filename);
  try {
    const text = await readFile(filePath, "utf8");
    return JSON.parse(text);
  } catch (error) {
    if (error?.code === "ENOENT") {
      blockers.push(`${filename} is required`);
      return null;
    }
    if (error instanceof SyntaxError) {
      blockers.push(`${filename} must be valid JSON: ${error.message}`);
      return null;
    }
    throw error;
  }
}

async function readTextIfExists(filePath) {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function parseArgs(values) {
  let runFolder = null;
  let projectRootValue = process.cwd();
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--project-root") {
      projectRootValue = values[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (value.startsWith("--project-root=")) {
      projectRootValue = value.slice("--project-root=".length);
      continue;
    }
    if (!value.startsWith("--") && !runFolder) {
      runFolder = value;
      continue;
    }
    throw new Error(`未知参数：${value}`);
  }
  return {
    runFolderArg: runFolder,
    projectRootArg: projectRootValue || process.cwd(),
  };
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isBlank(value) {
  if (Array.isArray(value)) return value.length === 0;
  if (isRecord(value)) return Object.keys(value).length === 0;
  return String(value ?? "").trim() === "";
}

function normalizePath(value) {
  return value.split(path.sep).join("/");
}
