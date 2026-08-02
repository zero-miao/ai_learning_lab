import React, { useEffect, useState } from 'react';
import { Navigate, useParams, useNavigate, Link } from 'react-router-dom';
import {
  Layout,
  Typography,
  Button,
  Space,
  Card,
  Descriptions,
  Tag,
  List,
  Modal,
  Pagination,
  Form,
  Input,
  Popconfirm,
  Radio,
  Tabs,
  Tooltip,
  message,
} from 'antd';
import {
  ArrowLeftOutlined,
  ApartmentOutlined,
  BookOutlined,
  DeleteOutlined,
  EyeOutlined,
  FormOutlined,
  PlusOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import {
  createMaterial,
  deleteMaterial,
  deleteQuestion,
  getTopic,
  listAITasks,
  retryMaterialImport,
} from '../../api';
import type { Topic } from '../../api';
import TopicDiscussion from '../../components/TopicDiscussion';

const { Title } = Typography;
const { Content } = Layout;
const OUTPUT_PAGE_SIZE = 5;
type LearningOutputTab = 'questions' | 'concepts' | 'highlights';

interface SearchField {
  label: string;
  value?: string;
}

function getMatchingFields(fields: SearchField[], keyword: string) {
  if (!keyword) return [];
  return fields.filter((field) =>
    field.value?.toLowerCase().includes(keyword),
  );
}

function renderHighlightedText(value: string, keyword: string): React.ReactNode {
  if (!keyword) return value;
  const escapedKeyword = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`(${escapedKeyword})`, 'gi');
  return value.split(pattern).map((part, index) =>
    part.toLowerCase() === keyword ? (
      <mark key={index}>{part}</mark>
    ) : (
      part
    ),
  );
}

const TopicDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const [topic, setTopic] = useState<Topic | null>(null);
  const [loading, setLoading] = useState(false);
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [briefingMaterialIds, setBriefingMaterialIds] = useState<number[]>([]);
  const [outputTab, setOutputTab] = useState<LearningOutputTab>('questions');
  const [outputKeyword, setOutputKeyword] = useState('');
  const [outputPage, setOutputPage] = useState(1);
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

  const handleRetryMaterialImport = async (materialId: number) => {
    try {
      await retryMaterialImport(materialId);
      message.success('材料已重新导入');
      fetchTopic();
    } catch (error) {
      console.error('Failed to retry material import:', error);
      message.error('重新导入材料失败');
    }
  };

  const handleDeleteQuestion = async (questionId: number) => {
    try {
      await deleteQuestion(questionId);
      message.success('问答已删除');
      fetchTopic();
    } catch (error) {
      console.error('Failed to delete question:', error);
      message.error('删除问答失败');
    }
  };

  if (loading && !topic) return <div style={{ padding: '24px' }}>加载中...</div>;
  if (!topic) return <div style={{ padding: '24px' }}>未找到主题</div>;
  if (topic.type === 'discussion') {
    return <Navigate to={`/topics/${topic.id}/discussion`} replace />;
  }
  const getMaterialTitle = (materialId: number | null) =>
    topic.materials.find((material) => material.id === materialId)?.title ??
    '未知材料';
  const normalizedKeyword = outputKeyword.trim().toLowerCase();
  const savedQuestions = topic.questions.filter(
    (question) => question.is_saved,
  );
  const questionFields = (question: (typeof savedQuestions)[number]) => [
    { label: '问题', value: question.question_text },
    ...(question.selected_text
      ? [{ label: '原文', value: question.selected_text }]
      : [{ label: 'AI 回答', value: question.ai_responses[0]?.content }]),
    { label: '出处', value: getMaterialTitle(question.material) },
  ];
  const conceptFields = (concept: Topic['concepts'][number]) => {
    const anchor = concept.anchors[0];
    return [
      { label: '概念名称', value: concept.title },
      { label: '定义', value: concept.definition },
      { label: '原文', value: anchor?.source_text },
      { label: '出处', value: anchor?.material_title },
    ];
  };
  const highlightFields = (highlight: Topic['highlights'][number]) => [
    { label: '原文', value: highlight.source_text },
    { label: '出处', value: getMaterialTitle(highlight.material) },
    { label: '备注', value: highlight.user_note },
  ];
  const matchesFields = (fields: SearchField[], keyword = normalizedKeyword) =>
    !keyword || getMatchingFields(fields, keyword).length > 0;
  const renderMatchedFieldNames = (fields: SearchField[]) => {
    const matchedFields = getMatchingFields(fields, normalizedKeyword);
    return matchedFields.length ? (
      <Typography.Text type="secondary">
        匹配字段：{matchedFields.map((field) => field.label).join('、')}
      </Typography.Text>
    ) : null;
  };
  const filteredQuestions = savedQuestions.filter((question) =>
    matchesFields(questionFields(question)),
  );
  const filteredConcepts = topic.concepts.filter((concept) =>
    matchesFields(conceptFields(concept)),
  );
  const filteredHighlights = topic.highlights.filter((highlight) =>
    matchesFields(highlightFields(highlight)),
  );
  const paginate = <Item,>(items: Item[]) =>
    items.slice(
      (outputPage - 1) * OUTPUT_PAGE_SIZE,
      outputPage * OUTPUT_PAGE_SIZE,
    );
  const renderOutputPagination = (total: number) =>
    total > OUTPUT_PAGE_SIZE ? (
      <Pagination
        current={outputPage}
        pageSize={OUTPUT_PAGE_SIZE}
        total={total}
        showSizeChanger={false}
        onChange={setOutputPage}
        style={{ marginTop: 16, textAlign: 'right' }}
      />
    ) : null;
  const handleOutputTabChange = (nextTab: string) => {
    setOutputTab(nextTab as LearningOutputTab);
    setOutputPage(1);
  };
  const handleOutputKeywordChange = (value: string) => {
    setOutputKeyword(value);
    setOutputPage(1);
    const nextKeyword = value.trim().toLowerCase();
    if (!nextKeyword) return;
    const matchingTabs = {
      questions: savedQuestions.some((question) =>
        matchesFields(questionFields(question), nextKeyword),
      ),
      concepts: topic.concepts.some((concept) =>
        matchesFields(conceptFields(concept), nextKeyword),
      ),
      highlights: topic.highlights.some((highlight) =>
        matchesFields(highlightFields(highlight), nextKeyword),
      ),
    };
    const nextTab = (
      [outputTab, 'questions', 'concepts', 'highlights'] as LearningOutputTab[]
    ).find((tab) => matchingTabs[tab]);
    if (nextTab) setOutputTab(nextTab);
  };

  return (
    <Content style={{ padding: '24px' }}>
      <Space direction="vertical" size="large" style={{ display: 'flex' }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/topics')}>
          返回列表
        </Button>

        <Card size="small">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <Space size={8}>
              <Tag color={topic.type === 'learning' ? 'blue' : 'purple'}>
                {topic.type === 'learning' ? '学习类' : '讨论类'}
              </Tag>
              <Title level={3} style={{ margin: 0 }}>{topic.title}</Title>
            </Space>
            <Space>
              <Tag color="blue">{topic.status_display}</Tag>
              <Tag color="green">掌握度: {topic.mastery_level_display}</Tag>
              <Button
                icon={<ApartmentOutlined />}
                onClick={() => navigate(`/topics/${topic.id}/map`)}
              >
                查看思维导图
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

          <Descriptions size="small" column={2} style={{ marginTop: '16px' }}>
            <Descriptions.Item label="学习目标">{topic.goal || '未设置'}</Descriptions.Item>
            <Descriptions.Item label="学习范围">{topic.scope || '未设置'}</Descriptions.Item>
            <Descriptions.Item label="创建时间">{new Date(topic.created_at).toLocaleString()}</Descriptions.Item>
          </Descriptions>
        </Card>

        <Card
          title="学习产出"
          extra={
            <Input.Search
              allowClear
              placeholder="搜索当前学习产出"
              style={{ width: 260 }}
              value={outputKeyword}
              onChange={(event) => handleOutputKeywordChange(event.target.value)}
            />
          }
        >
          <Tabs
            activeKey={outputTab}
            onChange={handleOutputTabChange}
            items={[
              {
                key: 'questions',
                label: `问答 (${filteredQuestions.length})`,
                children: (
                  <>
                    <List
                      size="small"
                      dataSource={paginate(filteredQuestions)}
                      locale={{ emptyText: '没有匹配的已沉淀问答。' }}
                      renderItem={(question) => (
                        <List.Item
                          actions={[
                            question.material && question.start_offset !== null ? (
                              <Button key="source" type="link" icon={<EyeOutlined />} onClick={() => navigate(`/topics/${topic.id}/materials/${question.material}?anchor=${question.start_offset}&question=${question.id}`)}>
                                查看原文
                              </Button>
                            ) : null,
                            <Popconfirm key="delete" title="删除这条问答？" okText="删除" cancelText="取消" okButtonProps={{ danger: true }} onConfirm={() => void handleDeleteQuestion(question.id)}>
                              <Button type="link" danger icon={<DeleteOutlined />}>删除</Button>
                            </Popconfirm>,
                          ]}
                        >
                          <List.Item.Meta
                            title={renderHighlightedText(
                              question.question_text,
                              normalizedKeyword,
                            )}
                            description={
                              question.selected_text ? (
                                <Space direction="vertical" size={2}>
                                  <Typography.Text>
                                    原文：“
                                    {renderHighlightedText(
                                      question.selected_text,
                                      normalizedKeyword,
                                    )}
                                    ”
                                  </Typography.Text>
                                  <Typography.Text type="secondary">
                                    来自：《
                                    {renderHighlightedText(
                                      getMaterialTitle(question.material),
                                      normalizedKeyword,
                                    )}
                                    》
                                  </Typography.Text>
                                  {renderMatchedFieldNames(
                                    questionFields(question),
                                  )}
                                </Space>
                              ) : (
                                <Space direction="vertical" size={2}>
                                  <Typography.Text>
                                    {renderHighlightedText(
                                      question.ai_responses[0]?.content ||
                                        'AI 回答仍在生成或不可用。',
                                      normalizedKeyword,
                                    )}
                                  </Typography.Text>
                                  <Typography.Text type="secondary">
                                    来自：《
                                    {renderHighlightedText(
                                      getMaterialTitle(question.material),
                                      normalizedKeyword,
                                    )}
                                    》
                                  </Typography.Text>
                                  {renderMatchedFieldNames(
                                    questionFields(question),
                                  )}
                                </Space>
                              )
                            }
                          />
                        </List.Item>
                      )}
                    />
                    {renderOutputPagination(filteredQuestions.length)}
                  </>
                ),
              },
              {
                key: 'concepts',
                label: `概念 (${filteredConcepts.length})`,
                children: (
                  <>
                  <List
                    size="small"
                    dataSource={paginate(filteredConcepts)}
                    locale={{ emptyText: '没有匹配的概念。' }}
                    renderItem={(concept) => {
                      const anchor = concept.anchors[0];
                      return (
                        <List.Item
                          actions={
                            anchor
                              ? [
                                  <Button
                                    key="source"
                                    type="link"
                                    icon={<EyeOutlined />}
                                    onClick={() =>
                                      navigate(
                                        `/topics/${topic.id}/materials/${anchor.material}?anchor=${anchor.start_offset}&concept=${concept.id}`,
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
                            title={renderHighlightedText(
                              concept.title,
                              normalizedKeyword,
                            )}
                            description={
                              <Space direction="vertical" size={2}>
                                <Typography.Text>
                                  {renderHighlightedText(
                                    concept.definition ||
                                      '概念草稿正在生成或等待补全。',
                                    normalizedKeyword,
                                  )}
                                </Typography.Text>
                                {anchor && (
                                  <>
                                    <Typography.Text>
                                      原文：“
                                      {renderHighlightedText(
                                        anchor.source_text,
                                        normalizedKeyword,
                                      )}
                                      ”
                                    </Typography.Text>
                                    <Typography.Text type="secondary">
                                      来自：《
                                      {renderHighlightedText(
                                        anchor.material_title,
                                        normalizedKeyword,
                                      )}
                                      》
                                    </Typography.Text>
                                  </>
                                )}
                                {renderMatchedFieldNames(
                                  conceptFields(concept),
                                )}
                              </Space>
                            }
                          />
                        </List.Item>
                      );
                    }}
                  />
                  {renderOutputPagination(filteredConcepts.length)}
                  </>
                ),
              },
              {
                key: 'highlights',
                label: `高亮 (${filteredHighlights.length})`,
                children: (
                  <>
                  <List
                    size="small"
                    dataSource={paginate(filteredHighlights)}
                    locale={{ emptyText: '没有匹配的高亮。' }}
                    renderItem={(highlight) => (
                      <List.Item
                        actions={[
                          <Button
                            key="source"
                            type="link"
                            icon={<EyeOutlined />}
                            onClick={() =>
                              navigate(
                                `/topics/${topic.id}/materials/${highlight.material}?anchor=${highlight.start_offset}&highlight=${highlight.id}`,
                              )
                            }
                          >
                            查看原文
                          </Button>,
                        ]}
                      >
                        <Space direction="vertical" size={2}>
                          <Typography.Paragraph style={{ margin: 0 }}>
                            原文：“
                            {renderHighlightedText(
                              highlight.source_text,
                              normalizedKeyword,
                            )}
                            ”
                          </Typography.Paragraph>
                          <Typography.Text type="secondary">
                            来自：《
                            {renderHighlightedText(
                              getMaterialTitle(highlight.material),
                              normalizedKeyword,
                            )}
                            》
                          </Typography.Text>
                          {highlight.user_note && (
                            <Typography.Text type="secondary">
                              备注：
                              {renderHighlightedText(
                                highlight.user_note,
                                normalizedKeyword,
                              )}
                            </Typography.Text>
                          )}
                          {renderMatchedFieldNames(highlightFields(highlight))}
                        </Space>
                      </List.Item>
                    )}
                  />
                  {renderOutputPagination(filteredHighlights.length)}
                  </>
                ),
              },
            ]}
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
                  ...(item.import_status === 'failed'
                    ? [
                        <Button
                          key="retry-import"
                          type="link"
                          icon={<ReloadOutlined />}
                          onClick={() => handleRetryMaterialImport(item.id)}
                        >
                          重新导入
                        </Button>,
                      ]
                    : []),
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
                      <Tooltip title={item.import_error || undefined}>
                        <Tag
                          color={
                            item.import_status === 'success'
                              ? 'success'
                              : item.import_status === 'failed'
                                ? 'error'
                                : 'processing'
                          }
                        >
                          {item.import_status_display}
                        </Tag>
                      </Tooltip>
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

        <TopicDiscussion topicId={topic.id} />
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
