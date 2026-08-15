import React from 'react';
import { createPortal } from 'react-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import {
  MediaPlayer,
  MediaProvider,
  TimeSlider,
  type MediaPlayerInstance,
  useMediaState,
} from '@vidstack/react';
import {
  defaultLayoutIcons,
  DefaultVideoLayout,
} from '@vidstack/react/player/layouts/default';
import '@vidstack/react/player/styles/base.css';
import '@vidstack/react/player/styles/default/theme.css';
import '@vidstack/react/player/styles/default/layouts/video.css';
import {
  BookOutlined,
  CommentOutlined,
  EditOutlined,
  HighlightOutlined,
  LinkOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  SaveOutlined,
  SoundOutlined,
  UnorderedListOutlined,
} from '@ant-design/icons';
import { Button, Divider, Drawer, Input, Popover, Space, Tag, Tooltip, Typography, message } from 'antd';
import type { Concept, Highlight, Material, Question } from '../../api';
import type { ReaderFont } from '../../readingPreferencesContext';
import {
  siteThemeOptions,
  type SiteTheme,
} from '../../appearance';
import { useMediaQuery } from '../../useMediaQuery';
import './styles.css';

const { Title, Text } = Typography;

export interface TextSelectionAnchor {
  text: string;
  startOffset: number;
  endOffset: number;
}

export type ReaderTheme = SiteTheme;
export type { ReaderFont } from '../../readingPreferencesContext';

interface UniversalReaderProps {
  material: Material;
  highlights: Highlight[];
  concepts: Concept[];
  questions: Question[];
  readerTheme: ReaderTheme;
  onReaderThemeChange: (theme: ReaderTheme) => void;
  readerFont: ReaderFont;
  onReaderFontChange: (font: ReaderFont) => void;
  preferredSpeechVoice?: string;
  preferredSpeechRate?: number;
  onSpeechPreferencesChange?: (values: {
    voice?: string;
    rate?: number;
  }) => void;
  onMarkConcept: (selection: TextSelectionAnchor) => void;
  onAskQuestion: (selection: TextSelectionAnchor) => void;
  onHighlight: (selection: TextSelectionAnchor) => void;
  onClearAnnotationSelection: () => void;
  onAnnotationClick: (
    type: 'concept' | 'question' | 'highlight',
    id: number,
  ) => void;
  selectedAnnotations: Array<{
    type: 'concept' | 'question' | 'highlight';
    id: number | null;
  }>;
  showHighlightNotes?: boolean;
  onHighlightNoteSave?: (highlightId: number, userNote: string) => Promise<void>;
  seekTime?: { time: number | null; nonce: string };
  speechControlsTargetId?: string;
}

interface ReaderChunk {
  id: number;
  content: string;
  startOffset: number;
  endOffset: number;
  startTime: number | null;
  endTime: number | null;
}

interface SelectionMenu {
  selection: TextSelectionAnchor;
  top: number;
  left: number;
}

interface HighlightCommentPosition {
  anchorTop: number;
  top: number;
}

interface ReaderHeading {
  depth: number;
  id: string;
  label: string;
}

interface MarkdownAstNode {
  type: string;
  value?: string;
  alt?: string;
  depth?: number;
  children?: MarkdownAstNode[];
}

function markdownNodeText(node: MarkdownAstNode): string {
  if (node.value) return node.value;
  if (node.alt) return node.alt;
  return node.children?.map(markdownNodeText).join('') ?? '';
}

function extractHeadings(markdown: string): ReaderHeading[] {
  const headings: ReaderHeading[] = [];
  const tree = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .parse(markdown) as MarkdownAstNode;

  const visit = (node: MarkdownAstNode) => {
    if (node.type === 'heading' && node.depth) {
      headings.push({
        depth: node.depth,
        id: `reader-heading-${headings.length}`,
        label: markdownNodeText(node).trim() || '未命名标题',
      });
    }
    node.children?.forEach(visit);
  };
  visit(tree);

  return headings;
}

function formatTimestamp(seconds: number) {
  const totalSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds % 60;
  return `${minutes}:${String(remainingSeconds).padStart(2, '0')}`;
}

interface VideoMarker {
  id: string;
  label: string;
  type: 'concept' | 'highlight' | 'question';
  time: number;
}

function VideoTimeline({
  markers,
  onSeek,
}: {
  markers: VideoMarker[];
  onSeek: (time: number) => void;
}) {
  const duration = useMediaState('duration');

  return (
    <TimeSlider.Root
      className="vds-time-slider vds-slider universal-reader__timeline"
      aria-label="视频进度与学习标记"
    >
      <TimeSlider.Track className="vds-slider-track">
        <TimeSlider.TrackFill className="vds-slider-track-fill vds-slider-track" />
        <TimeSlider.Progress className="vds-slider-progress vds-slider-track" />
      </TimeSlider.Track>
      {duration > 0 && (
        <div className="universal-reader__timeline-markers" aria-label="进度条学习标记">
          {markers.map((marker) => (
            <button
              key={marker.id}
              type="button"
              className={`universal-reader__timeline-marker universal-reader__timeline-marker--${marker.type}`}
              style={{ left: `${Math.min(100, Math.max(0, marker.time / duration * 100))}%` }}
              title={`${marker.label} ${formatTimestamp(marker.time)}`}
              aria-label={`跳转到${marker.label} ${formatTimestamp(marker.time)}`}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                onSeek(marker.time);
              }}
            />
          ))}
        </div>
      )}
      <TimeSlider.Thumb className="vds-slider-thumb" />
      <TimeSlider.Preview className="vds-slider-preview">
        <TimeSlider.Value className="vds-slider-value" />
      </TimeSlider.Preview>
    </TimeSlider.Root>
  );
}

const mediaTypeLabels: Record<Material['media_type'], string> = {
  text: '文本',
  web_page: '网页',
  video: '视频',
};

const readerFontOptions: Array<{
  value: ReaderFont;
  label: string;
  shortLabel: string;
}> = [
  { value: 'system', label: '系统字体', shortLabel: '默认' },
  { value: 'song', label: '宋体', shortLabel: '宋' },
  { value: 'kai', label: '楷体', shortLabel: '楷' },
  { value: 'serif', label: '衬线字体', shortLabel: '衬' },
];

function getReaderChunks(material: Material): ReaderChunk[] {
  if (material.chunks.length) {
    return material.chunks.map((chunk) => ({
      id: chunk.id,
      content: chunk.content,
      startOffset: chunk.start_offset,
      endOffset: chunk.end_offset,
      startTime: chunk.start_time,
      endTime: chunk.end_time,
    }));
  }
  return [
    {
      id: 0,
      content: material.clean_text,
      startOffset: 0,
      endOffset: material.clean_text.length,
      startTime: null,
      endTime: null,
    },
  ];
}

