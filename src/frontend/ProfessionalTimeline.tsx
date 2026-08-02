import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
} from 'react';
import type {
  LayoutEditorNode,
  LayoutNodeOverride,
  LayoutPropertyKeyframe,
  LayoutPropertyTrack,
} from '../shared/layout.ts';
import {compactTimelineNodes} from './professionalTimelineState.ts';

export interface EditorTimelineScene {
  sceneId: string;
  label: string;
  firstFrame: number;
  lastFrame: number;
  nodes: LayoutEditorNode[];
}

export interface EditorTimelineMarker {
  id: string;
  label: string;
  frame: number;
}

interface ProfessionalTimelineProps {
  frame: number;
  duration: number;
  fps: number;
  scenes: EditorTimelineScene[];
  markers?: EditorTimelineMarker[];
  activeSceneId: string;
  selectedNodeKey?: string | null;
  overrides: LayoutNodeOverride[];
  audioUrl?: string;
  editableProperties?: string[];
  animationDisabled?: boolean;
  onSeek: (frame: number) => void;
  onSelectNode: (sceneId: string, nodeKey: string) => void;
  onSetKeyframe: (
    property: LayoutPropertyTrack['property'],
    value?: number,
    easing?: LayoutPropertyKeyframe['easing'],
  ) => void;
  onRemoveKeyframe: (
    property: LayoutPropertyTrack['property'],
    timeSeconds: number,
  ) => void;
  onMoveKeyframe: (
    property: LayoutPropertyTrack['property'],
    fromTimeSeconds: number,
    toTimeSeconds: number,
  ) => void;
}

const animationProperties = [
  ['x', 'X'],
  ['y', 'Y'],
  ['scale', 'Scale'],
  ['rotation', 'Rotate'],
  ['opacity', 'Opacity'],
] as const;

function percent(value: number, duration: number) {
  return `${Math.min(100, Math.max(0, (value / Math.max(1, duration)) * 100))}%`;
}

function useWaveform(audioUrl?: string) {
  const [samples, setSamples] = useState<number[]>([]);
  useEffect(() => {
    if (!audioUrl) {
      setSamples([]);
      return;
    }
    const controller = new AbortController();
    let context: AudioContext | null = null;
    void (async () => {
      try {
        const response = await fetch(audioUrl, {
          signal: controller.signal,
          cache: 'no-store',
        });
        if (!response.ok) return;
        const buffer = await response.arrayBuffer();
        context = new AudioContext();
        const audio = await context.decodeAudioData(buffer.slice(0));
        const channel = audio.getChannelData(0);
        const count = 180;
        const size = Math.max(1, Math.floor(channel.length / count));
        const next = Array.from({length: count}, (_, index) => {
          let peak = 0;
          const start = index * size;
          const end = Math.min(channel.length, start + size);
          for (let sample = start; sample < end; sample += 1) {
            peak = Math.max(peak, Math.abs(channel[sample] ?? 0));
          }
          return Math.max(0.04, peak);
        });
        if (!controller.signal.aborted) setSamples(next);
      } catch {
        if (!controller.signal.aborted) setSamples([]);
      } finally {
        void context?.close();
      }
    })();
    return () => {
      controller.abort();
      void context?.close();
    };
  }, [audioUrl]);
  return samples;
}

