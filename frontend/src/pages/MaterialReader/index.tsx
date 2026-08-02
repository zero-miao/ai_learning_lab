import React, { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  Alert,
  Button,
  Collapse,
  Divider,
  Dropdown,
  Drawer,
  FloatButton,
  Form,
  Input,
  Layout,
  List,
  message,
  Modal,
  Popconfirm,
  Space,
  Tabs,
  Typography,
} from 'antd';
import {
  AppstoreOutlined,
  ArrowLeftOutlined,
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
  getQuestion,
  getTopic,
  listAITasks,
  retryAITask,
  saveQuestion,
  updateConcept,
} from '../../api';
import type { AITask, Concept, Material, Topic } from '../../api';
import UniversalReader from '../../components/UniversalReader';
import type { TextSelectionAnchor } from '../../components/UniversalReader';
import { useAITaskPolling } from '../../hooks/useAITaskPolling';

const { Text } = Typography;
const { Content } = Layout;

type ChatItem = {
  role: 'user' | 'ai';
  content: string;
  selection?: string;
  type?: string;
  task?: AITask;
  questionId?: number;
  isSaved?: boolean;
};

interface ConceptFormValues {
  title: string;
}

interface ConceptEditorValues {
  title: string;
  definition?: string;
  principle?: string;
  pitfalls?: string;
  applications?: string;
}

function renderMarkdownInline(text: string): React.ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return <Typography.Text code key={index}>{part.slice(1, -1)}</Typography.Text>;
    }
    return part;
  });
}

