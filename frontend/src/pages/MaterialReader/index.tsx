import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  Alert,
  Button,
  Collapse,
  ConfigProvider,
  Drawer,
  Form,
  Input,
  List,
  Modal,
  Space,
  Tabs,
  Typography,
  message,
  theme,
} from 'antd';
import {
  ArrowLeftOutlined,
  CheckOutlined,
  DeleteOutlined,
  EditOutlined,
  FileSearchOutlined,
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
  getSession,
  getTopic,
  triggerSupplement,
  updateConcept,
  updateHighlight,
  createSessionMessage,
} from '../../api';
import type { AITask, Concept, Highlight, Material, Question, Topic, Session } from '../../api';
import UniversalReader from '../../components/UniversalReader';
import type { TextSelectionAnchor } from '../../components/UniversalReader';

const { Text } = Typography;

function renderMarkdownInline(text: string): React.ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <Typography.Text strong key={index}>{part.slice(2, -2)}</Typography.Text>;
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return <Typography.Text code key={index}>{part.slice(1, -1)}</Typography.Text>;
    }
    return part;
  });
}

const MarkdownDigest: React.FC<{ content: string }> = ({ content }) => (
  <div>
    {content.split('\n').map((line, index) => {
      if (line.startsWith('### ')) return <Typography.Title key={index} level={5}>{renderMarkdownInline(line.slice(4))}</Typography.Title>;
      if (line.startsWith('## ')) return <Typography.Title key={index} level={4}>{renderMarkdownInline(line.slice(3))}</Typography.Title>;
      if (line.startsWith('# ')) return <Typography.Title key={index} level={3}>{renderMarkdownInline(line.slice(2))}</Typography.Title>;
      if (/^[-*] /.test(line)) return <li key={index} style={{ color: 'inherit' }}><Typography.Text>{renderMarkdownInline(line.slice(2))}</Typography.Text></li>;
      return line ? <Typography.Paragraph key={index}>{renderMarkdownInline(line)}</Typography.Paragraph> : null;
    })}
  </div>
);

