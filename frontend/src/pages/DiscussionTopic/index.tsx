import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button, Card, Input, List, Space, Tag, Typography, message } from 'antd';
import { ArrowLeftOutlined, SendOutlined } from '@ant-design/icons';
import { createDiscussionMessage, getDiscussion, getAITask } from '../../api';
import type { AITask, SessionMessage, Topic } from '../../api';

const DiscussionTopic: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [topic, setTopic] = useState<Topic | null>(null);
  const [messages, setMessages] = useState<SessionMessage[]>([]);
  const [content, setContent] = useState('');
  const [task, setTask] = useState<AITask | null>(null);
  const load = useCallback(async () => {
    if (!id) return;
    const response = await getDiscussion(Number(id));
    setTopic(response.data.topic);
    setMessages(response.data.messages);
  }, [id]);
  useEffect(() => { void load().catch(() => message.error('加载讨论失败')); }, [load]);
  useEffect(() => {
    if (!task || !['pending', 'running'].includes(task.status)) return;
    const timer = window.setInterval(async () => {
      const next = (await getAITask(task.id)).data;
      setTask(next);
      if (next.status === 'succeeded') await load();
      if (next.status === 'failed') message.error(next.error_message || '讨论回复失败');
    }, 1500);
    return () => window.clearInterval(timer);
  }, [load, task]);
  const send = async () => {
    if (!topic || !content.trim()) return;
    const response = await createDiscussionMessage(topic.id, content.trim());
    setMessages((current) => [...current, response.data.message]);
    setContent('');
    setTask(response.data.task);
  };
  if (!topic) return <div style={{ padding: 24 }}>加载中...</div>;
  return <div style={{ maxWidth: 900, margin: '0 auto', padding: 24 }}>
    <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/topics')}>返回话题列表</Button>
    <Card style={{ marginTop: 16 }} title={<Space><span>{topic.title}</span><Tag color="purple">讨论</Tag></Space>}>
      <Typography.Paragraph type="secondary">{topic.goal || '围绕这个话题探索并形成学习决策。'}</Typography.Paragraph>
      <List style={{ minHeight: 360 }} dataSource={messages} locale={{ emptyText: '开始输入你的想法。' }} renderItem={(item) => (
        <List.Item style={{ border: 'none', justifyContent: item.msg_from === 'user' ? 'flex-end' : 'flex-start' }}>
          <div style={{ maxWidth: '80%', padding: '10px 12px', borderRadius: 8, whiteSpace: 'pre-wrap', background: item.msg_from === 'user' ? '#1677ff' : '#f5f5f5', color: item.msg_from === 'user' ? '#fff' : undefined }}>{item.msg_content}</div>
        </List.Item>
      )} />
      {task && ['pending', 'running'].includes(task.status) && <Typography.Text type="secondary">AI 正在回复...</Typography.Text>}
      <Space.Compact style={{ width: '100%', marginTop: 12 }}><Input value={content} onChange={(event) => setContent(event.target.value)} onPressEnter={() => void send()} placeholder="输入你的想法或问题" /><Button type="primary" icon={<SendOutlined />} onClick={() => void send()} /></Space.Compact>
    </Card>
  </div>;
};

export default DiscussionTopic;
