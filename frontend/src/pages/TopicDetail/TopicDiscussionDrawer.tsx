import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Collapse,
  Drawer,
  Empty,
  Input,
  Progress,
  Space,
  Spin,
  Tag,
  Typography,
  message,
  theme,
} from 'antd';
import {
  CheckOutlined,
  CloseOutlined,
  FileSearchOutlined,
  LinkOutlined,
  SendOutlined,
} from '@ant-design/icons';
import {
  adoptMaterialRecommendation,
  createDiscussionMessage,
  dismissMaterialRecommendation,
  getDiscussion,
  triggerSupplement,
} from '../../api';
import './discussion.css';
import type {
  AITask,
  MaterialRecommendation,
  SessionMessage,
} from '../../api';
import MarkdownContent from '../../components/MarkdownContent';
import { useAITaskPolling } from '../../hooks/useAITaskPolling';

interface Props {
  topicId: number;
  open: boolean;
  onClose: () => void;
  onMaterialsChanged: () => Promise<void>;
}

const supplementStageLabels: Record<string, string> = {
  searching: '正在检索候选资料',
  crawling: '正在抓取候选正文',
  evaluating: '正在评估资料相关度',
  completed: '检索已完成',
};

const TopicDiscussionDrawer: React.FC<Props> = ({
  topicId,
  open,
  onClose,
  onMaterialsChanged,
}) => {
  const [messages, setMessages] = useState<SessionMessage[]>([]);
  const [recommendations, setRecommendations] = useState<MaterialRecommendation[]>([]);
  const [tasks, setTasks] = useState<AITask[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [startingSearch, setStartingSearch] = useState(false);
  const [processingId, setProcessingId] = useState<number | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const { token } = theme.useToken();

  const load = useCallback(async () => {
    const response = await getDiscussion(topicId);
    setMessages(response.data.messages);
    setRecommendations(response.data.recommendations);
    setTasks(response.data.active_tasks);
  }, [topicId]);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    void load()
      .catch(() => message.error('加载学习讨论失败'))
      .finally(() => setLoading(false));
  }, [load, open]);

  useAITaskPolling(tasks, {
    enabled: open,
    onUpdate: (nextTasks) => setTasks(nextTasks as AITask[]),
    onSettled: async (settled) => {
      const failed = settled.find((task) => task.status === 'failed');
      if (failed) {
        message.error(failed.error_message || `${failed.task_type_display}失败`);
      }
      const completedSupplement = settled.find(
        (task) => task.task_type === 'supplement_search' && task.status === 'succeeded',
      );
      if (completedSupplement) {
        const count = Number(completedSupplement.result_json.recommended_count ?? 0);
        message.success(
          count ? `找到 ${count} 篇候选材料，请人工采纳。` : '未找到达到相关度要求的资料。',
        );
      }
      await load();
    },
    onError: () => message.error('刷新讨论任务状态失败'),
  });

  useEffect(() => {
    if (!open) return;
    endRef.current?.scrollIntoView({ block: 'nearest' });
  }, [messages, open, recommendations, tasks]);

  const activeTask = useMemo(
    () => tasks.find((task) => ['pending', 'running'].includes(task.status)),
    [tasks],
  );
  const activeChatTask = useMemo(
    () =>
      tasks.find(
        (task) =>
          task.task_type === 'discussion_reply' &&
          ['pending', 'running'].includes(task.status),
      ),
    [tasks],
  );
  const activeSupplementTask = useMemo(
    () =>
      tasks.find(
        (task) =>
          task.task_type === 'supplement_search' &&
          ['pending', 'running'].includes(task.status),
      ),
    [tasks],
  );
  const supplementProgress = useMemo(() => {
    if (!activeSupplementTask) return null;
    const result = activeSupplementTask.result_json;
    const candidates = Array.isArray(result.candidates) ? result.candidates : [];
    const searchedCount = Number(result.searched_count ?? 0);
    const total = Math.min(searchedCount, 20);
    const processed = candidates.length;
    return {
      stage: String(result.stage ?? ''),
      searchedCount,
      processed,
      recommended: candidates.filter(
        (candidate) => candidate.status === 'recommended',
      ).length,
      percent: total > 0 ? Math.min(99, Math.round((processed / total) * 100)) : 5,
    };
  }, [activeSupplementTask]);

  const send = async () => {
    const content = draft.trim();
    if (!content || sending || activeChatTask) return;
    setSending(true);
    try {
      const response = await createDiscussionMessage(topicId, content);
      setMessages((current) => [...current, response.data.message]);
      setTasks((current) => [...current, response.data.task]);
      setDraft('');
    } catch {
      message.error('发送失败，请重试');
    } finally {
      setSending(false);
    }
  };

  const startMaterialSearch = async () => {
    if (startingSearch || activeSupplementTask) return;
    setStartingSearch(true);
    try {
      const response = await triggerSupplement(topicId);
      setTasks((current) => {
        const remaining = current.filter((task) => task.id !== response.data.task.id);
        return [...remaining, response.data.task];
      });
      message.info(
        response.data.created ? '正在检索补充资料。' : '已有资料检索任务正在执行。',
      );
    } catch {
      message.error('查找材料失败，请确认本地检索服务已启动后重试');
    } finally {
      setStartingSearch(false);
    }
  };

  const adopt = async (recommendation: MaterialRecommendation) => {
    setProcessingId(recommendation.id);
    try {
      const response = await adoptMaterialRecommendation(recommendation.id);
      setRecommendations((current) =>
        current.map((item) =>
          item.id === recommendation.id ? response.data.recommendation : item,
        ),
      );
      message.success('已采纳，材料正在进入处理流水线');
      await onMaterialsChanged();
    } catch {
      message.error('采纳失败');
    } finally {
      setProcessingId(null);
    }
  };

  const dismiss = async (recommendation: MaterialRecommendation) => {
    setProcessingId(recommendation.id);
    try {
      const response = await dismissMaterialRecommendation(recommendation.id);
      setRecommendations((current) =>
        current.map((item) =>
          item.id === recommendation.id ? response.data : item,
        ),
      );
    } catch {
      message.error('忽略失败');
    } finally {
      setProcessingId(null);
    }
  };

  const recommendationCards = (messageId: number | null) => {
    const matching = recommendations.filter((item) => item.message === messageId);
    const pending = matching.filter((item) => item.status === 'pending');
    const decided = matching.filter((item) => item.status !== 'pending');
    const renderCard = (item: MaterialRecommendation) => (
        <Card
          key={item.id}
          size="small"
          style={{
            marginTop: 8,
            borderColor: item.status === 'pending' ? token.colorInfoBorder : undefined,
          }}
          title={
            <Typography.Text ellipsis={{ tooltip: item.title }} style={{ maxWidth: 260 }}>
              {item.title}
            </Typography.Text>
          }
          extra={<Tag color={item.status === 'pending' ? 'blue' : 'default'}>{item.status_display}</Tag>}
        >
          <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
            {item.reason}
          </Typography.Paragraph>
          <Space wrap>
            <Tag>{item.category_display}</Tag>
            <Tag color="purple">相关度 {Math.round(item.relevance_score * 100)}%</Tag>
          </Space>
          <Space style={{ marginTop: 12 }}>
            <Button
              size="small"
              type="primary"
              icon={<CheckOutlined />}
              disabled={item.status !== 'pending'}
              loading={processingId === item.id}
              onClick={() => void adopt(item)}
            >
              采纳
            </Button>
            <Button
              size="small"
              icon={<CloseOutlined />}
              disabled={item.status !== 'pending'}
              onClick={() => void dismiss(item)}
            >
              忽略
            </Button>
            <Button
              size="small"
              type="link"
              icon={<LinkOutlined />}
              href={item.url}
              target="_blank"
            >
              原文
            </Button>
          </Space>
        </Card>
    );

    return (
      <>
        {pending.map(renderCard)}
        {decided.length > 0 && (
          <Collapse
            ghost
            size="small"
            style={{ marginTop: 8, width: '100%' }}
            items={[
              {
                key: 'decided',
                label: `已处理材料（${decided.length}）`,
                children: decided.map(renderCard),
              },
            ]}
          />
        )}
      </>
    );
  };

  return (
    <Drawer
      title={
        <Space>
          <span>学习讨论</span>
          <Tag>{recommendations.filter((item) => item.status === 'pending').length} 条待采纳</Tag>
        </Space>
      }
      size={460}
      open={open}
      onClose={onClose}
      destroyOnClose={false}
      styles={{
        body: { padding: 16, display: 'flex', flexDirection: 'column' },
      }}
    >
      <Spin spinning={loading}>
        <div style={{ flex: 1, minHeight: 320, overflowY: 'auto', paddingRight: 4 }}>
          {activeSupplementTask && supplementProgress && (
            <Alert
              role="status"
              aria-label={`补充资料检索进行中：已发现 ${supplementProgress.searchedCount} 个候选，已处理 ${supplementProgress.processed} 个，当前推荐 ${supplementProgress.recommended} 个`}
              type="info"
              showIcon
              title={
                activeSupplementTask.status === 'pending'
                  ? '补充资料检索正在排队'
                  : supplementStageLabels[supplementProgress.stage] || '补充资料检索仍在继续'
              }
              description={
                <div>
                  <div style={{ marginBottom: 6 }}>
                    已发现 {supplementProgress.searchedCount} 个候选，已处理 {supplementProgress.processed} 个，
                    当前推荐 {supplementProgress.recommended} 个。出现候选不代表任务已完成。
                  </div>
                  <Progress
                    percent={supplementProgress.percent}
                    size="small"
                    showInfo={false}
                    status="active"
                  />
                </div>
              }
              style={{
                position: 'sticky',
                top: 0,
                zIndex: 2,
                marginBottom: 12,
              }}
            />
          )}
          {!messages.length && !loading ? (
            <Empty description="从问题、判断或材料缺口开始讨论" />
          ) : (
            messages.map((item) => (
              <div
                key={item.id}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: item.msg_from === 'user' ? 'flex-end' : 'stretch',
                  marginBottom: 14,
                }}
              >
                <div
                  style={{
                    maxWidth: item.msg_from === 'user' ? '85%' : '100%',
                    padding: '10px 12px',
                    borderRadius: 10,
                    lineHeight: 1.6,
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
                  <div className="topic-discussion__markdown">
                    <MarkdownContent>{item.msg_content}</MarkdownContent>
                  </div>
                </div>
                {item.msg_from === 'ai' && recommendationCards(item.id)}
              </div>
            ))
          )}
          {recommendationCards(null)}
          {activeTask && activeTask.task_type !== 'supplement_search' && (
            <Alert
              type="info"
              showIcon
              title={
                activeTask.status === 'pending'
                  ? `正在等待“${activeTask.task_type_display}”`
                  : `正在使用 ${activeTask.model} 执行“${activeTask.task_type_display}”`
              }
              style={{ marginTop: 8 }}
            />
          )}
          <div ref={endRef} />
        </div>
      </Spin>
      <div
        style={{
          borderTop: `1px solid ${token.colorBorderSecondary}`,
          paddingTop: 12,
          marginTop: 12,
        }}
      >
        <Input.TextArea
          value={draft}
          autoSize={{ minRows: 2, maxRows: 6 }}
          placeholder="输入问题或想法，Shift+Enter 换行"
          disabled={Boolean(activeChatTask)}
          onChange={(event) => setDraft(event.target.value)}
          onPressEnter={(event) => {
            if (event.shiftKey) return;
            event.preventDefault();
            void send();
          }}
        />
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            gap: 8,
            marginTop: 8,
          }}
        >
          <Button
            icon={<FileSearchOutlined />}
            loading={startingSearch}
            disabled={Boolean(activeSupplementTask)}
            onClick={() => void startMaterialSearch()}
          >
            查找材料
          </Button>
          <Button
            type="primary"
            icon={<SendOutlined />}
            loading={sending}
            disabled={!draft.trim() || Boolean(activeChatTask)}
            onClick={() => void send()}
          >
            发送
          </Button>
        </div>
      </div>
    </Drawer>
  );
};

export default TopicDiscussionDrawer;
