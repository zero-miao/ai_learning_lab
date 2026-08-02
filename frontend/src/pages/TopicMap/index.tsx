import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Button,
  Card,
  Descriptions,
  Drawer,
  Empty,
  Form,
  Input,
  List,
  Modal,
  Popconfirm,
  Select,
  Space,
  Tag,
  Typography,
  message,
} from 'antd';
import {
  ArrowLeftOutlined,
  DeleteOutlined,
  EditOutlined,
} from '@ant-design/icons';
import {
  createConceptRelation,
  deleteConcept,
  deleteConceptRelation,
  getTopic,
  updateConcept,
  updateConceptRelation,
} from '../../api';
import type {
  Concept,
  ConceptAnchor,
  ConceptRelation,
  Topic,
} from '../../api';

const { Title, Paragraph } = Typography;

interface RelationFormValues {
  from_concept: number;
  to_concept: number;
  relation_type: string;
  description?: string;
}

interface ConceptFormValues {
  title: string;
  definition?: string;
  principle?: string;
  pitfalls?: string;
  applications?: string;
}

interface NodePosition {
  x: number;
  y: number;
}

const MAP_WIDTH = 960;
const MAP_HEIGHT = 560;

function getNodePositions(concepts: Concept[]) {
  const positions = new Map<number, NodePosition>();
  const radius = Math.min(190, 90 + concepts.length * 15);
  concepts.forEach((concept, index) => {
    const angle = -Math.PI / 2 + (index * 2 * Math.PI) / concepts.length;
    positions.set(concept.id, {
      x: MAP_WIDTH / 2 + Math.cos(angle) * radius,
      y: MAP_HEIGHT / 2 + Math.sin(angle) * radius,
    });
  });
  return positions;
}

