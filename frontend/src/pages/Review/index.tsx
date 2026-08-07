import React, { useCallback, useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Alert, Button, Card, Empty, Form, Input, List, Modal, Space, Tag, Typography, message } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import {
  createReviewPrompt,
  getAITask,
  getReviews,
  listAITasks,
  retryAITask,
  submitReview,
} from '../../api';
import type { AITask, ReviewRecord } from '../../api';
import './styles.css';

const activeTaskStatuses = ['pending', 'running'];

function taskKey(task: Pick<AITask, 'trigger_id' | 'task_type'>) {
  return `${task.trigger_id}:${task.task_type}`;
}

const ReviewPage: React.FC = () => {
  const [reviews, setReviews] = useState<ReviewRecord[]>([]);
  const [active, setActive] = useState<ReviewRecord | null>(null);
  const [tasks, setTasks] = useState<Record<string, AITask>>({});
  const [loading, setLoading] = useState(false);
  const [form] = Form.useForm<{ response_text: string }>();
  const navigate = useNavigate();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [reviewsResponse, tasksResponse] = await Promise.all([
        getReviews(),
        listAITasks({ trigger_type: 'ReviewRecord' }),
      ]);
      setReviews(reviewsResponse.data);
      const latestTasks: Record<string, AITask> = {};
      tasksResponse.data.forEach((task) => {
        if (
          ['review_prompt', 'grade_review'].includes(task.task_type)
          && !latestTasks[taskKey(task)]
        ) {
          latestTasks[taskKey(task)] = task;
        }
      });
      setTasks(latestTasks);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load().catch(() => message.error('加载复习计划失败'));
  }, [load]);

  const activeTasks = useMemo(
    () => Object.values(tasks).filter((task) => activeTaskStatuses.includes(task.status)),
    [tasks],
  );

  useEffect(() => {
    if (!activeTasks.length) return;
    const timer = window.setInterval(async () => {
      try {
        const refreshed = await Promise.all(
          activeTasks.map(async (task) => (await getAITask(task.id)).data),
        );
        setTasks((current) => {
          const next = { ...current };
          refreshed.forEach((task) => { next[taskKey(task)] = task; });
          return next;
        });
        const finished = refreshed.filter((task) => !activeTaskStatuses.includes(task.status));
        if (finished.length) {
          finished.forEach((task) => {
            if (task.status === 'succeeded') {
              message.success(`${task.task_type_display}已完成`);
            }
          });
          await load();
        }
      } catch {
        message.error('刷新复习任务状态失败');
      }
    }, 1500);
    return () => window.clearInterval(timer);
  }, [activeTasks, load]);

  const setTask = (task: AITask) => {
    setTasks((current) => ({ ...current, [taskKey(task)]: task }));
  };

  const createPrompt = async (review: ReviewRecord) => {
    try {
      setTask((await createReviewPrompt(review.id)).data.task);
    } catch {
      message.error('提交复习提示任务失败');
    }
  };

  const submit = async ({ response_text }: { response_text: string }) => {
    if (!active) return;
    try {
      setTask((await submitReview(active.id, response_text)).data.task);
      message.info('复盘评分任务已提交');
      setActive(null);
      form.resetFields();
      await load();
    } catch {
      message.error('提交复盘失败');
    }
  };

  const retry = async (task: AITask) => {
    try {
      setTask((await retryAITask(task.id)).data);
      message.info('复习任务已重新进入队列');
    } catch {
      message.error('重试复习任务失败');
    }
  };

  const renderTaskState = (task: AITask | undefined) => {
    if (!task || task.status === 'succeeded') return null;
    if (activeTaskStatuses.includes(task.status)) {
      return (
        <Alert
          type="info"
          showIcon
          message={`${task.task_type_display}${task.status === 'pending' ? '正在排队' : '正在执行'}`}
        />
      );
    }
    if (['failed', 'cancelled'].includes(task.status)) {
      return (
        <Alert
          type="error"
          showIcon
          message={`${task.task_type_display}${task.status === 'failed' ? '失败' : '已取消'}`}
          description={task.error_message || '任务未完成，可以重新提交。'}
          action={<Button size="small" icon={<ReloadOutlined />} onClick={() => void retry(task)}>重试</Button>}
        />
      );
    }
    return null;
  };

  const activeGradeTask = active
    ? tasks[`${active.id}:grade_review`]
    : undefined;

  return <div style={{ maxWidth: 1100, margin: '0 auto', padding: 24 }}>
    <Card title="复习计划" extra={<Button loading={loading} onClick={() => void load()}>刷新</Button>}>
      <List dataSource={reviews} locale={{ emptyText: <Empty description="暂无复习计划" /> }} renderItem={(item) => (
        (() => {
          const promptTask = tasks[`${item.id}:review_prompt`];
          const gradeTask = tasks[`${item.id}:grade_review`];
          const hasActiveTask = [promptTask, gradeTask].some(
            (task) => task && activeTaskStatuses.includes(task.status),
          );
          return (
            <List.Item actions={[
              item.result === 'pending' ? (
                <Button
                  key="prompt"
                  loading={Boolean(promptTask && activeTaskStatuses.includes(promptTask.status))}
                  disabled={hasActiveTask}
                  onClick={() => void createPrompt(item)}
                >
                  {item.review_prompt ? '重新生成提示' : '生成提示'}
                </Button>
              ) : null,
              item.result === 'pending' ? (
                <Button
                  key="submit"
                  type="primary"
                  disabled={hasActiveTask}
                  onClick={() => {
                    setActive(item);
                    form.setFieldsValue({ response_text: item.response_text });
                  }}
                >
                  提交复盘
                </Button>
              ) : null,
              <Button key="topic" type="link" onClick={() => navigate(`/topics/${item.topic}`)}>进入主题</Button>,
            ]}>
              <List.Item.Meta
                title={(
                  <Space>
                    <span>{item.topic_title}</span>
                    <Tag color={item.result === 'completed' ? 'success' : 'blue'}>{item.result_display}</Tag>
                    {item.score !== null && <Tag color="purple">{item.score} 分</Tag>}
                  </Space>
                )}
                description={(
                  <Space direction="vertical" size="small" style={{ display: 'flex' }}>
                    <Typography.Text type="secondary">应复习：{new Date(item.due_at).toLocaleString()}</Typography.Text>
                    {item.review_prompt && (
                      <div className="review__markdown">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{item.review_prompt}</ReactMarkdown>
                      </div>
                    )}
                    {item.feedback && <Typography.Text>反馈：{item.feedback}</Typography.Text>}
                    {item.next_due_at && <Typography.Text type="secondary">下次复习：{new Date(item.next_due_at).toLocaleString()}</Typography.Text>}
                    {renderTaskState(gradeTask)}
                    {renderTaskState(promptTask)}
                  </Space>
                )}
              />
            </List.Item>
          );
        })()
      )} />
    </Card>
    <Modal
      title="提交复盘"
      open={Boolean(active)}
      confirmLoading={Boolean(activeGradeTask && activeTaskStatuses.includes(activeGradeTask.status))}
      onCancel={() => setActive(null)}
      onOk={() => form.submit()}
    >
      {active?.review_prompt && (
        <div className="review__markdown">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{active.review_prompt}</ReactMarkdown>
        </div>
      )}
      <Form form={form} layout="vertical" onFinish={(values) => void submit(values)}><Form.Item name="response_text" label="本次主动回忆与应用" rules={[{ required: true }]}><Input.TextArea rows={8} /></Form.Item></Form>
    </Modal>
  </div>;
};

export default ReviewPage;
