declare module '*?scene' {
  const value: import('@motion-canvas/core/lib/scenes/Scene').FullSceneDescription;
  export = value;
}

declare module '*.wav' {
  const source: string;
  export default source;
}

declare type Callback = (...args: any[]) => void;
