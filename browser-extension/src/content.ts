import { Readability } from '@mozilla/readability';

type CaptureMode = 'auto' | 'article' | 'document' | 'selection' | 'visible';

interface SnapshotBlock {
  id: string;
  type: string;
  [key: string]: unknown;
}

interface CapturedAsset {
  sourceUrl: string;
  id?: string;
  contentType?: string;
  data?: string;
}

const BLOCK_SELECTOR = 'h1,h2,h3,h4,h5,h6,p,blockquote,pre,ul,ol,table,img,hr';
const DOCUMENT_BLOCK_SELECTOR = [
  BLOCK_SELECTOR,
  '.page-block-content',
  '.docx-image',
  '[data-block-id]',
  '[data-record-id]',
  '[data-node-id]',
  '[data-type^="heading"]',
  '[data-type="text"]',
].join(',');
const DOCUMENT_ROOT_SELECTORS = [
  '[data-testid="docx-editor"]',
  '[data-testid="document-content"]',
  '.docx-editor',
  '.docx-content',
  '.bear-web-x-container',
  '.suite-editor-container',
  '[class*="docx-editor"]',
  '[class*="editor-content"]',
  '[contenteditable="true"][role="textbox"]',
  'main [contenteditable="true"]',
];
const FEISHU_CONTENT_ROOT_SELECTOR = '.root-render-unit-container';
const FEISHU_EXCLUDED_SELECTOR = [
  '.docx-ai-summary-block',
  '.docx-back_ref_list-block',
  '.back-ref-container',
  '.back-ref-list-container',
  '[class*="catalogue"]',
  '[class*="outline"]',
  '[class*="comment-panel"]',
  '[class*="side-panel"]',
  '[class*="popover"]',
].join(',');
const FEISHU_ATTACHMENT_SELECTOR = [
  '.docx-file-block',
  '.docx-attachment-block',
  '[data-type="print-forbidden-placeholder"]',
  '[data-block-type="file"]',
  '[data-block-type="attachment"]',
  '[class*="attachment-block"]',
].join(',');
const INVISIBLE_FORMAT_CHARACTERS = /[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g;
const DOCUMENT_PAINT_DELAY_MS = 180;
const DOCUMENT_SCROLL_OVERLAP_RATIO = 0.3;

function textOf(element: Element) {
  return cleanText(element.textContent || '');
}

function textWithoutAttachments(element: Element) {
  const clone = element.cloneNode(true) as Element;
  clone.querySelectorAll(FEISHU_ATTACHMENT_SELECTOR).forEach((node) => node.remove());
  return textOf(clone);
}

function cleanText(value: string) {
  return value
    .replace(INVISIBLE_FORMAT_CHARACTERS, '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}

function cleanTitle(value: string) {
  return cleanText(value)
    .replace(/\s*[-|]\s*(飞书云文档|Feishu Docs|Lark Docs)$/i, '')
    .trim();
}

function isVisible(element: Element) {
  const style = getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
}

function topLevelBlocks(root: ParentNode, visibleOnly: boolean) {
  return Array.from(root.querySelectorAll(BLOCK_SELECTOR)).filter((element) => {
    const parentBlock = element.parentElement?.closest(BLOCK_SELECTOR);
    const nested = parentBlock && root instanceof Node && root.contains(parentBlock);
    return !nested && (!visibleOnly || isVisible(element));
  });
}

function elementToBlock(element: Element, index: number): SnapshotBlock | null {
  const tag = element.tagName.toLowerCase();
  const id =
    element.getAttribute('data-record-id') ||
    element.getAttribute('data-block-id') ||
    element.closest('[data-record-id]')?.getAttribute('data-record-id') ||
    element.closest('[data-block-id]')?.getAttribute('data-block-id') ||
    element.id ||
    `b${index + 1}`;
  if (element.matches('.docx-table-block')) {
    const header = Array.from(
      element.querySelectorAll<HTMLElement>(
        '.docx-table_cell-block.sticky-cell-vertical-align-polyfill',
      ),
    ).map((cell) => textWithoutAttachments(cell));
    const table = element.querySelector('table.table') || element.querySelector('table');
    const body = Array.from(table?.querySelectorAll('tr') || []).map((row) =>
      Array.from(row.children)
        .filter((cell) => ['th', 'td'].includes(cell.tagName.toLowerCase()))
        .map((cell) => textWithoutAttachments(cell)),
    );
    const rows = (header.length ? [header, ...body] : body).filter((row) =>
      row.some((cell) => cell),
    );
    return rows.length ? { id, type: 'table', rows } : null;
  }
  const role = element.getAttribute('role');
  if (/^h[1-6]$/.test(tag) || role === 'heading') {
    return {
      id,
      type: 'heading',
      level: Number(tag.slice(1)) || Number(element.getAttribute('aria-level')) || 2,
      text: textOf(element),
    };
  }
  if (tag === 'p') return { id, type: 'paragraph', text: textOf(element) };
  if (tag === 'blockquote') return { id, type: 'quote', text: textOf(element) };
  if (tag === 'pre') {
    return {
      id,
      type: 'code',
      language: element.querySelector('code')?.className.match(/language-([\w-]+)/)?.[1] || '',
      text: element.textContent?.trim() || '',
    };
  }
  if (tag === 'ul' || tag === 'ol') {
    return {
      id,
      type: tag === 'ol' ? 'ordered_list' : 'unordered_list',
      items: Array.from(element.children)
        .filter((child) => child.tagName.toLowerCase() === 'li')
        .map((child) => textOf(child)),
    };
  }
  if (tag === 'table') {
    return {
      id,
      type: 'table',
      rows: Array.from(element.querySelectorAll('tr')).map((row) =>
        Array.from(row.querySelectorAll('th,td')).map((cell) => textOf(cell)),
      ),
    };
  }
  if (tag === 'img') {
    const image = element as HTMLImageElement;
    const sourceUrl =
      image.currentSrc ||
      image.src ||
      image.getAttribute('data-src') ||
      image.getAttribute('data-original') ||
      '';
    return sourceUrl
      ? { id, type: 'image', source_url: new URL(sourceUrl, location.href).href, alt: image.alt || '' }
      : null;
  }
  if (tag === 'hr') return { id, type: 'divider' };
  const dataType = (element.getAttribute('data-type') || '').toLowerCase();
  const className = typeof element.className === 'string' ? element.className.toLowerCase() : '';
  const text = textOf(element);
  if (!text) return null;
  const headingMatch = `${dataType} ${className}`.match(/heading[-_ ]?([1-6])|(?:^|\s)h([1-6])(?:\s|$)/);
  if (headingMatch) {
    return {
      id,
      type: 'heading',
      level: Number(headingMatch[1] || headingMatch[2] || 2),
      text,
    };
  }
  if (dataType.includes('code') || className.includes('code-block')) {
    return { id, type: 'code', text: element.textContent?.trim() || '' };
  }
  if (dataType.includes('quote') || className.includes('blockquote')) {
    return { id, type: 'quote', text };
  }
  return { id, type: 'paragraph', text };
}

function selectionRoot() {
  const selection = getSelection();
  if (!selection || selection.rangeCount === 0 || !selection.toString().trim()) return null;
  const container = document.createElement('div');
  for (let index = 0; index < selection.rangeCount; index += 1) {
    container.append(selection.getRangeAt(index).cloneContents());
  }
  return container;
}

function articleRoot() {
  const clone = document.cloneNode(true) as Document;
  const article = new Readability(clone, { charThreshold: 100 }).parse();
  if (!article?.content) return null;
  const root = document.createElement('div');
  root.innerHTML = article.content;
  return { root, title: cleanTitle(article.title || document.title) };
}

function isFeishuDocument() {
  return /(^|\.)((feishu|larksuite)\.cn|larkoffice\.com)$/.test(location.hostname)
    && /\/(docx|docs?)\//.test(location.pathname);
}

function feishuDocumentTitle() {
  const titleInput = document.querySelector<HTMLInputElement>('.note-title__input');
  const visibleTitle =
    titleInput?.value ||
    titleInput?.textContent ||
    document.querySelector<HTMLElement>('.page-block-content[role="heading"]')?.textContent ||
    document.querySelector<HTMLElement>('h1.page-block-content')?.textContent;
  return cleanTitle(visibleTitle || document.title);
}

function feishuContentRoot() {
  const candidates = Array.from(
    document.querySelectorAll<HTMLElement>(FEISHU_CONTENT_ROOT_SELECTOR),
  );
  return candidates
    .map((element) => {
      const rect = element.getBoundingClientRect();
      const visibleBlocks = Array.from(
        element.querySelectorAll<HTMLElement>('.block[data-block-id], .docx-image'),
      ).filter(isVisible).length;
      return {
        element,
        score:
          visibleBlocks * 1_000_000 +
          Math.min(rect.width * rect.height, 1_000_000) +
          element.querySelectorAll('.block[data-block-id], .docx-image').length,
      };
    })
    .sort((left, right) => right.score - left.score)[0]?.element;
}

function documentRoot() {
  if (isFeishuDocument()) {
    const contentRoot = feishuContentRoot();
    if (contentRoot) return contentRoot;
    const feishuRoot = document.querySelector<HTMLElement>('.bear-web-x-container');
    if (feishuRoot) return feishuRoot;
    const anchor =
      document.querySelector<HTMLElement>('.docx-image') ||
      document.querySelector<HTMLElement>(
        '.page-block-content.left, .page-block-content.flash-block-content',
      );
    if (anchor) {
      let current: HTMLElement | null = anchor.parentElement;
      while (current && current !== document.body) {
        const identity = `${current.id} ${current.className}`.toLowerCase();
        if (
          current.scrollHeight > current.clientHeight + 100 &&
          !/catalog|outline|sidebar|side-panel/.test(identity)
        ) {
          return current;
        }
        current = current.parentElement;
      }
      return anchor.parentElement || anchor;
    }
  }
  const candidates = DOCUMENT_ROOT_SELECTORS.flatMap((selector) =>
    Array.from(document.querySelectorAll<HTMLElement>(selector)),
  );
  const unique = Array.from(new Set(candidates));
  const ranked = unique
    .map((element) => {
      const textLength = textOf(element).length;
      const rect = element.getBoundingClientRect();
      const editorBonus =
        /docx|document|editor|bear-web/.test(
          `${element.className} ${element.getAttribute('data-testid') || ''}`.toLowerCase(),
        )
          ? 10000
          : 0;
      const sidePanelPenalty =
        /sidebar|aside|outline|catalog|ai.summary|ai-summary/.test(
          `${element.className} ${element.getAttribute('data-testid') || ''}`.toLowerCase(),
        )
          ? 100000
          : 0;
      return {
        element,
        score: textLength + editorBonus + Math.min(rect.width * rect.height / 100, 10000) - sidePanelPenalty,
      };
    })
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score);
  return ranked[0]?.element || document.querySelector<HTMLElement>('main') || document.body;
}

function scrollContainerFor(root: HTMLElement) {
  if (isFeishuDocument()) {
    const feishuScroller = document.querySelector<HTMLElement>('.bear-web-x-container');
    if (
      feishuScroller &&
      feishuScroller.scrollHeight > feishuScroller.clientHeight + 100
    ) {
      return feishuScroller;
    }
    const anchor =
      document.querySelector<HTMLElement>('.docx-image') ||
      document.querySelector<HTMLElement>(
        '.page-block-content.left, .page-block-content.flash-block-content',
      );
    let current: HTMLElement | null = anchor || root;
    const ancestors: HTMLElement[] = [];
    while (current) {
      const identity = `${current.id} ${current.className}`.toLowerCase();
      if (
        current.scrollHeight > current.clientHeight + 100 &&
        !/catalog|outline|sidebar|side-panel/.test(identity)
      ) {
        ancestors.push(current);
      }
      current = current.parentElement;
    }
    const direct = ancestors.sort((left, right) => {
      const leftOverflow = left.scrollHeight - left.clientHeight;
      const rightOverflow = right.scrollHeight - right.clientHeight;
      const leftWidthFit = left.clientWidth > window.innerWidth * 0.35 ? 1 : 0;
      const rightWidthFit = right.clientWidth > window.innerWidth * 0.35 ? 1 : 0;
      return rightWidthFit - leftWidthFit || rightOverflow - leftOverflow;
    })[0];
    if (direct) return direct;
  }

  const perfectScrollbars = Array.from(document.querySelectorAll<HTMLElement>('.ps'))
    .filter(
      (element) => {
        const identity = `${element.id} ${element.className}`.toLowerCase();
        return (
          element.scrollHeight > element.clientHeight + 100 &&
          (element.contains(root) || root.contains(element)) &&
          !/catalog|outline|sidebar|side-panel/.test(identity)
        );
      },
    )
    .sort(
      (left, right) =>
        right.scrollHeight -
        right.clientHeight -
        (left.scrollHeight - left.clientHeight),
    );
  if (perfectScrollbars[0]) return perfectScrollbars[0];

  if (!isFeishuDocument()) {
    const thumbContainer = document
      .querySelector<HTMLElement>('.ps__thumb-y')
      ?.closest<HTMLElement>('.ps');
    if (
      thumbContainer &&
      thumbContainer.scrollHeight > thumbContainer.clientHeight + 100
    ) {
      return thumbContainer;
    }
  }

  const candidates: HTMLElement[] = [];
  let current: HTMLElement | null = root;
  while (current) {
    candidates.push(current);
    current = current.parentElement;
  }
  candidates.push(document.scrollingElement as HTMLElement, document.documentElement, document.body);
  return Array.from(new Set(candidates))
    .filter((element) => element && element.scrollHeight > element.clientHeight + 100)
    .sort((left, right) => {
      const leftScrollable = /auto|scroll/.test(getComputedStyle(left).overflowY) ? 1 : 0;
      const rightScrollable = /auto|scroll/.test(getComputedStyle(right).overflowY) ? 1 : 0;
      return (
        rightScrollable - leftScrollable ||
        right.scrollHeight - right.clientHeight - (left.scrollHeight - left.clientHeight)
      );
    })[0] || (document.scrollingElement as HTMLElement);
}

function withDocumentPosition(
  block: SnapshotBlock | null,
  element: Element,
  root: HTMLElement,
  scrollContainer: HTMLElement,
) {
  if (!block) return null;
  const elementRect = element.getBoundingClientRect();
  const containerRect = scrollContainer.getBoundingClientRect();
  let current: Element | null = element;
  let outermostBlockId = '';
  while (current && root.contains(current)) {
    if (current.matches('.block[data-block-id]')) {
      outermostBlockId = current.getAttribute('data-block-id') || outermostBlockId;
    }
    if (current === root) break;
    current = current.parentElement;
  }
  block.__documentBlockOrder = Number(outermostBlockId);
  block.__documentTop = scrollContainer.scrollTop + elementRect.top - containerRect.top;
  block.__documentLeft = elementRect.left;
  block.__documentHeight = elementRect.height;
  return block;
}

function documentBlocks(root: HTMLElement, scrollContainer: HTMLElement) {
  if (isFeishuDocument()) {
    const elements = Array.from(
      root.querySelectorAll<HTMLElement>('.block[data-block-id], .docx-image'),
    )
      .filter(
        (element) =>
          (element.matches('[class*="docx-heading"], .docx-table-block') ||
            isVisible(element)) &&
          !element.closest('[aria-hidden="true"]'),
      )
      .filter((element) => {
        const excluded = element.closest(FEISHU_EXCLUDED_SELECTOR);
        return !excluded || !root.contains(excluded);
      })
      .filter((element) => {
        const table = element.closest<HTMLElement>('.docx-table-block');
        if (table) {
          return element === table || element.matches('.docx-image');
        }
        if (element.closest(FEISHU_ATTACHMENT_SELECTOR)) return false;
        if (element.classList.contains('docx-image-block')) return false;
        if (element.classList.contains('docx-page-block')) return false;
        if (element.matches('[class*="docx-heading"]')) return true;
        return !(
          element.hasAttribute('data-block-id') &&
          element.querySelector('.block[data-block-id]')
        );
      });
    return elements
      .map((element, index) =>
        withDocumentPosition(
          elementToBlock(element, index),
          element,
          root,
          scrollContainer,
        ),
      )
      .filter((block): block is SnapshotBlock => Boolean(block))
      .filter(
        (block) =>
          block.type === 'image' ||
          Boolean(block.text) ||
          Boolean(block.items) ||
          Boolean(block.rows) ||
          block.type === 'divider',
      );
  }
  const elements = Array.from(root.querySelectorAll(DOCUMENT_BLOCK_SELECTOR))
    .filter((element) => isVisible(element) && !element.closest('[aria-hidden="true"]'));
  const elementSet = new Set(elements);
  return elements
    .filter((element) => {
      const text = textOf(element);
      if (!text && element.tagName.toLowerCase() !== 'img') return false;
      return !Array.from(element.children).some(
        (child) => elementSet.has(child) && textOf(child) === text,
      );
    })
    .map((element, index) =>
      withDocumentPosition(
        elementToBlock(element, index),
        element,
        root,
        scrollContainer,
      ),
    )
    .filter((block): block is SnapshotBlock => Boolean(block))
    .filter(
      (block) =>
        block.type === 'image' ||
        Boolean(block.text) ||
        Boolean(block.items) ||
        Boolean(block.rows) ||
        block.type === 'divider',
    );
}

function mergeCapturedBlock(previous: SnapshotBlock | undefined, next: SnapshotBlock) {
  if (!previous) return next;
  if (previous.type !== 'table' || next.type !== 'table') {
    if (previous.asset_id && !next.asset_id) next.asset_id = previous.asset_id;
    return next;
  }
  const previousRows = Array.isArray(previous.rows) ? previous.rows as unknown[][] : [];
  const nextRows = Array.isArray(next.rows) ? next.rows as unknown[][] : [];
  const rowCount = Math.max(previousRows.length, nextRows.length);
  const rows = Array.from({ length: rowCount }, (_, rowIndex) => {
    const previousRow = previousRows[rowIndex] || [];
    const nextRow = nextRows[rowIndex] || [];
    const columnCount = Math.max(previousRow.length, nextRow.length);
    return Array.from({ length: columnCount }, (_, columnIndex) => {
      const nextCell = nextRow[columnIndex];
      return String(nextCell || '').trim() ? nextCell : previousRow[columnIndex] || '';
    });
  });
  return { ...next, rows };
}

function currentDocumentRoot(fallback: HTMLElement) {
  if (!isFeishuDocument()) return fallback;
  const next = documentRoot();
  return next.isConnected ? next : fallback;
}

function blockFingerprint(block: SnapshotBlock) {
  const stableId = String(block.id || '');
  if (stableId && !/^b\d+$/.test(stableId)) return `id:${stableId}`;
  return JSON.stringify([
    block.type,
    block.level || '',
    block.text || '',
    block.items || '',
    block.rows || '',
    block.source_url || '',
  ]);
}

function waitForDocumentPaint() {
  return new Promise<void>((resolve) =>
    window.setTimeout(resolve, DOCUMENT_PAINT_DELAY_MS),
  );
}

function reportCaptureProgress(message: string) {
  void chrome.runtime
    .sendMessage({ type: 'CAPTURE_PROGRESS', message })
    .catch(() => undefined);
}

async function waitForDocumentReady() {
  let previousHeight = 0;
  let stableCount = 0;
  let root = documentRoot();
  let scrollContainer = scrollContainerFor(root);

  for (let attempt = 0; attempt < 40; attempt += 1) {
    root = documentRoot();
    scrollContainer = scrollContainerFor(root);
    const height = scrollContainer.scrollHeight;
    const hasContent =
      root.querySelector('.docx-image, .page-block-content, [data-block-id]') !== null;
    stableCount =
      hasContent && Math.abs(height - previousHeight) < 5
        ? stableCount + 1
        : 0;
    if (stableCount >= 3) return { root, scrollContainer };
    previousHeight = height;
    await new Promise<void>((resolve) => window.setTimeout(resolve, 500));
  }

  if (isFeishuDocument()) {
    throw new Error('飞书正文仍在加载，未检测到稳定的文档内容。请稍后重试。');
  }
  return { root, scrollContainer };
}

function setDocumentScrollTop(container: HTMLElement, value: number) {
  container.scrollTop = value;
  container.dispatchEvent(new Event('scroll', { bubbles: true }));
}

function foldBlockIdentity(wrapper: HTMLElement) {
  const block = wrapper.closest<HTMLElement>('[data-record-id], [data-block-id]');
  const title = Array.from(block?.children || [])
    .filter((child) => !child.classList.contains('fold-wrapper'))
    .map((child) => cleanText(child.textContent || ''))
    .find(Boolean);
  if (title) return `title:${title}`;
  const recordId = block?.getAttribute('data-record-id');
  if (recordId) return `record:${recordId}`;
  const blockId = block?.getAttribute('data-block-id');
  if (blockId) return `block:${blockId}`;
  return (
    wrapper.className.match(/(?:^|\s)fold-block-id-([^\s]+)/)?.[1]
      ? `legacy:${wrapper.className.match(/(?:^|\s)fold-block-id-([^\s]+)/)?.[1]}`
      : ''
  );
}

function clickFoldHandler(wrapper: HTMLElement) {
  const handler = wrapper.querySelector<HTMLElement>('.fold-handler');
  if (!handler) return false;
  handler.click();
  return true;
}

function hasVisibleFoldHandler(wrapper: HTMLElement) {
  const handler = wrapper.querySelector<HTMLElement>('.fold-handler');
  return Boolean(handler && isVisible(handler));
}

async function expandVisibleFoldedBlocks(
  root: HTMLElement,
  originallyFolded: Set<string>,
) {
  let expanded = 0;
  for (let round = 0; round < 8; round += 1) {
    const folded = Array.from(
      root.querySelectorAll<HTMLElement>(
        '.fold-wrapper.fold-folded:not(.fold-handler-wrapper)',
      ),
    ).filter(hasVisibleFoldHandler);
    if (!folded.length) break;
    let changed = 0;
    for (const wrapper of folded) {
      const identity = foldBlockIdentity(wrapper);
      if (!identity || !clickFoldHandler(wrapper)) continue;
      originallyFolded.add(identity);
      changed += 1;
      expanded += 1;
    }
    if (!changed) break;
    await waitForDocumentPaint();
  }
  return expanded;
}

async function restoreFoldedBlocks(
  scrollContainer: HTMLElement,
  blockIds: Set<string>,
) {
  const remaining = new Set(blockIds);
  if (!remaining.size) return 0;
  setDocumentScrollTop(scrollContainer, 0);
  await waitForDocumentPaint();

  for (let screen = 0; screen < 300 && remaining.size; screen += 1) {
    const root = documentRoot();
    const expanded = Array.from(
      root.querySelectorAll<HTMLElement>(
        '.fold-wrapper.can-fold:not(.fold-folded):not(.fold-handler-wrapper)',
      ),
    );
    let restored = 0;
    for (const wrapper of expanded) {
      const identity = foldBlockIdentity(wrapper);
      if (!remaining.has(identity) || !clickFoldHandler(wrapper)) continue;
      remaining.delete(identity);
      restored += 1;
    }
    if (restored) await waitForDocumentPaint();
    const maxScrollTop = Math.max(
      0,
      scrollContainer.scrollHeight - scrollContainer.clientHeight,
    );
    if (scrollContainer.scrollTop >= maxScrollTop - 8) break;
    const next = Math.min(
      maxScrollTop,
      scrollContainer.scrollTop + Math.max(scrollContainer.clientHeight * 0.65, 400),
    );
    if (next <= scrollContainer.scrollTop) break;
    setDocumentScrollTop(scrollContainer, next);
    await waitForDocumentPaint();
  }
  return remaining.size;
}

async function hydrateCapturedTables(
  root: HTMLElement,
  scrollContainer: HTMLElement,
  collected: Map<string, SnapshotBlock>,
) {
  const targets = Array.from(collected.values())
    .filter((block) => block.type === 'table')
    .map((block) => ({
      top: Number(block.__documentTop),
      height: Number(block.__documentHeight),
    }))
    .filter((target) => Number.isFinite(target.top) && Number.isFinite(target.height))
    .sort((left, right) => left.top - right.top);
  const maxScrollTop = Math.max(
    0,
    scrollContainer.scrollHeight - scrollContainer.clientHeight,
  );
  for (const target of targets) {
    const positions = Array.from(
      new Set(
        [
          target.top - scrollContainer.clientHeight * 0.2,
          target.top + target.height / 2 - scrollContainer.clientHeight / 2,
          target.top + target.height - scrollContainer.clientHeight * 0.8,
        ].map((position) => Math.max(0, Math.min(maxScrollTop, position))),
      ),
    );
    for (const position of positions) {
      setDocumentScrollTop(scrollContainer, position);
      await waitForDocumentPaint();
      for (const block of documentBlocks(currentDocumentRoot(root), scrollContainer)) {
        if (block.type !== 'table') continue;
        const fingerprint = blockFingerprint(block);
        collected.set(
          fingerprint,
          mergeCapturedBlock(collected.get(fingerprint), block),
        );
      }
    }
  }
}

async function collectDocument() {
  const { root, scrollContainer } = await waitForDocumentReady();
  if (
    isFeishuDocument() &&
    /catalogue__scroller|catalogue-container|outline__scroller|sidebar__scroller|side-panel__scroller/i.test(
      `${scrollContainer.id} ${scrollContainer.className}`,
    )
  ) {
    throw new Error('误识别到飞书目录滚动容器，已停止采集。');
  }
  const initialClientHeight = scrollContainer.clientHeight;
  const initialScrollHeight = scrollContainer.scrollHeight;
  const originalScrollTop = scrollContainer.scrollTop;
  const collected = new Map<string, SnapshotBlock>();
  const assets: CapturedAsset[] = [];
  const assetWarnings: string[] = [];
  const assetByUrl = new Map<string, string>();
  const originallyFolded = new Set<string>();
  let screens = 0;
  let passes = 0;
  let expandedFoldCount = 0;
  let unrestoredFoldCount = 0;

  try {
    const maxPasses = isFeishuDocument() ? 3 : 1;
    for (let pass = 0; pass < maxPasses; pass += 1) {
      reportCaptureProgress(`正在扫描正文，第 ${pass + 1} 轮...`);
      const sizeAtPassStart = collected.size;
      const heightAtPassStart = scrollContainer.scrollHeight;
      let noGrowthCount = 0;
      let passScreens = 0;
      setDocumentScrollTop(scrollContainer, 0);
      await waitForDocumentPaint();
      while (passScreens < 240) {
        expandedFoldCount += await expandVisibleFoldedBlocks(
          currentDocumentRoot(root),
          originallyFolded,
        );
        const before = collected.size;
        const visibleBlocks = documentBlocks(currentDocumentRoot(root), scrollContainer);
        const visibleAssets = await collectAssets(visibleBlocks, assetByUrl);
        assets.push(...visibleAssets.assets);
        assetWarnings.push(...visibleAssets.warnings);
        for (const block of visibleBlocks) {
          const fingerprint = blockFingerprint(block);
          const previous = collected.get(fingerprint);
          collected.set(fingerprint, mergeCapturedBlock(previous, block));
        }
        noGrowthCount = collected.size === before ? noGrowthCount + 1 : 0;
        const maxScrollTop = Math.max(
          0,
          scrollContainer.scrollHeight - scrollContainer.clientHeight,
        );
        if (
          scrollContainer.scrollTop >= maxScrollTop - 8 ||
          (!isFeishuDocument() && noGrowthCount >= 12)
        ) {
          break;
        }
        const next = Math.min(
          maxScrollTop,
          scrollContainer.scrollTop +
            Math.max(
              scrollContainer.clientHeight * (1 - DOCUMENT_SCROLL_OVERLAP_RATIO),
              320,
            ),
        );
        if (next <= scrollContainer.scrollTop) break;
        setDocumentScrollTop(scrollContainer, next);
        passScreens += 1;
        screens += 1;
        if (passScreens % 20 === 0) {
          reportCaptureProgress(
            `正在扫描正文，第 ${pass + 1} 轮 ${passScreens} 屏，已读取 ${collected.size} 个块...`,
          );
        }
        await waitForDocumentPaint();
      }
      passes += 1;
      if (
        isFeishuDocument() &&
        pass >= 1 &&
        collected.size === sizeAtPassStart &&
        Math.abs(scrollContainer.scrollHeight - heightAtPassStart) < 5
      ) {
        break;
      }
    }
    if (isFeishuDocument()) {
      reportCaptureProgress('正文扫描完成，正在补全表格...');
      await hydrateCapturedTables(root, scrollContainer, collected);
    }
  } finally {
    if (isFeishuDocument()) {
      unrestoredFoldCount = await restoreFoldedBlocks(
        scrollContainer,
        originallyFolded,
      );
    }
    setDocumentScrollTop(scrollContainer, originalScrollTop);
  }

  const orderedBlocks = Array.from(collected.values())
    .map((block, index) => ({ block, index }))
    .sort((left, right) => {
      const leftBlockOrder = Number(left.block.__documentBlockOrder);
      const rightBlockOrder = Number(right.block.__documentBlockOrder);
      if (
        Number.isFinite(leftBlockOrder) &&
        Number.isFinite(rightBlockOrder) &&
        leftBlockOrder !== rightBlockOrder
      ) {
        return leftBlockOrder - rightBlockOrder;
      }
      const leftTop = Number(left.block.__documentTop);
      const rightTop = Number(right.block.__documentTop);
      if (Number.isFinite(leftTop) && Number.isFinite(rightTop) && leftTop !== rightTop) {
        return leftTop - rightTop;
      }
      const leftOffset = Number(left.block.__documentLeft);
      const rightOffset = Number(right.block.__documentLeft);
      if (
        Number.isFinite(leftOffset) &&
        Number.isFinite(rightOffset) &&
        leftOffset !== rightOffset
      ) {
        return leftOffset - rightOffset;
      }
      return left.index - right.index;
    })
    .map(({ block }) => block);

  return {
    blocks: orderedBlocks.map((block, index) => {
      const {
        __documentBlockOrder: _blockOrder,
        __documentTop: _top,
        __documentLeft: _left,
        __documentHeight: _height,
        ...content
      } = block;
      return { ...content, id: `b${index + 1}` };
    }),
    screens: screens + 1,
    passes,
    scrollContainer: scrollContainer.className || scrollContainer.tagName,
    scrollDimensions: `${initialClientHeight}/${initialScrollHeight}`,
    assets,
    assetWarnings: Array.from(new Set(assetWarnings)),
    expandedFoldCount,
    unrestoredFoldCount,
  };
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  const size = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += size) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + size));
  }
  return btoa(binary);
}