function getParentChunkElement(
  node: Node,
  offset: number,
  isStart: boolean,
): HTMLElement | null {
  const element =
    node.nodeType === Node.ELEMENT_NODE
      ? (node as HTMLElement)
      : node.parentElement;
  const chunkElement =
    element?.closest<HTMLElement>('[data-start-offset]') ?? null;
  if (chunkElement) return chunkElement;

  if (node.nodeType !== Node.ELEMENT_NODE) return null;
  const children = Array.from(node.childNodes);
  const childIndex = isStart
    ? Math.min(offset, children.length - 1)
    : Math.max(0, offset - 1);
  const child = children[childIndex];
  if (!child) return null;
  const childElement =
    child.nodeType === Node.ELEMENT_NODE
      ? (child as HTMLElement)
      : child.parentElement;
  return childElement?.closest<HTMLElement>('[data-start-offset]') ?? null;
}

function getOffsetInElement(
  element: HTMLElement,
  container: Node,
  offset: number,
): number {
  const range = document.createRange();
  range.selectNodeContents(element);
  range.setEnd(container, offset);
  const fragment = range.cloneContents();
  fragment
    .querySelectorAll('[data-reader-ignore-offset]')
    .forEach((node) => node.remove());
  return fragment.textContent?.length ?? 0;
}

function getMarkdownSourceOffset(
  container: Node,
  offset: number,
  isStart: boolean,
): number | null {
  const element =
    container.nodeType === Node.ELEMENT_NODE
      ? (container as HTMLElement)
      : container.parentElement;
  const sourceElement =
    element?.closest<HTMLElement>('[data-source-start]') ?? null;
  if (sourceElement) {
    const sourceStart = Number(sourceElement.dataset.sourceStart);
    if (container.nodeType === Node.TEXT_NODE) {
      return sourceStart + offset;
    }
    return isStart
      ? sourceStart
      : Number(sourceElement.dataset.sourceEnd ?? sourceStart);
  }

  if (container.nodeType !== Node.ELEMENT_NODE) return null;
  const sourceNodes = Array.from(
    (container as HTMLElement).querySelectorAll<HTMLElement>('[data-source-start]'),
  );
  const candidate = isStart
    ? sourceNodes.find((node) => {
        const child = container.childNodes[offset];
        return child ? child === node || child.contains(node) : false;
      }) ?? sourceNodes[0]
    : [...sourceNodes].reverse()[0];
  if (!candidate) return null;
  return Number(
    isStart
      ? candidate.dataset.sourceStart
      : candidate.dataset.sourceEnd ?? candidate.dataset.sourceStart,
  );
}

type AnnotationType = 'highlight' | 'concept' | 'question';

interface AnnotationRange {
  type: AnnotationType;
  variant: string;
  id: number;
  start: number;
  end: number;
  sourceStart: number;
}

interface MarkdownNode {
  type: string;
  value?: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: MarkdownNode[];
  position?: {
    start: { offset?: number };
    end: { offset?: number };
  };
}

interface ReaderMarkdownPluginOptions {
  chunks: ReaderChunk[];
  ranges: AnnotationRange[];
  activeChunkId?: number | null;
  selectedAnnotations: UniversalReaderProps['selectedAnnotations'];
}

function getAnnotationRanges(
  highlights: Highlight[],
  concepts: Concept[],
  questions: Question[],
): AnnotationRange[] {
  return [
    ...highlights.flatMap((highlight) =>
      highlight.locators.map((locator) => ({
        type: 'highlight' as const,
        variant: 'highlight',
        id: highlight.id,
        start: locator.start_offset,
        end: locator.end_offset,
        sourceStart: locator.start_offset,
      })),
    ),
    ...concepts.flatMap((concept) =>
      concept.locators.map((locator) => ({
        type: 'concept' as const,
        variant:
          concept.status === 'confirmed'
            ? 'concept-confirmed'
            : 'concept-draft',
        id: concept.id,
        start: locator.start_offset,
        end: locator.end_offset,
        sourceStart: locator.start_offset,
      })),
    ),
    ...questions.flatMap((question) =>
      question.locators.map((locator) => ({
        type: 'question' as const,
        variant: question.status === 'closed' ? 'question-saved' : 'question',
        id: question.id,
        start: locator.start_offset,
        end: locator.end_offset,
        sourceStart: locator.start_offset,
      })),
    ),
  ];
}

function readerMarkdownPlugin(options: ReaderMarkdownPluginOptions) {
  return (tree: MarkdownNode) => {
    const anchoredChunks = new Set<number>();
    let headingIndex = 0;

    const transform = (node: MarkdownNode) => {
      if (node.tagName && /^h[1-6]$/.test(node.tagName)) {
        node.properties = {
          ...node.properties,
          id: `reader-heading-${headingIndex}`,
        };
        headingIndex += 1;
      }
      if (!node.children) return;
      node.children = node.children.flatMap((child) => {
        if (child.type !== 'text' || !child.value || !child.position) {
          transform(child);
          return [child];
        }

        const sourceStart = child.position.start.offset;
        const sourceEnd = child.position.end.offset;
        if (sourceStart === undefined || sourceEnd === undefined) return [child];

        const overlappingRanges = options.ranges.filter(
          (range) => range.start < sourceEnd && range.end > sourceStart,
        );
        const overlappingChunks = options.chunks.filter(
          (chunk) => chunk.startOffset < sourceEnd && chunk.endOffset > sourceStart,
        );
        const boundaries = new Set([sourceStart, sourceEnd]);
        overlappingRanges.forEach((range) => {
          boundaries.add(Math.max(sourceStart, range.start));
          boundaries.add(Math.min(sourceEnd, range.end));
        });
        overlappingChunks.forEach((chunk) => {
          boundaries.add(Math.max(sourceStart, chunk.startOffset));
          boundaries.add(Math.min(sourceEnd, chunk.endOffset));
        });
        const positions = Array.from(boundaries).sort((left, right) => left - right);

        return positions.slice(0, -1).map((start, index) => {
          const end = positions[index + 1];
          const chunk = options.chunks.find(
            (item) => item.startOffset <= start && start < item.endOffset,
          );
          const activeRanges = overlappingRanges.filter(
            (range) => range.start < end && range.end > start,
          );
          const prioritizedRanges = (
            ['concept', 'question', 'highlight'] as AnnotationType[]
          ).flatMap((type) => activeRanges.filter((range) => range.type === type));
          const clickTarget =
            prioritizedRanges.find((range) => range.sourceStart === start) ??
            prioritizedRanges[0];
          const classNames = [
            'universal-reader__source-text',
            chunk?.id === options.activeChunkId
              ? 'universal-reader__source-text--active'
              : '',
            ...activeRanges.map(
              (range) => `universal-reader__annotation universal-reader__annotation--${range.variant}`,
            ),
            activeRanges.some((range) =>
              options.selectedAnnotations.some(
                (selected) =>
                  selected.type === range.type && selected.id === range.id,
              ),
            )
              ? 'universal-reader__annotation--selected'
              : '',
          ].filter(Boolean);
          const properties: Record<string, unknown> = {
            className: classNames,
            'data-source-start': start,
            'data-source-end': end,
          };
          const highlightIds = activeRanges
            .filter((range) => range.type === 'highlight')
            .map((range) => range.id);
          if (highlightIds.length) {
            properties['data-highlight-ids'] = highlightIds.join(' ');
          }
          if (chunk) {
            properties['data-chunk-id'] = chunk.id;
            if (!anchoredChunks.has(chunk.id)) {
              properties.id = `reader-chunk-${chunk.id}`;
              anchoredChunks.add(chunk.id);
            }
          }
          if (clickTarget) {
            properties.id =
              clickTarget.sourceStart === start
                ? `reader-${clickTarget.type}-${clickTarget.id}`
                : properties.id;
            properties['data-annotation-type'] = clickTarget.type;
            properties['data-annotation-id'] = clickTarget.id;
            properties.role = 'button';
            properties.tabIndex = 0;
          }

          return {
            type: 'element',
            tagName: 'span',
            properties,
            children: [
              {
                type: 'text',
                value: child.value?.slice(
                  Math.max(0, start - sourceStart),
                  Math.max(0, end - sourceStart),
                ),
              },
            ],
          };
        });
      });
    };

    transform(tree);
  };
}

