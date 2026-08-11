import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Vditor from 'vditor';
import 'vditor/dist/index.css';
import {
  CloseOutlined,
  HistoryOutlined,
  RollbackOutlined,
  UnorderedListOutlined,
} from '@ant-design/icons';
import {
  Button,
  Drawer,
  Empty,
  Input,
  List,
  Popconfirm,
  Space,
  Spin,
  Tag,
  Typography,
  message,
} from 'antd';
import {
  getMaterialDraftVersion,
  getMaterialDraftVersions,
  restoreMaterialDraftVersion,
  updateMaterialDraft,
} from '../../api';
import type {
  MaterialDraft,
  MaterialDraftVersion,
  MaterialDraftVersionSummary,
} from '../../api';
import { useSiteTheme } from '../../appearance';
import './material-draft.css';

interface Props {
  draft: MaterialDraft;
  open: boolean;
  onClose: () => void;
  onSaved: (draft: MaterialDraft) => void;
}

type SaveState = 'saved' | 'dirty' | 'saving' | 'error';

interface DraftHeading {
  depth: number;
  index: number;
  label: string;
}

interface ToolbarHint {
  text: string;
  left: number;
  top: number;
}

const VDITOR_CDN = '/vditor';

const VDITOR_TOOLBAR = [
  'emoji',
  'headings',
  'bold',
  'italic',
  'strike',
  'link',
  '|',
  'list',
  'ordered-list',
  'check',
  'outdent',
  'indent',
  '|',
  'quote',
  'line',
  'code',
  'inline-code',
  'insert-before',
  'insert-after',
  '|',
  'table',
  '|',
  'undo',
  'redo',
  '|',
  'fullscreen',
  'edit-mode',
  {
    name: 'more',
    toolbar: [
      'both',
      'code-theme',
      'content-theme',
      'export',
      'preview',
      'info',
      'help',
    ],
  },
];

const saveStateLabels: Record<SaveState, string> = {
  saved: '已保存',
  dirty: '等待自动保存',
  saving: '正在保存',
  error: '保存失败',
};

function extractHeadings(markdown: string): DraftHeading[] {
  const headings: DraftHeading[] = [];
  let codeFence = '';

  markdown.split('\n').forEach((line) => {
    const fence = line.match(/^\s*(`{3,}|~{3,})/);
    if (fence) {
      if (!codeFence) codeFence = fence[1][0];
      else if (fence[1][0] === codeFence) codeFence = '';
      return;
    }
    if (codeFence) return;

    const match = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (!match) return;
    const label = match[2]
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/[*_~`]/g, '')
      .trim();
    if (!label) return;
    headings.push({
      depth: match[1].length,
      index: headings.length,
      label,
    });
  });

  return headings;
}

function getVisibleHeadings(host: HTMLElement) {
  const surface = Array.from(
    host.querySelectorAll<HTMLElement>(
      '.vditor-wysiwyg, .vditor-ir, .vditor-preview',
    ),
  ).find((item) => item.offsetParent !== null);
  return {
    surface,
    headings: surface?.querySelectorAll('h1, h2, h3, h4, h5, h6'),
  };
}