async function fetchAsset(url: string) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 10_000);
  try {
    return await fetch(url, { credentials: 'include', signal: controller.signal });
  } finally {
    window.clearTimeout(timeout);
  }
}

async function collectAssets(
  blocks: SnapshotBlock[],
  byUrl = new Map<string, string>(),
) {
  const assets: CapturedAsset[] = [];
  const warnings: string[] = [];
  for (const block of blocks) {
    if (block.type !== 'image' || typeof block.source_url !== 'string') continue;
    const previous = byUrl.get(block.source_url);
    if (previous) {
      if (previous !== block.source_url) block.asset_id = previous;
      continue;
    }
    if (/^https?:\/\//.test(block.source_url)) {
      byUrl.set(block.source_url, block.source_url);
      assets.push({ sourceUrl: block.source_url });
      continue;
    }
    try {
      const response = await fetchAsset(block.source_url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength > 20 * 1024 * 1024) throw new Error('图片超过 20 MB');
      const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
        .map((value) => value.toString(16).padStart(2, '0'))
        .join('');
      const assetId = `sha256:${digest}`;
      block.asset_id = assetId;
      byUrl.set(block.source_url, assetId);
      assets.push({
        sourceUrl: block.source_url,
        id: assetId,
        contentType: response.headers.get('content-type') || 'application/octet-stream',
        data: bytesToBase64(bytes),
      });
    } catch (error) {
      warnings.push(`图片采集失败：${block.source_url}（${String(error)}）`);
    }
  }
  return { assets, warnings };
}

