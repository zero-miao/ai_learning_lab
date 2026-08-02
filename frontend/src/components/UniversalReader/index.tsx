import React from 'react';
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
  onAnnotationClick: (
    type: 'concept' | 'question' | 'highlight',
    id: number,
  ) => void;
}

interface ReaderChunk {
  id: number;
  content: string;
  startOffset: number;
  endOffset: number;
}

interface SelectionMenu {
  selection: TextSelectionAnchor;
  top: number;
  left: number;
}

function getReaderChunks(material: Material): ReaderChunk[] {
  if (material.chunks.length) {
    return material.chunks.map((chunk) => ({
      id: chunk.id,
      content: chunk.content,
      startOffset: chunk.start_offset,
      endOffset: chunk.end_offset,
    }));
  }
  return [
    {
      id: 0,
      content: material.clean_text,
      startOffset: 0,
      endOffset: material.clean_text.length,
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
  return range.toString().length;
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
) {
  const ranges: AnnotationRange[] = [
    ...highlights.map((highlight) => ({
      type: 'highlight' as const,
      variant: 'highlight',
      id: highlight.id,
      start: highlight.start_offset,
      end: highlight.end_offset,
      sourceStart: highlight.start_offset,
    })),
    ...concepts.flatMap((concept) =>
      concept.anchors.map((anchor) => ({
        type: 'concept' as const,
        variant:
          concept.status === 'confirmed'
            ? 'concept-confirmed'
            : 'concept-draft',
        id: concept.id,
        start: anchor.start_offset,
        end: anchor.end_offset,
        sourceStart: anchor.start_offset,
      })),
    ),
    ...questions
      .filter(
        (question) =>
          question.start_offset !== null && question.end_offset !== null,
      )
      .map((question) => ({
        type: 'question' as const,
        variant: question.is_saved ? 'question-saved' : 'question',
        id: question.id,
        start: question.start_offset!,
        end: question.end_offset!,
        sourceStart: question.start_offset!,
      })),
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
        ].join(' ')}
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
  onAnnotationClick,
}: UniversalReaderProps) {
  const chunks = getReaderChunks(material);
  const [selectionMenu, setSelectionMenu] = React.useState<SelectionMenu | null>(
    null,
  );

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
      className={`universal-reader ${darkMode ? 'universal-reader--dark' : ''}`}
    >
      <header className="universal-reader__header">
        <div>
          <Space size={8} wrap>
            <Tag
              icon={<BookOutlined />}
              color={material.source_type === 'manual' ? 'default' : 'purple'}
            >
              {material.source_type_display}
            </Tag>
            <Text type="secondary">{material.type_display}</Text>
          </Space>
          <Title level={1} className="universal-reader__title">
            {material.title}
          </Title>
        </div>
        <Space>
          {material.source_url && (
            <Button
              icon={<LinkOutlined />}
              href={material.source_url}
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

      <div className="universal-reader__content" onMouseUp={handleMouseUp}>
        {chunks.map((chunk) => (
          <p
            id={`reader-chunk-${chunk.id}`}
            key={chunk.id}
            data-start-offset={chunk.startOffset}
            data-end-offset={chunk.endOffset}
          >
            {renderChunk(
              chunk,
              highlights,
              concepts,
              questions,
              onAnnotationClick,
            )}
          </p>
        ))}
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
