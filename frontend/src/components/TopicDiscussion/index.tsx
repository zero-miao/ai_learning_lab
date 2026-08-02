import React, { useCallback, useEffect, useState } from 'react';
import { Button, Collapse, Input, List, Space, Typography, message } from 'antd';
import { SendOutlined } from '@ant-design/icons';
import {
  createDiscussionMessage,
  getDiscussion,
  listAITasks,
} from '../../api';
import type { DiscussionMessage } from '../../api';
import { useAITaskPolling } from '../../hooks/useAITaskPolling';

const { Text } = Typography;

interface TopicDiscussionProps {
  topicId: number;
}

const TopicDiscussion: React.FC<TopicDiscussionProps> = ({ topicId }) => {
  const [messages, setMessages] = useState<DiscussionMessage[]>([]);
  const [input, setInput] = useState('');
  const [taskId, setTaskId] = useState<number | null>(null);

  const loadDiscussion = useCallback(async () => {
    const response = await getDiscussion(topicId);
    setMessages(response.data.messages);
  }, [topicId]);

  useEffect(() => {
    void loadDiscussion().catch((error) => {
      console.error('Failed to load topic discussion:', error);
      message.error('加载话题讨论失败');
    });
  }, [loadDiscussion]);

  useEffect(() => {
    if (taskId) return;
    void listAITasks({ topic: topicId }).then((response) => {
      const activeTask = response.data.find(
        (task) =>
          task.task_type === 'discussion_reply' &&
          (task.status === 'pending' || task.status === 'running'),
      );
      if (activeTask) setTaskId(activeTask.id);
    });
  }, [taskId, topicId]);

  const task = useAITaskPolling(taskId, {
    onSucceeded: () => {
      setTaskId(null);
      void loadDiscussion();
    },
    onFailed: (failedTask) => {
      setTaskId(null);
      message.error(failedTask.error_message || '讨论回复生成失败');
    },
  });

  const submitMessage = async () => {
    const content = input.trim();
    if (!content) return;
    setInput('');
    try {
      const response = await createDiscussionMessage(topicId, content);
      setMessages((current) => [...current, response.data.message]);
      setTaskId(response.data.task.id);
    } catch (error) {
      console.error('Failed to submit topic discussion message:', error);
      message.error('提交讨论消息失败');
    }
  };

  const discussionContent = (
    <>
      {task && (
        <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
          {task.status === 'running' ? 'AI 正在回复' : 'AI 回复已提交'}
        </Text>
      )}
      <List
        style={{ maxHeight: 420, overflowY: 'auto', marginBottom: 16 }}
        dataSource={messages}
        locale={{
          emptyText: '尚无讨论记录。可以围绕当前材料、概念或学习困惑开始讨论。',
        }}
        renderItem={(item) => (
          <List.Item style={{ border: 'none', padding: '6px 0' }}>
            <div
              style={{
                maxWidth: '88%',
                marginLeft: item.role === 'user' ? 'auto' : 0,
                padding: '10px 12px',
                borderRadius: 10,
                background: item.role === 'user' ? '#1677ff' : '#f5f5f5',
                color: item.role === 'user' ? '#fff' : '#1f2937',
                whiteSpace: 'pre-wrap',
              }}
            >
              {item.role === 'assistant' && (
                <Text strong style={{ display: 'block', marginBottom: 4 }}>
                  {item.message_type_display}
                </Text>
              )}
              {item.content}
            </div>
          </List.Item>
        )}
      />
      <Space.Compact style={{ width: '100%' }}>
        <Input
          placeholder="围绕当前学习内容继续讨论..."
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onPressEnter={() => void submitMessage()}
        />
        <Button
          type="primary"
          icon={<SendOutlined />}
          onClick={() => void submitMessage()}
        />
      </Space.Compact>
    </>
  );

  return (
    <Collapse
      items={[
        {
          key: 'discussion',
          label: `话题讨论 (${messages.length})`,
          children: discussionContent,
        },
      ]}
    />
  );
};

export default TopicDiscussion;
