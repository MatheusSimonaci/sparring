import "./index.css";
import { Composition } from "remotion";
import { Demo, totalDurationInFrames } from "./Demo";

const FPS = 30;

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="DemoHorizontal"
        component={Demo}
        durationInFrames={totalDurationInFrames(FPS)}
        fps={FPS}
        width={1920}
        height={1080}
      />
      <Composition
        id="DemoVertical"
        component={Demo}
        durationInFrames={totalDurationInFrames(FPS)}
        fps={FPS}
        width={1080}
        height={1920}
      />
    </>
  );
};