export function ProfessionalTimeline({
  frame,
  duration,
  fps,
  scenes,
  markers = [],
  activeSceneId,
  selectedNodeKey,
  overrides,
  audioUrl,
  editableProperties = animationProperties.map(([property]) => property),
  animationDisabled = false,
  onSeek,
  onSelectNode,
  onSetKeyframe,
  onRemoveKeyframe,
  onMoveKeyframe,
}: ProfessionalTimelineProps) {
  const [zoom, setZoom] = useState(1);
  const [easing, setEasing] =
    useState<LayoutPropertyKeyframe['easing']>('ease-in-out');
  const stageRef = useRef<HTMLDivElement | null>(null);
  const keyframeDragRef = useRef<{
    pointerId: number;
    property: LayoutPropertyTrack['property'];
    fromTimeSeconds: number;
    toTimeSeconds: number;
  } | null>(null);
  const scrubbingPointerRef = useRef<number | null>(null);
  const ignoreNextKeyframeClickRef = useRef(false);
  const waveform = useWaveform(audioUrl);
  const activeScene = scenes.find(scene => scene.sceneId === activeSceneId);
  const sceneDurationFrames = Math.max(
    1,
    (activeScene?.lastFrame ?? duration) -
      (activeScene?.firstFrame ?? 0),
  );
  const selectedOverride = overrides.find(
    item =>
      item.sceneId === activeSceneId &&
      item.nodeKey === selectedNodeKey,
  );
  const tracks = useMemo(
    () =>
      new Map(
        (selectedOverride?.animations ?? []).map(track => [
          track.property,
          track,
        ]),
      ),
    [selectedOverride],
  );
  const visibleNodes = compactTimelineNodes(
    activeScene?.nodes ?? [],
    overrides,
    activeSceneId,
    selectedNodeKey,
  );

  function contentBounds() {
    return stageRef.current
      ?.querySelector<HTMLElement>('.pro-timeline-row > div')
      ?.getBoundingClientRect();
  }

  function seekFromClientX(clientX: number) {
    const bounds = contentBounds();
    if (!bounds) return;
    const ratio = Math.min(
      1,
      Math.max(0, (clientX - bounds.left) / Math.max(1, bounds.width)),
    );
    onSeek(Math.round(ratio * duration));
  }

  function startScrubbing(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    scrubbingPointerRef.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    seekFromClientX(event.clientX);
  }

  function keyframeTimeFromClientX(clientX: number) {
    const bounds = contentBounds();
    if (!bounds || !activeScene) return 0;
    const ratio = Math.min(
      1,
      Math.max(0, (clientX - bounds.left) / Math.max(1, bounds.width)),
    );
    const globalFrame = ratio * duration;
    return Math.max(
      0,
      Math.min(
        sceneDurationFrames / Math.max(1, fps),
        (globalFrame - activeScene.firstFrame) / Math.max(1, fps),
      ),
    );
  }

  return (
    <section
      className="pro-timeline"
      style={{'--timeline-zoom': zoom} as CSSProperties}
    >
      <header className="pro-timeline-toolbar">
        <div className="pro-timeline-status">
          <span>
            <strong>Timeline</strong>
            <code>
              {(frame / Math.max(1, fps)).toFixed(2)}s /{' '}
              {(duration / Math.max(1, fps)).toFixed(2)}s
            </code>
          </span>
          <input
            className="pro-timeline-scrubber"
            type="range"
            min={0}
            max={Math.max(1, duration)}
            step={1}
            value={Math.min(duration, Math.max(0, frame))}
            aria-label="Di chuyển playhead qua các scene"
            onChange={event => onSeek(Number(event.currentTarget.value))}
          />
        </div>
        <div className="pro-timeline-keyframe-actions">
          {animationProperties.map(([property, label]) => (
            <button
              type="button"
              key={property}
              className={tracks.has(property) ? 'is-active' : ''}
              disabled={
                !selectedNodeKey ||
                animationDisabled ||
                !editableProperties.includes(property)
              }
              onClick={() => onSetKeyframe(property, undefined, easing)}
              title={`Đặt keyframe ${label} tại playhead`}
            >
              <i>◆</i>
              {label}
            </button>
          ))}
        </div>
        <label className="pro-timeline-easing">
          <span>Easing</span>
          <select
            value={easing}
            onChange={event =>
              setEasing(
                event.currentTarget
                  .value as LayoutPropertyKeyframe['easing'],
              )
            }
          >
            <option value="linear">Linear</option>
            <option value="ease-in">Ease in</option>
            <option value="ease-out">Ease out</option>
            <option value="ease-in-out">Ease in/out</option>
          </select>
        </label>
        <label className="pro-timeline-zoom">
          <span>Zoom</span>
          <input
            type="range"
            min={0.75}
            max={4}
            step={0.25}
            value={zoom}
            onChange={event => setZoom(Number(event.currentTarget.value))}
          />
        </label>
      </header>

      <div className="pro-timeline-scroll">
        <div
          ref={stageRef}
          className="pro-timeline-stage"
          style={{width: `${Math.max(100, zoom * 100)}%`}}
          onPointerDown={startScrubbing}
          onPointerMove={event => {
            if (scrubbingPointerRef.current !== event.pointerId) return;
            seekFromClientX(event.clientX);
          }}
          onPointerUp={event => {
            if (scrubbingPointerRef.current !== event.pointerId) return;
            scrubbingPointerRef.current = null;
            event.currentTarget.releasePointerCapture(event.pointerId);
          }}
          onPointerCancel={() => {
            scrubbingPointerRef.current = null;
          }}
        >
          <div className="pro-timeline-ruler">
            {Array.from({length: 11}, (_, index) => (
              <span
                key={index}
                style={{
                  left: `calc(var(--timeline-gutter) + (100% - var(--timeline-gutter)) * ${index / 10})`,
                }}
              >
                {((duration / Math.max(1, fps)) * index / 10).toFixed(1)}s
              </span>
            ))}
          </div>

          <div className="pro-timeline-row is-scenes">
            <strong>Scenes</strong>
            <div>
              {scenes.map(scene => (
                <button
                  type="button"
                  key={scene.sceneId}
                  className={scene.sceneId === activeSceneId ? 'is-active' : ''}
                  style={{
                    left: percent(scene.firstFrame, duration),
                    width: percent(
                      Math.max(1, scene.lastFrame - scene.firstFrame),
                      duration,
                    ),
                  }}
                  onPointerDown={event => event.stopPropagation()}
                  onClick={() => onSeek(scene.firstFrame)}
                >
                  {scene.label}
                </button>
              ))}
              {markers.map(marker => (
                <i
                  className="pro-timeline-marker"
                  key={marker.id}
                  style={{left: percent(marker.frame, duration)}}
                  title={marker.label}
                />
              ))}
            </div>
          </div>

          {audioUrl && (
            <div className="pro-timeline-row is-audio">
              <strong>Voice 🔒</strong>
              <div>
                {waveform.length > 0 ? (
                  <span className="pro-waveform">
                    {waveform.map((sample, index) => (
                      <i key={index} style={{height: `${sample * 90}%`}} />
                    ))}
                  </span>
                ) : (
                  <span className="pro-waveform-loading">Đang đọc waveform…</span>
                )}
              </div>
            </div>
          )}

          <div className="pro-timeline-layers">
            {visibleNodes.map(node => {
              const override = overrides.find(
                item =>
                  item.sceneId === activeSceneId &&
                  item.nodeKey === node.key,
              );
              const nodeTracks = override?.animations ?? [];
              return (
                <div
                  className={`pro-timeline-row is-layer${
                    node.key === selectedNodeKey ? ' is-selected' : ''
                  }`}
                  key={node.key}
                >
                  <button
                    type="button"
                    onPointerDown={event => event.stopPropagation()}
                    onClick={() => onSelectNode(activeSceneId, node.key)}
                  >
                    <span>{node.role === 'block' ? '▣' : node.role === 'content' ? '▦' : '◇'}</span>
                    {node.label}
                  </button>
                  <div>
                    <span
                      className="pro-layer-span"
                      style={{
                        left: percent(
                          activeScene?.firstFrame ?? 0,
                          duration,
                        ),
                        width: percent(sceneDurationFrames, duration),
                      }}
                    />
                    {nodeTracks.flatMap(track =>
                      track.keyframes.map(keyframe => (
                        <button
                          type="button"
                          className={`pro-keyframe is-${track.property}`}
                          key={`${track.property}:${keyframe.timeSeconds}`}
                          style={{
                            left: percent(
                              (activeScene?.firstFrame ?? 0) +
                                keyframe.timeSeconds * fps,
                              duration,
                            ),
                          }}
                          title={`${track.property} · ${keyframe.timeSeconds.toFixed(2)}s · ${keyframe.value}`}
                          onPointerDown={event => event.stopPropagation()}
                          onPointerDownCapture={event => {
                            event.stopPropagation();
                            event.currentTarget.setPointerCapture(
                              event.pointerId,
                            );
                            keyframeDragRef.current = {
                              pointerId: event.pointerId,
                              property: track.property,
                              fromTimeSeconds: keyframe.timeSeconds,
                              toTimeSeconds: keyframe.timeSeconds,
                            };
                          }}
                          onPointerMove={event => {
                            const dragging = keyframeDragRef.current;
                            if (dragging?.pointerId !== event.pointerId) return;
                            dragging.toTimeSeconds = keyframeTimeFromClientX(
                              event.clientX,
                            );
                          }}
                          onPointerUp={event => {
                            const dragging = keyframeDragRef.current;
                            if (dragging?.pointerId !== event.pointerId) return;
                            keyframeDragRef.current = null;
                            const moved =
                              Math.abs(
                                dragging.toTimeSeconds -
                                  dragging.fromTimeSeconds,
                              ) >
                              1 / Math.max(1, fps);
                            if (moved) {
                              ignoreNextKeyframeClickRef.current = true;
                              onMoveKeyframe(
                                dragging.property,
                                dragging.fromTimeSeconds,
                                dragging.toTimeSeconds,
                              );
                            }
                          }}
                          onPointerCancel={() => {
                            keyframeDragRef.current = null;
                          }}
                          onClick={() => {
                            if (ignoreNextKeyframeClickRef.current) {
                              ignoreNextKeyframeClickRef.current = false;
                              return;
                            }
                            onSeek(
                              Math.round(
                                (activeScene?.firstFrame ?? 0) +
                                  keyframe.timeSeconds * fps,
                              ),
                            );
                          }}
                          onDoubleClick={() =>
                            onRemoveKeyframe(
                              track.property,
                              keyframe.timeSeconds,
                            )
                          }
                        >
                          ◆
                        </button>
                      )),
                    )}
                    {override?.visibility?.map(keyframe => (
                      <i
                        className="pro-visibility-keyframe"
                        key={`visibility:${keyframe.timeSeconds}`}
                        style={{
                          left: percent(
                            (activeScene?.firstFrame ?? 0) +
                              keyframe.timeSeconds * fps,
                            duration,
                          ),
                        }}
                        title={`${keyframe.hidden ? 'Ẩn' : 'Hiện'} · ${keyframe.timeSeconds.toFixed(2)}s`}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          <i
            className="pro-playhead"
            style={{
              '--playhead-ratio': Math.min(
                1,
                Math.max(0, frame / Math.max(1, duration)),
              ),
            } as CSSProperties}
          >
            <span />
          </i>
        </div>
      </div>
    </section>
  );
}
