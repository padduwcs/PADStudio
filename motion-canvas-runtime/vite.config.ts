import motionCanvasModule from '@motion-canvas/vite-plugin';

const motionCanvas =
  typeof motionCanvasModule === 'function'
    ? motionCanvasModule
    : (
        motionCanvasModule as unknown as {
          default: typeof motionCanvasModule;
        }
      ).default;

// Motion Canvas 3.17 passes this path through fast-glob and path.posix.
// Windows separators would otherwise be interpreted as a dynamic pattern.
const project = process.env.PAD_MOTION_PROJECT_FILE?.replaceAll('\\', '/');
const output = process.env.PAD_MOTION_OUTPUT_DIRECTORY;

if (!project || !output) {
  throw new Error(
    'PAD_MOTION_PROJECT_FILE và PAD_MOTION_OUTPUT_DIRECTORY là bắt buộc.',
  );
}

export default {
  plugins: [
    motionCanvas({
      project,
      output,
      buildForEditor:
        process.env.PAD_MOTION_BUILD_FOR_EDITOR === 'true',
    }),
  ],
  server: {
    host: '127.0.0.1',
    port: Number(process.env.PAD_MOTION_PORT ?? 9000),
  },
};
