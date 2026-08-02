import React, { useCallback, useEffect, useRef, useState } from 'react';
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
  Tooltip,
  Typography,
  message,
} from 'antd';
import {
  ArrowLeftOutlined,
  BookOutlined,
  CompassOutlined,
  PlusOutlined,
  ReloadOutlined,
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
  retryMaterialImport,
  updateDiscussionStage,
  updateTopic,
} from '../../api';
import type { DiscussionMessage, Topic } from '../../api';
import { useAITaskPolling } from '../../hooks/useAITaskPolling';

const { Title, Paragraph, Text } = Typography;
const stageLabels = {
  explore: '探索',
  frame: '定义问题',
  decide: '形成决策',
};
const starterPrompts = [
  '我对这件事有点困惑，暂时说不清问题在哪里。',
  '先从一个具体例子开始帮我想想。',
  '帮我把这个模糊想法拆开：',
];

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
  const messageEndRef = useRef<HTMLDivElement | null>(null);

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
    messageEndRef.current?.scrollIntoView({
      behavior: 'smooth',
      block: 'end',
    });
  }, [messages]);

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
    intervalMs: 500,
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

  const updateStage = async (stage: Topic['discussion_stage']) => {
    if (!topic) return;
    try {
      const response = await updateDiscussionStage(topic.id, stage);
      setTopic(response.data);
    } catch (error) {
      console.error('Failed to update discussion stage:', error);
      message.error('更新讨论阶段失败');
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

  const retryImport = async (materialId: number) => {
    try {
      await retryMaterialImport(materialId);
      message.success('材料已重新导入');
      await loadDiscussion();
    } catch (error) {
      console.error('Failed to retry material import:', error);
      message.error('重新导入材料失败');
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
                  <Tag color="blue">{stageLabels[topic.discussion_stage]}</Tag>
                </div>
                <Button
                  icon={<CompassOutlined />}
                  onClick={() => void startLearningPath()}
                >
                  生成学习路线
                </Button>
              </div>

              {topic.discussion_rationale && (
                <Alert
                  type="info"
                  showIcon
                  message="最近的材料评估"
                  description={topic.discussion_rationale}
                />
              )}

              <div
                style={{
                  maxHeight: 'min(560px, calc(100vh - 360px))',
                  minHeight: 240,
                  overflowY: 'auto',
                  paddingRight: 8,
                }}
              >
                <List
                  dataSource={messages}
                  locale={{ emptyText: '从下面的提示开始，或者直接写下一个念头。' }}
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
                          {item.content}
                        </div>
                        {item.role === 'assistant' && (
                          <Space size={4} style={{ marginTop: 6 }}>
                            <Tag>{item.source_task_model || '本地模型'}</Tag>
                            <Tag color="blue">
                              {item.source_task_stage
                                ? stageLabels[item.source_task_stage]
                                : '非阶段任务'}
                            </Tag>
                          </Space>
                        )}
                        {item.role === 'assistant' && item.suggested_stage && (
                          <Space style={{ marginTop: 8 }}>
                            <Text type="secondary">
                              {item.stage_suggestion_reason || '信息已经足够，可以进入下一阶段。'}
                            </Text>
                            <Button
                              size="small"
                              onClick={() => void updateStage(item.suggested_stage!)}
                            >
                              进入{stageLabels[item.suggested_stage]}
                            </Button>
                          </Space>
                        )}
                      </div>
                    </List.Item>
                  )}
                />
                <div ref={messageEndRef} />
              </div>

              {!messages.some((item) => item.role === 'user') && (
                <Space wrap>
                  {starterPrompts.map((prompt) => (
                    <Button key={prompt} onClick={() => setInput(prompt)}>
                      {prompt.replace('：', '')}
                    </Button>
                  ))}
                </Space>
              )}

              {task && (
                <Alert
                  showIcon
                  type="info"
                  message={
                    task.status === 'pending'
                      ? task.blocking_task
                        ? `正在等待「${task.blocking_task.task_type_display}」完成（${task.blocking_task.model}），随后将使用 ${task.model}`
                        : `正在等待任务调度，随后将使用 ${task.model}`
                      : `正在使用 ${task.model} 生成回复`
                  }
                />
              )}

              <Space.Compact style={{ width: '100%' }}>
                <Input
                  placeholder="写下一个念头、例子、顾虑或片段..."
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
              {topic.discussion_stage !== 'explore' && (
                <Button
                  size="small"
                  style={{ marginBottom: 12 }}
                  onClick={() => void updateStage('explore')}
                >
                  回到探索
                </Button>
              )}
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
                                  <Tooltip title={material.import_error || undefined}>
                                    <Tag
                                      color={
                                        material.import_status === 'success'
                                          ? 'success'
                                          : material.import_status === 'failed'
                                            ? 'error'
                                            : 'processing'
                                      }
                                    >
                                      {material.import_status_display}
                                    </Tag>
                                  </Tooltip>
                                  {material.import_status === 'failed' && (
                                    <Button
                                      size="small"
                                      icon={<ReloadOutlined />}
                                      onClick={() => void retryImport(material.id)}
                                    >
                                      重新导入
                                    </Button>
                                  )}
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
