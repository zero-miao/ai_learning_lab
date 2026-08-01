import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Alert,
  Button,
  Card,
  Collapse,
  Form,
  Input,
  List,
  Modal,
  Popconfirm,
  Radio,
  Space,
  Tag,
  Typography,
  message,
} from 'antd';
import {
  ArrowLeftOutlined,
  BookOutlined,
  CompassOutlined,
  PlusOutlined,
  SendOutlined,
  SwapOutlined,
} from '@ant-design/icons';
import {
  convertToLearning,
  createDiscussionAssessment,
  createDiscussionMessage,
  createLearningPath,
  createMaterial,
  getDiscussion,
  listAITasks,
  updateTopic,
} from '../../api';
import type { DiscussionMessage, Topic } from '../../api';
import { useAITaskPolling } from '../../hooks/useAITaskPolling';

const { Title, Paragraph, Text } = Typography;

interface MaterialFormValues {
  title: string;
  type: 'url' | 'text';
  source_url?: string;
  raw_text?: string;
}

const DiscussionTopic: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const topicId = Number(id);
  const navigate = useNavigate();
  const [topic, setTopic] = useState<Topic | null>(null);
  const [messages, setMessages] = useState<DiscussionMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [input, setInput] = useState('');
  const [taskId, setTaskId] = useState<number | null>(null);
  const [importVisible, setImportVisible] = useState(false);
  const [materialForm] = Form.useForm<MaterialFormValues>();

  const loadDiscussion = useCallback(async () => {
    if (!Number.isInteger(topicId)) return;
    const response = await getDiscussion(topicId);
    setTopic(response.data.topic);
    setMessages(response.data.messages);
  }, [topicId]);

  useEffect(() => {
    setLoading(true);
    void loadDiscussion()
      .catch((error) => {
        console.error('Failed to load discussion:', error);
        message.error('加载讨论话题失败');
      })
      .finally(() => setLoading(false));
  }, [loadDiscussion]);

  useEffect(() => {
    if (!topic || taskId) return;
    void listAITasks({ topic: topic.id }).then((response) => {
      const activeTask = response.data.find(
        (task) =>
          [
            'discussion_opening',
            'discussion_assessment',
            'discussion_reply',
            'learning_path',
          ].includes(task.task_type) &&
          ['pending', 'running'].includes(task.status),
      );
      if (activeTask) setTaskId(activeTask.id);
    });
  }, [taskId, topic]);

  const task = useAITaskPolling(taskId, {
    onSucceeded: () => {
      setTaskId(null);
      void loadDiscussion();
    },
    onFailed: (failedTask) => {
      setTaskId(null);
      message.error(failedTask.error_message || '讨论任务失败');
    },
  });

  const submitMessage = async () => {
    if (!input.trim() || !topic) return;
    const content = input.trim();
    setInput('');
    try {
      const response = await createDiscussionMessage(topic.id, content);
      setMessages((current) => [...current, response.data.message]);
      setTaskId(response.data.task.id);
    } catch (error) {
      console.error('Failed to submit discussion message:', error);
      message.error('提交讨论消息失败');
    }
  };

  const startAssessment = async () => {
    if (!topic) return;
    try {
      const response = await createDiscussionAssessment(topic.id);
      setTaskId(response.data.task.id);
      message.info('已提交材料快速评估');
    } catch (error) {
      console.error('Failed to start assessment:', error);
      message.error('材料快速评估提交失败');
    }
  };

  const startLearningPath = async () => {
    if (!topic) return;
    try {
      const response = await createLearningPath(topic.id);
      setTaskId(response.data.task.id);
      message.info('已提交学习路线生成任务');
    } catch (error) {
      console.error('Failed to create learning path:', error);
      message.error('学习路线生成失败');
    }
  };

  const updateOutcome = async (outcome: Topic['discussion_outcome']) => {
    if (!topic) return;
    try {
      const response = await updateTopic(topic.id, {
        discussion_outcome: outcome,
      });
      setTopic(response.data);
    } catch (error) {
      console.error('Failed to update discussion outcome:', error);
      message.error('更新讨论结论失败');
    }
  };

  const convert = async () => {
    if (!topic) return;
    try {
      const response = await convertToLearning(topic.id);
      message.success('已转为学习型话题，讨论记录和材料已保留');
      navigate(`/topics/${response.data.id}`);
    } catch (error) {
      console.error('Failed to convert topic:', error);
      message.error('转换学习型话题失败');
    }
  };

  const importMaterial = async (values: MaterialFormValues) => {
    if (!topic) return;
    try {
      await createMaterial({ ...values, topic: topic.id });
      setImportVisible(false);
      materialForm.resetFields();
      message.success('材料已导入，完成处理后会自动生成快速评估');
      await loadDiscussion();
    } catch (error) {
      console.error('Failed to import discussion material:', error);
      message.error('导入材料失败');
    }
  };

  if (loading && !topic) return <div style={{ padding: 24 }}>加载中...</div>;
  if (!topic) return <div style={{ padding: 24 }}>未找到讨论话题</div>;

  return (
    <div style={{ maxWidth: 1400, margin: '0 auto', padding: '24px' }}>
      <Space direction="vertical" size="large" style={{ display: 'flex' }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/topics')}>
          返回话题列表
        </Button>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr) minmax(300px, 360px)',
            gap: 24,
            alignItems: 'start',
          }}
        >
          <Card>
            <Space direction="vertical" size="middle" style={{ display: 'flex' }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 16,
                  alignItems: 'flex-start',
                }}
              >
                <div>
                  <Space>
                    <Title level={2} style={{ margin: 0 }}>
                      {topic.title}
                    </Title>
                    <Tag color="purple">讨论</Tag>
                  </Space>
                  <Paragraph type="secondary" style={{ margin: '8px 0 0' }}>
                    {topic.goal || '先判断是否值得投入系统学习。'}
                  </Paragraph>
                </div>
                <Button
                  icon={<CompassOutlined />}
                  onClick={() => void startLearningPath()}
                >
                  生成学习路线
                </Button>
              </div>

              {task && (
                <Alert
                  showIcon
                  type="info"
                  message={`${task.task_type_display}处理中，你可以继续浏览或稍后返回。`}
                />
              )}
              {topic.discussion_rationale && (
                <Alert
                  type="info"
                  showIcon
                  message="最近的材料评估"
                  description={topic.discussion_rationale}
                />
              )}

              <List
                dataSource={messages}
                locale={{ emptyText: '正在准备讨论开场...' }}
                renderItem={(item) => (
                  <List.Item style={{ border: 'none', padding: '8px 0' }}>
                    <div
                      style={{
                        width: '100%',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems:
                          item.role === 'user' ? 'flex-end' : 'flex-start',
                      }}
                    >
                      <div
                        style={{
                          maxWidth: '88%',
                          padding: '10px 12px',
                          borderRadius: 10,
                          background:
                            item.role === 'user' ? '#1677ff' : '#f5f5f5',
                          color: item.role === 'user' ? '#fff' : '#1f2937',
                          whiteSpace: 'pre-wrap',
                        }}
                      >
                        {item.role === 'assistant' && (
                          <Text
                            strong
                            style={{ display: 'block', marginBottom: 4 }}
                          >
                            {item.message_type_display}
                          </Text>
                        )}
                        {item.content}
                      </div>
                    </div>
                  </List.Item>
                )}
              />

              <Space.Compact style={{ width: '100%' }}>
                <Input
                  placeholder="说说你的学习动机、顾虑或已有经验..."
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
            </Space>
          </Card>

          <Space direction="vertical" size="middle" style={{ display: 'flex' }}>
            <Card
              title="讨论结论"
              extra={
                <Popconfirm
                  title="转为学习型话题？"
                  description="讨论记录、判断依据和材料都会保留。"
                  okText="转换"
                  cancelText="取消"
                  onConfirm={() => void convert()}
                >
                  <Button type="primary" icon={<SwapOutlined />}>
                    转为学习型
                  </Button>
                </Popconfirm>
              }
            >
              <Radio.Group
                value={topic.discussion_outcome}
                onChange={(event) => void updateOutcome(event.target.value)}
              >
                <Space direction="vertical">
                  <Radio value="pending">待定</Radio>
                  <Radio value="learn">值得学习</Radio>
                  <Radio value="not_learn">暂不学习</Radio>
                </Space>
              </Radio.Group>
            </Card>

            <Card
              title="材料"
              extra={
                <Space>
                  <Button
                    size="small"
                    onClick={() => void startAssessment()}
                    disabled={!topic.materials.some(
                      (material) => material.import_status === 'success',
                    )}
                  >
                    快速评估
                  </Button>
                  <Button
                    size="small"
                    type="primary"
                    icon={<PlusOutlined />}
                    onClick={() => setImportVisible(true)}
                  >
                    导入
                  </Button>
                </Space>
              }
            >
              <Collapse
                items={[
                  {
                    key: 'materials',
                    label: `${topic.materials.length} 份材料`,
                    children: (
                      <List
                        size="small"
                        dataSource={topic.materials}
                        locale={{ emptyText: '尚未导入材料，也可以先从对话开始。' }}
                        renderItem={(material) => (
                          <List.Item>
                            <List.Item.Meta
                              avatar={<BookOutlined />}
                              title={material.title}
                              description={
                                <Space size={4} wrap>
                                  <Tag>{material.source_type_display}</Tag>
                                  <Tag
                                    color={
                                      material.import_status === 'success'
                                        ? 'success'
                                        : 'processing'
                                    }
                                  >
                                    {material.import_status_display}
                                  </Tag>
                                </Space>
                              }
                            />
                          </List.Item>
                        )}
                      />
                    ),
                  },
                ]}
              />
            </Card>
          </Space>
        </div>
      </Space>

      <Modal
        title="导入讨论材料"
        open={importVisible}
        onCancel={() => {
          setImportVisible(false);
          materialForm.resetFields();
        }}
        onOk={() => materialForm.submit()}
      >
        <Form
          form={materialForm}
          layout="vertical"
          initialValues={{ type: 'url' }}
          onFinish={(values) => void importMaterial(values)}
        >
          <Form.Item
            name="title"
            label="材料标题"
            rules={[{ required: true, message: '请输入材料标题' }]}
          >
            <Input />
          </Form.Item>
          <Form.Item name="type" label="导入类型">
            <Radio.Group>
              <Radio value="url">网页链接</Radio>
              <Radio value="text">粘贴文本</Radio>
            </Radio.Group>
          </Form.Item>
          <Form.Item
            noStyle
            shouldUpdate={(previous, current) =>
              previous.type !== current.type
            }
          >
            {({ getFieldValue }) =>
              getFieldValue('type') === 'text' ? (
                <Form.Item
                  name="raw_text"
                  label="材料内容"
                  rules={[{ required: true, message: '请输入材料内容' }]}
                >
                  <Input.TextArea rows={6} />
                </Form.Item>
              ) : (
                <Form.Item
                  name="source_url"
                  label="网页链接"
                  rules={[
                    { required: true, message: '请输入网页链接' },
                    { type: 'url', message: '请输入有效 URL' },
                  ]}
                >
                  <Input placeholder="https://..." />
                </Form.Item>
              )
            }
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default DiscussionTopic;