function renderChunk(
  chunk: ReaderChunk,
  highlights: Highlight[],
  concepts: Concept[],
  questions: Question[],
  onAnnotationClick: UniversalReaderProps['onAnnotationClick'],
  selectedAnnotations: UniversalReaderProps['selectedAnnotations'],
) {
  const ranges = getAnnotationRanges(highlights, concepts, questions).filter(
    (range) => range.start < chunk.endOffset && range.end > chunk.startOffset,
  );

  if (!ranges.length) return chunk.content;

  const boundaries = new Set([0, chunk.content.length]);
  ranges.forEach((range) => {
    boundaries.add(Math.max(0, range.start - chunk.startOffset));
    boundaries.add(Math.min(chunk.content.length, range.end - chunk.startOffset));
  });
  const positions = Array.from(boundaries).sort((left, right) => left - right);

  return positions.slice(0, -1).map((start, index) => {
    const end = positions[index + 1];
    const absoluteStart = chunk.startOffset + start;
    const activeRanges = ranges.filter(
      (range) => range.start < chunk.startOffset + end && range.end > absoluteStart,
    );
    const content = chunk.content.slice(start, end);
    if (!activeRanges.length) return content;

    const prioritizedRanges = (
      ['concept', 'question', 'highlight'] as AnnotationType[]
    )
      .map((type) =>
        activeRanges.filter((range) => range.type === type),
      )
      .flat();
    const anchor = prioritizedRanges.find(
      (range) => range.sourceStart === absoluteStart,
    );
    const clickTarget = anchor ?? prioritizedRanges[0];
    return (
      <span
        id={anchor ? `reader-${anchor.type}-${anchor.id}` : undefined}
        key={`${start}-${end}`}
        className={[
          'universal-reader__annotation',
          ...activeRanges.map(
            (range) => `universal-reader__annotation--${range.variant}`,
          ),
          ...activeRanges
            .filter((range) =>
              selectedAnnotations.some(
                (selected) =>
                  selected.type === range.type && selected.id === range.id,
              ),
            )
            .map(() => 'universal-reader__annotation--selected'),
        ].join(' ')}
        data-question-ids={activeRanges
          .filter((range) => range.type === 'question')
          .map((range) => range.id)
          .join(' ')}
        data-concept-ids={activeRanges
          .filter((range) => range.type === 'concept')
          .map((range) => range.id)
          .join(' ')}
        data-highlight-ids={activeRanges
          .filter((range) => range.type === 'highlight')
          .map((range) => range.id)
          .join(' ')}
        role="button"
        tabIndex={0}
        aria-label={`查看${clickTarget.type === 'concept' ? '概念' : clickTarget.type === 'question' ? '问答' : '高亮'}`}
        onClick={(event) => {
          if (!clickTarget) return;
          event.stopPropagation();
          onAnnotationClick(clickTarget.type, clickTarget.id);
        }}
        onKeyDown={(event) => {
          if (!clickTarget || !['Enter', ' '].includes(event.key)) return;
          event.preventDefault();
          event.stopPropagation();
          onAnnotationClick(clickTarget.type, clickTarget.id);
        }}
      >
        {content}
      </span>
    );
  });
}

