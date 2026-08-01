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
import type { Highlight, Material } from '../../api';
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
  darkMode: boolean;
  onDarkModeChange: (enabled: boolean) => void;
  onMarkConcept: (selection: TextSelectionAnchor) => void;
  onAskQuestion: (selection: TextSelectionAnchor) => void;
  onHighlight: (selection: TextSelectionAnchor) => void;
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

function renderChunk(
  chunk: ReaderChunk,
  highlights: Highlight[],
) {
  const ranges = highlights
    .filter(
      (highlight) =>
        highlight.start_offset < chunk.endOffset &&
        highlight.end_offset > chunk.startOffset,
    )
    .map((highlight) => ({
      start: Math.max(0, highlight.start_offset - chunk.startOffset),
      end: Math.min(chunk.content.length, highlight.end_offset - chunk.startOffset),
      id: highlight.id,
      isAnchor:
        highlight.start_offset >= chunk.startOffset &&
        highlight.start_offset < chunk.endOffset,
    }))
    .sort((left, right) => left.start - right.start);

  const fragments: React.ReactNode[] = [];
  let position = 0;
  for (const range of ranges) {
    if (range.end <= position) continue;
    const start = Math.max(range.start, position);
    if (start > position) {
      fragments.push(chunk.content.slice(position, start));
    }
    fragments.push(
      <mark
        id={range.isAnchor ? `reader-highlight-${range.id}` : undefined}
        key={range.id}
        className="universal-reader__highlight"
      >
        {chunk.content.slice(start, range.end)}
      </mark>,
    );
    position = range.end;
  }
  if (position < chunk.content.length) {
    fragments.push(chunk.content.slice(position));
  }
  return fragments;
}

export default function UniversalReader({
  material,
  highlights,
  darkMode,
  onDarkModeChange,
  onMarkConcept,
  onAskQuestion,
  onHighlight,
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
            {renderChunk(chunk, highlights)}
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