const TopicMap: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [topic, setTopic] = useState<Topic | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedConcept, setSelectedConcept] = useState<Concept | null>(null);
  const [relationModalOpen, setRelationModalOpen] = useState(false);
  const [editingRelation, setEditingRelation] = useState<ConceptRelation | null>(
    null,
  );
  const [conceptModalOpen, setConceptModalOpen] = useState(false);
  const [draggedConceptId, setDraggedConceptId] = useState<number | null>(null);
  const [relationForm] = Form.useForm<RelationFormValues>();
  const [conceptForm] = Form.useForm<ConceptFormValues>();

  const loadTopic = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const response = await getTopic(Number(id));
      setTopic(response.data);
      setSelectedConcept((current) =>
        current
          ? response.data.concepts.find((concept) => concept.id === current.id) ??
            null
          : null,
      );
    } catch (error) {
      console.error('Failed to load topic map:', error);
      message.error('加载话题主图失败');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void loadTopic();
  }, [loadTopic]);

  const positions = useMemo(
    () => getNodePositions(topic?.concepts ?? []),
    [topic?.concepts],
  );

  const openEditRelation = (relation: ConceptRelation) => {
    setEditingRelation(relation);
    relationForm.setFieldsValue(relation);
    setRelationModalOpen(true);
  };

  const handleRelationSubmit = async (values: RelationFormValues) => {
    if (!topic) return;
    try {
      if (editingRelation) {
        await updateConceptRelation(editingRelation.id, {
          ...values,
          topic: topic.id,
        });
        message.success('概念关系已更新');
      } else {
        await createConceptRelation({
          topic: topic.id,
          ...values,
          description: values.description ?? '',
        });
        message.success('概念关系已创建');
      }
      setRelationModalOpen(false);
      relationForm.resetFields();
      await loadTopic();
    } catch (error) {
      console.error('Failed to save concept relation:', error);
      message.error('保存概念关系失败');
    }
  };

  const handleDeleteRelation = async (relationId: number) => {
    try {
      await deleteConceptRelation(relationId);
      message.success('概念关系已删除');
      await loadTopic();
    } catch (error) {
      console.error('Failed to delete concept relation:', error);
      message.error('删除概念关系失败');
    }
  };

  const handleDropOnConcept = (target: Concept) => {
    if (!draggedConceptId || draggedConceptId === target.id) return;
    const existingRelation = topic?.concept_relations.find(
      (relation) =>
        (relation.from_concept === draggedConceptId &&
          relation.to_concept === target.id) ||
        (relation.from_concept === target.id &&
          relation.to_concept === draggedConceptId),
    );
    if (existingRelation) {
      openEditRelation(existingRelation);
      setDraggedConceptId(null);
      return;
    }
    setEditingRelation(null);
    relationForm.setFieldsValue({
      from_concept: draggedConceptId,
      to_concept: target.id,
      relation_type: '关联',
      description: '',
    });
    setRelationModalOpen(true);
    setDraggedConceptId(null);
  };

  const handleDeleteConcept = async () => {
    if (!selectedConcept) return;
    try {
      await deleteConcept(selectedConcept.id);
      setSelectedConcept(null);
      message.success('概念及其关联关系已删除');
      await loadTopic();
    } catch (error) {
      console.error('Failed to delete concept:', error);
      message.error('删除概念失败');
    }
  };

  const openEditConcept = () => {
    if (!selectedConcept) return;
    conceptForm.setFieldsValue(selectedConcept);
    setConceptModalOpen(true);
  };

  const handleConceptSubmit = async (values: ConceptFormValues) => {
    if (!selectedConcept) return;
    try {
      await updateConcept(selectedConcept.id, values);
      message.success('概念卡片已更新');
      setConceptModalOpen(false);
      await loadTopic();
    } catch (error) {
      console.error('Failed to update concept:', error);
      message.error('更新概念卡片失败');
    }
  };

  const jumpToAnchor = (anchor: ConceptAnchor) => {
    if (!topic) {
      message.warning('该概念没有可用的材料来源。');
      return;
    }
    navigate(
      `/topics/${topic.id}/materials/${anchor.material}?anchor=${anchor.start_offset}`,
    );
  };

  if (loading && !topic) return <div style={{ padding: 24 }}>加载中...</div>;
  if (!topic) return <div style={{ padding: 24 }}>未找到主题</div>;

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: '24px' }}>
      <Space direction="vertical" size="large" style={{ display: 'flex' }}>
        <Button
          icon={<ArrowLeftOutlined />}
          onClick={() => navigate(`/topics/${topic.id}`)}
        >
          返回话题
        </Button>

        <Card
          title={
            <Space>
              <span>{topic.title} 的主思维导图</span>
              <Tag color="blue">{topic.concepts.length} 个概念</Tag>
              <Tag>{topic.concept_relations.length} 条关系</Tag>
            </Space>
          }
        >
          <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
            拖拽一个概念节点到另一个节点上，即可建立关联；重复拖拽会打开已有关系进行编辑。
          </Typography.Text>
          {topic.concepts.length ? (
            <div
              style={{
                position: 'relative',
                minHeight: 560,
                overflow: 'auto',
                background: '#fafcff',
                borderRadius: 8,
              }}
            >
              <svg
                aria-label="概念关系图"
                viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`}
                width={MAP_WIDTH}
                height={MAP_HEIGHT}
                style={{ display: 'block', minWidth: MAP_WIDTH }}
              >
                <defs>
                  <marker
                    id="concept-map-arrow"
                    viewBox="0 0 10 10"
                    refX="9"
                    refY="5"
                    markerWidth="6"
                    markerHeight="6"
                    orient="auto-start-reverse"
                  >
                    <path d="M 0 0 L 10 5 L 0 10 z" fill="#94a3b8" />
                  </marker>
                </defs>
                {topic.concept_relations.map((relation) => {
                  const from = positions.get(relation.from_concept);
                  const to = positions.get(relation.to_concept);
                  if (!from || !to) return null;
                  const labelX = (from.x + to.x) / 2;
                  const labelY = (from.y + to.y) / 2;
                  return (
                    <g key={relation.id}>
                      <line
                        x1={from.x}
                        y1={from.y}
                        x2={to.x}
                        y2={to.y}
                        stroke="#94a3b8"
                        strokeWidth="2"
                        markerEnd="url(#concept-map-arrow)"
                        style={{ cursor: 'pointer' }}
                        onClick={() => openEditRelation(relation)}
                      />
                      <text
                        x={labelX}
                        y={labelY - 6}
                        textAnchor="middle"
                        fill="#64748b"
                        fontSize="12"
                        style={{ cursor: 'pointer' }}
                        onClick={() => openEditRelation(relation)}
                      >
                        {relation.relation_type}
                      </text>
                    </g>
                  );
                })}
              </svg>
              {topic.concepts.map((concept) => {
                const position = positions.get(concept.id);
                if (!position) return null;
                return (
                  <Button
                    key={concept.id}
                    type={
                      selectedConcept?.id === concept.id ? 'primary' : 'default'
                    }
                    onClick={() => setSelectedConcept(concept)}
                    draggable
                    onDragStart={() => setDraggedConceptId(concept.id)}
                    onDragEnd={() => setDraggedConceptId(null)}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={() => handleDropOnConcept(concept)}
                    title="拖拽到另一个概念节点以建立关系"
                    style={{
                      position: 'absolute',
                      left: position.x,
                      top: position.y,
                      transform: 'translate(-50%, -50%)',
                      maxWidth: 180,
                      height: 'auto',
                      minHeight: 42,
                      whiteSpace: 'normal',
                      borderRadius: 20,
                    }}
                  >
                    {concept.title}
                  </Button>
                );
              })}
            </div>
          ) : (
            <Empty description="从阅读中标记概念后，主图会在这里逐步生长。" />
          )}
        </Card>

        <Card title="概念关系">
          <List
            dataSource={topic.concept_relations}
            locale={{ emptyText: '尚未建立概念关系' }}
            renderItem={(relation) => (
              <List.Item
                actions={[
                  <Button
                    key="edit"
                    type="link"
                    icon={<EditOutlined />}
                    onClick={() => openEditRelation(relation)}
                  >
                    编辑
                  </Button>,
                  <Popconfirm
                    key="delete"
                    title="删除这条概念关系？"
                    okText="删除"
                    cancelText="取消"
                    okButtonProps={{ danger: true }}
                    onConfirm={() => void handleDeleteRelation(relation.id)}
                  >
                    <Button type="link" danger icon={<DeleteOutlined />}>
                      删除
                    </Button>
                  </Popconfirm>,
                ]}
              >
                <List.Item.Meta
                  title={`${relation.from_concept_title} - ${relation.relation_type} -> ${relation.to_concept_title}`}
                  description={relation.description || '未补充关系说明'}
                />
              </List.Item>
            )}
          />
        </Card>
      </Space>

      <Drawer
        title="概念详情"
        placement="right"
        width={440}
        open={Boolean(selectedConcept)}
        onClose={() => setSelectedConcept(null)}
        extra={
          <Space size="small">
            <Button type="link" icon={<EditOutlined />} onClick={openEditConcept}>
              编辑
            </Button>
            <Popconfirm
              title="删除这个概念及其关联关系？"
              okText="删除"
              cancelText="取消"
              okButtonProps={{ danger: true }}
              onConfirm={() => void handleDeleteConcept()}
            >
              <Button type="link" danger icon={<DeleteOutlined />}>
                删除
              </Button>
            </Popconfirm>
          </Space>
        }
      >
        {selectedConcept && (
          <Space direction="vertical" size="middle" style={{ display: 'flex' }}>
            <Title level={3}>{selectedConcept.title}</Title>
            <Tag color={selectedConcept.status === 'confirmed' ? 'blue' : 'green'}>
              {selectedConcept.status_display}
            </Tag>
            <Descriptions column={1} size="small">
              <Descriptions.Item label="定义">
                {selectedConcept.definition || '尚未填写'}
              </Descriptions.Item>
              <Descriptions.Item label="原理">
                {selectedConcept.principle || '尚未填写'}
              </Descriptions.Item>
              <Descriptions.Item label="易错点">
                {selectedConcept.pitfalls || '尚未填写'}
              </Descriptions.Item>
              <Descriptions.Item label="适用场景">
                {selectedConcept.applications || '尚未填写'}
              </Descriptions.Item>
            </Descriptions>
            <Card size="small" title="材料来源">
              <List
                size="small"
                dataSource={selectedConcept.anchors}
                locale={{ emptyText: '来源不可用' }}
                renderItem={(anchor) => (
                  <List.Item
                    actions={[
                      <Button
                        key="source"
                        type="link"
                        onClick={() => jumpToAnchor(anchor)}
                      >
                        查看原文
                      </Button>,
                    ]}
                  >
                    <List.Item.Meta
                      title={anchor.material_title}
                      description={
                        <Paragraph ellipsis={{ rows: 2 }} style={{ margin: 0 }}>
                          {anchor.source_text}
                        </Paragraph>
                      }
                    />
                  </List.Item>
                )}
              />
            </Card>
          </Space>
        )}
      </Drawer>

      <Modal
        title={editingRelation ? '编辑概念关系' : '建立概念关系'}
        open={relationModalOpen}
        onCancel={() => {
          setRelationModalOpen(false);
          relationForm.resetFields();
        }}
        onOk={() => relationForm.submit()}
      >
        <Form
          form={relationForm}
          layout="vertical"
          onFinish={(values) => void handleRelationSubmit(values)}
        >
          <Form.Item
            name="from_concept"
            label="起始概念"
            rules={[{ required: true, message: '请选择起始概念' }]}
          >
            <Select
              options={topic.concepts.map((concept) => ({
                value: concept.id,
                label: concept.title,
              }))}
            />
          </Form.Item>
          <Form.Item
            name="to_concept"
            label="目标概念"
            rules={[{ required: true, message: '请选择目标概念' }]}
          >
            <Select
              options={topic.concepts.map((concept) => ({
                value: concept.id,
                label: concept.title,
              }))}
            />
          </Form.Item>
          <Form.Item
            name="relation_type"
            label="关系类型"
            rules={[{ required: true, message: '请输入关系类型' }]}
          >
            <Input placeholder="例如：依赖于、属于、用于" />
          </Form.Item>
          <Form.Item name="description" label="关系说明">
            <Input.TextArea rows={3} />
          </Form.Item>
          {editingRelation && (
            <Popconfirm
              title="删除这条概念关系？"
              okText="删除"
              cancelText="取消"
              okButtonProps={{ danger: true }}
              onConfirm={() => void handleDeleteRelation(editingRelation.id)}
            >
              <Button danger>
                删除关联
              </Button>
            </Popconfirm>
          )}
        </Form>
      </Modal>

      <Modal
        title="编辑概念卡片"
        open={conceptModalOpen}
        onCancel={() => {
          setConceptModalOpen(false);
          conceptForm.resetFields();
        }}
        onOk={() => conceptForm.submit()}
        width={680}
      >
        <Form
          form={conceptForm}
          layout="vertical"
          onFinish={(values) => void handleConceptSubmit(values)}
        >
          <Form.Item
            name="title"
            label="概念名称"
            rules={[{ required: true, message: '请输入概念名称' }]}
          >
            <Input />
          </Form.Item>
          <Form.Item name="definition" label="定义">
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item name="principle" label="原理">
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item name="pitfalls" label="易错点">
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item name="applications" label="适用场景">
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default TopicMap;
