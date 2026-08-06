import React from 'react';
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
  MoonOutlined,
  SunOutlined,
} from '@ant-design/icons';
import { Button, Divider, Space, Tag, Typography } from 'antd';
import type { Concept, Highlight, Material, Question } from '../../api';
import './styles.css';

const { Title, Text } = Typography;

export interface TextSelectionAnchor {
  text: string;
  startOffset: number;
  endOffset: number;
}

interface UniversalReaderProps {
  material: Material;
  highlights: Highlight[];
  concepts: Concept[];
  questions: Question[];
  darkMode: boolean;
  onDarkModeChange: (enabled: boolean) => void;
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

type AnnotationType = 'highlight' | 'concept' | 'question';

interface AnnotationRange {
  type: AnnotationType;
  variant: string;
  id: number;
  start: number;
  end: number;
  sourceStart: number;
}

function renderChunk(
  chunk: ReaderChunk,
  highlights: Highlight[],
  concepts: Concept[],
  questions: Question[],
  onAnnotationClick: UniversalReaderProps['onAnnotationClick'],
  selectedAnnotations: UniversalReaderProps['selectedAnnotations'],
) {
  const ranges: AnnotationRange[] = [
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
  ].filter(
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
        onClick={(event) => {
          if (!clickTarget) return;
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
  darkMode,
  onDarkModeChange,
  onMarkConcept,
  onAskQuestion,
  onHighlight,
  onClearAnnotationSelection,
  onAnnotationClick,
  selectedAnnotations,
  seekTime,
}: UniversalReaderProps) {
  const chunks = getReaderChunks(material);
  const playerRef = React.useRef<MediaPlayerInstance | null>(null);
  const transcriptRef = React.useRef<HTMLDivElement | null>(null);
  const [selectionMenu, setSelectionMenu] = React.useState<SelectionMenu | null>(
    null,
  );
  const [currentTime, setCurrentTime] = React.useState(0);
  const isVideo = material.media_type === 'video' && Boolean(material.media_url);
  const activeChunkId = isVideo
    ? chunks.find(
        (chunk) =>
          chunk.startTime !== null &&
          chunk.endTime !== null &&
          currentTime >= chunk.startTime &&
          currentTime < chunk.endTime,
      )?.id
    : undefined;
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

  const handleMouseUp = () => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;

    const range = selection.getRangeAt(0);
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
    if (!startElement || !endElement) return;

    const startOffset =
      Number(startElement.dataset.startOffset) +
      (startElement.contains(range.startContainer)
        ? getOffsetInElement(
            startElement,
            range.startContainer,
            range.startOffset,
          )
        : 0);
    const endOffset =
      Number(endElement.dataset.startOffset) +
      (endElement.contains(range.endContainer)
        ? getOffsetInElement(endElement, range.endContainer, range.endOffset)
        : endElement.textContent?.length ?? 0);
    const text = selection.toString();
    if (!text.trim() || endOffset <= startOffset) return;

    const rect = range.getBoundingClientRect();
    setSelectionMenu({
      selection: { text, startOffset, endOffset },
      top: rect.bottom + 8,
      left: Math.max(12, Math.min(rect.left, window.innerWidth - 280)),
    });
  };

  const handleAction = (
    callback: (selection: TextSelectionAnchor) => void,
  ) => {
    if (!selectionMenu) return;
    callback(selectionMenu.selection);
    clearSelection();
  };

  return (
    <article
      className={[
        'universal-reader',
        darkMode ? 'universal-reader--dark' : '',
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
            <Text type="secondary">{material.media_type}</Text>
          </Space>
          <Title level={1} className="universal-reader__title">
            {material.title}
          </Title>
        </div>
        <Space>
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
          <Button
            aria-label={darkMode ? '切换浅色阅读模式' : '切换深色阅读模式'}
            icon={darkMode ? <SunOutlined /> : <MoonOutlined />}
            onClick={() => onDarkModeChange(!darkMode)}
          />
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
          onClick={onClearAnnotationSelection}
        >
          {chunks.map((chunk) => (
            <p
              id={`reader-chunk-${chunk.id}`}
              key={chunk.id}
              data-start-offset={chunk.startOffset}
              data-end-offset={chunk.endOffset}
              className={chunk.id === activeChunkId ? 'universal-reader__chunk--active' : undefined}
              onClick={() => {
                const selection = window.getSelection();
                if (selection && !selection.isCollapsed) return;

                if (chunk.startTime !== null) {
                  seekTo(chunk.startTime);
                }
              }}
            >
              {isVideo && (
                <span
                  className="universal-reader__timestamp"
                  data-reader-ignore-offset
                >
                  {chunk.startTime !== null ? formatTimestamp(chunk.startTime) : '--'}
                </span>
              )}
              {renderChunk(
                chunk,
                highlights,
                concepts,
                questions,
                onAnnotationClick,
                selectedAnnotations,
              )}
            </p>
          ))}
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
  );
}
