import React, { useEffect, useMemo, useState } from 'react';
import {
  Button,
  Card,
  Empty,
  Form,
  Input,
  List,
  Modal,
  Radio,
  Segmented,
  Space,
  Tag,
  Typography,
  message,
} from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { createMaterial, createTopic, getTopics } from '../../api';
import type { Topic } from '../../api';

const { Title, Paragraph } = Typography;

type TopicFilter = 'all' | Topic['type'];
type InitialMaterialType = 'url' | 'text';

interface CreateTopicValues {
  title: string;
  type: Topic['type'];
  goal?: string;
  addInitialMaterial?: boolean;
  initialMaterialType?: InitialMaterialType;
  initialUrl?: string;
  initialText?: string;
}

const TopicList: React.FC = () => {
  const [topics, setTopics] = useState<Topic[]>([]);
  const [loading, setLoading] = useState(false);
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [filter, setFilter] = useState<TopicFilter>('all');
  const [keyword, setKeyword] = useState('');
  const [form] = Form.useForm<CreateTopicValues>();
  const navigate = useNavigate();

  const fetchTopics = async () => {
    setLoading(true);
    try {
      const response = await getTopics();
      setTopics(response.data);
    } catch (error) {
      console.error('Failed to fetch topics:', error);
      message.error('获取话题列表失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchTopics();
  }, []);

  const handleCreate = async (values: CreateTopicValues) => {
    try {
      setLoading(true);
      const topicResponse = await createTopic({
        title: values.title,
        type: values.type,
        goal: values.goal,
      });
      const topic = topicResponse.data;

      if (values.addInitialMaterial) {
        const type = values.initialMaterialType ?? 'url';
        await createMaterial({
          topic: topic.id,
          type,
          title: `${topic.title} - 初始材料`,
          source_url: type === 'url' ? values.initialUrl : '',
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
      void fetchTopics();
    }
  };

  const visibleTopics = useMemo(() => {
    const normalizedKeyword = keyword.trim().toLowerCase();
    return topics.filter((topic) => {
      const matchesType = filter === 'all' || topic.type === filter;
      const matchesKeyword =
        !normalizedKeyword ||
        topic.title.toLowerCase().includes(normalizedKeyword) ||
        topic.goal.toLowerCase().includes(normalizedKeyword);
      return matchesType && matchesKeyword;
    });
  }, [filter, keyword, topics]);

  const closeModal = () => {
    setIsModalVisible(false);
    form.resetFields();
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
          <Segmented<TopicFilter>
            value={filter}
            onChange={setFilter}
            options={[
              { label: '全部', value: 'all' },
              { label: '学习', value: 'learning' },
              { label: '讨论', value: 'discussion' },
            ]}
          />
          <Input.Search
            allowClear
            placeholder="搜索话题或学习目标"
            style={{ width: 280 }}
            onChange={(event) => setKeyword(event.target.value)}
          />
        </Space>
      </Card>

      <List
        grid={{ gutter: 16, xs: 1, sm: 2, md: 3, lg: 3, xl: 4, xxl: 4 }}
        loading={loading}
        dataSource={visibleTopics}
        locale={{
          emptyText: (
            <Empty
              description={
                keyword || filter !== 'all' ? '没有匹配的话题' : '还没有话题'
              }
            >
              {!keyword && filter === 'all' && (
                <Button type="primary" onClick={() => setIsModalVisible(true)}>
                  新建话题
                </Button>
              )}
            </Empty>
          ),
        }}
        renderItem={(item) => (
          <List.Item>
            <Card
              hoverable
              title={item.title}
              extra={
                <Tag color={item.type === 'learning' ? 'blue' : 'purple'}>
                  {item.type_display}
                </Tag>
              }
              onClick={() =>
                navigate(
                  item.type === 'discussion'
                    ? `/topics/${item.id}/discussion`
                    : `/topics/${item.id}`,
                )
              }
            >
              <Paragraph ellipsis={{ rows: 2 }}>
                {item.goal || '还没有学习目标'}
              </Paragraph>
              <div style={{ marginTop: 16 }}>
                <Space wrap size={[4, 4]}>
                  <Tag>{item.materials.length} 份材料</Tag>
                  {item.type === 'learning' && (
                    <Tag color="blue">掌握度: {item.mastery_level_display}</Tag>
                  )}
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
            type: 'learning',
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
          <Form.Item name="type" label="话题类型" rules={[{ required: true }]}>
            <Radio.Group>
              <Radio value="learning">学习</Radio>
              <Radio value="discussion">讨论</Radio>
            </Radio.Group>
          </Form.Item>
          <Form.Item name="goal" label="学习目标">
            <Input.TextArea
              rows={3}
              placeholder="你希望通过学习或讨论得到什么？"
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
