import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Alert, Button, Divider, Drawer, FloatButton, Input, Layout, List, message, Space, Typography } from 'antd';
import { ArrowLeftOutlined, CommentOutlined, ReloadOutlined, SendOutlined } from '@ant-design/icons';
import { createQuestion, getQuestion, getTopic, listAITasks, retryAITask } from '../../api';
import type { AITask, Material, Topic } from '../../api';
import { useAITaskPolling } from '../../hooks/useAITaskPolling';
import UniversalReader from '../../components/UniversalReader';

const { Text } = Typography;
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
  const [darkMode, setDarkMode] = useState(false);
  const navigate = useNavigate();

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
    } else if (
      task.task_type === 'answer_question' &&
      typeof task.result_json.question_id === 'number'
    ) {
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

  const handleSelectText = (text: string) => {
    setSelectedText(text);
    setChatVisible(true);
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
    <Layout style={{ minHeight: 'calc(100vh - 64px)', background: darkMode ? '#0f0f0f' : '#f5f7fa' }}>
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
          <UniversalReader
            material={material}
            darkMode={darkMode}
            onDarkModeChange={setDarkMode}
            onSelectText={handleSelectText}
          />
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
