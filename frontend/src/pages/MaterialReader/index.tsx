import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import ReactMarkdown from 'react-markdown';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import remarkGfm from 'remark-gfm';
import {
  Alert,
  Button,
  Collapse,
  Drawer,
  Empty,
  Form,
  Input,
  List,
  Modal,
  Popconfirm,
  Result,
  Segmented,
  Skeleton,
  Space,
  Spin,
  Switch,
  Tag,
  Tabs,
  Typography,
  message,
} from 'antd';
import {
  AppstoreOutlined,
  ArrowLeftOutlined,
  CheckOutlined,
  CompressOutlined,
  DeleteOutlined,
  EditOutlined,
  FileSearchOutlined,
  ReloadOutlined,
  SendOutlined,
} from '@ant-design/icons';
import {
  createConcept,
  createHighlight,
  createQuestion,
  deleteConcept,
  deleteHighlight,
  deleteQuestion,
  getAITask,
  getMaterialAnnotations,
  getSession,
  getTopic,
  listAITasks,
  retryAITask,
  triggerSupplement,
  updateConcept,
  updateHighlight,
  createSessionMessage,
} from '../../api';
import type {
  AITask,
  Concept,
  Highlight,
  Material,
  MaterialAnnotations,
  Question,
  Topic,
  Session,
} from '../../api';
import UniversalReader from '../../components/UniversalReader';
import type { ReaderFont, TextSelectionAnchor } from '../../components/UniversalReader';
import { useSiteTheme } from '../../appearance';
import { useMediaQuery } from '../../useMediaQuery';
import './styles.css';

const { Text } = Typography;
const readerFonts: ReaderFont[] = ['system', 'song', 'kai', 'serif'];

interface ReadingViewportAnchor {
  sourceOffset: number;
  top: number;
  scrollContainer: HTMLElement | null;
}

const MarkdownDigest: React.FC<{ content: string }> = ({ content }) => (
  <div className="reader-briefing__markdown">
    <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
  </div>
);

const MarkdownChatMessage: React.FC<{ content: string }> = ({ content }) => (
  <div className="material-reader__chat-markdown">
    <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
  </div>
);

