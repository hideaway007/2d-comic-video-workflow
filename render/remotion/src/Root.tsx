import React from "react";
import { Composition, getInputProps, registerRoot } from "remotion";
import { MotionComic, Plan, Shot } from "./MotionComic";

const DEFAULT_WIDTH = 1920;
const DEFAULT_HEIGHT = 1080;
const DEFAULT_FPS = 24;

const durationFrames = (shot: Shot, fps: number): number => {
  const explicit = Number(shot.duration_frames ?? shot.durationFrames);
  if (Number.isFinite(explicit) && explicit > 0) {
    return Math.round(explicit);
  }

  const seconds = Number(shot.duration_seconds ?? shot.durationSeconds ?? shot.duration ?? 3);
  return Math.max(1, Math.round((Number.isFinite(seconds) ? seconds : 3) * fps));
};

const compositionIdForShot = (shotId: string): string =>
  `shot-${String(shotId).replace(/[^a-zA-Z0-9\u4e00-\u9fa5-]/g, "-")}`;

export const RemotionRoot: React.FC = () => {
  const inputProps = getInputProps() as { plan?: Plan };
  const plan = inputProps.plan;
  const shots = Array.isArray(plan?.shots) ? plan.shots : [];
  const fps = Number(plan?.render?.fps ?? plan?.fps ?? DEFAULT_FPS) || DEFAULT_FPS;
  const width = Number(plan?.render?.width ?? DEFAULT_WIDTH) || DEFAULT_WIDTH;
  const height = Number(plan?.render?.height ?? DEFAULT_HEIGHT) || DEFAULT_HEIGHT;
  const totalDuration = Math.max(
    1,
    shots.reduce((sum, shot) => sum + durationFrames(shot, fps), 0),
  );

  return (
    <>
      <Composition
        id="motion-comic-preview"
        component={MotionComic}
        durationInFrames={totalDuration}
        fps={fps}
        width={width}
        height={height}
      />
      {shots.map((shot) => (
        <Composition
          key={shot.shot_id}
          id={compositionIdForShot(shot.shot_id)}
          component={MotionComic}
          durationInFrames={durationFrames(shot, fps)}
          fps={fps}
          width={width}
          height={height}
          defaultProps={{ shotId: shot.shot_id }}
        />
      ))}
    </>
  );
};

registerRoot(RemotionRoot);
