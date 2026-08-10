import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  Button,
  Card,
  Descriptions,
  Form,
  Input,
  List,
  Modal,
  Pagination,
  Popconfirm,
  Radio,
  Select,
  Space,
  Tag,
  Tabs,
  Typography,
  message,
  theme,
} from 'antd';
import {
  ApartmentOutlined,
  ArrowLeftOutlined,
  CheckOutlined,
  DeleteOutlined,
  EditOutlined,
  EyeOutlined,
  FileSearchOutlined,
  LinkOutlined,
  MessageOutlined,
  PlusOutlined,
} from '@ant-design/icons';
import {
  deleteConcept,
  deleteHighlight,
  deleteQuestion,
  getMaterials,
  getTopic,
  createMaterial,
  removeTopicMaterial,
  triggerSupplement,
  updateConcept,
  updateHighlight,
  updateTopic,
  updateTopicMaterial,
  uploadVideo,
} from '../../api';
import type {
  Concept,
  Highlight,
  MaterialSummary,
  Topic,
  TopicMaterial,
} from '../../api';
import TopicDiscussionDrawer from './TopicDiscussionDrawer';

const { Title, Text } = Typography;
const OUTPUT_PAGE_SIZE = 5;
type OutputTab = 'concepts' | 'questions' | 'highlights';

interface MaterialFormValues {
  title: string;
  type: 'url' | 'text' | 'video' | 'existing';
  source_url?: string;
  raw_text?: string;
  existing_material_id?: number;
}

interface TopicFormValues {
  title: string;
  goal: string;
  scope: string;
}

const TopicDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [topic, setTopic] = useState<Topic | null>(null);
  const [loading, setLoading] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [subtitleFile, setSubtitleFile] = useState<File | null>(null);
  const [allMaterials, setAllMaterials] = useState<MaterialSummary[]>([]);
  const [materialForm] = Form.useForm<MaterialFormValues>();
  const [outputTab, setOutputTab] = useState<OutputTab>('concepts');
  const [outputPage, setOutputPage] = useState(1);
  const [editingConcept, setEditingConcept] = useState<Concept | null>(null);
  const [editingHighlight, setEditingHighlight] = useState<Highlight | null>(null);
  const [conceptModal, setConceptModal] = useState(false);
  const [highlightModal, setHighlightModal] = useState(false);
  const [topicModal, setTopicModal] = useState(false);
  const [discussionOpen, setDiscussionOpen] = useState(false);
  const [topicForm] = Form.useForm<TopicFormValues>();
  const [conceptForm] = Form.useForm<Partial<Concept>>();
  const [highlightForm] = Form.useForm<{ user_note: string }>();
  const { token } = theme.useToken();
  const outputTextStyle: React.CSSProperties = {
    color: token.colorText,
    fontSize: 14,
  };
  const outputQuoteStyle: React.CSSProperties = {
    color: token.colorTextSecondary,
    fontSize: 13,
    fontStyle: 'italic',
    borderLeft: `3px solid ${token.colorBorderSecondary}`,
    backgroundColor: token.colorFillQuaternary,
    padding: '8px 12px',
  };

  const loadTopic = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const [topicRes, materialsRes] = await Promise.all([
        getTopic(Number(id)),
        getMaterials({ page_size: 20 })
      ]);
      setTopic(topicRes.data);
      setAllMaterials(materialsRes.data.results);
    } catch {
      message.error('加载数据失败');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void loadTopic();
  }, [loadTopic]);

  const updateCategory = async (
    relation: TopicMaterial,
    category: TopicMaterial['category'],
  ) => {
    await updateTopicMaterial(relation.id, { category });
    await loadTopic();
  };

  const removeMaterial = async (relation: TopicMaterial) => {
    try {
      await removeTopicMaterial(relation.id);
      message.success('已移除材料关联');
      void loadTopic();
    } catch {
      message.error('移除失败');
    }
  };

  const runSupplement = async (type: 'Concept' | 'Question' | 'Highlight', id: number) => {
    if (!topic) return;
    try {
      await triggerSupplement(topic.id, type, id);
      setDiscussionOpen(true);
      message.info('正在检索补充资料。');
    } catch {
      message.error('触发补料失败');
    }
  };

  const handleEditConcept = (concept: Concept) => {
    setEditingConcept(concept);
    conceptForm.setFieldsValue(concept);
    setConceptModal(true);
  };

  const handleEditHighlight = (highlight: Highlight) => {
    setEditingHighlight(highlight);
    highlightForm.setFieldsValue({ user_note: highlight.user_note });
    setHighlightModal(true);
  };

  const submitConcept = async (values: Partial<Concept>) => {
    if (!editingConcept) return;
    try {
      await updateConcept(editingConcept.id, values);
      message.success('概念已更新');
      setConceptModal(false);
      setEditingConcept(null);
      void loadTopic();
    } catch {
      message.error('保存失败');
    }
  };

  const submitHighlight = async (values: { user_note: string }) => {
    if (!editingHighlight) return;
    try {
      await updateHighlight(editingHighlight.id, values);
      message.success('高亮已更新');
      setHighlightModal(false);
      setEditingHighlight(null);
      void loadTopic();
    } catch {
      message.error('保存失败');
    }
  };

  const confirmConcept = async (id: number) => {
    try {
      await updateConcept(id, { status: 'confirmed' });
      message.success('概念已确认');
      void loadTopic();
    } catch {
      message.error('确认失败');
    }
  };

  const openTopicEditor = () => {
    if (!topic) return;
    topicForm.setFieldsValue({
      title: topic.title,
      goal: topic.goal,
      scope: topic.scope,
    });
    setTopicModal(true);
  };

  const submitTopic = async (values: TopicFormValues) => {
    if (!topic) return;
    try {
      const response = await updateTopic(topic.id, values);
      setTopic(response.data);
      setTopicModal(false);
      message.success('话题信息已更新');
    } catch {
      message.error('保存话题信息失败');
    }
  };

  const importMaterial = async (values: MaterialFormValues) => {
    if (!topic) return;
    try {
      if (values.type === 'existing') {
        if (!values.existing_material_id) throw new Error('请选择已有材料');
        await createMaterial({
          topic: topic.id,
          title: '', // Not used for existing
          media_type: 'text', // Not used for existing
          existing_material_id: values.existing_material_id
        } as any);
      } else if (values.type === 'video') {
        if (!videoFile) {
          message.error('请选择视频文件');
          return;
        }
        const data = new FormData();
        data.append('topic', String(topic.id));
        data.append('title', values.title);
        data.append('video', videoFile);
        if (subtitleFile) {
          data.append('subtitle', subtitleFile);
        }
        await uploadVideo(data);
        message.success(
          subtitleFile
            ? '视频与字幕已上传，正在处理时间轴'
            : '视频已上传，正在生成转录稿',
        );
      } else {
        await createMaterial({
          topic: topic.id,
          title: values.title,
          media_type: values.type === 'url' ? 'web_page' : 'text',
          media_uri: values.type === 'url' ? values.source_url : '',
          raw_text: values.type === 'text' ? values.raw_text : '',
        });
        message.success('材料已导入');
      }
      setImportOpen(false);
      setVideoFile(null);
      setSubtitleFile(null);
      materialForm.resetFields();
      await loadTopic();
    } catch (error) {
      console.error('Failed to import material:', error);
      message.error('导入失败');
    }
  };

  if (loading && !topic) return <div style={{ padding: 24 }}>加载中...</div>;
  if (!topic) return <div style={{ padding: 24 }}>未找到主题</div>;
  return (
    <div style={{ maxWidth: 1080, margin: '0 auto', padding: 24 }}>
      <Space direction="vertical" size="large" style={{ display: 'flex' }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/topics')}>
          返回主题列表
        </Button>
        <Card>
          <Space direction="vertical" size="middle" style={{ display: 'flex' }}>
            <Space wrap>
              <Title level={2} style={{ margin: 0 }}>{topic.title}</Title>
              <Button
                type="text"
                icon={<EditOutlined />}
                aria-label="编辑话题信息"
                onClick={openTopicEditor}
              />
              <Tag color="blue">{topic.status_display}</Tag>
              <Tag color="green">掌握度：{topic.mastery_level_display}</Tag>
            </Space>
            <Descriptions size="small" column={2}>
              <Descriptions.Item label="学习目标" span={2}>
                <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                  {topic.goal || '未设置'}
                </div>
              </Descriptions.Item>
              <Descriptions.Item label="学习范围" span={2}>
                <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                  {topic.scope || '未设置'}
                </div>
              </Descriptions.Item>
              <Descriptions.Item label="概念">{topic.learning_output.concept_count}</Descriptions.Item>
              <Descriptions.Item label="问题">{topic.learning_output.question_count}</Descriptions.Item>
            </Descriptions>
            <Space wrap>
              <Button
                type="primary"
                icon={<MessageOutlined />}
                onClick={() => setDiscussionOpen(true)}
              >
                学习讨论
              </Button>
              <Button icon={<ApartmentOutlined />} onClick={() => navigate(`/topics/${topic.id}/map`)}>
                概念图
              </Button>
              <Button onClick={() => navigate(`/topics/${topic.id}/exam`)}>
                掌握度评估
              </Button>
            </Space>
          </Space>
        </Card>

        <Card title="学习产出">
          <Tabs
            activeKey={outputTab}
            onChange={(key) => { setOutputTab(key as OutputTab); setOutputPage(1); }}
            items={[
              {
                key: 'concepts',
                label: `概念 (${topic.concepts.length})`,
                children: (
                  <>
                    <List
                      size="small"
                      dataSource={topic.concepts.slice((outputPage - 1) * OUTPUT_PAGE_SIZE, outputPage * OUTPUT_PAGE_SIZE)}
                      locale={{ emptyText: '暂无概念。' }}
                      renderItem={(item) => (
                        <List.Item
                          actions={[
                            <Button key="jump" type="link" size="small" icon={<EyeOutlined />} onClick={() => navigate(`/topics/${topic.id}/materials/${item.locators[0]?.material}?locator=${item.locators[0]?.id}`)}>原文</Button>,
                            <Button key="edit" type="link" size="small" icon={<EditOutlined />} onClick={() => handleEditConcept(item)}>编辑</Button>,
                            <Button key="supp" type="link" size="small" icon={<FileSearchOutlined />} onClick={() => void runSupplement('Concept', item.id)}>补料</Button>,
                            item.status !== 'confirmed' && <Button key="confirm" type="link" size="small" icon={<CheckOutlined />} style={{ color: '#52c41a' }} onClick={() => void confirmConcept(item.id)}>确认</Button>,
                            <Popconfirm key="del" title="确定删除该概念？" onConfirm={() => void deleteConcept(item.id).then(loadTopic)}><Button type="link" size="small" danger icon={<DeleteOutlined />}>删除</Button></Popconfirm>
                          ].filter(Boolean)}
                        >
                          <List.Item.Meta
                            title={<span style={{ fontWeight: 'bold', fontSize: '16px' }}>{item.title}</span>}
                            description={
                              <Space direction="vertical" size={8} style={{ display: 'flex', marginTop: 4 }}>
                                <div style={outputTextStyle}>
                                  {item.definition || '等待 AI 生成内容'}
                                </div>
                                {item.locators[0]?.source_text && (
                                  <div style={outputQuoteStyle}>
                                    “{item.locators[0].source_text}” —— 来自《{item.locators[0].material_title}》
                                  </div>
                                )}
                              </Space>
                            }
                          />
                        </List.Item>
                      )}
                    />
                    {topic.concepts.length > OUTPUT_PAGE_SIZE && <Pagination current={outputPage} pageSize={OUTPUT_PAGE_SIZE} total={topic.concepts.length} showSizeChanger={false} onChange={setOutputPage} style={{ marginTop: 16, textAlign: 'right' }} />}
                  </>
                )
              },
              {
                key: 'questions',
                label: `问答 (${topic.questions.length})`,
                children: (
                  <>
                    <List
                      size="small"
                      dataSource={topic.questions.slice((outputPage - 1) * OUTPUT_PAGE_SIZE, outputPage * OUTPUT_PAGE_SIZE)}
                      locale={{ emptyText: '暂无问答。' }}
                      renderItem={(item) => (
                        <List.Item
                          actions={[
                            <Button key="jump" type="link" size="small" icon={<EyeOutlined />} onClick={() => navigate(`/topics/${topic.id}/materials/${item.locators[0]?.material}?locator=${item.locators[0]?.id}`)}>原文</Button>,
                            <Button key="supp" type="link" size="small" icon={<FileSearchOutlined />} onClick={() => void runSupplement('Question', item.id)}>补料</Button>,
                            <Popconfirm key="del" title="确定删除该问答？" onConfirm={() => void deleteQuestion(item.id).then(loadTopic)}><Button type="link" size="small" danger icon={<DeleteOutlined />}>删除</Button></Popconfirm>
                          ]}
                        >
                          <List.Item.Meta
                            title={<span style={{ fontWeight: 'bold', fontSize: '15px' }}>{item.question_text}</span>}
                            description={
                              <Space direction="vertical" size={8} style={{ display: 'flex', marginTop: 4 }}>
                                {item.locators[0]?.source_text && (
                                  <div style={outputQuoteStyle}>
                                    “{item.locators[0].source_text}” —— 来自《{item.locators[0].material_title}》
                                  </div>
                                )}
                                <div style={outputTextStyle}>
                                  {item.conclusion || '等待 AI 生成内容'}
                                </div>
                              </Space>
                            }
                          />
                        </List.Item>
                      )}
                    />
                    {topic.questions.length > OUTPUT_PAGE_SIZE && <Pagination current={outputPage} pageSize={OUTPUT_PAGE_SIZE} total={topic.questions.length} showSizeChanger={false} onChange={setOutputPage} style={{ marginTop: 16, textAlign: 'right' }} />}
                  </>
                )
              },
              {
                key: 'highlights',
                label: `高亮 (${topic.highlights.length})`,
                children: (
                  <>
                    <List
                      size="small"
                      dataSource={topic.highlights.slice((outputPage - 1) * OUTPUT_PAGE_SIZE, outputPage * OUTPUT_PAGE_SIZE)}
                      locale={{ emptyText: '暂无高亮。' }}
                      renderItem={(item) => (
                        <List.Item
                          actions={[
                            <Button key="jump" type="link" size="small" icon={<EyeOutlined />} onClick={() => navigate(`/topics/${topic.id}/materials/${item.locators[0]?.material}?locator=${item.locators[0]?.id}`)}>原文</Button>,
                            <Button key="edit" type="link" size="small" icon={<EditOutlined />} onClick={() => handleEditHighlight(item)}>编辑</Button>,
                            <Button key="supp" type="link" size="small" icon={<FileSearchOutlined />} onClick={() => void runSupplement('Highlight', item.id)}>补料</Button>,
                            <Popconfirm key="del" title="确定删除该高亮？" onConfirm={() => void deleteHighlight(item.id).then(loadTopic)}><Button type="link" size="small" danger icon={<DeleteOutlined />}>删除</Button></Popconfirm>
                          ]}
                        >
                          <List.Item.Meta
                            title={<span style={{ fontWeight: 'bold', fontSize: '15px' }}>{item.locators[0]?.source_text || '高亮'}</span>}
                            description={
                              <Space direction="vertical" size={8} style={{ display: 'flex', marginTop: 4 }}>
                                <div style={outputQuoteStyle}>
                                  “{item.locators[0]?.source_text}” —— 来自《{item.locators[0]?.material_title}》
                                </div>
                                <div style={outputTextStyle}>
                                  {item.user_note || <Text type="secondary" italic>暂无备注</Text>}
                                </div>
                              </Space>
                            }
                          />
                        </List.Item>
                      )}
                    />
                    {topic.highlights.length > OUTPUT_PAGE_SIZE && <Pagination current={outputPage} pageSize={OUTPUT_PAGE_SIZE} total={topic.highlights.length} showSizeChanger={false} onChange={setOutputPage} style={{ marginTop: 16, textAlign: 'right' }} />}
                  </>
                )
              }
            ]}
          />
        </Card>

        <Card
          title={`学习材料 (${topic.topic_materials.length})`}
          extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => setImportOpen(true)}>添加材料</Button>}
        >
          <List
            dataSource={topic.topic_materials}
            locale={{ emptyText: '暂无材料。可导入视频、文本或查找候选材料。' }}
            renderItem={(relation) => {
              const material = relation.material;
              return (
                <List.Item
                  actions={[
                    <Link key="read" to={`/topics/${topic.id}/materials/${material.id}`}>
                      <Button type="link">学习</Button>
                    </Link>,
                    <Popconfirm
                      key="remove"
                      title="从当前主题移除这份材料？"
                      onConfirm={() => void removeMaterial(relation)}
                    >
                      <Button type="text" danger icon={<DeleteOutlined />} />
                    </Popconfirm>,
                  ]}
                >
                  <List.Item.Meta
                    title={
                      <Space>
                        <span>{material.title}</span>
                        {relation.import_by === 'ai_recommended' && <Tag color="purple">AI 新增</Tag>}
                        {material.media_type === 'web_page' && material.media_uri && (
                          <a href={material.media_uri} target="_blank" rel="noreferrer" style={{ fontSize: '12px' }}>
                            <LinkOutlined style={{ marginRight: 4 }} />
                            原始链接
                          </a>
                        )}
                      </Space>
                    }
                    description={
                      <Space wrap>
                        <Tag>{material.media_type}</Tag>
                        <Tag color={material.status === 'ready' ? 'success' : material.status === 'failed' ? 'error' : 'processing'}>
                          {material.status_display || material.status}
                        </Tag>
                        {relation.import_by === 'ai_recommended' && (
                          <>
                            <Select
                              size="small"
                              value={relation.category}
                              onChange={(category) => void updateCategory(relation, category)}
                              options={[
                                { value: 'exam_material', label: '考试材料' },
                                { value: 'recommended_reading', label: '推荐阅读' },
                              ]}
                            />
                            <Text type="secondary">
                              {relation.relevance_score === null ? '' : `相关度 ${Math.round(relation.relevance_score * 100)}%`}
                              {relation.import_reason ? ` · ${relation.import_reason}` : ''}
                            </Text>
                          </>
                        )}
                        {material.error && <Text type="danger">{material.error}</Text>}
                      </Space>
                    }
                  />
                </List.Item>
              );
            }}
          />
        </Card>
      </Space>
      <Modal
        title="添加材料"
        open={importOpen}
        onCancel={() => {
          setImportOpen(false);
          setVideoFile(null);
          setSubtitleFile(null);
          materialForm.resetFields();
        }}
        onOk={() => materialForm.submit()}
      >
        <Form form={materialForm} layout="vertical" initialValues={{ type: 'url' }} onFinish={(values) => void importMaterial(values)}>
          <Form.Item
            noStyle
            shouldUpdate={(prev, curr) => prev.type !== curr.type}
          >
            {({ getFieldValue }) => {
              if (getFieldValue('type') === 'existing') return null;
              return <Form.Item name="title" label="材料标题" rules={[{ required: true, message: '请输入标题' }]}><Input /></Form.Item>;
            }}
          </Form.Item>
          <Form.Item name="type" label="材料类型">
            <Radio.Group>
              <Radio value="url">网页链接</Radio>
              <Radio value="text">粘贴文本</Radio>
              <Radio value="video">本地视频</Radio>
              <Radio value="existing">已有材料</Radio>
            </Radio.Group>
          </Form.Item>
          <Form.Item noStyle shouldUpdate={(previous, current) => previous.type !== current.type}>
            {({ getFieldValue, setFieldsValue }) => {
              const type = getFieldValue('type');
              if (type === 'existing') {
                if (!topic) return null;
                const linkedIds = new Set(topic.topic_materials.map(m => m.material.id));
                const available = allMaterials.filter(m => !linkedIds.has(m.id));
                return (
                  <Form.Item
                    name="existing_material_id"
                    label="选择已有材料"
                    rules={[{ required: true, message: '请选择材料' }]}
                  >
                    <Select
                      showSearch
                      placeholder="搜索并选择已有材料"
                      filterOption={false}
                      onSearch={(value) => {
                        void getMaterials({
                          page_size: 20,
                          ...(value.trim() ? { q: value.trim() } : {}),
                        }).then((response) => {
                          setAllMaterials(response.data.results);
                        });
                      }}
                      options={available.map(m => ({ label: m.title, value: m.id }))}
                    />
                  </Form.Item>
                );
              }
              if (type === 'url') {
                return <Form.Item name="source_url" label="网页链接" rules={[{ required: true, type: 'url', message: '请输入有效 URL' }]}><Input placeholder="https://..." /></Form.Item>;
              }
              if (type === 'text') {
                return <Form.Item name="raw_text" label="材料正文" rules={[{ required: true, message: '请输入正文' }]}><Input.TextArea rows={7} /></Form.Item>;
              }
              if (type === 'video') {
                return (
                  <>
                    <Form.Item label="选择视频" required>
                      <input
                        type="file"
                        accept="video/*"
                        aria-label="选择视频文件"
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          setVideoFile(file ?? null);
                          if (file && !materialForm.getFieldValue('title')) {
                            setFieldsValue({
                              title: file.name.replace(/\.[^.]+$/, ''),
                            });
                          }
                        }}
                      />
                    </Form.Item>
                    <Form.Item
                      label="外挂字幕（可选）"
                      extra="支持 .srt 和 .vtt；提供后将优先使用字幕，不再执行语音识别。"
                    >
                      <input
                        type="file"
                        accept=".srt,.vtt,text/vtt,application/x-subrip"
                        aria-label="选择外挂字幕文件"
                        onChange={(event) => {
                          setSubtitleFile(event.target.files?.[0] ?? null);
                        }}
                      />
                    </Form.Item>
                  </>
                );
              }
              return null;
            }}
          </Form.Item>
        </Form>
      </Modal>
      <Modal title={editingConcept ? "编辑概念" : "标记概念"} open={conceptModal} onCancel={() => { setConceptModal(false); setEditingConcept(null); }} onOk={() => conceptForm.submit()}>
        <Form form={conceptForm} layout="vertical" onFinish={submitConcept}>
          <Form.Item name="title" label="名称" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="definition" label="定义"><Input.TextArea rows={3} /></Form.Item>
          <Form.Item name="principle" label="原理"><Input.TextArea rows={3} /></Form.Item>
          <Form.Item name="pitfalls" label="易错点"><Input.TextArea rows={3} /></Form.Item>
          <Form.Item name="applications" label="应用"><Input.TextArea rows={3} /></Form.Item>
        </Form>
      </Modal>
      <Modal
        title="编辑话题信息"
        open={topicModal}
        onCancel={() => setTopicModal(false)}
        onOk={() => topicForm.submit()}
        okText="保存"
      >
        <Form form={topicForm} layout="vertical" onFinish={submitTopic}>
          <Form.Item
            name="title"
            label="标题"
            rules={[{ required: true, whitespace: true, message: '请输入话题标题' }]}
          >
            <Input />
          </Form.Item>
          <Form.Item name="goal" label="学习目标">
            <Input.TextArea rows={3} placeholder="希望通过这个话题解决什么问题？" />
          </Form.Item>
          <Form.Item name="scope" label="学习范围">
            <Input.TextArea rows={3} placeholder="明确包含内容、边界或暂不涉及的方向" />
          </Form.Item>
        </Form>
      </Modal>
      <Modal title={editingHighlight ? "编辑高亮" : "添加高亮"} open={highlightModal} onCancel={() => { setHighlightModal(false); setEditingHighlight(null); }} onOk={() => highlightForm.submit()}>
        <Form form={highlightForm} layout="vertical" onFinish={submitHighlight}>
          <Form.Item name="user_note" label="笔记内容"><Input.TextArea rows={4} /></Form.Item>
        </Form>
      </Modal>
      <TopicDiscussionDrawer
        topicId={topic.id}
        open={discussionOpen}
        onClose={() => setDiscussionOpen(false)}
        onMaterialsChanged={loadTopic}
      />
    </div>
  );
};

export default TopicDetail;