export default function MaterialDraftEditor({
  draft,
  open,
  onClose,
  onSaved,
}: Props) {
  const [title, setTitle] = useState(draft.title);
  const [content, setContent] = useState(draft.content);
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [versions, setVersions] = useState<MaterialDraftVersionSummary[]>([]);
  const [selectedVersion, setSelectedVersion] = useState<MaterialDraftVersion | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [restoringId, setRestoringId] = useState<number | null>(null);
  const [tocOpen, setTocOpen] = useState(() => window.innerWidth >= 1100);
  const [activeHeadingIndex, setActiveHeadingIndex] = useState<number | null>(null);
  const [toolbarHint, setToolbarHint] = useState<ToolbarHint | null>(null);
  const lastSaved = useRef(JSON.stringify([draft.title, draft.content]));
  const saveTimer = useRef<number | null>(null);
  const editorHostRef = useRef<HTMLDivElement>(null);
  const tocRef = useRef<HTMLElement>(null);
  const editorRef = useRef<Vditor | null>(null);
  const initialContentRef = useRef(draft.content);
  const { option } = useSiteTheme();
  const darkThemeRef = useRef(option.dark);
  darkThemeRef.current = option.dark;
  const headings = useMemo(() => extractHeadings(content), [content]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  useEffect(() => {
    const editorHost = editorHostRef.current;
    if (!open || !editorHost) return;

    let disposed = false;
    let initialized = false;
    let animationFrame = 0;
    let syncActiveHeading: () => void = () => undefined;
    const showToolbarHint = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const button = target.closest<HTMLElement>('.vditor-toolbar [aria-label]');
      const text = button?.getAttribute('aria-label');
      if (!button || !text) return;
      const rect = button.getBoundingClientRect();
      setToolbarHint({
        text,
        left: Math.min(Math.max(rect.left + rect.width / 2, 80), window.innerWidth - 80),
        top: rect.bottom + 6,
      });
    };
    const hideToolbarHint = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const button = target.closest<HTMLElement>('.vditor-toolbar [aria-label]');
      if (!button) return;
      const relatedTarget = event.relatedTarget;
      if (relatedTarget instanceof Node && button.contains(relatedTarget)) return;
      setToolbarHint(null);
    };
    editorHost.addEventListener('mouseover', showToolbarHint);
    editorHost.addEventListener('mouseout', hideToolbarHint);
    const editor = new Vditor(editorHost, {
      cdn: VDITOR_CDN,
      value: initialContentRef.current,
      mode: 'wysiwyg',
      height: '100%',
      lang: 'zh_CN',
      icon: 'ant',
      theme: darkThemeRef.current ? 'dark' : 'classic',
      cache: { enable: false },
      counter: { enable: true, type: 'markdown' },
      outline: { enable: false, position: 'right' },
      resize: { enable: false },
      toolbar: VDITOR_TOOLBAR,
      toolbarConfig: { pin: false },
      placeholder: '开始写作。停止输入约 5 秒后自动保存。',
      preview: {
        hljs: { style: darkThemeRef.current ? 'github-dark' : 'github' },
        theme: {
          current: darkThemeRef.current ? 'dark' : 'ant-design',
          path: `${VDITOR_CDN}/dist/css/content-theme`,
        },
      },
      input: (value) => {
        setContent(value);
        window.cancelAnimationFrame(animationFrame);
        animationFrame = window.requestAnimationFrame(syncActiveHeading);
      },
      after: () => {
        initialized = true;
        if (disposed) {
          editor.destroy();
          return;
        }
        editorRef.current = editor;
        if (editorHost) {
          syncActiveHeading = () => {
            const { surface, headings: headingElements } = getVisibleHeadings(editorHost);
            if (!surface || !headingElements?.length) {
              setActiveHeadingIndex(null);
              return;
            }

            const surfaceTop = surface.getBoundingClientRect().top;
            let activeIndex = 0;
            headingElements.forEach((heading, index) => {
              if (heading.getBoundingClientRect().top <= surfaceTop + 48) {
                activeIndex = index;
              }
            });
            setActiveHeadingIndex(activeIndex);
          };
          editorHost.addEventListener('scroll', syncActiveHeading, true);
          syncActiveHeading();
        }
        editor.setTheme(
          darkThemeRef.current ? 'dark' : 'classic',
          darkThemeRef.current ? 'dark' : 'ant-design',
          darkThemeRef.current ? 'github-dark' : 'github',
          `${VDITOR_CDN}/dist/css/content-theme`,
        );
      },
    });

    return () => {
      disposed = true;
      window.cancelAnimationFrame(animationFrame);
      editorHost.removeEventListener('mouseover', showToolbarHint);
      editorHost.removeEventListener('mouseout', hideToolbarHint);
      editorHost.removeEventListener('scroll', syncActiveHeading, true);
      setToolbarHint(null);
      if (editorRef.current === editor) editorRef.current = null;
      if (initialized) editor.destroy();
    };
  }, [draft.id, open]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!open || !editor) return;
    editor.setTheme(
      option.dark ? 'dark' : 'classic',
      option.dark ? 'dark' : 'ant-design',
      option.dark ? 'github-dark' : 'github',
      `${VDITOR_CDN}/dist/css/content-theme`,
    );
  }, [open, option.dark]);

  useEffect(() => {
    if (!tocOpen || activeHeadingIndex === null) return;
    tocRef.current
      ?.querySelector<HTMLElement>('nav button.active')
      ?.scrollIntoView({ block: 'nearest' });
  }, [activeHeadingIndex, tocOpen]);

  const save = useCallback(async () => {
    if (saveTimer.current !== null) {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    const signature = JSON.stringify([title, content]);
    if (signature === lastSaved.current) {
      setSaveState('saved');
      return true;
    }
    setSaveState('saving');
    try {
      const response = await updateMaterialDraft(draft.id, { title, content });
      lastSaved.current = signature;
      setSaveState('saved');
      onSaved(response.data);
      return true;
    } catch {
      setSaveState('error');
      message.error('草稿保存失败，请检查服务后继续');
      return false;
    }
  }, [content, draft.id, onSaved, title]);

  useEffect(() => {
    if (!open) return;
    const signature = JSON.stringify([title, content]);
    if (signature === lastSaved.current) return;
    setSaveState('dirty');
    saveTimer.current = window.setTimeout(() => {
      saveTimer.current = null;
      void save();
    }, 5000);
    return () => {
      if (saveTimer.current !== null) {
        window.clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }
    };
  }, [content, open, save, title]);

  useEffect(() => {
    if (!open) return;
    const saveWithShortcut = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 's') return;
      event.preventDefault();
      void save().then((saved) => {
        if (saved) message.success('草稿已保存');
      });
    };
    document.addEventListener('keydown', saveWithShortcut);
    return () => document.removeEventListener('keydown', saveWithShortcut);
  }, [open, save]);

  useEffect(() => {
    if (!open) return;
    const saveWhenHidden = () => {
      if (document.visibilityState === 'hidden') void save();
    };
    window.addEventListener('pagehide', saveWhenHidden);
    document.addEventListener('visibilitychange', saveWhenHidden);
    return () => {
      window.removeEventListener('pagehide', saveWhenHidden);
      document.removeEventListener('visibilitychange', saveWhenHidden);
    };
  }, [open, save]);

  const close = async () => {
    if (await save()) onClose();
  };

  const loadVersions = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const response = await getMaterialDraftVersions(draft.id);
      setVersions(response.data.results);
      setSelectedVersion((current) =>
        response.data.results.some((version) => version.id === current?.id)
          ? current
          : null,
      );
    } catch {
      message.error('加载版本历史失败');
    } finally {
      setHistoryLoading(false);
    }
  }, [draft.id]);

  const openHistory = async () => {
    if (!(await save())) return;
    setHistoryOpen(true);
    await loadVersions();
  };

  const viewVersion = async (version: MaterialDraftVersionSummary) => {
    setHistoryLoading(true);
    try {
      const response = await getMaterialDraftVersion(version.id);
      setSelectedVersion(response.data);
    } catch {
      message.error('加载版本内容失败');
    } finally {
      setHistoryLoading(false);
    }
  };

  const restore = async (version: MaterialDraftVersionSummary) => {
    setRestoringId(version.id);
    try {
      const response = await restoreMaterialDraftVersion(version.id);
      setTitle(response.data.title);
      setContent(response.data.content);
      editorRef.current?.setValue(response.data.content, true);
      lastSaved.current = JSON.stringify([response.data.title, response.data.content]);
      setSaveState('saved');
      onSaved(response.data);
      await loadVersions();
      message.success(`已将版本 ${version.version_number} 恢复为当前版本`);
    } catch {
      message.error('恢复版本失败');
    } finally {
      setRestoringId(null);
    }
  };

  const scrollToHeading = (heading: DraftHeading) => {
    const host = editorHostRef.current;
    const headingElements = host ? getVisibleHeadings(host).headings : undefined;
    setActiveHeadingIndex(heading.index);
    headingElements?.[heading.index]?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    });
  };

  if (!open) return null;

  return (
    <div
      className={option.dark ? 'dark-theme material-draft-editor' : 'material-draft-editor'}
      style={{ '--material-draft-surface': option.color } as CSSProperties}
      role="dialog"
      aria-modal="true"
      aria-label="Markdown 沉浸写作"
    >
      <header className="material-draft-editor__header">
        <Input
          className="material-draft-editor__title"
          value={title}
          maxLength={255}
          variant="borderless"
          placeholder="输入材料标题"
          aria-label="输入材料标题"
          onChange={(event) => setTitle(event.target.value)}
        />
        <Space wrap>
          <Tag color={saveState === 'error' ? 'error' : saveState === 'saved' ? 'success' : 'processing'}>
            {saveStateLabels[saveState]}
          </Tag>
          <Button
            icon={<UnorderedListOutlined />}
            type={tocOpen ? 'primary' : 'default'}
            ghost={tocOpen}
            onClick={() => setTocOpen((current) => !current)}
          >
            目录
          </Button>
          <Button icon={<HistoryOutlined />} onClick={() => void openHistory()}>
            版本历史
          </Button>
          <Button
            type="text"
            icon={<CloseOutlined />}
            aria-label="关闭编辑器"
            onClick={() => void close()}
          />
        </Space>
      </header>
      <div className="material-draft-editor__workspace">
        <div ref={editorHostRef} className="material-draft-editor__vditor" />
        {tocOpen && (
          <aside ref={tocRef} className="material-draft-editor__toc" aria-label="文档目录">
            <div className="material-draft-editor__toc-header">
              <Typography.Text strong>目录</Typography.Text>
              <Button
                type="text"
                size="small"
                icon={<CloseOutlined />}
                aria-label="收起目录"
                onClick={() => setTocOpen(false)}
              />
            </div>
            {!headings.length ? (
              <Typography.Text type="secondary" className="material-draft-editor__toc-empty">
                使用标题后自动生成
              </Typography.Text>
            ) : (
              <nav>
                {headings.map((heading) => (
                  <button
                    key={`${heading.index}-${heading.label}`}
                    type="button"
                    className={activeHeadingIndex === heading.index ? 'active' : undefined}
                    aria-current={activeHeadingIndex === heading.index ? 'location' : undefined}
                    style={{ paddingInlineStart: 10 + (heading.depth - 1) * 12 }}
                    title={heading.label}
                    onClick={() => scrollToHeading(heading)}
                  >
                    {heading.label}
                  </button>
                ))}
              </nav>
            )}
          </aside>
        )}
      </div>
      {toolbarHint && (
        <div
          className="material-draft-editor__toolbar-hint"
          role="tooltip"
          style={{ left: toolbarHint.left, top: toolbarHint.top }}
        >
          {toolbarHint.text}
        </div>
      )}

      <Drawer
        title={`版本历史 (${versions.length})`}
        open={historyOpen}
        size={680}
        zIndex={2100}
        onClose={() => {
          setHistoryOpen(false);
          setSelectedVersion(null);
        }}
      >
        <Spin spinning={historyLoading}>
          {!versions.length ? (
            <Empty description="连续编辑会保存在当前版本；间隔超过 10 分钟后再次修改，才会生成历史版本。" />
          ) : (
            <List
              dataSource={versions}
              renderItem={(version) => (
                <List.Item
                  actions={[
                    <Button key="view" type="link" onClick={() => void viewVersion(version)}>
                      查看
                    </Button>,
                    <Popconfirm
                      key="restore"
                      title={`恢复版本 ${version.version_number}？`}
                      description="当前内容会先保存为历史版本，再以该版本生成新的当前版本。"
                      onConfirm={() => void restore(version)}
                    >
                      <Button
                        type="link"
                        icon={<RollbackOutlined />}
                        loading={restoringId === version.id}
                      >
                        恢复
                      </Button>
                    </Popconfirm>,
                  ]}
                >
                  <List.Item.Meta
                    title={`版本 ${version.version_number} · ${version.title || '未命名'}`}
                    description={new Date(version.created_at).toLocaleString()}
                  />
                </List.Item>
              )}
            />
          )}
          {selectedVersion && (
            <div className="material-draft-editor__version-preview">
              <Typography.Title level={4}>
                版本 {selectedVersion.version_number}：{selectedVersion.title || '未命名'}
              </Typography.Title>
              <div className="topic-discussion__markdown">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {selectedVersion.content || '（空白版本）'}
                </ReactMarkdown>
              </div>
            </div>
          )}
        </Spin>
      </Drawer>
    </div>
  );
}