const MarkdownBriefing: React.FC<{ content: string }> = ({ content }) => {
  const lines = content.split('\n');
  const blocks: React.ReactNode[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    const isTable =
      line.includes('|') &&
      /^\s*\|?[\s:-]+\|[\s|:-]*$/.test(lines[index + 1] ?? '');
    if (isTable) {
      const rows = [line];
      index += 2;
      while (lines[index]?.includes('|')) {
        rows.push(lines[index]);
        index += 1;
      }
      const cells = (row: string) =>
        row
          .trim()
          .replace(/^\||\|$/g, '')
          .split('|')
          .map((cell) => cell.trim());
      blocks.push(
        <div key={`table-${index}`} style={{ overflowX: 'auto', marginBottom: 16 }}>
          <table className="reader-briefing__table">
            <thead>
              <tr>
                {cells(rows[0]).map((cell, cellIndex) => (
                  <th key={cellIndex}>{renderMarkdownInline(cell)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.slice(1).map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {cells(row).map((cell, cellIndex) => (
                    <td key={cellIndex}>{renderMarkdownInline(cell)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    if (!line.trim()) {
      index += 1;
      continue;
    }
    if (line.startsWith('### ')) {
      blocks.push(<Typography.Title key={index} level={5}>{renderMarkdownInline(line.slice(4))}</Typography.Title>);
    } else if (line.startsWith('## ')) {
      blocks.push(<Typography.Title key={index} level={4}>{renderMarkdownInline(line.slice(3))}</Typography.Title>);
    } else if (line.startsWith('# ')) {
      blocks.push(<Typography.Title key={index} level={3}>{renderMarkdownInline(line.slice(2))}</Typography.Title>);
    } else if (/^[-*] /.test(line)) {
      blocks.push(<li key={index}>{renderMarkdownInline(line.slice(2))}</li>);
    } else {
      blocks.push(<Typography.Paragraph key={index}>{renderMarkdownInline(line)}</Typography.Paragraph>);
    }
    index += 1;
  }
  return (
    <div className="reader-briefing__markdown">{blocks}</div>
  );
};

const MaterialReader: React.FC = () => {
  const { topicId, materialId } = useParams<{
    topicId: string;
    materialId: string;
  }>();
  const [topic, setTopic] = useState<Topic | null>(null);
  const [material, setMaterial] = useState<Material | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedText, setSelectedText] = useState('');
  const [selectedAnchor, setSelectedAnchor] =
    useState<TextSelectionAnchor | null>(null);
  const [assistantVisible, setAssistantVisible] = useState(false);
  const [assistantTab, setAssistantTab] = useState('questions');
  const [question, setQuestion] = useState('');
  const [chatHistory, setChatHistory] = useState<ChatItem[]>([]);
  const [activeTaskId, setActiveTaskId] = useState<number | null>(null);
  const [activeTaskType, setActiveTaskType] = useState<string | null>(null);
  const [darkMode, setDarkMode] = useState(
    () => window.matchMedia('(prefers-color-scheme: dark)').matches,
  );
  const [conceptModalOpen, setConceptModalOpen] = useState(false);
  const [conceptSelection, setConceptSelection] =
    useState<TextSelectionAnchor | null>(null);
  const [conceptSaving, setConceptSaving] = useState(false);
  const [conceptForm] = Form.useForm<ConceptFormValues>();
  const [conceptEditorOpen, setConceptEditorOpen] = useState(false);
  const [editingConcept, setEditingConcept] = useState<Concept | null>(null);
  const [conceptEditorForm] = Form.useForm<ConceptEditorValues>();
  const [selectedConceptId, setSelectedConceptId] = useState<number | null>(null);
  const [selectedQuestionId, setSelectedQuestionId] = useState<number | null>(null);
  const [selectedHighlightId, setSelectedHighlightId] = useState<number | null>(null);
  const [pendingConceptIds, setPendingConceptIds] = useState<Set<number>>(
    new Set(),
  );
  const navigate = useNavigate();
  const location = useLocation();

  const loadData = useCallback(async () => {
    if (!topicId || !materialId) return;
    const [response, tasksResponse] = await Promise.all([
      getTopic(Number(topicId)),
      listAITasks({ topic: Number(topicId) }),
    ]);
    setTopic(response.data);
    setPendingConceptIds(
      new Set(
        tasksResponse.data
          .filter(
            (task) =>
              task.task_type === 'concept_draft' &&
              (task.status === 'pending' || task.status === 'running') &&
              task.concept !== null,
          )
          .map((task) => task.concept!),
      ),
    );
    const nextMaterial =
      response.data.materials.find((item) => item.id === Number(materialId)) ??
      null;
    setMaterial(nextMaterial);
  }, [materialId, topicId]);

  const handleTaskSuccess = useCallback(
    async (task: AITask) => {
      if (task.task_type === 'briefing') {
        await loadData();
      } else if (
        task.task_type === 'answer_question' &&
        typeof task.result_json.question_id === 'number'
      ) {
        const response = await getQuestion(task.result_json.question_id);
        const answer = response.data.ai_responses[0];
        if (answer) {
          setChatHistory((current) =>
            current.map((item) =>
              item.task?.id === task.id
                ? {
                    role: 'ai',
                    content: answer.content,
                    questionId: response.data.id,
                    isSaved: response.data.is_saved,
                  }
                : item,
            ),
          );
        }
      }
      setActiveTaskId(null);
      setActiveTaskType(null);
    },
    [loadData],
  );

  const handleTaskFailure = useCallback((task: AITask) => {
    setChatHistory((current) =>
      current.map((item) =>
        item.task?.id === task.id
          ? {
              ...item,
              content: task.error_message || 'AI 任务失败。',
              task,
            }
          : item,
      ),
    );
  }, []);

  const activeTask = useAITaskPolling(activeTaskId, {
    onSucceeded: (task) => {
      void handleTaskSuccess(task);
    },
    onFailed: handleTaskFailure,
  });

  useEffect(() => {
    setLoading(true);
    void loadData()
      .catch((error) => {
        console.error('Failed to fetch reader data:', error);
        message.error('加载阅读材料失败');
      })
      .finally(() => setLoading(false));
  }, [loadData]);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (event: MediaQueryListEvent) =>
      setDarkMode(event.matches);
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  useEffect(() => {
    if (!pendingConceptIds.size) return;
    const timer = window.setInterval(() => {
      void loadData();
    }, 3000);
    return () => window.clearInterval(timer);
  }, [loadData, pendingConceptIds]);

  useEffect(() => {
    if (!material) return;
    const searchParams = new URLSearchParams(location.search);
    const questionId = Number(searchParams.get('question'));
    if (Number.isInteger(questionId) && questionId > 0) {
      const questionElement = document.querySelector<HTMLElement>(
        `[data-question-ids~="${questionId}"]`,
      );
      if (questionElement) {
        questionElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
    }
    const anchorValue = searchParams.get('anchor');
    if (anchorValue === null) return;
    const anchor = Number(anchorValue);
    if (!Number.isInteger(anchor) || anchor < 0) return;
    const chunk = material.chunks.find(
      (item) => item.start_offset <= anchor && anchor < item.end_offset,
    );
    const element = document.getElementById(
      `reader-chunk-${chunk?.id ?? 0}`,
    );
    element?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [location.search, material]);

  useEffect(() => {
    if (!material || activeTaskId) return;
    void listAITasks({ material: material.id }).then((response) => {
      const task = response.data.find(
        (item) =>
          (item.task_type === 'briefing' ||
            item.task_type === 'answer_question') &&
          (item.status === 'pending' || item.status === 'running'),
      );
      if (task) {
        setActiveTaskId(task.id);
        setActiveTaskType(task.task_type);
      }
    });
  }, [activeTaskId, material]);

  const handleAskSelection = (selection: TextSelectionAnchor) => {
    setSelectedText(selection.text);
    setSelectedAnchor(selection);
    setAssistantTab('questions');
    setAssistantVisible(true);
  };

  const handleAsk = async () => {
    if (!question.trim() || !topic || !material) return;
    const currentQuestion = question;
    const currentSelection = selectedText;
    const currentAnchor = selectedAnchor;
    setQuestion('');
    setSelectedText('');
    setSelectedAnchor(null);
    setChatHistory((current) => [
      ...current,
      { role: 'user', content: currentQuestion, selection: currentSelection },
    ]);
    try {
      const response = await createQuestion({
        topic: topic.id,
        material: material.id,
        selected_text: currentSelection,
        start_offset: currentAnchor?.startOffset,
        end_offset: currentAnchor?.endOffset,
        question_text: currentQuestion,
      });
      const task = response.data.task;
      setChatHistory((current) => [
        ...current,
        {
          role: 'ai',
          content: 'AI 正在思考...',
          task,
          questionId: response.data.question.id,
          isSaved: response.data.question.is_saved,
        },
      ]);
      setActiveTaskId(task.id);
      setActiveTaskType(task.task_type);
    } catch (error) {
      console.error('Failed to ask question:', error);
      message.error('提问提交失败');
    }
  };

  const handleMarkConcept = (selection: TextSelectionAnchor) => {
    setConceptSelection(selection);
    conceptForm.setFieldsValue({
      title: selection.text.replace(/\s+/g, ' ').trim().slice(0, 80),
    });
    setConceptModalOpen(true);
  };

  const handleConceptSubmit = async (values: ConceptFormValues) => {
    if (!topic || !material) return;
    try {
      setConceptSaving(true);
      if (!conceptSelection) return;
      const response = await createConcept(topic.id, {
        title: values.title,
        material: material.id,
        start_offset: conceptSelection.startOffset,
        end_offset: conceptSelection.endOffset,
      });
      setPendingConceptIds((current) => new Set(current).add(response.data.concept.id));
      message.info(
        response.data.created ? '已提交概念草稿生成任务' : '已关联到已有概念，正在更新草稿',
      );
      closeConceptModal();
      await loadData();
    } catch (error) {
      console.error('Failed to create or update concept:', error);
      message.error('提交概念草稿失败');
    } finally {
      setConceptSaving(false);
    }
  };

  const closeConceptModal = () => {
    setConceptModalOpen(false);
    setConceptSelection(null);
    conceptForm.resetFields();
  };

  const handleHighlight = async (selection: TextSelectionAnchor) => {
    if (!topic || !material) return;
    try {
      const response = await createHighlight(topic.id, {
        material: material.id,
        start_offset: selection.startOffset,
        end_offset: selection.endOffset,
      });
      message.success(response.data.created ? '已添加高亮' : '该文本已经高亮');
      await loadData();
    } catch (error) {
      console.error('Failed to create highlight:', error);
      message.error('添加高亮失败');
    }
  };

  const handleSaveQuestion = async (questionId: number, conceptId?: number) => {
    try {
      const response = await saveQuestion(questionId, conceptId);
      setChatHistory((current) =>
        current.map((item) =>
          item.questionId === questionId
            ? { ...item, isSaved: response.data.is_saved }
            : item,
        ),
      );
      message.success(
        conceptId ? '问答已沉淀到概念卡片' : '问答已保存到材料记录',
      );
      await loadData();
    } catch (error) {
      console.error('Failed to save question:', error);
      message.error('保存问答失败');
    }
  };

  const handleJumpToHighlight = (highlightId: number) => {
    const highlight = topic?.highlights.find((item) => item.id === highlightId);
    if (!highlight) return;
    const target =
      document.getElementById(`reader-highlight-${highlight.id}`) ??
      document.getElementById(
        highlight.chunk ? `reader-chunk-${highlight.chunk}` : 'reader-chunk-0',
      );
    target?.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
    });
    setAssistantVisible(false);
  };

  const handleAnnotationClick = (
    type: 'concept' | 'question' | 'highlight',
    id: number,
  ) => {
    setAssistantVisible(true);
    if (type === 'concept') {
      setAssistantTab('concepts');
      setSelectedConceptId(id);
    } else if (type === 'question') {
      setAssistantTab('questions');
      setSelectedQuestionId(id);
    } else {
      setAssistantTab('highlights');
      setSelectedHighlightId(id);
    }
  };

  const handleJumpToQuestion = (questionId: number) => {
    const item = topic?.questions.find((question) => question.id === questionId);
    if (!item || item.start_offset === null) return;
    const target = document.querySelector<HTMLElement>(
      `[data-question-ids~="${questionId}"]`,
    );
    target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setAssistantVisible(false);
  };

  const handleDeleteQuestion = async (questionId: number) => {
    try {
      await deleteQuestion(questionId);
      if (selectedQuestionId === questionId) setSelectedQuestionId(null);
      setChatHistory((current) =>
        current.filter((item) => item.questionId !== questionId),
      );
      message.success('问答已删除');
      await loadData();
    } catch (error) {
      console.error('Failed to delete question:', error);
      message.error('删除问答失败');
    }
  };

  const openConceptEditor = (concept: Concept) => {
    setEditingConcept(concept);
    conceptEditorForm.setFieldsValue(concept);
    setConceptEditorOpen(true);
  };

  const saveConcept = async (
    values: ConceptEditorValues,
    confirm = false,
    target = editingConcept,
  ) => {
    if (!target) return;
    try {
      const response = await updateConcept(target.id, {
        ...values,
        status: confirm ? 'confirmed' : target.status,
      });
      setEditingConcept(response.data);
      message.success(confirm ? '概念已确认' : '概念已更新');
      setConceptEditorOpen(false);
      await loadData();
    } catch (error) {
      console.error('Failed to update concept:', error);
      message.error('保存概念失败');
    }
  };

  const handleDeleteConcept = async (conceptId: number) => {
    try {
      await deleteConcept(conceptId);
      if (selectedConceptId === conceptId) setSelectedConceptId(null);
      setConceptEditorOpen(false);
      message.success('概念已删除');
      await loadData();
    } catch (error) {
      console.error('Failed to delete concept:', error);
      message.error('删除概念失败');
    }
  };

  const confirmDeleteConcept = (concept: Concept) => {
    Modal.confirm({
      title: `删除概念“${concept.title}”？`,
      content: '该概念的所有来源锚点和关联关系都会一并删除，且无法恢复。',
      okText: '删除概念',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: () => handleDeleteConcept(concept.id),
    });
  };

  const handleDeleteHighlight = async (highlightId: number) => {
    try {
      await deleteHighlight(highlightId);
      message.success('高亮已删除');
      await loadData();
    } catch (error) {
      console.error('Failed to delete highlight:', error);
      message.error('删除高亮失败');
    }
  };

  const handleJumpToConcept = (concept: Concept) => {
    const anchor =
      concept.anchors.find((item) => item.material === material?.id) ??
      concept.anchors[0];
    if (!anchor || !topic) {
      message.warning('该概念没有可用的材料来源。');
      return;
    }
    if (anchor.material === material?.id) {
      const target =
        document.getElementById(`reader-concept-${concept.id}`) ??
        document.getElementById(`reader-chunk-${anchor.chunk ?? 0}`);
      target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setAssistantVisible(false);
      return;
    }
    navigate(
      `/topics/${topic.id}/materials/${anchor.material}?anchor=${anchor.start_offset}`,
    );
  };

  const handleRetry = async (task: AITask) => {
    const response = await retryAITask(task.id);
    setActiveTaskId(response.data.id);
    setActiveTaskType(response.data.task_type);
  };

  if (loading && !material) return <div style={{ padding: 24 }}>加载中...</div>;
  if (!material) return <div style={{ padding: 24 }}>未找到材料</div>;
  const briefing = material.ai_responses.find(
    (item) => item.task_type === 'briefing',
  );
  return (
    <Layout
      style={{
        minHeight: 'calc(100vh - 64px)',
        background: darkMode ? '#0f0f0f' : '#f5f7fa',
      }}
    >
      <Content
        style={{
          padding: '28px 24px 56px',
          overflowY: 'auto',
          background: 'transparent',
        }}
      >
        <div style={{ maxWidth: 980, margin: '0 auto' }}>
          <Button
            type="text"
            icon={<ArrowLeftOutlined />}
            onClick={() => navigate(`/topics/${topicId}`)}
            style={{ marginBottom: 20, color: darkMode ? '#d4d4d8' : '#595959' }}
          >
            返回话题
          </Button>
          {activeTask && (
            <Alert
              type="info"
              showIcon
              message={
                activeTaskType === 'briefing'
                  ? '阅读前导正在生成，你可以继续阅读。'
                  : 'AI 正在处理你的问题，你可以继续阅读。'
              }
              style={{ marginBottom: 16 }}
            />
          )}
          {briefing && (
            <Collapse
              size="small"
              style={{
                marginBottom: 20,
                borderColor: '#69b1ff',
                background: '#e6f4ff',
              }}
              items={[
                {
                  key: 'briefing',
                  label: '阅读前导（AI 生成）',
                  children: <MarkdownBriefing content={briefing.content} />,
                },
              ]}
            />
          )}
          <UniversalReader
            material={material}
            highlights={topic?.highlights.filter(
              (highlight) => highlight.material === material.id,
            ) ?? []}
            concepts={(topic?.concepts ?? [])
              .map((concept) => ({
                ...concept,
                anchors: concept.anchors.filter(
                  (anchor) => anchor.material === material.id,
                ),
              }))
              .filter((concept) => concept.anchors.length > 0)}
            questions={(topic?.questions ?? []).filter(
              (question) => question.material === material.id,
            )}
            darkMode={darkMode}
            onDarkModeChange={setDarkMode}
            onMarkConcept={handleMarkConcept}
            onAskQuestion={handleAskSelection}
            onHighlight={handleHighlight}
            onAnnotationClick={handleAnnotationClick}
            selectedAnnotations={[
              { type: 'concept', id: selectedConceptId },
              { type: 'question', id: selectedQuestionId },
              { type: 'highlight', id: selectedHighlightId },
            ]}
          />
        </div>
      </Content>

      <Drawer
        title="学习助手"
        placement="right"
        width={400}
        onClose={() => setAssistantVisible(false)}
        open={assistantVisible}
        mask={false}
      >
        <Tabs
          activeKey={assistantTab}
          onChange={setAssistantTab}
          items={[
            { key: 'questions', label: '问答' },
            { key: 'question-history', label: '问答历史' },
            { key: 'concepts', label: '概念' },
            { key: 'highlights', label: '高亮' },
          ]}
        />
        {assistantTab === 'questions' && (
          <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100% - 48px)' }}>
          <div style={{ flex: 1, overflowY: 'auto', marginBottom: 16 }}>
            <List
              dataSource={chatHistory}
              renderItem={(item) => (
                <List.Item style={{ border: 'none', padding: '8px 0' }}>
                  <div
                    style={{
                      width: '100%',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems:
                        item.role === 'user' ? 'flex-end' : 'flex-start',
                    }}
                  >
                    {item.selection && (
                      <div
                        style={{
                          fontSize: 12,
                          color: '#999',
                          background: '#f5f5f5',
                          padding: '4px 8px',
                          borderRadius: 4,
                          marginBottom: 4,
                          maxWidth: '80%',
                        }}
                      >
                        引用：“{item.selection}”
                      </div>
                    )}
                    <div
                      style={{
                        background: item.role === 'user' ? '#1677ff' : '#f0f0f0',
                        color: item.role === 'user' ? '#fff' : '#333',
                        padding: '8px 12px',
                        borderRadius: 8,
                        maxWidth: '90%',
                        whiteSpace: 'pre-wrap',
                      }}
                    >
                      {item.content}
                      {item.task?.status === 'failed' && (
                        <Button
                          size="small"
                          icon={<ReloadOutlined />}
                          onClick={() => void handleRetry(item.task!)}
                          style={{ marginTop: 8 }}
                        >
                          重试
                        </Button>
                      )}
                      {item.role === 'ai' &&
                        item.questionId &&
                        (item.isSaved ? (
                          <Text
                            type="secondary"
                            style={{ display: 'block', marginTop: 8 }}
                          >
                            已沉淀
                          </Text>
                        ) : (
                          <Dropdown
                            menu={{
                              items: [
                                {
                                  key: 'material',
                                  label: '保存到材料问答',
                                },
                                ...((topic?.concepts ?? []).map((concept) => ({
                                  key: `concept-${concept.id}`,
                                  label: `保存到概念：${concept.title}`,
                                }))),
                              ],
                              onClick: ({ key }) => {
                                const conceptId = key.startsWith('concept-')
                                  ? Number(key.replace('concept-', ''))
                                  : undefined;
                                void handleSaveQuestion(
                                  item.questionId!,
                                  conceptId,
                                );
                              },
                            }}
                          >
                            <Button size="small" style={{ marginTop: 8 }}>
                              沉淀问答
                            </Button>
                          </Dropdown>
                        ))}
                    </div>
                  </div>
                </List.Item>
              )}
            />
          </div>
          <Divider style={{ margin: '8px 0' }} />
          {selectedText && (
            <Alert
              type="info"
              showIcon
              message="将基于以下选中内容提问"
              description={
                <div>
                  <div
                    style={{
                      maxHeight: 88,
                      margin: '6px 0',
                      overflowY: 'auto',
                      whiteSpace: 'pre-wrap',
                    }}
                  >
                    “{selectedText}”
                  </div>
                  <Button
                    type="link"
                    size="small"
                    onClick={() => {
                      setSelectedText('');
                      setSelectedAnchor(null);
                    }}
                  >
                    取消引用
                  </Button>
                </div>
              }
              style={{ marginBottom: 8 }}
            />
          )}
          <Space.Compact style={{ width: '100%' }}>
            <Input
              placeholder="问问 AI..."
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              onPressEnter={handleAsk}
            />
            <Button
              type="primary"
              icon={<SendOutlined />}
              onClick={() => void handleAsk()}
            />
          </Space.Compact>
          </div>
        )}
      {assistantVisible && assistantTab === 'question-history' && (
        <List
          dataSource={topic?.questions ?? []}
          locale={{ emptyText: '当前话题还没有问答记录。' }}
          renderItem={(item) => (
            <List.Item
              style={
                selectedQuestionId === item.id
                  ? { background: '#fff7e6', padding: '8px' }
                  : undefined
              }
              actions={[
                <Button
                  key="source"
                  type="link"
                  disabled={item.start_offset === null}
                  onClick={() => handleJumpToQuestion(item.id)}
                >
                  查看原文
                </Button>,
                <Popconfirm
                  key="delete"
                  title="删除这条问答？"
                  okText="删除"
                  cancelText="取消"
                  okButtonProps={{ danger: true }}
                  onConfirm={() => void handleDeleteQuestion(item.id)}
                >
                  <Button type="link" danger>
                    删除
                  </Button>
                </Popconfirm>,
              ]}
            >
              <List.Item.Meta
                title={item.question_text}
                description={
                  item.ai_responses[0]?.content ||
                  'AI 回答正在生成或尚未可用。'
                }
              />
            </List.Item>
          )}
        />
      )}
      {assistantVisible && assistantTab === 'concepts' && (
        <>
          <List
            dataSource={topic?.concepts ?? []}
            locale={{ emptyText: '从阅读中标记概念后，会在这里集中显示。' }}
            renderItem={(concept) => (
              <List.Item
                style={
                  selectedConceptId === concept.id
                    ? { background: '#e6f4ff', padding: '8px' }
                    : undefined
                }
                actions={[
                  <Button
                    key="source"
                    type="link"
                    onClick={() => handleJumpToConcept(concept)}
                  >
                    查看来源
                  </Button>,
                  <Dropdown
                    key="more"
                    menu={{
                      items: [
                        { key: 'edit', label: '编辑概念' },
                        ...(concept.status === 'draft' &&
                        !pendingConceptIds.has(concept.id)
                          ? [{ key: 'confirm', label: '确认概念' }]
                          : []),
                        { key: 'delete', label: '删除概念', danger: true },
                      ],
                      onClick: ({ key }) => {
                        if (key === 'edit') openConceptEditor(concept);
                        if (key === 'confirm') {
                          void saveConcept(concept, true, concept);
                        }
                        if (key === 'delete') confirmDeleteConcept(concept);
                      },
                    }}
                  >
                    <Button type="link">更多</Button>
                  </Dropdown>,
                ]}
              >
                <List.Item.Meta
                  title={
                    <Space size={6}>
                      <span>{concept.title}</span>
                      <Typography.Text
                        style={{
                          color: pendingConceptIds.has(concept.id)
                            ? '#389e0d'
                            : concept.status === 'confirmed'
                              ? '#0958d9'
                              : '#389e0d',
                        }}
                      >
                        {pendingConceptIds.has(concept.id)
                          ? '草稿生成中'
                          : concept.status_display}
                      </Typography.Text>
                    </Space>
                  }
                  description={
                    <Typography.Paragraph ellipsis={{ rows: 3 }}>
                      {concept.definition || '概念草稿正在等待补全。'}
                    </Typography.Paragraph>
                  }
                />
              </List.Item>
            )}
          />
        </>
      )}

      {assistantVisible && assistantTab === 'highlights' && (
        <>
          <List
            dataSource={(topic?.highlights ?? []).filter(
              (highlight) => highlight.material === material.id,
            )}
            locale={{ emptyText: '当前材料还没有高亮片段' }}
            renderItem={(highlight) => (
              <List.Item
                style={
                  selectedHighlightId === highlight.id
                    ? { background: '#fffbe6', padding: '8px' }
                    : undefined
                }
              actions={[
                <Button
                  key="jump"
                  type="link"
                  onClick={() => handleJumpToHighlight(highlight.id)}
                >
                  查看原文
                </Button>,
                <Popconfirm
                  key="delete"
                  title="删除这条高亮？"
                  okText="删除"
                  okButtonProps={{ danger: true }}
                  cancelText="取消"
                  onConfirm={() => void handleDeleteHighlight(highlight.id)}
                >
                  <Button type="link" danger>
                    删除
                  </Button>
                </Popconfirm>,
              ]}
            >
              <List.Item.Meta
                title={`高亮于 ${new Date(highlight.created_at).toLocaleString()}`}
                description={
                  <Typography.Paragraph ellipsis={{ rows: 3 }}>
                    {highlight.source_text}
                  </Typography.Paragraph>
                }
              />
              </List.Item>
            )}
          />
        </>
      )}
      </Drawer>

      <Modal
        title="标记为概念"
        open={conceptModalOpen}
        onCancel={closeConceptModal}
        onOk={() => conceptForm.submit()}
        confirmLoading={conceptSaving}
        okText="后台生成草稿"
        width={680}
      >
        {conceptSelection && (
          <Alert
            type="info"
            showIcon
            message="AI 将根据当前选中原文生成可编辑的概念草稿。"
            description={`“${conceptSelection.text}”`}
            style={{ marginBottom: 16 }}
          />
        )}
        <Form
          form={conceptForm}
          layout="vertical"
          onFinish={(values) => void handleConceptSubmit(values)}
        >
          <Form.Item
            name="title"
            label="概念名称"
            rules={[{ required: true, message: '请输入概念名称' }]}
          >
            <Input />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="编辑概念卡片"
        open={conceptEditorOpen}
        onCancel={() => {
          setConceptEditorOpen(false);
          setEditingConcept(null);
          conceptEditorForm.resetFields();
        }}
        onOk={() => conceptEditorForm.submit()}
        width={680}
      >
        <Form
          form={conceptEditorForm}
          layout="vertical"
          onFinish={(values) => void saveConcept(values)}
        >
          <Form.Item
            name="title"
            label="概念名称"
            rules={[{ required: true, message: '请输入概念名称' }]}
          >
            <Input />
          </Form.Item>
          <Form.Item name="definition" label="定义">
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item name="principle" label="原理">
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item name="pitfalls" label="易错点">
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item name="applications" label="适用场景">
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>

      <FloatButton
        icon={<AppstoreOutlined />}
        type="primary"
        style={{ right: 24 }}
        onClick={() => setAssistantVisible(!assistantVisible)}
        badge={{ dot: selectedText !== '' }}
      />
    </Layout>
  );
};

export default MaterialReader;
