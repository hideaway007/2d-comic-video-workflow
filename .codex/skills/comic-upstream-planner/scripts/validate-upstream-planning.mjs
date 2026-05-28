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
const allowedInputModes = new Set(["idea", "novel", "script", "brief"]);

const storyStrategy = await readRequiredJson("story_strategy.json");
const eventSceneMap = await readRequiredJson("event_scene_map.json");
const characterRegistry = await readRequiredJson("character_registry.json");
const environmentRegistry = await readRequiredJson("environment_registry.json");
const propRegistry = await readRequiredJson("prop_registry.json");
const referenceSelectionPlan = await readRequiredJson("reference_selection_plan.json");
const adaptationPlan = await readTextIfExists(path.join(briefDir, "adaptation_plan.md"));

if (!adaptationPlan?.trim()) {
  blockers.push("adaptation_plan.md is required");
}

const events = Array.isArray(eventSceneMap?.events) ? eventSceneMap.events : [];
const scenes = Array.isArray(eventSceneMap?.scenes) ? eventSceneMap.scenes : [];
const characters = Array.isArray(characterRegistry?.characters) ? characterRegistry.characters : [];
const environments = Array.isArray(environmentRegistry?.environments) ? environmentRegistry.environments : [];
const props = Array.isArray(propRegistry?.props) ? propRegistry.props : [];
const referenceSlots = Array.isArray(referenceSelectionPlan?.reference_slots) ? referenceSelectionPlan.reference_slots : [];

const eventIds = new Set(events.map((event) => event.event_id).filter(Boolean));
const sceneIds = new Set(scenes.map((scene) => scene.scene_id).filter(Boolean));
const characterIds = new Set(characters.map((character) => character.character_id).filter(Boolean));
const environmentIds = new Set(environments.map((environment) => environment.location_id).filter(Boolean));
const propIds = new Set(props.map((prop) => prop.prop_id).filter(Boolean));
const knownSourceIds = new Set([...eventIds, ...sceneIds, ...characterIds, ...environmentIds, ...propIds]);

validateStoryStrategy(storyStrategy);
validateEventSceneMap(eventSceneMap);
validateCharacterRegistry(characterRegistry);
validateEnvironmentRegistry(environmentRegistry);
validatePropRegistry(propRegistry);
validateReferenceSelectionPlan(referenceSelectionPlan);

const audit = {
  version: 1,
  checked_at: new Date().toISOString(),
  run_folder: normalizePath(path.relative(projectRoot, runFolder)),
  input_mode: storyStrategy?.input_mode ?? null,
  mode: storyStrategy?.mode ?? null,
  event_count: events.length,
  scene_count: scenes.length,
  character_count: characters.length,
  environment_count: environments.length,
  prop_count: props.length,
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

console.log(`upstream planning audit passed: ${scenes.length} scene(s), ${characters.length} character(s)`);

function validateStoryStrategy(strategy) {
  if (!isRecord(strategy)) return;
  for (const field of ["version", "input_mode", "mode", "title", "target_output"]) {
    if (isBlank(strategy[field])) {
      blockers.push(`story_strategy.json ${field} is required`);
    }
  }
  if (strategy.input_mode && !allowedInputModes.has(strategy.input_mode)) {
    blockers.push(`story_strategy.json input_mode is invalid: ${strategy.input_mode}`);
  }
  if (!isRecord(strategy.narrative_strategy)) {
    blockers.push("story_strategy.json narrative_strategy is required");
  } else {
    for (const field of ["logline", "core_conflict", "audience_hook", "ending_pressure"]) {
      if (isBlank(strategy.narrative_strategy[field])) {
        blockers.push(`story_strategy.json narrative_strategy.${field} is required`);
      }
    }
  }
  if (!isRecord(strategy.route_decision) || isBlank(strategy.route_decision.topic_pack)) {
    blockers.push("story_strategy.json route_decision.topic_pack is required");
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
    for (const field of ["scene_id", "event_id", "location_id", "dramatic_function", "scene_summary"]) {
      if (isBlank(scene[field])) {
        blockers.push(`${label} ${field} is required`);
      }
    }
    if (scene.event_id && !eventIds.has(scene.event_id)) {
      blockers.push(`${label} unknown event_id ${scene.event_id}`);
    }
    if (scene.location_id && !environmentIds.has(scene.location_id)) {
      blockers.push(`${label} unknown location_id ${scene.location_id}`);
    }
    validateIdArray(`${label} visible_character_ids`, scene.visible_character_ids, characterIds);
    validateIdArray(`${label} key_prop_ids`, scene.key_prop_ids, propIds);
  }
}

function validateCharacterRegistry(value) {
  if (!isRecord(value)) return;
  if (!Array.isArray(value.characters) || value.characters.length === 0) {
    blockers.push("character_registry.json characters must be a non-empty array");
    return;
  }
  for (const [index, character] of characters.entries()) {
    const label = character.character_id || `characters[${index}]`;
    for (const field of ["character_id", "name", "static_features"]) {
      if (isBlank(character[field])) {
        blockers.push(`${label} ${field} is required`);
      }
    }
    if (!Array.isArray(character.active_scenes) || character.active_scenes.length === 0) {
      blockers.push(`${label} active_scenes must be a non-empty array`);
    } else {
      for (const sceneId of character.active_scenes) {
        if (!sceneIds.has(sceneId)) {
          blockers.push(`${label} unknown active_scenes reference ${sceneId}`);
        }
      }
    }
    if (isRecord(character.dynamic_features_by_scene)) {
      for (const sceneId of Object.keys(character.dynamic_features_by_scene)) {
        if (!sceneIds.has(sceneId)) {
          blockers.push(`${label} unknown dynamic_features_by_scene reference ${sceneId}`);
        }
      }
    }
  }
}

function validateEnvironmentRegistry(value) {
  if (!isRecord(value)) return;
  if (!Array.isArray(value.environments) || value.environments.length === 0) {
    blockers.push("environment_registry.json environments must be a non-empty array");
    return;
  }
  for (const [index, environment] of environments.entries()) {
    const label = environment.location_id || `environments[${index}]`;
    for (const field of ["location_id", "name", "spatial_description", "lighting_arc"]) {
      if (isBlank(environment[field])) {
        blockers.push(`${label} ${field} is required`);
      }
    }
    if (!Array.isArray(environment.continuity_anchors) || environment.continuity_anchors.length === 0) {
      blockers.push(`${label} continuity_anchors must be a non-empty array`);
    }
  }
}

function validatePropRegistry(value) {
  if (!isRecord(value)) return;
  if (!Array.isArray(value.props) || value.props.length === 0) {
    blockers.push("prop_registry.json props must be a non-empty array");
    return;
  }
  for (const [index, prop] of props.entries()) {
    const label = prop.prop_id || `props[${index}]`;
    for (const field of ["prop_id", "name", "visual_signature", "first_scene_id"]) {
      if (isBlank(prop[field])) {
        blockers.push(`${label} ${field} is required`);
      }
    }
    if (prop.first_scene_id && !sceneIds.has(prop.first_scene_id)) {
      blockers.push(`${label} unknown first_scene_id ${prop.first_scene_id}`);
    }
    if (!isRecord(prop.state_by_scene) || Object.keys(prop.state_by_scene).length === 0) {
      blockers.push(`${label} state_by_scene is required`);
    } else {
      for (const sceneId of Object.keys(prop.state_by_scene)) {
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
