import { useCallback, useEffect, useState } from 'react';
import {
  Button,
  Descriptions,
  List,
  Pagination,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import type { TableColumnsType } from 'antd';
import { LinkOutlined, ReloadOutlined } from '@ant-design/icons';
import {
  getUserFeedback,
  type FeedbackCategory,
  type FeedbackFeature,
  type UserFeedback,
} from '../../api';
import { useMediaQuery } from '../../useMediaQuery';
import './styles.css';

const { Paragraph, Text, Title } = Typography;

const statusColor: Record<UserFeedback['status'], string> = {
  new: 'processing',
  reviewing: 'warning',
  resolved: 'success',
};

const statusOptions = [
  { value: 'all', label: '全部状态' },
  { value: 'new', label: '待处理' },
  { value: 'reviewing', label: '处理中' },
  { value: 'resolved', label: '已解决' },
];

const categoryOptions = [
  { value: 'all', label: '全部类型' },
  { value: 'usability', label: '不好用' },
  { value: 'bug', label: '功能异常' },
  { value: 'content', label: '内容问题' },
  { value: 'suggestion', label: '功能建议' },
  { value: 'other', label: '其他' },
];

const featureOptions = [
  { value: 'all', label: '全部功能' },
  { value: 'management_assistant', label: '全站管理助手' },
  { value: 'topic_management', label: '话题管理' },
  { value: 'topic_detail', label: '话题详情' },
  { value: 'material_reader', label: '学习阅读' },
  { value: 'material_management', label: '材料管理' },
  { value: 'exam', label: '掌握度评估' },
  { value: 'review', label: '复习计划' },
  { value: 'task_management', label: '任务管理' },
  { value: 'system_settings', label: '系统设置' },
  { value: 'feedback', label: '反馈功能' },
  { value: 'other', label: '其他' },
];

function formatDate(value: string) {
  return new Date(value).toLocaleString();
}

function FeedbackDetails({ feedback }: { feedback: UserFeedback }) {
  return (
    <Descriptions size="small" column={1} bordered>
      <Descriptions.Item label="处理记录">
        {feedback.resolution_note || '暂无处理记录'}
      </Descriptions.Item>
      <Descriptions.Item label="来源页面">
        {feedback.page_url ? (
          <a href={feedback.page_url} target="_blank" rel="noreferrer">
            <LinkOutlined /> {feedback.page_title || feedback.page_url}
          </a>
        ) : (
          '未记录'
        )}
      </Descriptions.Item>
      <Descriptions.Item label="浏览器">
        <Text className="feedback-management__break-text">
          {feedback.user_agent || '未记录'}
        </Text>
      </Descriptions.Item>
      <Descriptions.Item label="页面上下文">
        <pre className="feedback-management__context">
          {JSON.stringify(feedback.context, null, 2)}
        </pre>
      </Descriptions.Item>
    </Descriptions>
  );
}

export default function FeedbackManagement() {
  const [feedback, setFeedback] = useState<UserFeedback[]>([]);
  const [status, setStatus] = useState<UserFeedback['status'] | 'all'>('all');
  const [category, setCategory] = useState<FeedbackCategory | 'all'>('all');
  const [feature, setFeature] = useState<FeedbackFeature | 'all'>('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const isMobile = useMediaQuery('(max-width: 767px)');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await getUserFeedback({
        page,
        page_size: pageSize,
        ...(status !== 'all' ? { status } : {}),
        ...(category !== 'all' ? { category } : {}),
        ...(feature !== 'all' ? { feature } : {}),
      });
      setFeedback(response.data.results);
      setTotal(response.data.count);
    } catch {
      message.error('加载反馈记录失败');
    } finally {
      setLoading(false);
    }
  }, [category, feature, page, pageSize, status]);

  useEffect(() => {
    void load();
  }, [load]);

  const columns: TableColumnsType<UserFeedback> = [
    { title: 'ID', dataIndex: 'id', width: 72 },
    {
      title: '反馈内容',
      dataIndex: 'description',
      render: (description: string) => (
        <Paragraph ellipsis={{ rows: 3, expandable: true, symbol: '展开' }}>
          {description}
        </Paragraph>
      ),
    },
    {
      title: '状态',
      key: 'status',
      width: 100,
      render: (_, item) => (
        <Tag color={statusColor[item.status]}>{item.status_display}</Tag>
      ),
    },
    {
      title: '类型',
      key: 'category',
      width: 110,
      render: (_, item) => item.category_display,
    },
    {
      title: '所属功能',
      key: 'feature',
      width: 140,
      render: (_, item) => item.feature_display,
    },
    {
      title: '提交时间',
      key: 'created_at',
      width: 170,
      render: (_, item) => formatDate(item.created_at),
    },
  ];

  const filters = (
    <Space className="feedback-management__filters" wrap>
      <Select
        aria-label="反馈状态"
        value={status}
        options={statusOptions}
        onChange={(value) => {
          setStatus(value);
          setPage(1);
        }}
      />
      <Select
        aria-label="反馈类型"
        value={category}
        options={categoryOptions}
        onChange={(value) => {
          setCategory(value);
          setPage(1);
        }}
      />
      <Select
        aria-label="所属功能"
        value={feature}
        options={featureOptions}
        onChange={(value) => {
          setFeature(value);
          setPage(1);
        }}
      />
      <Button
        icon={<ReloadOutlined />}
        loading={loading}
        aria-label="刷新反馈"
        title="刷新反馈"
        onClick={() => void load()}
      />
    </Space>
  );

  return (
    <main className="feedback-management">
      <header className="feedback-management__header">
        <div>
          <Title level={2}>反馈记录</Title>
          <Text type="secondary">共 {total} 条，处理状态由系统后台维护。</Text>
        </div>
        {filters}
      </header>

      {isMobile ? (
        <>
          <List
            loading={loading}
            dataSource={feedback}
            locale={{ emptyText: '没有符合条件的反馈' }}
            renderItem={(item) => (
              <List.Item className="feedback-management__mobile-item">
                <div className="feedback-management__mobile-record">
                  <Space wrap>
                    <Text strong>#{item.id}</Text>
                    <Tag color={statusColor[item.status]}>
                      {item.status_display}
                    </Tag>
                    <Tag>{item.feature_display}</Tag>
                  </Space>
                  <Paragraph>{item.description}</Paragraph>
                  <Text type="secondary">
                    {item.category_display} · {formatDate(item.created_at)}
                  </Text>
                  {item.resolution_note && (
                    <div className="feedback-management__resolution">
                      {item.resolution_note}
                    </div>
                  )}
                </div>
              </List.Item>
            )}
          />
          <Pagination
            current={page}
            pageSize={pageSize}
            total={total}
            showSizeChanger={false}
            onChange={setPage}
          />
        </>
      ) : (
        <Table
          rowKey="id"
          columns={columns}
          dataSource={feedback}
          loading={loading}
          locale={{ emptyText: '没有符合条件的反馈' }}
          scroll={{ x: 900 }}
          expandable={{
            expandedRowRender: (item) => <FeedbackDetails feedback={item} />,
          }}
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
        />
      )}
    </main>
  );
}
