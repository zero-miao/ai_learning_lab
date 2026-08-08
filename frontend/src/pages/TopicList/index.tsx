import React, { useCallback, useEffect, useState } from 'react';
import {
  Button,
  Card,
  Empty,
  Form,
  Input,
  List,
  Modal,
  Popconfirm,
  Radio,
  Space,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd';
import {
  DeleteOutlined,
  PlusOutlined,
  PushpinFilled,
  PushpinOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import {
  createMaterial,
  createTopic,
  deleteTopic,
  getTopics,
  updateTopic,
} from '../../api';
import type { TopicSummary } from '../../api';

const { Title, Paragraph } = Typography;

type InitialMaterialType = 'url' | 'text';

interface CreateTopicValues {
  title: string;
  goal?: string;
  addInitialMaterial?: boolean;
  initialMaterialType?: InitialMaterialType;
  initialUrl?: string;
  initialText?: string;
}

const TopicList: React.FC = () => {
  const [topics, setTopics] = useState<TopicSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [deletingTopicId, setDeletingTopicId] = useState<number | null>(null);
  const [pinningTopicId, setPinningTopicId] = useState<number | null>(null);
  const [form] = Form.useForm<CreateTopicValues>();
  const navigate = useNavigate();

  const fetchTopics = useCallback(async () => {
    setLoading(true);
    try {
      const response = await getTopics({
        page,
        page_size: pageSize,
        q: searchQuery || undefined,
      });
      setTopics(response.data.results);
      setTotal(response.data.count);
    } catch (error) {
      console.error('Failed to fetch topics:', error);
      message.error('获取话题列表失败');
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, searchQuery]);

  useEffect(() => {
    void fetchTopics();
  }, [fetchTopics]);

  const handleCreate = async (values: CreateTopicValues) => {
    try {
      setLoading(true);
      const topicResponse = await createTopic({
        title: values.title,
        goal: values.goal,
      });
      const topic = topicResponse.data;

      if (values.addInitialMaterial) {
        const type = values.initialMaterialType ?? 'url';
        await createMaterial({
          topic: topic.id,
          title: `${topic.title} - 初始材料`,
          media_type: type === 'url' ? 'web_page' : 'text',
          media_uri: type === 'url' ? values.initialUrl : '',
          raw_text: type === 'text' ? values.initialText : '',
        });
      }

      message.success(
        values.addInitialMaterial ? '话题和初始材料已创建' : '话题已创建',
      );
      setIsModalVisible(false);
      form.resetFields();
    } catch (error) {
      console.error('Failed to create topic:', error);
      message.error('创建话题失败');
    } finally {
      setLoading(false);
      if (page === 1) void fetchTopics();
      else setPage(1);
    }
  };

  const closeModal = () => {
    setIsModalVisible(false);
    form.resetFields();
  };

  const handleDelete = async (topic: TopicSummary) => {
    try {
      setDeletingTopicId(topic.id);
      await deleteTopic(topic.id);
      message.success(`已删除话题“${topic.title}”`);
      if (topics.length === 1 && page > 1) setPage((current) => current - 1);
      else void fetchTopics();
    } catch (error) {
      console.error('Failed to delete topic:', error);
      message.error('删除话题失败');
    } finally {
      setDeletingTopicId(null);
    }
  };

  const handlePin = async (topic: TopicSummary) => {
    const nextPinned = !topic.is_pinned;
    try {
      setPinningTopicId(topic.id);
      await updateTopic(topic.id, { is_pinned: nextPinned });
      message.success(nextPinned ? `已置顶“${topic.title}”` : `已取消置顶“${topic.title}”`);
      if (nextPinned && page !== 1) setPage(1);
      else await fetchTopics();
    } catch (error) {
      console.error('Failed to pin topic:', error);
      message.error(nextPinned ? '置顶话题失败' : '取消置顶失败');
    } finally {
      setPinningTopicId(null);
    }
  };

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: '32px 24px' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 16,
          marginBottom: 24,
        }}
      >
        <div>
          <Title level={2} style={{ margin: 0 }}>
            我的话题
          </Title>
          <Paragraph type="secondary" style={{ margin: '6px 0 0' }}>
            从一个想法或一份材料开始学习。
          </Paragraph>
        </div>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => setIsModalVisible(true)}
        >
          新建话题
        </Button>
      </div>

      <Card styles={{ body: { padding: 16 } }} style={{ marginBottom: 24 }}>
        <Space wrap size="middle">
          <Input.Search
            allowClear
            placeholder="搜索话题或学习目标"
            style={{ width: 280 }}
            value={keyword}
            onChange={(event) => {
              const value = event.target.value;
              setKeyword(value);
              if (!value && searchQuery) {
                setSearchQuery('');
                setPage(1);
              }
            }}
            onSearch={(value) => {
              setSearchQuery(value.trim());
              setPage(1);
            }}
          />
        </Space>
      </Card>

      <List
        grid={{ gutter: 24, column: 4, xs: 1, sm: 2, md: 2, lg: 4, xl: 4, xxl: 4 }}
        loading={loading}
        dataSource={topics}
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
        locale={{
          emptyText: (
            <Empty
              description={
                searchQuery ? '没有匹配的话题' : '还没有话题'
              }
            >
              {!searchQuery && (
                <Button type="primary" onClick={() => setIsModalVisible(true)}>
                  新建话题
                </Button>
              )}
            </Empty>
          ),
        }}
        renderItem={(item) => (
          <List.Item style={{ padding: 0 }}>
            <Card
              hoverable
              style={{
                height: 200,
                width: '100%',
                display: 'flex',
                flexDirection: 'column',
              }}
              styles={{
                header: { flex: '0 0 auto', overflow: 'hidden', padding: '0 16px' },
                body: {
                  flex: '1 1 auto',
                  display: 'flex',
                  flexDirection: 'column',
                  overflow: 'hidden',
                  padding: '12px 16px',
                },
              }}
              title={
                <Tooltip title={item.title}>
                  <Typography.Text strong ellipsis style={{ display: 'block', lineHeight: '56px' }}>
                    {item.title}
                  </Typography.Text>
                </Tooltip>
              }
              extra={
                <Space size={4} onClick={(event) => event.stopPropagation()} style={{ lineHeight: '56px' }}>
                  <Tooltip title={item.is_pinned ? '取消置顶' : '置顶话题'}>
                    <Button
                      size="small"
                      type={item.is_pinned ? 'primary' : 'text'}
                      icon={item.is_pinned ? <PushpinFilled /> : <PushpinOutlined />}
                      loading={pinningTopicId === item.id}
                      aria-label={`${item.is_pinned ? '取消置顶' : '置顶'}话题 ${item.title}`}
                      aria-pressed={item.is_pinned}
                      onClick={() => void handlePin(item)}
                    />
                  </Tooltip>
                  <Popconfirm
                    title={`删除“${item.title}”？`}
                    description="相关材料、讨论记录、概念和任务都会一并删除，此操作不可恢复。"
                    okText="删除"
                    okButtonProps={{ danger: true, loading: deletingTopicId === item.id }}
                    cancelText="取消"
                    onConfirm={() => void handleDelete(item)}
                  >
                    <Button
                      danger
                      size="small"
                      type="text"
                      icon={<DeleteOutlined />}
                      aria-label={`删除话题 ${item.title}`}
                    />
                  </Popconfirm>
                </Space>
              }
              onClick={() => navigate(`/topics/${item.id}`)}
            >
              <Tooltip title={item.goal || '还没有学习目标'}>
                <Paragraph
                  ellipsis={{ rows: 2 }}
                  type="secondary"
                  style={{ marginBottom: 8, flex: '1 1 auto', fontSize: '13px' }}
                >
                  {item.goal || '还没有学习目标'}
                </Paragraph>
              </Tooltip>
              <div style={{ marginTop: 'auto', flex: '0 0 auto' }}>
                <Space wrap size={[8, 8]}>
                  <Tag color="default" style={{ margin: 0 }}>{item.material_count} 份材料</Tag>
                  <Tag color="processing" style={{ margin: 0 }}>掌握度: {item.mastery_level_display}</Tag>
                </Space>
              </div>
            </Card>
          </List.Item>
        )}
      />

      <Modal
        title="新建话题"
        open={isModalVisible}
        onCancel={closeModal}
        onOk={() => form.submit()}
        confirmLoading={loading}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={handleCreate}
          initialValues={{
            addInitialMaterial: false,
            initialMaterialType: 'url',
          }}
        >
          <Form.Item
            name="title"
            label="话题标题"
            rules={[{ required: true, message: '请输入话题标题' }]}
          >
            <Input placeholder="例如：深入理解 Django ORM" autoFocus />
          </Form.Item>
          <Form.Item name="goal" label="学习目标">
            <Input.TextArea
              rows={3}
              placeholder="你希望通过学习得到什么？"
            />
          </Form.Item>
          <Form.Item name="addInitialMaterial">
            <Radio.Group>
              <Radio value={false}>暂不添加材料</Radio>
              <Radio value={true}>添加初始材料</Radio>
            </Radio.Group>
          </Form.Item>
          <Form.Item
            noStyle
            shouldUpdate={(previous, current) =>
              previous.addInitialMaterial !== current.addInitialMaterial
            }
          >
            {({ getFieldValue }) =>
              getFieldValue('addInitialMaterial') && (
                <>
                  <Form.Item name="initialMaterialType" label="材料类型">
                    <Radio.Group>
                      <Radio value="url">网页链接</Radio>
                      <Radio value="text">粘贴文本</Radio>
                    </Radio.Group>
                  </Form.Item>
                  <Form.Item
                    noStyle
                    shouldUpdate={(previous, current) =>
                      previous.initialMaterialType !== current.initialMaterialType
                    }
                  >
                    {({ getFieldValue: getInitialValue }) =>
                      getInitialValue('initialMaterialType') === 'text' ? (
                        <Form.Item
                          name="initialText"
                          label="材料内容"
                          rules={[{ required: true, message: '请输入材料内容' }]}
                        >
                          <Input.TextArea
                            rows={6}
                            placeholder="粘贴需要学习的文本..."
                          />
                        </Form.Item>
                      ) : (
                        <Form.Item
                          name="initialUrl"
                          label="网页链接"
                          rules={[
                            { required: true, message: '请输入网页链接' },
                            { type: 'url', message: '请输入有效的 URL' },
                          ]}
                        >
                          <Input placeholder="https://..." />
                        </Form.Item>
                      )
                    }
                  </Form.Item>
                </>
              )
            }
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default TopicList;
