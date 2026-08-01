import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Alert, Button, Divider, Drawer, FloatButton, Input, Layout, List, message, Space, Typography } from 'antd';
import { ArrowLeftOutlined, CommentOutlined, ReloadOutlined, SendOutlined } from '@ant-design/icons';
import { createQuestion, getQuestion, getTopic, listAITasks, retryAITask } from '../../api';
import type { AITask, Material, Topic } from '../../api';
import { useAITaskPolling } from '../../hooks/useAITaskPolling';

const { Title, Paragraph, Text } = Typography;
const { Content } = Layout;

type ChatItem = {
  id?: number;
  role: 'user' | 'ai';
  content: string;
  selection?: string;
  type?: string;
  task?: AITask;
};

const MaterialReader: React.FC = () => {
  const { topicId, materialId } = useParams<{ topicId: string; materialId: string }>();
  const [topic, setTopic] = useState<Topic | null>(null);
  const [material, setMaterial] = useState<Material | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedText, setSelectedText] = useState('');
  const [chatVisible, setChatVisible] = useState(false);
  const [question, setQuestion] = useState('');
  const [chatHistory, setChatHistory] = useState<ChatItem[]>([]);
  const [activeTaskId, setActiveTaskId] = useState<number | null>(null);
  const [activeTaskType, setActiveTaskType] = useState<string | null>(null);
  const navigate = useNavigate();
  const contentRef = useRef<HTMLDivElement>(null);

  const loadData = useCallback(async () => {
    if (!topicId || !materialId) return;
    const response = await getTopic(Number(topicId));
    setTopic(response.data);
    const nextMaterial = response.data.materials.find((item) => item.id === Number(materialId)) ?? null;
    setMaterial(nextMaterial);
    if (nextMaterial) {
      const briefing = nextMaterial.ai_responses.find((item) => item.task_type === 'briefing');
      setChatHistory((current) => {
        const withoutBriefing = current.filter((item) => item.type !== 'briefing');
        return briefing ? [{ role: 'ai', content: briefing.content, type: 'briefing' }, ...withoutBriefing] : withoutBriefing;
      });
    }
  }, [materialId, topicId]);

  const handleTaskSuccess = useCallback(async (task: AITask) => {
    if (task.task_type === 'briefing') {
      await loadData();
    } else if (task.task_type === 'answer_question' && task.result_json.question_id) {
      const response = await getQuestion(task.result_json.question_id);
      const answer = response.data.ai_responses[0];
      if (answer) {
        setChatHistory((current) => current.map((item) =>
          item.task?.id === task.id ? { role: 'ai', content: answer.content } : item,
        ));
      }
    }
    setActiveTaskId(null);
    setActiveTaskType(null);
  }, [loadData]);

  const handleTaskFailure = useCallback((task: AITask) => {
    setChatHistory((current) => current.map((item) =>
      item.task?.id === task.id ? { ...item, content: task.error_message || 'AI 任务失败。', task } : item,
    ));
  }, []);

  const activeTask = useAITaskPolling(activeTaskId, {
    onSucceeded: (task) => { void handleTaskSuccess(task); },
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
    if (!material || activeTaskId) return;
    void listAITasks({ material: material.id }).then((response) => {
      const task = response.data.find((item) => item.status === 'pending' || item.status === 'running');
      if (task) {
        setActiveTaskId(task.id);
        setActiveTaskType(task.task_type);
      }
    });
  }, [activeTaskId, material]);

  const handleMouseUp = () => {
    const selection = window.getSelection();
    const text = selection?.toString().trim();
    if (text) {
      setSelectedText(text);
      setChatVisible(true);
    }
  };

  const handleAsk = async () => {
    if (!question.trim() || !topic || !material) return;
    const currentQuestion = question;
    const currentSelection = selectedText;
    setQuestion('');
    setSelectedText('');
    setChatHistory((current) => [...current, { role: 'user', content: currentQuestion, selection: currentSelection }]);
    try {
      const response = await createQuestion({
        topic: topic.id,
        material: material.id,
        selected_text: currentSelection,
        question_text: currentQuestion,
      });
      const task = response.data.task;
      setChatHistory((current) => [...current, { role: 'ai', content: 'AI 正在思考...', task }]);
      setActiveTaskId(task.id);
      setActiveTaskType(task.task_type);
    } catch (error) {
      console.error('Failed to ask question:', error);
      message.error('提问提交失败');
    }
  };

  const handleRetry = async (task: AITask) => {
    const response = await retryAITask(task.id);
    setActiveTaskId(response.data.id);
    setActiveTaskType(response.data.task_type);
  };

  if (loading && !material) return <div style={{ padding: '24px' }}>加载中...</div>;
  if (!material) return <div style={{ padding: '24px' }}>未找到材料</div>;

  return (
    <Layout style={{ height: 'calc(100vh - 64px)', background: '#fdfdfd' }}>
      <Content style={{ padding: '40px 24px', overflowY: 'auto', background: 'transparent' }}>
        <div style={{ maxWidth: '720px', margin: '0 auto', background: '#fff', padding: '60px 80px', boxShadow: '0 2px 12px rgba(0,0,0,0.05)', borderRadius: '8px', minHeight: '100%' }}>
          <Button type="text" icon={<ArrowLeftOutlined />} onClick={() => navigate(`/topics/${topicId}`)} style={{ marginBottom: '40px', color: '#999' }}>返回主题</Button>
          <Title level={1} style={{ marginBottom: '48px', fontSize: '32px', fontWeight: 600 }}>{material.title}</Title>
          <div ref={contentRef} onMouseUp={handleMouseUp} className="reading-content">
            {material.clean_text.split(/\n+/).map((paragraph, index) => paragraph.trim() && (
              <Paragraph key={index} style={{ fontSize: '18px', lineHeight: '1.8', marginBottom: '1.5em', color: '#2c3e50', textAlign: 'justify', letterSpacing: '0.02em' }}>{paragraph.trim()}</Paragraph>
            ))}
          </div>
        </div>
      </Content>
      <Drawer title="AI 学习助手" placement="right" width={400} onClose={() => setChatVisible(false)} open={chatVisible} mask={false}>
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
          <div style={{ flex: 1, overflowY: 'auto', marginBottom: '16px' }}>
            <List dataSource={chatHistory} renderItem={(item) => (
              <List.Item style={{ border: 'none', padding: '8px 0' }}>
                <div style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: item.role === 'user' ? 'flex-end' : 'flex-start' }}>
                  {item.selection && <div style={{ fontSize: '12px', color: '#999', background: '#f5f5f5', padding: '4px 8px', borderRadius: '4px', marginBottom: '4px', maxWidth: '80%' }}>引用：“{item.selection}”</div>}
                  <div style={{ background: item.role === 'user' ? '#1677ff' : '#f0f0f0', color: item.role === 'user' ? '#fff' : '#333', padding: '8px 12px', borderRadius: '8px', maxWidth: '90%', whiteSpace: 'pre-wrap' }}>
                    {item.type === 'briefing' && <Text strong style={{ display: 'block', marginBottom: '4px' }}>阅读前导：</Text>}
                    {item.content}
                    {item.task?.status === 'failed' && <Button size="small" icon={<ReloadOutlined />} onClick={() => void handleRetry(item.task!)} style={{ marginTop: 8 }}>重试</Button>}
                  </div>
                </div>
              </List.Item>
            )} />
          </div>
          {activeTask && <Alert type="info" showIcon message={activeTaskType === 'briefing' ? '正在生成阅读前导，可继续阅读或稍后返回。' : 'AI 正在思考，可继续阅读或稍后返回。'} style={{ marginBottom: 8 }} />}
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
                  <Button type="link" size="small" onClick={() => setSelectedText('')}>
                    取消引用
                  </Button>
                </div>
              }
              style={{ marginBottom: 8 }}
            />
          )}
          <Space.Compact style={{ width: '100%' }}>
            <Input placeholder="问问 AI..." value={question} onChange={(event) => setQuestion(event.target.value)} onPressEnter={handleAsk} />
            <Button type="primary" icon={<SendOutlined />} onClick={handleAsk} />
          </Space.Compact>
        </div>
      </Drawer>
      <FloatButton icon={<CommentOutlined />} type="primary" style={{ right: 24 }} onClick={() => setChatVisible(!chatVisible)} badge={{ dot: selectedText !== '' }} />
    </Layout>
  );
};

export default MaterialReader;