export default function UniversalReader({
  material,
  highlights,
  concepts,
  questions,
  readerTheme,
  onReaderThemeChange,
  readerFont,
  onReaderFontChange,
  preferredSpeechVoice,
  preferredSpeechRate,
  onSpeechPreferencesChange,
  onMarkConcept,
  onAskQuestion,
  onHighlight,
  onClearAnnotationSelection,
  onAnnotationClick,
  selectedAnnotations,
  showHighlightNotes = false,
  onHighlightNoteSave,
  seekTime,
  speechControlsTargetId,
}: UniversalReaderProps) {
  const chunks = React.useMemo(() => getReaderChunks(material), [material]);
  const speechVoices = React.useMemo(
    () => material.tts_assets.filter(
      (asset) => asset.status === 'ready' && Boolean(asset.url),
    ),
    [material.tts_assets],
  );
  const annotationRanges = React.useMemo(
    () => getAnnotationRanges(highlights, concepts, questions),
    [concepts, highlights, questions],
  );
  const playerRef = React.useRef<MediaPlayerInstance | null>(null);
  const audioRef = React.useRef<HTMLAudioElement | null>(null);
  const pendingSpeechOffsetRef = React.useRef<number | null>(null);
  const contentShellRef = React.useRef<HTMLDivElement | null>(null);
  const transcriptRef = React.useRef<HTMLDivElement | null>(null);
  const [selectionMenu, setSelectionMenu] = React.useState<SelectionMenu | null>(
    null,
  );
  const selectionCaptureTimersRef = React.useRef<number[]>([]);
  const selectionMenuInteractionRef = React.useRef(false);
  const [currentTime, setCurrentTime] = React.useState(0);
  const [speechState, setSpeechState] = React.useState<
    'idle' | 'speaking' | 'paused'
  >('idle');
  const [speechRate, setSpeechRate] = React.useState(
    preferredSpeechRate ?? 1,
  );
  const [speechVoiceURI, setSpeechVoiceURI] = React.useState(
    preferredSpeechVoice ?? '',
  );
  const [spokenChunkId, setSpokenChunkId] = React.useState<number | null>(null);
  const [openToolPanel, setOpenToolPanel] = React.useState<
    'toc' | 'theme' | 'font' | 'voice' | 'rate' | null
  >(null);
  const [speechControlsTarget, setSpeechControlsTarget] =
    React.useState<HTMLElement | null>(null);
  const [highlightCommentPositions, setHighlightCommentPositions] =
    React.useState<Record<number, HighlightCommentPosition>>({});
  const [highlightCommentRailHeight, setHighlightCommentRailHeight] =
    React.useState(0);
  const [mobileCommentId, setMobileCommentId] = React.useState<number | null>(null);
  const [commentDrafts, setCommentDrafts] = React.useState<Record<number, string>>({});
  const [savingCommentId, setSavingCommentId] = React.useState<number | null>(null);
  const [editingCommentId, setEditingCommentId] = React.useState<number | null>(null);
  const [activeCommentId, setActiveCommentId] = React.useState<number | null>(null);
  const isMobile = useMediaQuery('(max-width: 767px)');
  const isVideo = material.media_type === 'video' && Boolean(material.media_url);
  const headings = React.useMemo(
    () => isVideo ? [] : extractHeadings(material.clean_text),
    [isVideo, material.clean_text],
  );
  const highlightComments = React.useMemo(
    () =>
      showHighlightNotes && !isVideo
        ? highlights.filter((highlight) => highlight.user_note.trim())
        : [],
    [highlights, isVideo, showHighlightNotes],
  );
  const selectedVoice =
    speechVoices.find((voice) => voice.voice === speechVoiceURI) ??
    speechVoices[0];
  const mobileComment = highlights.find(
    (highlight) => highlight.id === mobileCommentId,
  );
  const darkMode =
    siteThemeOptions.find((option) => option.value === readerTheme)?.dark ?? false;
  const activeChunkId = isVideo
    ? chunks.find(
        (chunk) =>
          chunk.startTime !== null &&
          chunk.endTime !== null &&
          currentTime >= chunk.startTime &&
          currentTime < chunk.endTime,
      )?.id
    : undefined;
  const visibleActiveChunkId = isVideo ? activeChunkId : spokenChunkId;
  const seekTo = (time: number | null) => {
    if (time === null || !playerRef.current) return;
    playerRef.current.remoteControl.seek(time);
  };
  React.useEffect(() => {
    if (isVideo && seekTime?.time !== null && seekTime?.time !== undefined) {
      seekTo(seekTime.time);
    }
  }, [isVideo, seekTime?.nonce, seekTime?.time]);
  React.useEffect(() => {
    if (!isVideo || activeChunkId === undefined) return;
    const chunk = transcriptRef.current?.querySelector<HTMLElement>(
      `#reader-chunk-${activeChunkId}`,
    );
    chunk?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [activeChunkId, isVideo]);
  React.useEffect(() => {
    if (isVideo || spokenChunkId === null) return;
    transcriptRef.current
      ?.querySelector<HTMLElement>(`#reader-chunk-${spokenChunkId}`)
      ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [isVideo, spokenChunkId]);
  React.useEffect(() => {
    setSpeechVoiceURI((current) =>
      speechVoices.some((voice) => voice.voice === current)
        ? current
        : speechVoices[0]?.voice ?? '',
    );
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
    setSpeechState('idle');
    setSpokenChunkId(null);
  }, [material.id, speechVoices]);
  React.useEffect(() => {
    if (
      preferredSpeechVoice &&
      speechVoices.some((voice) => voice.voice === preferredSpeechVoice)
    ) {
      setSpeechVoiceURI(preferredSpeechVoice);
    }
  }, [preferredSpeechVoice, speechVoices]);
  React.useEffect(() => {
    if (
      preferredSpeechRate !== undefined &&
      preferredSpeechRate >= 0.5 &&
      preferredSpeechRate <= 3
    ) {
      setSpeechRate(preferredSpeechRate);
      if (audioRef.current) {
        audioRef.current.playbackRate = preferredSpeechRate;
      }
    }
  }, [preferredSpeechRate]);
  React.useEffect(() => {
    setCommentDrafts(
      Object.fromEntries(
        highlights.map((highlight) => [highlight.id, highlight.user_note]),
      ),
    );
  }, [highlights]);
  React.useEffect(() => {
    if (!speechControlsTargetId) {
      setSpeechControlsTarget(null);
      return;
    }
    setSpeechControlsTarget(document.getElementById(speechControlsTargetId));
  }, [speechControlsTargetId]);
  React.useLayoutEffect(() => {
    const shell = contentShellRef.current;
    const content = transcriptRef.current;
    if (!shell || !content || !highlightComments.length) {
      setHighlightCommentPositions({});
      setHighlightCommentRailHeight(0);
      return;
    }

    const updatePositions = () => {
      const shellRect = shell.getBoundingClientRect();
      const anchors = highlightComments
        .map((highlight) => {
          const anchor = content.querySelector<HTMLElement>(
            `[data-highlight-ids~="${highlight.id}"]`,
          );
          if (!anchor) return null;
          return {
            highlight,
            anchorTop: anchor.getBoundingClientRect().top - shellRect.top,
          };
        })
        .filter(
          (
            item,
          ): item is {
            highlight: Highlight;
            anchorTop: number;
          } => item !== null,
        )
        .sort((left, right) => left.anchorTop - right.anchorTop);

      let previousBottom = 0;
      const nextPositions: Record<number, HighlightCommentPosition> = {};
      anchors.forEach(({ highlight, anchorTop }) => {
        const card = shell.querySelector<HTMLElement>(
          `[data-highlight-comment-id="${highlight.id}"]`,
        );
        const top = Math.max(anchorTop, previousBottom ? previousBottom + 12 : 0);
        nextPositions[highlight.id] = { anchorTop, top };
        previousBottom = top + (card?.offsetHeight ?? 96);
      });
      setHighlightCommentPositions(nextPositions);
      setHighlightCommentRailHeight(previousBottom);
    };

    updatePositions();
    const resizeObserver = new ResizeObserver(updatePositions);
    resizeObserver.observe(content);
    shell
      .querySelectorAll<HTMLElement>('[data-highlight-comment-id]')
      .forEach((card) => resizeObserver.observe(card));
    window.addEventListener('resize', updatePositions);
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', updatePositions);
    };
  }, [highlightComments, material.clean_text, readerFont]);
  const videoMarkers = isVideo
    ? [
        ...concepts.flatMap((concept) =>
          concept.locators.map((locator) => ({
            id: `concept-${concept.id}-${locator.id}`,
            label: '概念',
            type: 'concept' as const,
            offset: locator.start_offset,
            locatorTime: locator.time_start_offset,
          })),
        ),
        ...highlights.flatMap((highlight) =>
          highlight.locators.map((locator) => ({
            id: `highlight-${highlight.id}-${locator.id}`,
            label: '高亮',
            type: 'highlight' as const,
            offset: locator.start_offset,
            locatorTime: locator.time_start_offset,
          })),
        ),
        ...questions.flatMap((question) =>
          question.locators.map((locator) => ({
            id: `question-${question.id}-${locator.id}`,
            label: '问答',
            type: 'question' as const,
            offset: locator.start_offset,
            locatorTime: locator.time_start_offset,
          })),
        ),
      ]
        .map((marker) => ({
          ...marker,
          time: marker.locatorTime ?? chunks.find(
            (chunk) => chunk.startOffset <= marker.offset && marker.offset < chunk.endOffset,
          )?.startTime,
        }))
        .filter((marker): marker is VideoMarker & typeof marker => (
          marker.time !== null && marker.time !== undefined
        ))
    : [];

  const clearSelection = () => {
    window.getSelection()?.removeAllRanges();
    setSelectionMenu(null);
    selectionMenuInteractionRef.current = false;
  };

  const captureSelection = React.useCallback(() => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
      if (!selectionMenuInteractionRef.current) setSelectionMenu(null);
      return;
    }

    const range = selection.getRangeAt(0);
    const content = transcriptRef.current;
    if (
      !content ||
      !content.contains(range.startContainer) ||
      !content.contains(range.endContainer)
    ) {
      return;
    }
    const markdownStart = getMarkdownSourceOffset(
      range.startContainer,
      range.startOffset,
      true,
    );
    const markdownEnd = getMarkdownSourceOffset(
      range.endContainer,
      range.endOffset,
      false,
    );
    const startElement = getParentChunkElement(
      range.startContainer,
      range.startOffset,
      true,
    );
    const endElement = getParentChunkElement(
      range.endContainer,
      range.endOffset,
      false,
    );
    if (
      (markdownStart === null || markdownEnd === null) &&
      (!startElement || !endElement)
    ) {
      return;
    }
    const startOffset = markdownStart ??
      (Number(startElement?.dataset.startOffset) +
        (startElement?.contains(range.startContainer)
          ? getOffsetInElement(
              startElement,
              range.startContainer,
              range.startOffset,
            )
          : 0));
    const endOffset = markdownEnd ??
      (Number(endElement?.dataset.startOffset) +
        (endElement?.contains(range.endContainer)
          ? getOffsetInElement(endElement, range.endContainer, range.endOffset)
          : endElement?.textContent?.length ?? 0));
    const text = selection.toString();
    if (!text.trim() || endOffset <= startOffset) return;

    const rect = range.getBoundingClientRect();
    const menuWidth = isVideo ? 280 : 390;
    const menuHeight = 42;
    const preferredTop = rect.bottom + 8;
    setSelectionMenu({
      selection: { text, startOffset, endOffset },
      top: preferredTop + menuHeight <= window.innerHeight
        ? preferredTop
        : Math.max(12, rect.top - menuHeight - 8),
      left: Math.max(12, Math.min(rect.left, window.innerWidth - menuWidth - 12)),
    });
  }, [isVideo]);

  const scheduleSelectionCapture = React.useCallback(
    (delays = [0]) => {
      selectionCaptureTimersRef.current.forEach(window.clearTimeout);
      selectionCaptureTimersRef.current = delays.map((delay) =>
        window.setTimeout(captureSelection, delay),
      );
    },
    [captureSelection],
  );

  React.useEffect(() => {
    const handleSelectionChange = () => {
      scheduleSelectionCapture(isMobile ? [80, 260] : [0]);
    };
    const dismissOnScroll = () => {
      if (!selectionMenuInteractionRef.current) setSelectionMenu(null);
    };
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') clearSelection();
    };
    document.addEventListener('selectionchange', handleSelectionChange);
    document.addEventListener('scroll', dismissOnScroll, true);
    document.addEventListener('keydown', dismissOnEscape);
    return () => {
      selectionCaptureTimersRef.current.forEach(window.clearTimeout);
      document.removeEventListener('selectionchange', handleSelectionChange);
      document.removeEventListener('scroll', dismissOnScroll, true);
      document.removeEventListener('keydown', dismissOnEscape);
    };
  }, [isMobile, scheduleSelectionCapture]);

  const handleMouseUp = () => captureSelection();

  const handleTouchEnd = () => {
    scheduleSelectionCapture([80, 260, 500]);
  };

  const handleAction = (
    callback: (selection: TextSelectionAnchor) => void,
  ) => {
    if (!selectionMenu) return;
    callback(selectionMenu.selection);
    clearSelection();
  };

  const stopSpeech = () => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
    setSpeechState('idle');
    setSpokenChunkId(null);
  };

  const toggleSpeech = () => {
    const audio = audioRef.current;
    if (!audio || !selectedVoice?.url) {
      message.warning(
        material.status === 'generating_audio'
          ? '朗读音频正在生成，请稍后再试'
          : '当前材料没有可用的朗读音频',
      );
      return;
    }
    if (speechState === 'speaking') {
      audio.pause();
      setSpeechState('paused');
      return;
    }
    audio.playbackRate = speechRate;
    void audio.play().then(() => {
      setSpeechState('speaking');
    }).catch(() => {
      setSpeechState('idle');
      message.error('朗读音频加载失败，请稍后重试');
    });
  };

  const playSpeechFromOffset = (sourceOffset: number) => {
    const audio = audioRef.current;
    if (!audio || !selectedVoice?.url) {
      message.warning(
        material.status === 'generating_audio'
          ? '朗读音频正在生成，请稍后再试'
          : '当前材料没有可用的朗读音频',
      );
      return;
    }
    if (!Number.isFinite(audio.duration) || audio.duration <= 0) {
      pendingSpeechOffsetRef.current = sourceOffset;
      audio.load();
      return;
    }
    const ratio = Math.min(
      1,
      Math.max(0, sourceOffset / Math.max(1, material.clean_text.length)),
    );
    audio.currentTime = ratio * audio.duration;
    audio.playbackRate = speechRate;
    void audio
      .play()
      .then(() => setSpeechState('speaking'))
      .catch(() => {
        setSpeechState('idle');
        message.error('朗读音频加载失败，请稍后重试');
      });
  };

  const changeSpeechRate = (rate: number) => {
    setSpeechRate(rate);
    onSpeechPreferencesChange?.({ rate });
    if (audioRef.current) audioRef.current.playbackRate = rate;
  };

  const changeSpeechVoice = (voiceURI: string) => {
    stopSpeech();
    setSpeechVoiceURI(voiceURI);
    onSpeechPreferencesChange?.({ voice: voiceURI });
  };

  const syncSpokenChunk = () => {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(audio.duration) || audio.duration <= 0) return;
    const sourceOffset =
      (audio.currentTime / audio.duration) * material.clean_text.length;
    const chunk = chunks.find(
      (item) =>
        item.startOffset <= sourceOffset && sourceOffset < item.endOffset,
    );
    setSpokenChunkId(chunk?.id ?? null);
  };

  const saveHighlightNote = async (highlightId: number) => {
    if (!onHighlightNoteSave) return;
    setSavingCommentId(highlightId);
    try {
      await onHighlightNoteSave(highlightId, commentDrafts[highlightId] ?? '');
      setEditingCommentId(null);
      message.success('高亮备注已保存');
    } catch {
      message.error('高亮备注保存失败');
    } finally {
      setSavingCommentId(null);
    }
  };

  const openMarkdownAnnotation = (
    target: EventTarget | null,
    requireKeyboardActivation = false,
  ) => {
    const element =
      target instanceof HTMLElement
        ? target.closest<HTMLElement>('[data-annotation-type]')
        : null;
    if (!element) return;
    if (!requireKeyboardActivation) {
      const currentSelection = window.getSelection();
      if (currentSelection && !currentSelection.isCollapsed) return;
    }
    const type = element.dataset.annotationType as AnnotationType | undefined;
    const id = Number(element.dataset.annotationId);
    if (!type || !id) return;
    onAnnotationClick(type, id);
  };

  const speechDisabled = isVideo || !selectedVoice;
  const selectedTheme = siteThemeOptions.find(
    (item) => item.value === readerTheme,
  );
  const selectedFont = readerFontOptions.find((item) => item.value === readerFont);
  const voiceLabel = selectedVoice?.label.slice(0, 4) || '音色';
  const readerControls = (
    <div className="universal-reader__reader-controls">
      <Tooltip
        title={
          isVideo
            ? '视频材料使用原始音轨'
            : speechState === 'speaking'
              ? '暂停朗读；双击停止'
              : speechState === 'paused'
                ? '继续朗读；双击停止'
                : '开始朗读'
        }
      >
        <Button
          className="universal-reader__play-button"
          type="primary"
          shape="circle"
          disabled={speechDisabled}
          aria-label={
            speechState === 'speaking'
              ? '暂停朗读'
              : speechState === 'paused'
                ? '继续朗读'
                : '开始朗读'
          }
          icon={
            speechState === 'speaking'
              ? <PauseCircleOutlined />
              : <PlayCircleOutlined />
          }
          onClick={toggleSpeech}
          onDoubleClick={stopSpeech}
        />
      </Tooltip>
      <div className={`universal-reader__tool-dock ${darkMode ? 'universal-reader__tool-dock--dark' : ''}`}>
        <Popover
          trigger="click"
          placement="leftTop"
          arrow
          open={openToolPanel === 'toc'}
          onOpenChange={(open) => setOpenToolPanel(open ? 'toc' : null)}
          content={
            <nav
              className="universal-reader__toc-panel"
              aria-label="文章目录"
            >
              <Text strong>文章目录</Text>
              {headings.map((heading) => (
                <Button
                  key={heading.id}
                  type="text"
                  style={{ paddingInlineStart: 8 + (heading.depth - 1) * 12 }}
                  onClick={() => {
                    document.getElementById(heading.id)?.scrollIntoView({
                      behavior: 'smooth',
                      block: 'start',
                    });
                    setOpenToolPanel(null);
                  }}
                >
                  {heading.label}
                </Button>
              ))}
            </nav>
          }
        >
          <Button
            type="text"
            className="universal-reader__setting-button"
            disabled={!headings.length}
            icon={<UnorderedListOutlined />}
            title={headings.length ? '文章目录' : '正文没有可用标题'}
            aria-label="打开文章目录"
          />
        </Popover>
        <Popover
        trigger="click"
        placement="leftTop"
        arrow
        open={openToolPanel === 'theme'}
        onOpenChange={(open) => setOpenToolPanel(open ? 'theme' : null)}
        content={
          <div className="universal-reader__tool-panel">
            {siteThemeOptions.map((option) => (
              <Button
                key={option.value}
                type={readerTheme === option.value ? 'primary' : 'text'}
                onClick={() => {
                  onReaderThemeChange(option.value);
                  setOpenToolPanel(null);
                }}
              >
                <span
                  className="universal-reader__theme-swatch"
                  style={{ background: option.color }}
                />
                {option.label}
              </Button>
            ))}
          </div>
        }
      >
        <Button
          type="text"
          className="universal-reader__setting-button"
          title={`阅读背景：${selectedTheme?.label}`}
          aria-label="选择阅读背景"
        >
          <span
            className="universal-reader__current-theme"
            style={{ background: selectedTheme?.color }}
          />
        </Button>
        </Popover>
        <Popover
        trigger="click"
        placement="leftTop"
        arrow
        open={openToolPanel === 'font'}
        onOpenChange={(open) => setOpenToolPanel(open ? 'font' : null)}
        content={
          <div className="universal-reader__tool-panel">
            {readerFontOptions.map((option) => (
              <Button
                key={option.value}
                type={readerFont === option.value ? 'primary' : 'text'}
                onClick={() => {
                  onReaderFontChange(option.value);
                  setOpenToolPanel(null);
                }}
              >
                {option.label}
              </Button>
            ))}
          </div>
        }
      >
        <Button
          type="text"
          className="universal-reader__setting-button"
          title={`正文字体：${selectedFont?.label}`}
          aria-label="选择正文字体"
        >
          <span className="universal-reader__setting-label">
            {selectedFont?.shortLabel}
          </span>
        </Button>
        </Popover>
        <Popover
        trigger="click"
        placement="leftTop"
        arrow
        open={openToolPanel === 'voice'}
        onOpenChange={(open) => setOpenToolPanel(open ? 'voice' : null)}
        content={
          <div className="universal-reader__tool-panel universal-reader__voice-panel">
            {speechVoices.map((voice) => (
              <Button
                key={voice.voice}
                type={speechVoiceURI === voice.voice ? 'primary' : 'text'}
                onClick={() => {
                  changeSpeechVoice(voice.voice);
                  setOpenToolPanel(null);
                }}
              >
                {voice.label}
              </Button>
            ))}
          </div>
        }
      >
        <Button
          type="text"
          className="universal-reader__setting-button"
          disabled={isVideo || !speechVoices.length}
          title={isVideo ? '视频材料使用原始音轨' : `朗读音色：${selectedVoice?.label ?? '暂无音频'}`}
          aria-label="选择朗读音色"
        >
          <span className="universal-reader__setting-label">{voiceLabel}</span>
        </Button>
        </Popover>
        <Popover
        trigger="click"
        placement="leftTop"
        arrow
        open={openToolPanel === 'rate'}
        onOpenChange={(open) => setOpenToolPanel(open ? 'rate' : null)}
        content={
          <div className="universal-reader__tool-panel universal-reader__rate-panel">
            {[0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3].map((rate) => (
              <Button
                key={rate}
                type={speechRate === rate ? 'primary' : 'text'}
                onClick={() => {
                  changeSpeechRate(rate);
                  setOpenToolPanel(null);
                }}
              >
                {rate}x
              </Button>
            ))}
          </div>
        }
      >
        <Button
          type="text"
          className="universal-reader__setting-button"
          disabled={speechDisabled}
          title={`朗读速度：${speechRate}x`}
          aria-label={`选择朗读速度，当前 ${speechRate} 倍`}
        >
          <span className="universal-reader__setting-label">{speechRate}x</span>
        </Button>
        </Popover>
      </div>
    </div>
  );

  return (
    <>
      <audio
        ref={audioRef}
        src={selectedVoice?.url}
        preload="metadata"
        hidden
        onPlay={() => setSpeechState('speaking')}
        onEnded={() => {
          setSpeechState('idle');
          setSpokenChunkId(null);
        }}
        onError={() => {
          if (selectedVoice?.url) {
            setSpeechState('idle');
            setSpokenChunkId(null);
          }
        }}
        onLoadedMetadata={() => {
          if (audioRef.current) audioRef.current.playbackRate = speechRate;
          if (pendingSpeechOffsetRef.current !== null) {
            const sourceOffset = pendingSpeechOffsetRef.current;
            pendingSpeechOffsetRef.current = null;
            playSpeechFromOffset(sourceOffset);
          }
        }}
        onTimeUpdate={syncSpokenChunk}
      />
      <article
        className={[
          'universal-reader',
          darkMode ? 'universal-reader--dark' : '',
          `universal-reader--${readerTheme}`,
          `universal-reader--font-${readerFont}`,
          isVideo ? 'universal-reader--video' : '',
        ].filter(Boolean).join(' ')}
      >
      <header className="universal-reader__header">
        <div>
          <Space size={8} wrap>
            <Tag
              icon={<BookOutlined />}
              color={material.created_by === 'manual' ? 'default' : 'purple'}
            >
              {material.created_by === 'manual' ? '人工添加' : 'AI 推荐'}
            </Tag>
            <Text type="secondary">{mediaTypeLabels[material.media_type]}</Text>
          </Space>
          <Title level={1} className="universal-reader__title">
            {material.title}
          </Title>
        </div>
        <Space wrap>
          {material.media_type === 'web_page' && material.media_uri && (
            <Button
              icon={<LinkOutlined />}
              href={material.media_uri}
              target="_blank"
              rel="noreferrer"
            >
              原始来源
            </Button>
          )}
        </Space>
      </header>

      <Divider className="universal-reader__divider" />

      <div
        ref={contentShellRef}
        className={
          isVideo
            ? 'universal-reader__video-workspace'
            : 'universal-reader__content-shell'
        }
        style={
          !isVideo && highlightCommentRailHeight
            ? { minHeight: highlightCommentRailHeight }
            : undefined
        }
      >
        {isVideo && (
          <section className="universal-reader__video">
            <MediaPlayer
              key={material.id}
              ref={playerRef}
              src={material.media_url}
              title={material.title}
              onTimeUpdate={(detail) => setCurrentTime(detail.currentTime)}
              playsInline
              viewType="video"
              load="eager"
            >
              <MediaProvider />
              <DefaultVideoLayout
                icons={defaultLayoutIcons}
                slots={{
                  timeSlider: (
                    <VideoTimeline markers={videoMarkers} onSeek={seekTo} />
                  ),
                }}
              />
            </MediaPlayer>
            {videoMarkers.length > 0 && (
              <div className="universal-reader__video-markers" aria-label="视频学习标记">
                {videoMarkers.map((marker) => (
                  <Button
                    key={marker.id}
                    size="small"
                    type="text"
                    onClick={() => seekTo(marker.time)}
                  >
                    {marker.label} {formatTimestamp(marker.time)}
                  </Button>
                ))}
              </div>
            )}
          </section>
        )}

        <div
          className={`universal-reader__content ${isVideo ? 'universal-reader__transcript' : ''}`}
          ref={transcriptRef}
          onMouseUp={handleMouseUp}
          onTouchEnd={handleTouchEnd}
          onClick={(event) => {
            setActiveCommentId(null);
            onClearAnnotationSelection();
            if (!isVideo) openMarkdownAnnotation(event.target);
          }}
          onKeyDown={(event) => {
            if (
              !isVideo &&
              ['Enter', ' '].includes(event.key) &&
              event.target instanceof HTMLElement &&
              event.target.closest('[data-annotation-type]')
            ) {
              event.preventDefault();
              openMarkdownAnnotation(event.target, true);
            }
          }}
        >
          {isVideo ? (
            chunks.map((chunk) => (
              <p
                id={`reader-chunk-${chunk.id}`}
                key={chunk.id}
                data-start-offset={chunk.startOffset}
                data-end-offset={chunk.endOffset}
                className={chunk.id === visibleActiveChunkId ? 'universal-reader__chunk--active' : undefined}
                onClick={() => {
                  const selection = window.getSelection();
                  if (selection && !selection.isCollapsed) return;
                  if (chunk.startTime !== null) seekTo(chunk.startTime);
                }}
              >
                <span
                  className="universal-reader__timestamp"
                  data-reader-ignore-offset
                >
                  {chunk.startTime !== null ? formatTimestamp(chunk.startTime) : '--'}
                </span>
                {renderChunk(
                  chunk,
                  highlights,
                  concepts,
                  questions,
                  onAnnotationClick,
                  selectedAnnotations,
                )}
              </p>
            ))
          ) : (
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[
                [
                  readerMarkdownPlugin,
                  {
                    chunks,
                    ranges: annotationRanges,
                    activeChunkId: visibleActiveChunkId,
                    selectedAnnotations:
                      activeCommentId === null
                        ? selectedAnnotations
                        : [
                            ...selectedAnnotations,
                            { type: 'highlight' as const, id: activeCommentId },
                          ],
                  },
                ],
              ]}
            >
              {material.clean_text}
            </ReactMarkdown>
          )}
        </div>
        {!isVideo && highlightComments.length > 0 && (
          <aside
            className="universal-reader__comment-rail"
            aria-label="高亮备注"
          >
            {highlightComments.map((highlight) => {
              const position = highlightCommentPositions[highlight.id];
              const locator =
                highlight.locators.find(
                  (item) => item.material === material.id,
                ) ?? highlight.locators[0];
              const sourceText = locator?.source_text || '对应高亮';
              const isEditing = editingCommentId === highlight.id;
              const startEditing = () => {
                setCommentDrafts((current) => ({
                  ...current,
                  [highlight.id]: highlight.user_note,
                }));
                setEditingCommentId(highlight.id);
              };
              const cancelEditing = () => {
                setCommentDrafts((current) => ({
                  ...current,
                  [highlight.id]: highlight.user_note,
                }));
                setEditingCommentId(null);
              };
              const renderCommentBody = () => (
                <>
                  <span className="universal-reader__comment-card-title">
                    <span>
                      <CommentOutlined />
                      高亮备注
                    </span>
                    {!isEditing && (
                      <Button
                        type="text"
                        size="small"
                        icon={<EditOutlined />}
                        aria-label={`编辑高亮备注：${sourceText}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          startEditing();
                        }}
                      />
                    )}
                  </span>
                  <div className="universal-reader__comment-source">
                    {sourceText}
                  </div>
                  {isEditing ? (
                    <>
                      <Input.TextArea
                        value={commentDrafts[highlight.id] ?? highlight.user_note}
                        autoSize={{ minRows: 2, maxRows: 8 }}
                        aria-label={`编辑高亮备注：${sourceText}`}
                        onClick={(event) => event.stopPropagation()}
                        onChange={(event) =>
                          setCommentDrafts((current) => ({
                            ...current,
                            [highlight.id]: event.target.value,
                          }))
                        }
                      />
                      <Space className="universal-reader__comment-actions">
                        <Button
                          type="primary"
                          size="small"
                          icon={<SaveOutlined />}
                          loading={savingCommentId === highlight.id}
                          disabled={
                            !onHighlightNoteSave ||
                            (commentDrafts[highlight.id] ??
                              highlight.user_note) === highlight.user_note
                          }
                          onClick={(event) => {
                            event.stopPropagation();
                            void saveHighlightNote(highlight.id);
                          }}
                        >
                          保存
                        </Button>
                        <Button
                          size="small"
                          onClick={(event) => {
                            event.stopPropagation();
                            cancelEditing();
                          }}
                        >
                          取消
                        </Button>
                      </Space>
                    </>
                  ) : (
                    <span className="universal-reader__comment-text">
                      {highlight.user_note}
                    </span>
                  )}
                </>
              );

              return (
                <React.Fragment key={highlight.id}>
                  <div
                    className="universal-reader__comment-card"
                    data-highlight-comment-id={highlight.id}
                    style={{ top: position?.top ?? 0 }}
                    onClick={() => setActiveCommentId(highlight.id)}
                  >
                    {renderCommentBody()}
                  </div>
                  {isMobile ? (
                    <Button
                      className="universal-reader__comment-marker"
                      type="primary"
                      shape="circle"
                      size="small"
                      icon={<CommentOutlined />}
                      style={{ top: position?.anchorTop ?? 0 }}
                      aria-label={`查看高亮备注：${sourceText}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        setActiveCommentId(highlight.id);
                        setMobileCommentId(highlight.id);
                      }}
                    />
                  ) : (
                    <Popover
                      trigger="click"
                      placement="leftTop"
                      content={
                        <div
                          className="universal-reader__comment-popover"
                          onClick={() => setActiveCommentId(highlight.id)}
                        >
                          {renderCommentBody()}
                        </div>
                      }
                    >
                      <Button
                        className="universal-reader__comment-marker"
                        type="primary"
                        shape="circle"
                        size="small"
                        icon={<CommentOutlined />}
                        style={{ top: position?.anchorTop ?? 0 }}
                        aria-label={`查看高亮备注：${sourceText}`}
                        onClick={() => setActiveCommentId(highlight.id)}
                      />
                    </Popover>
                  )}
                </React.Fragment>
              );
            })}
          </aside>
        )}
      </div>

      <Drawer
        title="高亮备注"
        placement="bottom"
        open={isMobile && Boolean(mobileComment)}
        onClose={() => {
          setMobileCommentId(null);
          setEditingCommentId(null);
        }}
        maskClosable={false}
        height="auto"
        className="universal-reader__comment-drawer"
      >
        {mobileComment && (
          <div className="universal-reader__comment-popover">
            <div className="universal-reader__comment-card-title">
              <span>
                <CommentOutlined />
                高亮备注
              </span>
              {editingCommentId !== mobileComment.id && (
                <Button
                  type="text"
                  size="small"
                  icon={<EditOutlined />}
                  aria-label="编辑高亮备注"
                  onClick={() => {
                    setCommentDrafts((current) => ({
                      ...current,
                      [mobileComment.id]: mobileComment.user_note,
                    }));
                    setEditingCommentId(mobileComment.id);
                  }}
                />
              )}
            </div>
            <div className="universal-reader__comment-source">
              {mobileComment.locators.find(
                (item) => item.material === material.id,
              )?.source_text || '对应高亮'}
            </div>
            {editingCommentId === mobileComment.id ? (
              <>
                <Input.TextArea
                  value={
                    commentDrafts[mobileComment.id] ?? mobileComment.user_note
                  }
                  autoSize={{ minRows: 3, maxRows: 8 }}
                  aria-label="编辑高亮备注"
                  onChange={(event) =>
                    setCommentDrafts((current) => ({
                      ...current,
                      [mobileComment.id]: event.target.value,
                    }))
                  }
                />
                <Space className="universal-reader__comment-actions">
                  <Button
                    type="primary"
                    icon={<SaveOutlined />}
                    loading={savingCommentId === mobileComment.id}
                    disabled={
                      !onHighlightNoteSave ||
                      (commentDrafts[mobileComment.id] ??
                        mobileComment.user_note) === mobileComment.user_note
                    }
                    onClick={() => void saveHighlightNote(mobileComment.id)}
                  >
                    保存
                  </Button>
                  <Button
                    onClick={() => {
                      setCommentDrafts((current) => ({
                        ...current,
                        [mobileComment.id]: mobileComment.user_note,
                      }));
                      setEditingCommentId(null);
                    }}
                  >
                    取消
                  </Button>
                </Space>
              </>
            ) : (
              <div className="universal-reader__comment-text">
                {mobileComment.user_note}
              </div>
            )}
          </div>
        )}
      </Drawer>

      {selectionMenu && (
        <div
          className="universal-reader__selection-menu"
          style={{ top: selectionMenu.top, left: selectionMenu.left }}
          onMouseDown={(event) => event.preventDefault()}
          onPointerDown={() => {
            selectionMenuInteractionRef.current = true;
          }}
          onPointerUp={() => {
            window.setTimeout(() => {
              selectionMenuInteractionRef.current = false;
            }, 0);
          }}
        >
          <Button
            type="text"
            size="small"
            icon={<BookOutlined />}
            onClick={() => handleAction(onMarkConcept)}
          >
            标记概念
          </Button>
          <Button
            type="text"
            size="small"
            icon={<CommentOutlined />}
            onClick={() => handleAction(onAskQuestion)}
          >
            发起问答
          </Button>
          <Button
            type="text"
            size="small"
            icon={<HighlightOutlined />}
            onClick={() => handleAction(onHighlight)}
          >
            高亮
          </Button>
          {!isVideo && (
            <Button
              type="text"
              size="small"
              icon={<SoundOutlined />}
              onClick={() =>
                handleAction((selected) =>
                  playSpeechFromOffset(selected.startOffset),
                )
              }
            >
              从此朗读
            </Button>
          )}
        </div>
      )}
      </article>
      {speechControlsTarget
        ? createPortal(readerControls, speechControlsTarget)
        : readerControls}
    </>
  );
}