async function capture(mode: CaptureMode) {
  const selected = selectionRoot();
  let adapter = 'visible-page';
  let root: ParentNode = document.body;
  let title = cleanTitle(document.title);
  let visibleOnly = true;
  let blocks: SnapshotBlock[] | null = null;
  let assets: CapturedAsset[] | null = null;
  let assetWarnings: string[] = [];
  const warnings: string[] = [];

  if (mode === 'selection' || (mode === 'auto' && selected && textOf(selected).length >= 20)) {
    if (!selected) throw new Error('当前页面没有选中内容。');
    root = selected;
    adapter = 'selection';
    visibleOnly = false;
  } else if (mode === 'document' || (mode === 'auto' && isFeishuDocument())) {
    const documentResult = await collectDocument();
    blocks = documentResult.blocks;
    assets = documentResult.assets;
    assetWarnings = documentResult.assetWarnings;
    adapter = isFeishuDocument() ? 'feishu-document' : 'generic-document';
    if (isFeishuDocument()) title = feishuDocumentTitle();
    if (documentResult.screens > 1) {
      warnings.push(`已滚动采集 ${documentResult.screens} 屏内容。`);
    }
    warnings.push(`滚动容器：${documentResult.scrollContainer}`);
    warnings.push(`滚动尺寸：${documentResult.scrollDimensions}`);
    warnings.push(`滚动轮次：${documentResult.passes}`);
    if (documentResult.expandedFoldCount) {
      warnings.push(`已展开并采集 ${documentResult.expandedFoldCount} 个折叠区块。`);
    }
    if (documentResult.unrestoredFoldCount) {
      warnings.push(
        `${documentResult.unrestoredFoldCount} 个折叠区块未能恢复原状态。`,
      );
    }
  } else if (mode === 'article' || mode === 'auto') {
    const article = articleRoot();
    if (article) {
      root = article.root;
      title = article.title;
      adapter = 'readability';
      visibleOnly = false;
    }
  }

  blocks ||= topLevelBlocks(root, visibleOnly)
    .map(elementToBlock)
    .filter((block): block is SnapshotBlock => Boolean(block))
    .filter((block) => block.type === 'image' || Boolean(block.text) || Boolean(block.items) || Boolean(block.rows) || block.type === 'divider');
  if (!blocks.length) throw new Error('当前模式没有采集到可阅读内容。');
  const textLength = blocks.reduce(
    (total, block) => total + String(block.text || '').length,
    0,
  );
  if (adapter === 'feishu-document' && textLength < 500) {
    throw new Error('飞书正文少于 500 字，页面可能未完成渲染。请保持文档窗口可见后重试。');
  }
  const assetResult = assets
    ? { assets, warnings: assetWarnings }
    : await collectAssets(blocks);
  warnings.push(...assetResult.warnings);
  if (adapter === 'feishu-document') {
    const imageCount = blocks.filter((block) => block.type === 'image').length;
    warnings.push(
      `页面结构：${blocks.length} 个块，${textLength} 个文字，${imageCount} 张图片。`,
    );
  }
  return {
    snapshot: {
      title,
      source_url: location.href,
      site_name: location.hostname,
      captured_at: new Date().toISOString(),
      adapter,
      blocks,
      warnings,
    },
    assets: assetResult.assets,
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'CAPTURE_PAGE_V2') return;
  capture(message.mode)
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((error) => sendResponse({ ok: false, error: String(error.message || error) }));
  return true;
});