const MaterialReader: React.FC = () => {
  const { topicId, materialId } = useParams<{ topicId: string; materialId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [topic, setTopic] = useState<Topic | null>(null);
  const [material, setMaterial] = useState<Material | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [tab, setTab] = useState('questions');
  const [selection, setSelection] = useState<TextSelectionAnchor | null>(null);
  const [question, setQuestion] = useState('');
  const [task, setTask] = useState<AITask | null>(null);
  const [conceptModal, setConceptModal] = useState(false);
  const [highlightModal, setHighlightModal] = useState(false);
  const [darkMode, setDarkMode] = useState(
    () => window.matchMedia('(prefers-color-scheme: dark)').matches,
  );
  const [editingConcept, setEditingConcept] = useState<Concept | null>(null);
  const [editingHighlight, setEditingHighlight] = useState<Highlight | null>(null);
  const [activeSession, setActiveSession] = useState<Session | null>(null);
  const [chatLoading, setChatLoading] = useState(false);

  const [conceptForm] = Form.useForm<Partial<Concept>>();
  const [highlightForm] = Form.useForm<{ user_note: string }>();

  const load = useCallback(async () => {
    if (!topicId || !materialId) return;
    const response = await getTopic(Number(topicId));
    setTopic(response.data);
    const relation = response.data.topic_materials.find(
      (item) => item.material_id === Number(materialId),
    );
    setMaterial(relation?.material ?? null);
  }, [materialId, topicId]);

  useEffect(() => {
    void load().catch(() => message.error('加载材料失败'));
  }, [load]);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (event: MediaQueryListEvent) => setDarkMode(event.matches);
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  useEffect(() => {
    if (!task || !['pending', 'running'].includes(task.status)) return;
    const timer = window.setInterval(async () => {
      const response = await getAITask(task.id);
      setTask(response.data);
      if (['succeeded', 'failed'].includes(response.data.status)) {
        if (response.data.status === 'failed') {
          message.error(response.data.error_message || 'AI 任务失败');
        }
        await load();
      }
    }, 1500);
    return () => window.clearInterval(timer);
  }, [load, task]);

  const scoped = useMemo(() => {
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
    } catch (error) {
      console.error('Failed to load session:', error);
      message.error('加载对话失败，请重试');
    } finally {
      setChatLoading(false);
    }
  }, []);

  const handleSendChat = async () => {
    if (!activeSession || !question.trim()) return;
    try {
      setChatLoading(true);
      const content = question.trim();
      setQuestion('');
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
      await load();
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
      await load();
    } catch {
      message.error('保存失败');
    }
  };

  const createQuestionFromSelection = async () => {
    if (!topic || !material || !selection || !question.trim()) return;
    try {
      const response = await createQuestion({
        topic: topic.id,
        material: material.id,
        start_offset: selection.startOffset,
        end_offset: selection.endOffset,
        question_text: question.trim(),
      });
      setTask(response.data.task);
      setQuestion('');
      setSelection(null);
      setDrawerOpen(true);
      setTab('questions');
      await load();
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
    if (q.session) {
      void loadSession(q.session);
    } else {
      message.warning('该问答尚未初始化对话');
    }
  };

  const runSupplement = async (type: 'Concept' | 'Question' | 'Highlight', id: number) => {
    if (!topic) return;
    const response = await triggerSupplement(topic.id, type, id);
    setTask(response.data.task);
    message.info('正在检索补充资料。');
  };

  const searchParams = new URLSearchParams(location.search);
  const anchorParam = searchParams.get('anchor');
  const requestedAnchor = anchorParam !== null ? Number(anchorParam) : null;
  const requestedLocatorId = Number(searchParams.get('locator'));
  const nonce = searchParams.get('t') || '';

  const requestedLocator = useMemo(() => {
    if (!topic || !requestedLocatorId) return null;
    const conceptLocator = topic.concepts.flatMap((c) => c.locators.map((l) => ({ ...l, type: 'concept', ownerId: c.id }))).find((l) => l.id === requestedLocatorId);
    if (conceptLocator) return conceptLocator;
    const questionLocator = topic.questions.flatMap((q) => q.locators.map((l) => ({ ...l, type: 'question', ownerId: q.id }))).find((l) => l.id === requestedLocatorId);
    if (questionLocator) return questionLocator;
    const highlightLocator = topic.highlights.flatMap((h) => h.locators.map((l) => ({ ...l, type: 'highlight', ownerId: h.id }))).find((l) => l.id === requestedLocatorId);
    if (highlightLocator) return highlightLocator;
    return null;
  }, [topic, requestedLocatorId]);

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
          document.getElementById(`annotation-${requestedLocator.ownerId}`)?.scrollIntoView({
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

  if (!topic || !material) return <div style={{ padding: 24 }}>加载中...</div>;

  const seekTime = {
    time: requestedLocator?.time_start_offset ??
      (requestedAnchor !== null
        ? material.chunks.find((chunk) => chunk.start_offset <= requestedAnchor && requestedAnchor < chunk.end_offset)?.start_time ?? null
        : null),
    nonce
  };

  return (
    <ConfigProvider theme={{ algorithm: darkMode ? theme.darkAlgorithm : theme.defaultAlgorithm }}>
      <div style={{
        minHeight: '100vh',
        background: darkMode ? '#000000' : '#f5f7fa',
        transition: 'background-color 160ms ease',
      }}>
        <div
          style={{
            maxWidth: material.media_type === 'video' ? 1480 : 1080,
            margin: '0 auto',
            padding: '24px 24px 48px',
          }}
        >
          <Button
            icon={<ArrowLeftOutlined />}
            onClick={() => navigate(`/topics/${topic.id}`)}
            style={{
              position: 'fixed',
              top: 76,
              left: 24,
              zIndex: 10,
              boxShadow: '0 2px 8px rgba(0, 0, 0, 0.15)',
            }}
          >
            返回主题
          </Button>
          {task && ['pending', 'running'].includes(task.status) && (
            <Alert style={{ margin: '16px 0' }} type="info" message={`${task.task_type_display}正在执行`} />
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
            darkMode={darkMode}
            onDarkModeChange={setDarkMode}
            onMarkConcept={(next) => {
              setSelection(next);
              conceptForm.setFieldsValue({ title: next.text.slice(0, 80) });
              setConceptModal(true);
            }}
            onAskQuestion={(next) => {
              setSelection(next);
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
              const el = document.getElementById(`annotation-${id}`);
              if (el) {
                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                el.classList.add('reader-drawer-item--active');
                setTimeout(() => el.classList.remove('reader-drawer-item--active'), 3000);
              }
            }, 300);
          }}
            selectedAnnotations={[]}
            seekTime={seekTime}
          />
        </div>
      </div>
      <Drawer
        title="学习工作区"
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        width={420}
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
                    <div style={{
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
                              <Text style={{ color: 'inherit' }}>{msg.msg_content}</Text>
                            </div>
                          </div>
                        )}
                      />
                    </div>
                    <Space.Compact style={{ width: '100%' }}>
                      <Input
                        placeholder="继续提问..."
                        value={question}
                        onChange={(e) => setQuestion(e.target.value)}
                        onPressEnter={handleSendChat}
                        disabled={chatLoading}
                      />
                      <Button
                        type="primary"
                        icon={<SendOutlined />}
                        onClick={handleSendChat}
                        loading={chatLoading}
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
                      value={question}
                      onChange={(event) => setQuestion(event.target.value)}
                      placeholder="基于选中内容提问"
                      autoSize={{ minRows: 2, maxRows: 6 }}
                    />
                    <Button
                      type="primary"
                      block
                      icon={<SendOutlined />}
                      disabled={!selection || !question.trim()}
                      onClick={() => void createQuestionFromSelection()}
                    >
                      发起问答
                    </Button>
                    <List
                      dataSource={scoped.questions}
                      renderItem={(item) => (
                        <List.Item
                          id={`annotation-${item.id}`}
                          className="reader-drawer-item"
                          style={{ display: 'block', padding: '12px 8px', borderRadius: 8, cursor: 'pointer' }}
                          onClick={() => openQuestionChat(item)}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                            <Text strong style={{ flex: 1, marginRight: 8 }}>{item.question_text}</Text>
                            <Space size={0} onClick={(e) => e.stopPropagation()}>
                              <Button
                                type="text"
                                size="small"
                                icon={<FileSearchOutlined />}
                                title="补资料"
                                onClick={(e) => { e.stopPropagation(); void runSupplement('Question', item.id); }}
                              />
                              <Button
                                type="text"
                                size="small"
                                danger
                                icon={<DeleteOutlined />}
                                title="删除"
                                onClick={(e) => { e.stopPropagation(); void deleteQuestion(item.id).then(load); }}
                              />
                            </Space>
                          </div>
                          <Text type="secondary" style={{ fontSize: '13px' }} ellipsis>
                            {item.conclusion || '点击开始对话'}
                          </Text>
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
                      renderItem={(item) => (
                        <List.Item
                          id={`annotation-${item.id}`}
                          className="reader-drawer-item"
                          style={{ display: 'block', padding: '12px 8px', borderRadius: 8, cursor: 'pointer' }}
                          onClick={() => jumpToSource(item.locators[0]?.id)}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                            <Text strong style={{ flex: 1, marginRight: 8 }}>{item.title}</Text>
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
                                onClick={() => void runSupplement('Concept', item.id)}
                              />
                              {item.status !== 'confirmed' && (
                                <Button
                                  type="text"
                                  size="small"
                                  icon={<CheckOutlined />}
                                  title="确认"
                                  style={{ color: '#52c41a' }}
                                  onClick={() => void updateConcept(item.id, { status: 'confirmed' }).then(load)}
                                />
                              )}
                              <Button
                                type="text"
                                size="small"
                                danger
                                icon={<DeleteOutlined />}
                                title="删除"
                                onClick={() => void deleteConcept(item.id).then(load)}
                              />
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
                      renderItem={(item) => (
                        <List.Item
                          id={`annotation-${item.id}`}
                          className="reader-drawer-item"
                          style={{ display: 'block', padding: '12px 8px', borderRadius: 8, cursor: 'pointer' }}
                          onClick={() => jumpToSource(item.locators[0]?.id)}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                            <Text strong ellipsis style={{ flex: 1, marginRight: 8 }}>
                              {item.locators[0]?.source_text}
                            </Text>
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
                                onClick={() => void runSupplement('Highlight', item.id)}
                              />
                              <Button
                                type="text"
                                size="small"
                                danger
                                icon={<DeleteOutlined />}
                                title="删除"
                                onClick={() => void deleteHighlight(item.id).then(load)}
                              />
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
    <Modal title={editingConcept ? "编辑概念" : "标记概念"} open={conceptModal} onCancel={() => { setConceptModal(false); setEditingConcept(null); }} onOk={() => conceptForm.submit()}>
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
    <Modal title={editingHighlight ? "编辑高亮" : "添加高亮"} open={highlightModal} onCancel={() => { setHighlightModal(false); setEditingHighlight(null); }} onOk={() => highlightForm.submit()}>
      <Form form={highlightForm} layout="vertical" onFinish={submitHighlight}>
        <Form.Item name="user_note" label="笔记内容"><Input.TextArea rows={4} /></Form.Item>
      </Form>
    </Modal>
    </ConfigProvider>
  );
};

export default MaterialReader;
