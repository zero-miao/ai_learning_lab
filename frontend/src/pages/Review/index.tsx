import React, { useEffect, useState } from 'react';
import { Alert, Button, Card, Empty, List, Space, Tag, Typography, message } from 'antd';
import { ArrowRightOutlined, CheckOutlined, ReloadOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { completeReview, createReviewPrompt, getReviews } from '../../api';
import type { AITask, ReviewRecord } from '../../api';
import { useAITaskPolling } from '../../hooks/useAITaskPolling';

const { Paragraph, Text, Title } = Typography;

const formatDateTime = (value: string) => new Date(value).toLocaleString();

const ReviewPage: React.FC = () => {
  const [reviews, setReviews] = useState<ReviewRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [completingId, setCompletingId] = useState<number | null>(null);
  const [promptTaskId, setPromptTaskId] = useState<number | null>(null);
  const navigate = useNavigate();

  const fetchReviews = async () => {
    setLoading(true);
    try {
      const response = await getReviews();
      setReviews(response.data);
    } catch (error) {
      console.error('Failed to fetch reviews:', error);
      message.error('获取复习计划失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchReviews();
  }, []);

  const promptTask = useAITaskPolling(promptTaskId, {
    onSucceeded: () => {
      message.success('复习提示已生成');
      setPromptTaskId(null);
      void fetchReviews();
    },
    onFailed: (task: AITask) => {
      message.error(task.error_message || '复习提示生成失败');
      setPromptTaskId(null);
    },
  });

  const handleComplete = async (review: ReviewRecord) => {
    try {
      setCompletingId(review.id);
      await completeReview(review.id);
      message.success('已记录本次复习完成');
      await fetchReviews();
    } catch (error) {
      console.error('Failed to complete review:', error);
      message.error('更新复习记录失败');
    } finally {
      setCompletingId(null);
    }
  };

  const handleGeneratePrompt = async (review: ReviewRecord) => {
    try {
      const response = await createReviewPrompt(review.id);
      setPromptTaskId(response.data.task.id);
      message.info('已提交复习提示生成任务');
    } catch (error) {
      console.error('Failed to generate review prompt:', error);
      message.error('提交复习提示任务失败');
    }
  };

  const now = new Date();
  const pendingReviews = reviews.filter((review) => review.result === 'pending');
  const dueReviews = pendingReviews.filter((review) => new Date(review.due_at) <= now);
  const upcomingReviews = pendingReviews.filter(
    (review) => new Date(review.due_at) > now,
  );
  const completedReviews = reviews.filter((review) => review.result === 'completed');

  const renderReview = (review: ReviewRecord, canComplete: boolean) => (
    <List.Item
      actions={[
        canComplete ? (
          <Button
            key="prompt"
            loading={promptTaskId !== null}
            disabled={promptTaskId !== null}
            onClick={() => void handleGeneratePrompt(review)}
          >
            {review.review_prompt ? '重新生成提示' : '生成复习提示'}
          </Button>
        ) : null,
        <Button
          key="topic"
          type="link"
          icon={<ArrowRightOutlined />}
          onClick={() => navigate(`/topics/${review.topic}`)}
        >
          进入主题
        </Button>,
        canComplete ? (
          <Button
            key="complete"
            type="primary"
            icon={<CheckOutlined />}
            loading={completingId === review.id}
            onClick={() => void handleComplete(review)}
          >
            完成本次复习
          </Button>
        ) : null,
      ]}
    >
      <List.Item.Meta
        title={
          <Space>
            <span>{review.topic_title}</span>
            <Tag color="blue">掌握度：{review.topic_mastery_level_display}</Tag>
            {review.exam_score !== null && (
              <Tag>最近测验：{review.exam_score} 分</Tag>
            )}
          </Space>
        }
        description={
          <Space direction="vertical" size={0}>
            <Text type="secondary">
              应复习时间：{formatDateTime(review.due_at)}
            </Text>
            {review.completed_at && (
              <Text type="secondary">
                完成时间：{formatDateTime(review.completed_at)}
              </Text>
            )}
            {review.next_due_at && (
              <Text type="secondary">
                下次复习：{formatDateTime(review.next_due_at)}
              </Text>
            )}
            {review.review_prompt && (
              <div style={{ marginTop: 12 }}>
                <Text strong>复习提示</Text>
                <Paragraph style={{ whiteSpace: 'pre-wrap', marginBottom: 0 }}>
                  {review.review_prompt}
                </Paragraph>
                {review.review_prompt_generated_at && (
                  <Text type="secondary">
                    生成时间：{formatDateTime(review.review_prompt_generated_at)}
                  </Text>
                )}
              </div>
            )}
          </Space>
        }
      />
    </List.Item>
  );

  const renderSection = (
    title: string,
    description: string,
    records: ReviewRecord[],
    canComplete: boolean,
  ) => (
    <Card title={title} style={{ marginBottom: 16 }}>
      <Paragraph type="secondary">{description}</Paragraph>
      <List
        loading={loading}
        dataSource={records}
        renderItem={(review) => renderReview(review, canComplete)}
        locale={{ emptyText: <Empty description="暂无记录" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
      />
    </Card>
  );

  return (
    <div style={{ padding: 24, maxWidth: 1100, margin: '0 auto' }}>
      <Space
        style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 24 }}
      >
        <div>
          <Title level={2} style={{ marginBottom: 4 }}>
            复习计划
          </Title>
          <Text type="secondary">按 Assessment 结果安排的复习记录。</Text>
        </div>
        <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void fetchReviews()}>
          刷新
        </Button>
      </Space>

      {promptTaskId && (
        <Alert
          type="info"
          showIcon
          message={
            promptTask?.status === 'running'
              ? 'AI 正在生成复习提示，可继续浏览其他内容。'
              : '复习提示任务已提交，正在等待执行。'
          }
          style={{ marginBottom: 16 }}
        />
      )}

      {renderSection(
        '待复习',
        '这些主题已到复习时间。进入主题回顾材料和笔记后，再记录完成。',
        dueReviews,
        true,
      )}
      {renderSection(
        '后续计划',
        '尚未到期的复习记录会在到期后进入“待复习”。',
        upcomingReviews,
        false,
      )}
      {renderSection('已完成', '保留完成记录，便于回顾学习节奏。', completedReviews, false)}
    </div>
  );
};

export default ReviewPage;
