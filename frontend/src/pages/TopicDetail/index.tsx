import React, { useEffect, useState } from 'react';
import { Navigate, useParams, useNavigate, Link } from 'react-router-dom';
import {
  Layout,
  Typography,
  Button,
  Space,
  Card,
  Divider,
  Descriptions,
  Tag,
  List,
  Modal,
  Form,
  Input,
  Radio,
  Statistic,
  message,
} from 'antd';
import {
  ArrowLeftOutlined,
  ApartmentOutlined,
  BookOutlined,
  DeleteOutlined,
  FormOutlined,
  PlusOutlined,
} from '@ant-design/icons';
import {
  createMaterial,
  deleteMaterial,
  getTopic,
  listAITasks,
} from '../../api';
import type { Topic } from '../../api';

const { Title } = Typography;
const { Content } = Layout;

const TopicDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const [topic, setTopic] = useState<Topic | null>(null);
  const [loading, setLoading] = useState(false);
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [briefingMaterialIds, setBriefingMaterialIds] = useState<number[]>([]);
  const [form] = Form.useForm();
  const navigate = useNavigate();

  const fetchTopic = async () => {
    if (!id) return;
    setLoading(true);
    try {
      const response = await getTopic(parseInt(id));
      setTopic(response.data);
      const tasksResponse = await listAITasks({ topic: parseInt(id) });
      setBriefingMaterialIds(tasksResponse.data
        .filter((task) => task.task_type === 'briefing' && (task.status === 'pending' || task.status === 'running'))
        .map((task) => task.material)
        .filter((materialId): materialId is number => materialId !== null));
    } catch (error) {
      console.error('Failed to fetch topic:', error);
      message.error('获取主题详情失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTopic();
  }, [id]);

  const handleImport = async (values: any) => {
    if (!topic) return;
    try {
      setLoading(true);
      await createMaterial({
        ...values,
        topic: topic.id,
      });
      message.success('导入材料成功');
      setIsModalVisible(false);
      form.resetFields();
      fetchTopic();
    } catch (error) {
      console.error('Failed to import material:', error);
      message.error('导入材料失败');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteMaterial = async (materialId: number) => {
    try {
      await deleteMaterial(materialId);
      message.success('删除材料成功');
      fetchTopic();
    } catch (error) {
      console.error('Failed to delete material:', error);
      message.error('删除材料失败');
    }
  };

  if (loading && !topic) return <div style={{ padding: '24px' }}>加载中...</div>;
  if (!topic) return <div style={{ padding: '24px' }}>未找到主题</div>;
  if (topic.type === 'discussion') {
    return <Navigate to={`/topics/${topic.id}/discussion`} replace />;
  }

  return (
    <Content style={{ padding: '24px' }}>
      <Space direction="vertical" size="large" style={{ display: 'flex' }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/topics')}>
          返回列表
        </Button>

        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <Title level={2}>{topic.title}</Title>
            <Space>
              <Tag color={topic.type === 'learning' ? 'blue' : 'purple'}>
                {topic.type_display}
              </Tag>
              <Tag color="blue">{topic.status_display}</Tag>
              <Tag color="green">掌握度: {topic.mastery_level_display}</Tag>
              <Button
                icon={<ApartmentOutlined />}
                onClick={() => navigate(`/topics/${topic.id}/map`)}
              >
                查看主图
              </Button>
              <Button
                type="primary"
                icon={<FormOutlined />}
                disabled={!topic.materials.some((material) => material.import_status === 'success')}
                onClick={() => navigate(`/topics/${topic.id}/exam`)}
              >
                掌握度评估
              </Button>
            </Space>
          </div>

          <Descriptions column={1} bordered style={{ marginTop: '24px' }}>
            <Descriptions.Item label="学习目标">{topic.goal || '未设置'}</Descriptions.Item>
            <Descriptions.Item label="学习范围">{topic.scope || '未设置'}</Descriptions.Item>
            <Descriptions.Item label="创建时间">{new Date(topic.created_at).toLocaleString()}</Descriptions.Item>
            <Descriptions.Item label="更新时间">{new Date(topic.updated_at).toLocaleString()}</Descriptions.Item>
          </Descriptions>
        </Card>

        <Card
          title="学习产出"
          extra={
            <Button type="link" onClick={() => navigate(`/topics/${topic.id}/map`)}>
              打开思维导图
            </Button>
          }
        >
          <Space size="large" wrap>
            <Statistic
              title="概念"
              value={topic.learning_output.concept_count}
              suffix="个"
            />
            <Statistic
              title="已沉淀问答"
              value={topic.learning_output.saved_question_count}
              suffix="条"
            />
            <Statistic
              title="主图节点"
              value={topic.learning_output.map_node_count}
              suffix="个"
            />
          </Space>
          <Divider style={{ margin: '20px 0 12px' }} />
          <List
            size="small"
            dataSource={topic.questions.filter((question) => question.is_saved)}
            locale={{ emptyText: '还没有已沉淀问答。' }}
            renderItem={(question) => (
              <List.Item
                actions={
                  question.material && question.start_offset !== null
                    ? [
                        <Button
                          key="source"
                          type="link"
                          onClick={() =>
                            navigate(
                              `/topics/${topic.id}/materials/${question.material}?anchor=${question.start_offset}`,
                            )
                          }
                        >
                          查看原文
                        </Button>,
                      ]
                    : undefined
                }
              >
                <List.Item.Meta
                  title={question.question_text}
                  description={
                    question.ai_responses[0]?.content ||
                    'AI 回答仍在生成或不可用。'
                  }
                />
              </List.Item>
            )}
          />
        </Card>

        <Card
          title="学习材料"
          extra={
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setIsModalVisible(true)}>
              导入材料
            </Button>
          }
        >
          <List
            dataSource={topic.materials}
            renderItem={(item) => (
              <List.Item
                actions={[
                  <Link key="read" to={`/topics/${topic.id}/materials/${item.id}`}>
                    <Button type="link" icon={<BookOutlined />}>开始学习</Button>
                  </Link>,
                  <Button
                    key="delete"
                    type="text"
                    danger
                    icon={<DeleteOutlined />}
                    onClick={() => handleDeleteMaterial(item.id)}
                  />
                ]}
              >
                <List.Item.Meta
                  title={item.title}
                  description={
                    <Space>
                      <Tag>{item.type_display}</Tag>
                      <Tag color={item.source_type === 'manual' ? 'default' : 'purple'}>
                        {item.source_type_display}
                      </Tag>
                      <Tag color={item.import_status === 'success' ? 'success' : 'warning'}>
                        {item.import_status_display}
                      </Tag>
                      {briefingMaterialIds.includes(item.id) && <Tag color="processing">AI 前导生成中</Tag>}
                      {item.source_url && <a href={item.source_url} target="_blank" rel="noreferrer">查看来源</a>}
                    </Space>
                  }
                />
              </List.Item>
            )}
            locale={{ emptyText: '暂无材料，请先导入学习材料' }}
          />
        </Card>
      </Space>

      <Modal
        title="导入学习材料"
        open={isModalVisible}
        onCancel={() => setIsModalVisible(false)}
        onOk={() => form.submit()}
        confirmLoading={loading}
      >
        <Form form={form} layout="vertical" onFinish={handleImport} initialValues={{ type: 'url' }}>
          <Form.Item name="title" label="材料标题" rules={[{ required: true, message: '请输入标题' }]}>
            <Input placeholder="例如：Django 官方教程" />
          </Form.Item>
          <Form.Item name="type" label="导入类型">
            <Radio.Group>
              <Radio value="url">网页链接</Radio>
              <Radio value="text">纯文本</Radio>
            </Radio.Group>
          </Form.Item>
          <Form.Item
            noStyle
            shouldUpdate={(prevValues, currentValues) => prevValues.type !== currentValues.type}
          >
            {({ getFieldValue }) =>
              getFieldValue('type') === 'url' ? (
                <Form.Item name="source_url" label="网页链接" rules={[{ required: true, message: '请输入链接' }]}>
                  <Input placeholder="https://..." />
                </Form.Item>
              ) : (
                <Form.Item name="raw_text" label="粘贴文本" rules={[{ required: true, message: '请输入文本内容' }]}>
                  <Input.TextArea rows={6} placeholder="粘贴文章内容..." />
                </Form.Item>
              )
            }
          </Form.Item>
        </Form>
      </Modal>

    </Content>
  );
};

export default TopicDetail;
