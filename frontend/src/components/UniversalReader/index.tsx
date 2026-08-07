import React from 'react';
import { createPortal } from 'react-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  MediaPlayer,
  MediaProvider,
  type MediaPlayerInstance,
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
  HighlightOutlined,
  LinkOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
} from '@ant-design/icons';
import { Button, Divider, Popover, Space, Tag, Tooltip, Typography, message } from 'antd';
import type { Concept, Highlight, Material, Question } from '../../api';
import {
  siteThemeOptions,
  type SiteTheme,
} from '../../appearance';
import './styles.css';

const { Title, Text } = Typography;

export interface TextSelectionAnchor {
  text: string;
  startOffset: number;
  endOffset: number;
}

export type ReaderTheme = SiteTheme;
export type ReaderFont = 'system' | 'song' | 'kai' | 'serif';

interface UniversalReaderProps {
  material: Material;
  highlights: Highlight[];
  concepts: Concept[];
  questions: Question[];
  readerTheme: ReaderTheme;
  onReaderThemeChange: (theme: ReaderTheme) => void;
  readerFont: ReaderFont;
  onReaderFontChange: (font: ReaderFont) => void;
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

function formatTimestamp(seconds: number) {
  const totalSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds % 60;
  return `${minutes}:${String(remainingSeconds).padStart(2, '0')}`;
}

const mediaTypeLabels: Record<Material['media_type'], string> = {
  text: '文本',
  web_page: '网页',
  video: '视频',
  audio: '音频',
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

    const transform = (node: MarkdownNode) => {
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
  onMarkConcept,
  onAskQuestion,
  onHighlight,
  onClearAnnotationSelection,
  onAnnotationClick,
  selectedAnnotations,
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
  const transcriptRef = React.useRef<HTMLDivElement | null>(null);
  const [selectionMenu, setSelectionMenu] = React.useState<SelectionMenu | null>(
    null,
  );
  const [currentTime, setCurrentTime] = React.useState(0);
  const [speechState, setSpeechState] = React.useState<
    'idle' | 'speaking' | 'paused'
  >('idle');
  const [speechRate, setSpeechRate] = React.useState(1);
  const [speechVoiceURI, setSpeechVoiceURI] = React.useState('');
  const [spokenChunkId, setSpokenChunkId] = React.useState<number | null>(null);
  const [openToolPanel, setOpenToolPanel] = React.useState<
    'theme' | 'font' | 'voice' | 'rate' | null
  >(null);
  const [speechControlsTarget, setSpeechControlsTarget] =
    React.useState<HTMLElement | null>(null);
  const isVideo = material.media_type === 'video' && Boolean(material.media_url);
  const selectedVoice =
    speechVoices.find((voice) => voice.voice === speechVoiceURI) ??
    speechVoices[0];
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
    if (!speechControlsTargetId) {
      setSpeechControlsTarget(null);
      return;
    }
    setSpeechControlsTarget(document.getElementById(speechControlsTargetId));
  }, [speechControlsTargetId]);
  const videoMarkers = isVideo
    ? [
        ...concepts.flatMap((concept) =>
          concept.locators.map((locator) => ({
            id: `concept-${concept.id}-${locator.id}`,
            label: '概念',
            offset: locator.start_offset,
          })),
        ),
        ...highlights.flatMap((highlight) =>
          highlight.locators.map((locator) => ({
            id: `highlight-${highlight.id}-${locator.id}`,
            label: '高亮',
            offset: locator.start_offset,
          })),
        ),
        ...questions.flatMap((question) =>
          question.locators.map((locator) => ({
            id: `question-${question.id}-${locator.id}`,
            label: '问答',
            offset: locator.start_offset,
          })),
        ),
      ]
        .map((marker) => ({
          ...marker,
          time: chunks.find(
            (chunk) =>
              chunk.startOffset <= marker.offset && marker.offset < chunk.endOffset,
          )?.startTime,
        }))
        .filter((marker): marker is typeof marker & { time: number } => marker.time !== null && marker.time !== undefined)
    : [];

  const clearSelection = () => {
    window.getSelection()?.removeAllRanges();
    setSelectionMenu(null);
  };

  React.useEffect(() => {
    const dismissWhenSelectionClears = () => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
        setSelectionMenu(null);
      }
    };
    const dismissOnScroll = () => setSelectionMenu(null);
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') clearSelection();
    };
    document.addEventListener('selectionchange', dismissWhenSelectionClears);
    document.addEventListener('scroll', dismissOnScroll, true);
    document.addEventListener('keydown', dismissOnEscape);
    return () => {
      document.removeEventListener('selectionchange', dismissWhenSelectionClears);
      document.removeEventListener('scroll', dismissOnScroll, true);
      document.removeEventListener('keydown', dismissOnEscape);
    };
  }, []);

  const handleMouseUp = () => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
      setSelectionMenu(null);
      return;
    }

    const range = selection.getRangeAt(0);
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
    const menuWidth = 280;
    const menuHeight = 42;
    const preferredTop = rect.bottom + 8;
    setSelectionMenu({
      selection: { text, startOffset, endOffset },
      top: preferredTop + menuHeight <= window.innerHeight
        ? preferredTop
        : Math.max(12, rect.top - menuHeight - 8),
      left: Math.max(12, Math.min(rect.left, window.innerWidth - menuWidth - 12)),
    });
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

  const changeSpeechRate = (rate: number) => {
    setSpeechRate(rate);
    if (audioRef.current) audioRef.current.playbackRate = rate;
  };

  const changeSpeechVoice = (voiceURI: string) => {
    stopSpeech();
    setSpeechVoiceURI(voiceURI);
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

      <div className={isVideo ? 'universal-reader__video-workspace' : undefined}>
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
              <DefaultVideoLayout icons={defaultLayoutIcons} />
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
          onClick={(event) => {
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
                    selectedAnnotations,
                  },
                ],
              ]}
            >
              {material.clean_text}
            </ReactMarkdown>
          )}
        </div>
      </div>

      {selectionMenu && (
        <div
          className="universal-reader__selection-menu"
          style={{ top: selectionMenu.top, left: selectionMenu.left }}
          onMouseDown={(event) => event.preventDefault()}
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
        </div>
      )}
      </article>
      {speechControlsTarget
        ? createPortal(readerControls, speechControlsTarget)
        : readerControls}
    </>
  );
}