const MaterialReader: React.FC = () => {
  const { topicId, materialId } = useParams<{ topicId: string; materialId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [topic, setTopic] = useState<Topic | null>(null);
  const [material, setMaterial] = useState<Material | null>(null);
  const [allAnnotations, setAllAnnotations] = useState<MaterialAnnotations>({
    concepts: [],
    questions: [],
    highlights: [],
  });
  const [annotationScope, setAnnotationScope] = useState<'topic' | 'all'>('topic');
  const [showHighlightNotes, setShowHighlightNotes] = useState(
    () => window.localStorage.getItem('reader-highlight-notes') !== 'hidden',
  );
  const isMobile = useMediaQuery('(max-width: 767px)');
  const [immersiveMode, setImmersiveMode] = useState(
    () => window.matchMedia('(max-width: 767px)').matches,
  );
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [tab, setTab] = useState('questions');
  const [selection, setSelection] = useState<TextSelectionAnchor | null>(null);
  const [questionDraft, setQuestionDraft] = useState('');
  const [chatDraft, setChatDraft] = useState('');
  const [task, setTask] = useState<AITask | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [conceptModal, setConceptModal] = useState(false);
  const [highlightModal, setHighlightModal] = useState(false);
  const {
    siteTheme: readerTheme,
    setSiteTheme: setReaderTheme,
    option: themeOption,
  } = useSiteTheme();
  const [readerFont, setReaderFont] = useState<ReaderFont>(() => {
    const saved = window.localStorage.getItem('reader-font');
    if (readerFonts.includes(saved as ReaderFont)) return saved as ReaderFont;
    const configuredDefault = import.meta.env.VITE_DEFAULT_READER_FONT;
    return readerFonts.includes(configuredDefault as ReaderFont)
      ? configuredDefault as ReaderFont
      : 'system';
  });
  const darkMode = themeOption.dark;
  const [editingConcept, setEditingConcept] = useState<Concept | null>(null);
  const [editingHighlight, setEditingHighlight] = useState<Highlight | null>(null);
  const [activeSession, setActiveSession] = useState<Session | null>(null);
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const viewportAnchorRef = useRef<ReadingViewportAnchor | null>(null);
  const [annotationRefreshVersion, setAnnotationRefreshVersion] = useState(0);

  const [conceptForm] = Form.useForm<Partial<Concept>>();
  const [highlightForm] = Form.useForm<{ user_note: string }>();

  const load = useCallback(async () => {
    if (!topicId || !materialId) return;
    setLoadError('');
    try {
      const [response, annotationsResponse] = await Promise.all([
        getTopic(Number(topicId)),
        getMaterialAnnotations(Number(materialId)),
      ]);
      setTopic(response.data);
      setAllAnnotations(annotationsResponse.data);
      const relation = response.data.topic_materials.find(
        (item) => item.material_id === Number(materialId),
      );
      setMaterial(relation?.material ?? null);
      if (!relation) setLoadError('该材料未关联到当前话题，可能已被移除。');
    } catch {
      setLoadError('无法加载学习材料，请检查后端服务后重试。');
      throw new Error('Failed to load material');
    } finally {
      setLoading(false);
    }
  }, [materialId, topicId]);

  const captureReadingPosition = useCallback(() => {
    const content = document.querySelector<HTMLElement>('.universal-reader__content');
    if (!content) return;
    const scrollContainer = content.classList.contains('universal-reader__transcript')
      ? content
      : null;
    const viewportTop = scrollContainer
      ? scrollContainer.getBoundingClientRect().top
      : 132;
    const viewportBottom = scrollContainer
      ? scrollContainer.getBoundingClientRect().bottom
      : window.innerHeight;
    const anchors = Array.from(
      content.querySelectorAll<HTMLElement>('[data-source-start], [data-start-offset]'),
    );
    const anchor = anchors.find((element) => {
      const rect = element.getBoundingClientRect();
      return rect.bottom > viewportTop && rect.top < viewportBottom;
    });
    if (!anchor) return;
    const sourceOffset = Number(
      anchor.dataset.sourceStart ?? anchor.dataset.startOffset,
    );
    if (!Number.isFinite(sourceOffset)) return;
    viewportAnchorRef.current = {
      sourceOffset,
      top: anchor.getBoundingClientRect().top,
      scrollContainer,
    };
  }, []);

  const refreshAnnotations = useCallback(async (preservePosition = false) => {
    if (!topicId || !materialId) return;
    if (preservePosition) captureReadingPosition();
    try {
      const [topicResponse, annotationsResponse] = await Promise.all([
        getTopic(Number(topicId)),
        getMaterialAnnotations(Number(materialId)),
      ]);
      setTopic(topicResponse.data);
      setAllAnnotations(annotationsResponse.data);
      setAnnotationRefreshVersion((current) => current + 1);
    } catch (error) {
      viewportAnchorRef.current = null;
      throw error;
    }
  }, [captureReadingPosition, materialId, topicId]);

  useLayoutEffect(() => {
    const savedAnchor = viewportAnchorRef.current;
    if (!savedAnchor) return;
    viewportAnchorRef.current = null;
    const content = document.querySelector<HTMLElement>('.universal-reader__content');
    const anchors = Array.from(
      content?.querySelectorAll<HTMLElement>(
        '[data-source-start], [data-start-offset]',
      ) ?? [],
    );
    const anchor = anchors.find((element) => {
      const start = Number(
        element.dataset.sourceStart ?? element.dataset.startOffset,
      );
      const end = Number(
        element.dataset.sourceEnd ?? element.dataset.endOffset ?? start + 1,
      );
      return start <= savedAnchor.sourceOffset && savedAnchor.sourceOffset < end;
    });
    if (!anchor) return;
    const delta = anchor.getBoundingClientRect().top - savedAnchor.top;
    if (savedAnchor.scrollContainer) {
      savedAnchor.scrollContainer.scrollTop += delta;
    } else {
      window.scrollBy({ top: delta, behavior: 'auto' });
    }
  }, [annotationRefreshVersion]);

  useEffect(() => {
    void load().catch(() => message.error('加载材料失败'));
  }, [load]);

  useEffect(() => {
    window.localStorage.setItem(
      'reader-highlight-notes',
      showHighlightNotes ? 'visible' : 'hidden',
    );
  }, [showHighlightNotes]);

  useEffect(() => {
    const enabled = isMobile && immersiveMode;
    document.body.classList.toggle('mobile-reader-immersive', enabled);
    return () => document.body.classList.remove('mobile-reader-immersive');
  }, [immersiveMode, isMobile]);

  useEffect(() => {
    window.localStorage.setItem('reader-font', readerFont);
  }, [readerFont]);

  useEffect(() => {
    if (material?.status !== 'generating_audio') return;
    const timer = window.setInterval(() => {
      void load().catch(() => undefined);
    }, 2000);
    return () => window.clearInterval(timer);
  }, [load, material?.status]);

  useEffect(() => {
    if (!task || !['pending', 'running'].includes(task.status)) return;
    const timer = window.setInterval(async () => {
      const response = await getAITask(task.id);
      setTask(response.data);
      if (['succeeded', 'failed'].includes(response.data.status)) {
        if (response.data.status === 'failed') {
          message.error(response.data.error_message || 'AI 任务失败');
        } else {
          message.success(`${response.data.task_type_display}已完成`);
        }
        await refreshAnnotations(true);
        if (activeSession) {
          const sessionResponse = await getSession(activeSession.id);
          setActiveSession(sessionResponse.data);
        }
      }
    }, 1500);
    return () => window.clearInterval(timer);
  }, [activeSession, refreshAnnotations, task]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ block: 'nearest' });
  }, [activeSession?.messages, task?.id, task?.status]);

  const currentTopicAnnotations = useMemo(() => {
    if (!topic || !material) {
      return { concepts: [] as Concept[], highlights: [] as Highlight[], questions: [] as Question[] };
    }
    const matchesMaterial = (locatorMaterial: number) => locatorMaterial === material.id;
    return {
      concepts: topic.concepts
        .map((concept) => ({
          ...concept,
          locators: concept.locators.filter((locator) => matchesMaterial(locator.material)),
        }))
        .filter((concept) => concept.locators.length),
      highlights: topic.highlights
        .map((highlight) => ({
          ...highlight,
          locators: highlight.locators.filter((locator) => matchesMaterial(locator.material)),
        }))
        .filter((highlight) => highlight.locators.length),
      questions: topic.questions
        .map((item) => ({
          ...item,
          locators: item.locators.filter((locator) => matchesMaterial(locator.material)),
        }))
        .filter((item) => item.locators.length),
    };
  }, [material, topic]);
  const scoped = annotationScope === 'all'
    ? allAnnotations
    : currentTopicAnnotations;

  const activeQuestion = useMemo(
    () => scoped.questions.find((item) => item.session === activeSession?.id) ?? null,
    [activeSession?.id, scoped.questions],
  );
  const activeQuestionTask =
    task?.task_type === 'answer_question' &&
    ['pending', 'running'].includes(task.status) &&
    Number(task.task_data.question_id) === activeQuestion?.id
      ? task
      : null;

  const jumpToSource = (locatorId: number) => {
    navigate(`?locator=${locatorId}&t=${Date.now()}`, { replace: true });
  };

  const loadSession = useCallback(async (sessionId: number) => {
    if (!sessionId) {
      console.error('Invalid session ID');
      return;
    }
    try {
      setChatLoading(true);
      const response = await getSession(sessionId);
      setActiveSession(response.data);
      const latestUserMessage = [...response.data.messages]
        .reverse()
        .find((item) => item.msg_from === 'user');
      if (latestUserMessage) {
        const tasksResponse = await listAITasks({
          trigger_type: 'SessionMessage',
          trigger_id: latestUserMessage.id,
          task_type: 'answer_question',
        });
        const activeTask = tasksResponse.data.results.find((item) =>
          ['pending', 'running'].includes(item.status),
        );
        if (activeTask) setTask((await getAITask(activeTask.id)).data);
      }
    } catch (error) {
      console.error('Failed to load session:', error);
      message.error('加载对话失败，请重试');
    } finally {
      setChatLoading(false);
    }
  }, []);

  const handleSendChat = async () => {
    if (!activeSession || !chatDraft.trim() || activeQuestionTask) return;
    try {
      setChatLoading(true);
      const content = chatDraft.trim();
      setChatDraft('');
      const response = await createSessionMessage(activeSession.id, content);
      setTask(response.data.task);
      // Update session with new user message
      setActiveSession(prev => prev ? {
        ...prev,
        messages: [...prev.messages, response.data.message]
      } : null);
    } catch (error) {
      console.error('Send message failed:', error);
      message.error('发送消息失败');
    } finally {
      setChatLoading(false);
    }
  };

  const handleEditConcept = (concept: Concept) => {
    setEditingConcept(concept);
    conceptForm.setFieldsValue(concept);
    setConceptModal(true);
  };

  const handleEditHighlight = (highlight: Highlight) => {
    setEditingHighlight(highlight);
    highlightForm.setFieldsValue({ user_note: highlight.user_note });
    setHighlightModal(true);
  };

  const submitConcept = async (values: Partial<Concept>) => {
    if (!topic || !material) return;
    try {
      if (editingConcept) {
        await updateConcept(editingConcept.id, values);
        message.success('概念已更新');
      } else if (selection) {
        const response = await createConcept(topic.id, {
          title: values.title || selection.text.slice(0, 80),
          material: material.id,
          start_offset: selection.startOffset,
          end_offset: selection.endOffset,
        });
        setTask(response.data.task);
        message.success('概念草稿已创建');
      }
      setConceptModal(false);
      setEditingConcept(null);
      setSelection(null);
      await refreshAnnotations(true);
    } catch {
      message.error('保存失败');
    }
  };

  const submitHighlight = async (values: { user_note: string }) => {
    if (!topic || !material) return;
    try {
      if (editingHighlight) {
        await updateHighlight(editingHighlight.id, values);
        message.success('高亮已更新');
      } else if (selection) {
        await createHighlight(topic.id, {
          material: material.id,
          start_offset: selection.startOffset,
          end_offset: selection.endOffset,
          user_note: values.user_note,
        });
        message.success('已添加高亮');
      }
      setHighlightModal(false);
      setEditingHighlight(null);
      setSelection(null);
      await refreshAnnotations(true);
    } catch {
      message.error('保存失败');
    }
  };

  const createQuestionFromSelection = async () => {
    if (!topic || !material || !selection || !questionDraft.trim()) return;
    try {
      const response = await createQuestion({
        topic: topic.id,
        material: material.id,
        start_offset: selection.startOffset,
        end_offset: selection.endOffset,
        question_text: questionDraft.trim(),
      });
      setTask(response.data.task);
      setQuestionDraft('');
      setSelection(null);
      setDrawerOpen(true);
      setTab('questions');
      await refreshAnnotations(true);
      if (response.data.question.session) {
        void loadSession(response.data.question.session);
      }
    } catch (error) {
      console.error('Create question failed:', error);
      message.error('发起问答失败');
    }
  };

  const openQuestionChat = (q: Question) => {
    setDrawerOpen(true);
    setTab('questions');
    setSelection(null);
    setQuestionDraft('');
    if (q.session) {
      void loadSession(q.session);
    } else {
      message.warning('该问答尚未初始化对话');
    }
  };

  const runSupplement = async (
    type: 'Concept' | 'Question' | 'Highlight',
    id: number,
    targetTopicId: number,
  ) => {
    if (!topic) return;
    const response = await triggerSupplement(targetTopicId, type, id);
    setTask(response.data.task);
    message.info('正在检索补充资料。');
  };

  const retryTask = async () => {
    if (!task) return;
    try {
      const response = await retryAITask(task.id);
      setTask(response.data);
      message.info('任务已重新提交');
    } catch {
      message.error('任务重试失败');
    }
  };

  const searchParams = new URLSearchParams(location.search);
  const anchorParam = searchParams.get('anchor');
  const requestedAnchor = anchorParam !== null ? Number(anchorParam) : null;
  const requestedLocatorId = Number(searchParams.get('locator'));
  const nonce = searchParams.get('t') || '';

  const requestedLocator = useMemo(() => {
    if (!requestedLocatorId) return null;
    const conceptLocator = scoped.concepts.flatMap((c) => c.locators.map((l) => ({ ...l, type: 'concept', ownerId: c.id }))).find((l) => l.id === requestedLocatorId);
    if (conceptLocator) return conceptLocator;
    const questionLocator = scoped.questions.flatMap((q) => q.locators.map((l) => ({ ...l, type: 'question', ownerId: q.id }))).find((l) => l.id === requestedLocatorId);
    if (questionLocator) return questionLocator;
    const highlightLocator = scoped.highlights.flatMap((h) => h.locators.map((l) => ({ ...l, type: 'highlight', ownerId: h.id }))).find((l) => l.id === requestedLocatorId);
    if (highlightLocator) return highlightLocator;
    return null;
  }, [requestedLocatorId, scoped]);

  useEffect(() => {
    if (!material || (!requestedLocator && requestedAnchor === null)) return;

    const scrollTo = () => {
      let element: HTMLElement | null = null;
      if (requestedLocator) {
        // Open drawer and switch tab if we have a locator
        setDrawerOpen(true);
        setTab(
          requestedLocator.type === 'question' ? 'questions' :
          requestedLocator.type === 'concept' ? 'concepts' : 'highlights'
        );

        element = document.getElementById(`reader-${requestedLocator.type}-${requestedLocator.ownerId}`);

        // Also scroll the annotation in the drawer
        setTimeout(() => {
          document.getElementById(
            `annotation-${requestedLocator.type}-${requestedLocator.ownerId}`,
          )?.scrollIntoView({
            behavior: 'smooth',
            block: 'center',
          });
        }, 500);
      }

      if (!element && requestedAnchor !== null) {
        const chunk = requestedLocator?.chunk
          ? material.chunks.find((item) => item.id === requestedLocator.chunk)
          : material.chunks.find(
            (item) =>
              item.start_offset <= requestedAnchor &&
              requestedAnchor < item.end_offset,
          );
        element = document.getElementById(`reader-chunk-${chunk?.id ?? 0}`);
      }

      if (element) {
        element.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
        });
        if (requestedLocator) {
          element.classList.add('universal-reader__annotation--selected');
          setTimeout(() => {
            element?.classList.remove('universal-reader__annotation--selected');
          }, 2000);
        }
      }
    };

    // Use a slightly longer delay to ensure chunks are rendered and IDs are assigned
    const timer = setTimeout(scrollTo, 300);
    return () => clearTimeout(timer);
  }, [material, requestedAnchor, requestedLocator, nonce]);

  if (loading) {
    return (
      <div className="material-reader__loading">
        <Skeleton active paragraph={{ rows: 10 }} />
      </div>
    );
  }

  if (!topic || !material) {
    return (
      <Result
        status="warning"
        title="学习材料不可用"
        subTitle={loadError || '没有找到对应的学习材料。'}
        extra={[
          <Button key="back" onClick={() => navigate(topicId ? `/topics/${topicId}` : '/topics')}>
            返回话题
          </Button>,
          <Button key="retry" type="primary" icon={<ReloadOutlined />} onClick={() => void load()}>
            重新加载
          </Button>,
        ]}
      />
    );
  }

  const seekTime = {
    time: requestedLocator?.time_start_offset ??
      (requestedAnchor !== null
        ? material.chunks.find((chunk) => chunk.start_offset <= requestedAnchor && requestedAnchor < chunk.end_offset)?.start_time ?? null
        : null),
    nonce
  };

  return (
    <>
      <div
        className={`material-reader__page ${immersiveMode ? 'material-reader__page--immersive' : ''}`}
        style={{
          minHeight: '100vh',
          background: themeOption.page,
          transition: 'background-color 160ms ease',
        }}
      >
        <div
          className="material-reader__container"
          style={{
            maxWidth: material.media_type === 'video' ? 1480 : 1080,
            margin: '0 auto',
            padding: '24px 24px 48px',
          }}
        >
          <div className={`material-reader__toolbar ${darkMode ? 'material-reader__toolbar--dark' : ''}`}>
            <Button
              type="text"
              icon={<ArrowLeftOutlined />}
              className="material-reader__back-button"
              title={`返回主题：《${topic.title}》`}
              onClick={() => navigate(`/topics/${topic.id}`)}
            >
              返回主题：《{topic.title}》
            </Button>
            <div className="material-reader__toolbar-actions">
              <Segmented
                size="small"
                value={annotationScope}
                options={[
                  { label: '当前主题标注', value: 'topic' },
                  { label: '全部标注', value: 'all' },
                ]}
                onChange={(value) => {
                  setAnnotationScope(value as 'topic' | 'all');
                  setActiveSession(null);
                }}
              />
              <Text type="secondary">
                {scoped.concepts.length} 概念 · {scoped.questions.length} 问答 · {scoped.highlights.length} 高亮
              </Text>
              <Switch
                size="small"
                checked={showHighlightNotes}
                checkedChildren="备注开"
                unCheckedChildren="备注关"
                aria-label="切换正文高亮备注"
                onChange={setShowHighlightNotes}
              />
              <Button icon={<AppstoreOutlined />} onClick={() => setDrawerOpen(true)}>
                学习工作区
              </Button>
            </div>
          </div>
          {isMobile && immersiveMode && (
            <Button
              className="material-reader__exit-immersive"
              icon={<CompressOutlined />}
              aria-label="退出沉浸阅读"
              onClick={() => setImmersiveMode(false)}
            >
              退出沉浸
            </Button>
          )}
          {isMobile && !immersiveMode && (
            <Button
              className="material-reader__enter-immersive"
              type="primary"
              onClick={() => setImmersiveMode(true)}
            >
              沉浸阅读
            </Button>
          )}
          {task && (
            <Alert
              showIcon
              closable={['succeeded', 'cancelled'].includes(task.status)}
              onClose={() => setTask(null)}
              style={{ margin: '16px 0' }}
              type={task.status === 'failed' ? 'error' : task.status === 'succeeded' ? 'success' : 'info'}
              message={
                task.status === 'failed'
                  ? `${task.task_type_display}执行失败`
                  : `${task.task_type_display}${task.status === 'succeeded' ? '已完成' : '正在执行'}`
              }
              description={task.status === 'failed' ? task.error_message : undefined}
              action={task.status === 'failed' ? (
                <Button size="small" icon={<ReloadOutlined />} onClick={() => void retryTask()}>
                  重试
                </Button>
              ) : undefined}
            />
          )}
          {material.status !== 'ready' && (
            <Alert
              showIcon
              style={{ margin: '16px 0' }}
              type={material.status === 'failed' ? 'error' : 'warning'}
              message={`材料状态：${material.status_display}`}
              description={material.error || '材料仍在处理，当前内容可能尚未完整。'}
            />
          )}
          {material.digest && (
            <Collapse
              style={{
                margin: '16px 0',
                background: darkMode ? '#141414' : '#fff',
                borderColor: darkMode ? '#303030' : '#d9d9d9',
              }}
              items={[{
                key: 'digest',
                label: <Text strong>材料摘要</Text>,
                children: <MarkdownDigest content={material.digest} />,
              }]}
            />
          )}
          <UniversalReader
            material={material}
            highlights={scoped.highlights}
            concepts={scoped.concepts}
            questions={scoped.questions}
            readerTheme={readerTheme}
            onReaderThemeChange={setReaderTheme}
            readerFont={readerFont}
            onReaderFontChange={setReaderFont}
            onMarkConcept={(next) => {
              setSelection(next);
              conceptForm.setFieldsValue({ title: next.text.slice(0, 80) });
              setConceptModal(true);
            }}
            onAskQuestion={(next) => {
              setSelection(next);
              setActiveSession(null);
              setQuestionDraft('');
              setDrawerOpen(true);
              setTab('questions');
            }}
            onHighlight={(next) => {
              setSelection(next);
              highlightForm.resetFields();
              setHighlightModal(true);
            }}
            onClearAnnotationSelection={() => undefined}
            onAnnotationClick={(type, id) => {
            setDrawerOpen(true);
            const tabName = type === 'question' ? 'questions' : type === 'concept' ? 'concepts' : 'highlights';
            setTab(tabName);

            if (type === 'question') {
              const q = scoped.questions.find(item => item.id === id);
              if (q?.session) void loadSession(q.session);
            }

            // Wait for drawer to open before scrolling
            setTimeout(() => {
              const el = document.getElementById(`annotation-${type}-${id}`);
              if (el) {
                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                el.classList.add('reader-drawer-item--active');
                setTimeout(() => el.classList.remove('reader-drawer-item--active'), 3000);
              }
            }, 300);
          }}
            selectedAnnotations={[]}
            showHighlightNotes={showHighlightNotes}
            seekTime={seekTime}
            speechControlsTargetId="material-reader-reader-tools"
          />
        </div>
      </div>
      <div
        id="material-reader-reader-tools"
        className="material-reader__reader-tools"
      />
      <Drawer
        title={<Space><AppstoreOutlined /><span>学习工作区</span></Space>}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        size={520}
        className={darkMode ? 'universal-reader--dark' : ''}
      >
        <Tabs activeKey={tab} onChange={setTab} items={[
          {
            key: 'questions',
            label: `问答 (${scoped.questions.length})`,
            children: (
              <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 160px)' }}>
                {activeSession ? (
                  <>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                      <Typography.Title level={5} style={{ margin: 0 }}>当前对话</Typography.Title>
                      <Button type="link" size="small" onClick={() => setActiveSession(null)}>返回列表</Button>
                    </div>
                    {activeQuestion?.locators[0]?.source_text && (
                      <Alert
                        type="info"
                        showIcon
                        className="material-reader__question-context"
                        message="本次问答引用的原文"
                        description={`“${activeQuestion.locators[0].source_text}”`}
                        action={
                          <Button
                            type="link"
                            size="small"
                            onClick={() => jumpToSource(activeQuestion.locators[0].id)}
                          >
                            回原文
                          </Button>
                        }
                      />
                    )}
                    <div className="material-reader__chat-messages" style={{
                      flex: 1,
                      overflowY: 'auto',
                      marginBottom: 16,
                      padding: '8px',
                      background: darkMode ? '#1f1f1f' : '#fafafa',
                      borderRadius: 8,
                      border: darkMode ? '1px solid #303030' : 'none'
                    }}>
                      <List
                        loading={chatLoading}
                        dataSource={activeSession.messages}
                        locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="发送第一条追问" /> }}
                        renderItem={(msg) => (
                          <div style={{
                            marginBottom: 12,
                            textAlign: msg.msg_from === 'user' ? 'right' : 'left'
                          }}>
                            <div style={{
                              display: 'inline-block',
                              padding: '8px 12px',
                              borderRadius: 8,
                              maxWidth: '85%',
                              background: msg.msg_from === 'user' ? '#1677ff' : (darkMode ? '#262626' : '#fff'),
                              color: msg.msg_from === 'user' ? '#fff' : 'inherit',
                              boxShadow: '0 2px 4px rgba(0,0,0,0.05)',
                              textAlign: 'left',
                              border: msg.msg_from === 'ai' && darkMode ? '1px solid #303030' : 'none'
                            }}>
                              <MarkdownChatMessage content={msg.msg_content} />
                            </div>
                          </div>
                        )}
                      />
                      {activeQuestionTask && (
                        <div
                          role="status"
                          aria-live="polite"
                          className="material-reader__chat-replying"
                        >
                          <Spin size="small" />
                          <Text type="secondary">
                            {activeQuestionTask.status === 'pending'
                              ? 'AI 回复正在排队...'
                              : `AI 正在使用 ${activeQuestionTask.model || '当前模型'} 回复...`}
                          </Text>
                        </div>
                      )}
                      <div ref={chatEndRef} />
                    </div>
                    <Space.Compact style={{ width: '100%' }}>
                      <Input
                        placeholder="继续提问..."
                        value={chatDraft}
                        onChange={(e) => setChatDraft(e.target.value)}
                        onPressEnter={handleSendChat}
                        disabled={chatLoading || Boolean(activeQuestionTask)}
                      />
                      <Button
                        type="primary"
                        icon={<SendOutlined />}
                        onClick={handleSendChat}
                        loading={chatLoading}
                        disabled={!chatDraft.trim() || Boolean(activeQuestionTask)}
                      />
                    </Space.Compact>
                  </>
                ) : (
                  <Space direction="vertical" style={{ display: 'flex' }} size="middle">
                    {selection && (
                      <Alert
                        type="info"
                        message={
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <Text ellipsis style={{ maxWidth: 300 }}>引用：{selection.text}</Text>
                            <Button type="link" size="small" onClick={() => setSelection(null)}>取消</Button>
                          </div>
                        }
                      />
                    )}
                    <Input.TextArea
                      value={questionDraft}
                      onChange={(event) => setQuestionDraft(event.target.value)}
                      placeholder="基于选中内容提问"
                      autoSize={{ minRows: 2, maxRows: 6 }}
                    />
                    <Button
                      type="primary"
                      block
                      icon={<SendOutlined />}
                      disabled={!selection || !questionDraft.trim()}
                      onClick={() => void createQuestionFromSelection()}
                    >
                      发起问答
                    </Button>
                    <List
                      dataSource={scoped.questions}
                      locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="选中原文后发起第一个问答" /> }}
                      renderItem={(item) => (
                        <List.Item
                          id={`annotation-question-${item.id}`}
                          className="reader-drawer-item"
                          style={{ display: 'block', padding: '12px 8px', borderRadius: 8, cursor: 'pointer' }}
                          onClick={() => openQuestionChat(item)}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                            <Space size={6} wrap style={{ flex: 1, marginRight: 8 }}>
                              <Text strong>{item.question_text}</Text>
                              {annotationScope === 'all' && item.locators[0] && (
                                <Tag>{item.locators[0].topic_title}</Tag>
                              )}
                            </Space>
                            <Space size={0} onClick={(e) => e.stopPropagation()}>
                              <Button
                                type="text"
                                size="small"
                                icon={<FileSearchOutlined />}
                                title="补资料"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void runSupplement(
                                    'Question',
                                    item.id,
                                    item.locators[0]?.topic ?? topic.id,
                                  );
                                }}
                              />
                              <Popconfirm
                                title="删除这个问答？"
                                onConfirm={() => {
                                  captureReadingPosition();
                                  void deleteQuestion(item.id)
                                    .then(() => refreshAnnotations())
                                    .catch(() => {
                                      viewportAnchorRef.current = null;
                                      message.error('删除失败');
                                    });
                                }}
                              >
                                <Button type="text" size="small" danger icon={<DeleteOutlined />} title="删除" />
                              </Popconfirm>
                            </Space>
                          </div>
                          <Text type="secondary" style={{ fontSize: '13px' }} ellipsis>
                            {item.conclusion || '点击开始对话'}
                          </Text>
                          {item.locators[0]?.source_text && (
                            <div className="material-reader__question-source">
                              <Text type="secondary" ellipsis>
                                引用：“{item.locators[0].source_text}”
                              </Text>
                            </div>
                          )}
                        </List.Item>
                      )}
                    />
                  </Space>
                )}
              </div>
            ),
          },
          {
            key: 'concepts',
            label: `概念 (${scoped.concepts.length})`,
            children: (
                    <List
                      dataSource={scoped.concepts}
                      locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="选中原文后标记第一个概念" /> }}
                      renderItem={(item) => (
                        <List.Item
                          id={`annotation-concept-${item.id}`}
                          className="reader-drawer-item"
                          style={{ display: 'block', padding: '12px 8px', borderRadius: 8, cursor: 'pointer' }}
                          onClick={() => jumpToSource(item.locators[0]?.id)}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                            <Space size={6} wrap style={{ flex: 1, marginRight: 8 }}>
                              <Text strong>{item.title}</Text>
                              {annotationScope === 'all' && item.locators[0] && (
                                <Tag>{item.locators[0].topic_title}</Tag>
                              )}
                            </Space>
                            <Space size={0} onClick={(e) => e.stopPropagation()}>
                              <Button
                                type="text"
                                size="small"
                                icon={<EditOutlined />}
                                title="编辑"
                                onClick={() => handleEditConcept(item)}
                              />
                              <Button
                                type="text"
                                size="small"
                                icon={<FileSearchOutlined />}
                                title="补资料"
                                onClick={() => void runSupplement(
                                  'Concept',
                                  item.id,
                                  item.locators[0]?.topic ?? topic.id,
                                )}
                              />
                              {item.status !== 'confirmed' && (
                                <Button
                                  type="text"
                                  size="small"
                                  icon={<CheckOutlined />}
                                  title="确认"
                                  style={{ color: '#52c41a' }}
                                  onClick={() => {
                                    captureReadingPosition();
                                    void updateConcept(item.id, { status: 'confirmed' })
                                      .then(() => refreshAnnotations())
                                      .catch(() => {
                                        viewportAnchorRef.current = null;
                                        message.error('确认失败');
                                      });
                                  }}
                                />
                              )}
                              <Popconfirm
                                title="删除这个概念？"
                                onConfirm={() => {
                                  captureReadingPosition();
                                  void deleteConcept(item.id)
                                    .then(() => refreshAnnotations())
                                    .catch(() => {
                                      viewportAnchorRef.current = null;
                                      message.error('删除失败');
                                    });
                                }}
                              >
                                <Button type="text" size="small" danger icon={<DeleteOutlined />} title="删除" />
                              </Popconfirm>
                            </Space>
                          </div>
                          <Text type="secondary" style={{ fontSize: '13px' }}>
                            {item.definition || '草稿生成中...'}
                          </Text>
                        </List.Item>
                      )}
                    />
            ),
          },
          {
            key: 'highlights',
            label: `高亮 (${scoped.highlights.length})`,
            children: (
                    <List
                      dataSource={scoped.highlights}
                      locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="选中原文后添加第一条高亮" /> }}
                      renderItem={(item) => (
                        <List.Item
                          id={`annotation-highlight-${item.id}`}
                          className="reader-drawer-item"
                          style={{ display: 'block', padding: '12px 8px', borderRadius: 8, cursor: 'pointer' }}
                          onClick={() => jumpToSource(item.locators[0]?.id)}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                            <Space size={6} wrap style={{ flex: 1, marginRight: 8 }}>
                              <Text strong ellipsis>{item.locators[0]?.source_text}</Text>
                              {annotationScope === 'all' && item.locators[0] && (
                                <Tag>{item.locators[0].topic_title}</Tag>
                              )}
                            </Space>
                            <Space size={0} onClick={(e) => e.stopPropagation()}>
                              <Button
                                type="text"
                                size="small"
                                icon={<EditOutlined />}
                                title="编辑"
                                onClick={() => handleEditHighlight(item)}
                              />
                              <Button
                                type="text"
                                size="small"
                                icon={<FileSearchOutlined />}
                                title="补资料"
                                onClick={() => void runSupplement(
                                  'Highlight',
                                  item.id,
                                  item.locators[0]?.topic ?? topic.id,
                                )}
                              />
                              <Popconfirm
                                title="删除这条高亮？"
                                onConfirm={() => {
                                  captureReadingPosition();
                                  void deleteHighlight(item.id)
                                    .then(() => refreshAnnotations())
                                    .catch(() => {
                                      viewportAnchorRef.current = null;
                                      message.error('删除失败');
                                    });
                                }}
                              >
                                <Button type="text" size="small" danger icon={<DeleteOutlined />} title="删除" />
                              </Popconfirm>
                            </Space>
                          </div>
                          {item.user_note && (
                            <Text type="secondary" style={{ fontSize: '13px' }}>
                              {item.user_note}
                            </Text>
                          )}
                        </List.Item>
                      )}
                    />
            ),
          },
        ]} />
      </Drawer>
    <Modal title={editingConcept ? "编辑概念" : "标记概念"} open={conceptModal} focusTriggerAfterClose={false} onCancel={() => { setConceptModal(false); setEditingConcept(null); }} onOk={() => conceptForm.submit()}>
      <Form form={conceptForm} layout="vertical" onFinish={submitConcept}>
        <Form.Item name="title" label="名称" rules={[{ required: true }]}><Input /></Form.Item>
        {editingConcept && (
          <>
            <Form.Item name="definition" label="定义"><Input.TextArea rows={3} /></Form.Item>
            <Form.Item name="principle" label="原理"><Input.TextArea rows={3} /></Form.Item>
            <Form.Item name="pitfalls" label="易错点"><Input.TextArea rows={3} /></Form.Item>
            <Form.Item name="applications" label="应用"><Input.TextArea rows={3} /></Form.Item>
          </>
        )}
      </Form>
    </Modal>
    <Modal title={editingHighlight ? "编辑高亮" : "添加高亮"} open={highlightModal} focusTriggerAfterClose={false} onCancel={() => { setHighlightModal(false); setEditingHighlight(null); }} onOk={() => highlightForm.submit()}>
      <Form form={highlightForm} layout="vertical" onFinish={submitHighlight}>
        <Form.Item name="user_note" label="笔记内容"><Input.TextArea rows={4} /></Form.Item>
      </Form>
    </Modal>
    </>
  );
};

export default MaterialReader;
