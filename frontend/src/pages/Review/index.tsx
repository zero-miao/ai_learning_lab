import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, Empty, Form, Input, List, Modal, Space, Tag, Typography, message } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import {
  createReviewPrompt,
  getReviews,
  listAITasks,
  retryAITask,
  submitReview,
} from '../../api';
import type { AITaskSummary, ReviewRecord } from '../../api';
import MarkdownContent from '../../components/MarkdownContent';
import { useAITaskPolling } from '../../hooks/useAITaskPolling';
import './styles.css';

const activeTaskStatuses = ['pending', 'running'];

function taskKey(task: Pick<AITaskSummary, 'trigger_id' | 'task_type'>) {
  return `${task.trigger_id}:${task.task_type}`;
}

const ReviewPage: React.FC = () => {
  const [reviews, setReviews] = useState<ReviewRecord[]>([]);
  const [active, setActive] = useState<ReviewRecord | null>(null);
  const [tasks, setTasks] = useState<Record<string, AITaskSummary>>({});
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [total, setTotal] = useState(0);
  const [form] = Form.useForm<{ response_text: string }>();
  const navigate = useNavigate();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [reviewsResponse, tasksResponse] = await Promise.all([
        getReviews({ page, page_size: pageSize }),
        listAITasks({ trigger_type: 'ReviewRecord' }),
      ]);
      setReviews(reviewsResponse.data.results);
      setTotal(reviewsResponse.data.count);
      const latestTasks: Record<string, AITaskSummary> = {};
      tasksResponse.data.results.forEach((task) => {
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
  }, [page, pageSize]);

  useEffect(() => {
    void load().catch(() => message.error('加载复习计划失败'));
  }, [load]);

  const activeTasks = useMemo(
    () => Object.values(tasks).filter((task) => activeTaskStatuses.includes(task.status)),
    [tasks],
  );

  useAITaskPolling(activeTasks, {
    onUpdate: (refreshed) => {
      setTasks((current) => {
        const next = { ...current };
        refreshed.forEach((task) => {
          next[taskKey(task)] = task;
        });
        return next;
      });
    },
    onSettled: async (finished) => {
      finished.forEach((task) => {
        if (task.status === 'succeeded') {
          message.success(`${task.task_type_display}已完成`);
        }
      });
      await load();
    },
    onError: () => message.error('刷新复习任务状态失败'),
  });

  const setTask = (task: AITaskSummary) => {
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

  const retry = async (task: AITaskSummary) => {
    try {
      setTask((await retryAITask(task.id)).data);
      message.info('复习任务已重新进入队列');
    } catch {
      message.error('重试复习任务失败');
    }
  };

  const renderTaskState = (task: AITaskSummary | undefined) => {
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
      <List
        dataSource={reviews}
        pagination={{
          current: page,
          pageSize,
          total,
          showSizeChanger: true,
          onChange: (nextPage, nextPageSize) => {
            setPage(nextPageSize === pageSize ? nextPage : 1);
            setPageSize(nextPageSize);
          },
        }}
        locale={{ emptyText: <Empty description="暂无复习计划" /> }}
        renderItem={(item) => (
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
                        <MarkdownContent>{item.review_prompt}</MarkdownContent>
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
        )}
      />
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
          <MarkdownContent>{active.review_prompt}</MarkdownContent>
        </div>
      )}
      <Form form={form} layout="vertical" onFinish={(values) => void submit(values)}><Form.Item name="response_text" label="本次主动回忆与应用" rules={[{ required: true }]}><Input.TextArea rows={8} /></Form.Item></Form>
    </Modal>
  </div>;
};

export default ReviewPage;
