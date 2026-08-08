import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Drawer,
  Empty,
  Input,
  Space,
  Spin,
  Tag,
  Typography,
  message,
  theme,
} from 'antd';
import {
  ArrowRightOutlined,
  CheckOutlined,
  RobotOutlined,
  SendOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import {
  confirmManagementAssistantTopic,
  createManagementAssistantMessage,
  getManagementAssistant,
  retryAITask,
} from '../../api';
import type {
  ManagementAssistantTask,
  SessionMessage,
} from '../../api';
import './styles.css';

interface TopicDraft {
  title: string;
  goal: string;
  scope: string;
}

const quickPrompts = [
  '列出所有话题的学习目标和学习范围',
  '帮我创建一个新的学习话题',
];

export default function ManagementAssistant() {
  const navigate = useNavigate();
  const { token } = theme.useToken();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [confirmingId, setConfirmingId] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  const [messages, setMessages] = useState<SessionMessage[]>([]);
  const [tasks, setTasks] = useState<ManagementAssistantTask[]>([]);
  const endRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    const response = await getManagementAssistant();
    setMessages(response.data.session.messages);
    setTasks(response.data.tasks);
  }, []);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    void load()
      .catch(() => message.error('加载管理助手失败'))
      .finally(() => setLoading(false));
  }, [load, open]);

  const activeTask = useMemo(
    () => tasks.find((task) => ['pending', 'running'].includes(task.status)),
    [tasks],
  );

  useEffect(() => {
    if (!open || !activeTask) return;
    const timer = window.setInterval(() => {
      void load().catch(() => undefined);
    }, 1500);
    return () => window.clearInterval(timer);
  }, [activeTask, load, open]);

  useEffect(() => {
    if (!open) return;
    endRef.current?.scrollIntoView({ block: 'nearest' });
  }, [messages, open, tasks]);

  const send = async (content = draft) => {
    const normalized = content.trim();
    if (!normalized || sending || activeTask) return;
    setSending(true);
    try {
      const response = await createManagementAssistantMessage(normalized);
      setMessages((current) => [...current, response.data.message]);
      setTasks((current) => [response.data.task, ...current]);
      setDraft('');
    } catch {
      message.error('消息发送失败，请稍后重试');
    } finally {
      setSending(false);
    }
  };

  const confirmTopic = async (task: ManagementAssistantTask) => {
    setConfirmingId(task.id);
    try {
      const response = await confirmManagementAssistantTopic(task.id);
      await load();
      message.success(`已创建话题“${response.data.topic.title}”`);
    } catch {
      message.error('话题创建失败，请检查草稿后重试');
    } finally {
      setConfirmingId(null);
    }
  };

  const retry = async (task: ManagementAssistantTask) => {
    try {
      const response = await retryAITask(task.id);
      setTasks((current) =>
        current.map((item) => (item.id === task.id ? response.data : item)),
      );
    } catch {
      message.error('任务重试失败');
    }
  };

  const actionCard = (messageId: number) => {
    const task = tasks.find(
      (item) =>
        Number(item.result_json.message_id) === messageId &&
        item.result_json.action === 'draft_topic',
    );
    if (!task) return null;
    const topicDraft = task.result_json.draft as TopicDraft | undefined;
    if (!topicDraft) return null;
    const createdTopicId = Number(task.result_json.created_topic_id || 0);

    return (
      <Card
        size="small"
        className="management-assistant__action-card"
        title="话题草稿"
        extra={
          <Tag color={createdTopicId ? 'success' : 'processing'}>
            {createdTopicId ? '已创建' : '待确认'}
          </Tag>
        }
      >
        <Descriptions column={1} size="small">
          <Descriptions.Item label="话题">{topicDraft.title}</Descriptions.Item>
          <Descriptions.Item label="学习目标">{topicDraft.goal}</Descriptions.Item>
          <Descriptions.Item label="学习范围">{topicDraft.scope}</Descriptions.Item>
        </Descriptions>
        {createdTopicId ? (
          <Button
            type="link"
            icon={<ArrowRightOutlined />}
            onClick={() => {
              setOpen(false);
              navigate(`/topics/${createdTopicId}`);
            }}
          >
            进入话题
          </Button>
        ) : (
          <Button
            type="primary"
            icon={<CheckOutlined />}
            loading={confirmingId === task.id}
            onClick={() => void confirmTopic(task)}
          >
            确认创建
          </Button>
        )}
      </Card>
    );
  };

  const failedTask = tasks[0]?.status === 'failed' ? tasks[0] : undefined;

  return (
    <>
      <Button
        className="global-management-assistant-button"
        type="primary"
        shape="circle"
        size="large"
        icon={<RobotOutlined />}
        aria-label="打开全站管理助手"
        title="全站管理助手"
        onClick={() => setOpen(true)}
      />
      <Drawer
        title={
          <Space>
            <RobotOutlined />
            <span>全站管理助手</span>
          </Space>
        }
        size={520}
        open={open}
        onClose={() => setOpen(false)}
        destroyOnClose={false}
        styles={{
          body: { padding: 16, display: 'flex', flexDirection: 'column' },
        }}
      >
        <Spin spinning={loading}>
          <div className="management-assistant__messages">
            {!messages.length && !loading ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="可以查询现有数据，或快速创建学习话题"
              >
                <Space direction="vertical">
                  {quickPrompts.map((prompt) => (
                    <Button key={prompt} onClick={() => void send(prompt)}>
                      {prompt}
                    </Button>
                  ))}
                </Space>
              </Empty>
            ) : (
              messages.map((item) => (
                <div
                  key={item.id}
                  className={`management-assistant__message management-assistant__message--${item.msg_from}`}
                >
                  <div
                    className="management-assistant__bubble"
                    style={{
                      background:
                        item.msg_from === 'user'
                          ? token.colorPrimary
                          : token.colorFillSecondary,
                      color:
                        item.msg_from === 'user'
                          ? token.colorTextLightSolid
                          : token.colorText,
                    }}
                  >
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {item.msg_content}
                    </ReactMarkdown>
                  </div>
                  {item.msg_from === 'ai' && actionCard(item.id)}
                </div>
              ))
            )}
            {activeTask && (
              <Alert
                type="info"
                showIcon
                title={
                  activeTask.status === 'pending'
                    ? '管理助手正在排队'
                    : `管理助手正在使用 ${activeTask.model} 处理`
                }
              />
            )}
            {failedTask && (
              <Alert
                type="error"
                showIcon
                title="管理助手处理失败"
                description={failedTask.error_message}
                action={
                  <Button size="small" onClick={() => void retry(failedTask)}>
                    重试
                  </Button>
                }
              />
            )}
            <div ref={endRef} />
          </div>
        </Spin>
        <div
          className="management-assistant__composer"
          style={{ borderColor: token.colorBorderSecondary }}
        >
          {!messages.length && (
            <Typography.Text type="secondary">
              创建话题时请提供话题名称、学习目标和学习范围。
            </Typography.Text>
          )}
          <Input.TextArea
            value={draft}
            autoSize={{ minRows: 2, maxRows: 6 }}
            placeholder="输入消息，Shift+Enter 换行"
            disabled={Boolean(activeTask)}
            onChange={(event) => setDraft(event.target.value)}
            onPressEnter={(event) => {
              if (event.shiftKey) return;
              event.preventDefault();
              void send();
            }}
          />
          <Button
            type="primary"
            icon={<SendOutlined />}
            loading={sending}
            disabled={!draft.trim() || Boolean(activeTask)}
            onClick={() => void send()}
          >
            发送
          </Button>
        </div>
      </Drawer>
    </>
  );
}
