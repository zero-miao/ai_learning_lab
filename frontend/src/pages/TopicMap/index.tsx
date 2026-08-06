import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button, Card, Drawer, Empty, Form, Input, List, Modal, Popconfirm, Select, Space, Tag, Typography, message } from 'antd';
import { ArrowLeftOutlined, DeleteOutlined, EditOutlined } from '@ant-design/icons';
import { createConceptRelation, deleteConcept, deleteConceptRelation, getTopic, updateConcept, updateConceptRelation } from '../../api';
import type { Concept, ConceptRelation, Topic } from '../../api';

const MAP_WIDTH = 960;
const MAP_HEIGHT = 560;

function positions(concepts: Concept[]) {
  return new Map(concepts.map((concept, index) => {
    const angle = -Math.PI / 2 + (index * 2 * Math.PI) / Math.max(concepts.length, 1);
    const radius = Math.min(190, 90 + concepts.length * 15);
    return [concept.id, { x: MAP_WIDTH / 2 + Math.cos(angle) * radius, y: MAP_HEIGHT / 2 + Math.sin(angle) * radius }];
  }));
}

const TopicMap: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [topic, setTopic] = useState<Topic | null>(null);
  const [selected, setSelected] = useState<Concept | null>(null);
  const [dragged, setDragged] = useState<number | null>(null);
  const [relation, setRelation] = useState<ConceptRelation | null>(null);
  const [relationOpen, setRelationOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [relationForm] = Form.useForm<Pick<ConceptRelation, 'from_concept' | 'to_concept' | 'relation_type' | 'description'>>();
  const [conceptForm] = Form.useForm<Partial<Concept>>();
  const load = useCallback(async () => {
    if (!id) return;
    const response = await getTopic(Number(id));
    setTopic(response.data);
    setSelected((current) => current ? response.data.concepts.find((item) => item.id === current.id) ?? null : null);
  }, [id]);
  useEffect(() => { void load().catch(() => message.error('加载概念图失败')); }, [load]);
  const nodePositions = useMemo(() => positions(topic?.concepts ?? []), [topic?.concepts]);
  const openRelation = (current: ConceptRelation | null, from?: number, to?: number) => {
    setRelation(current);
    relationForm.setFieldsValue(current ?? { from_concept: from, to_concept: to, relation_type: '关联', description: '' });
    setRelationOpen(true);
  };
  const saveRelation = async (values: Pick<ConceptRelation, 'from_concept' | 'to_concept' | 'relation_type' | 'description'>) => {
    if (relation) await updateConceptRelation(relation.id, values);
    else await createConceptRelation(values);
    setRelationOpen(false);
    await load();
  };
  const drop = (target: Concept) => {
    if (!dragged || dragged === target.id || !topic) return;
    const existing = topic.concept_relations.find((item) => item.from_concept === dragged && item.to_concept === target.id);
    openRelation(existing ?? null, dragged, target.id);
    setDragged(null);
  };
  if (!topic) return <div style={{ padding: 24 }}>加载中...</div>;
  return <div style={{ maxWidth: 1200, margin: '0 auto', padding: 24 }}>
    <Space direction="vertical" size="large" style={{ display: 'flex' }}>
      <Button icon={<ArrowLeftOutlined />} onClick={() => navigate(`/topics/${topic.id}`)}>返回主题</Button>
      <Card title={<Space><span>{topic.title} 的思维导图</span><Tag>{topic.concepts.length} 个概念</Tag><Tag>{topic.concept_relations.length} 条关系</Tag></Space>}>
        <Typography.Text type="secondary">拖拽一个概念节点到另一个节点上即可建立或编辑关系。</Typography.Text>
        {topic.concepts.length ? <div style={{ position: 'relative', height: MAP_HEIGHT, overflow: 'auto', marginTop: 16, background: '#fafcff', borderRadius: 8 }}>
          <svg viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`} width={MAP_WIDTH} height={MAP_HEIGHT}>
            <defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" fill="#94a3b8" /></marker></defs>
            {topic.concept_relations.map((item) => {
              const from = nodePositions.get(item.from_concept); const to = nodePositions.get(item.to_concept);
              return from && to ? <g key={item.id} onClick={() => openRelation(item)} style={{ cursor: 'pointer' }}><line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke="#94a3b8" strokeWidth="2" markerEnd="url(#arrow)" /><text x={(from.x + to.x) / 2} y={(from.y + to.y) / 2 - 6} textAnchor="middle" fill="#475569">{item.relation_type}</text></g> : null;
            })}
          </svg>
          {topic.concepts.map((concept) => {
            const point = nodePositions.get(concept.id)!;
            return <Button key={concept.id} draggable onDragStart={() => setDragged(concept.id)} onDragEnd={() => setDragged(null)} onDragOver={(event) => event.preventDefault()} onDrop={() => drop(concept)} type={selected?.id === concept.id ? 'primary' : 'default'} onClick={() => setSelected(concept)} style={{ position: 'absolute', left: point.x, top: point.y, transform: 'translate(-50%, -50%)', minHeight: 42, maxWidth: 180, whiteSpace: 'normal', borderRadius: 22 }}>{concept.title}</Button>;
          })}
        </div> : <Empty description="从阅读页标记概念后，思维导图会在这里生长。" />}
      </Card>
    </Space>
    <Drawer title="概念详情" open={Boolean(selected)} onClose={() => setSelected(null)} width={440} extra={selected && <Space><Button icon={<EditOutlined />} onClick={() => { conceptForm.setFieldsValue(selected); setEditOpen(true); }}>编辑</Button><Popconfirm title="删除概念？" onConfirm={() => void deleteConcept(selected.id).then(load)}><Button danger icon={<DeleteOutlined />} /></Popconfirm></Space>}>
      {selected && <Space direction="vertical" style={{ display: 'flex' }}><Typography.Title level={3}>{selected.title}</Typography.Title><Typography.Paragraph>{selected.definition || '待生成定义'}</Typography.Paragraph><List header="材料来源" dataSource={selected.locators} renderItem={(locator) => <List.Item actions={[<Button key="source" type="link" onClick={() => navigate(`/topics/${topic.id}/materials/${locator.material}?locator=${locator.id}`)}>查看原文</Button>]}>{locator.source_text}</List.Item>} /></Space>}
    </Drawer>
    <Modal title={relation ? '编辑概念关系' : '建立概念关系'} open={relationOpen} onCancel={() => setRelationOpen(false)} onOk={() => relationForm.submit()}>
      <Form form={relationForm} layout="vertical" onFinish={(values) => void saveRelation(values)}>
        <Form.Item name="from_concept" label="起始概念" rules={[{ required: true }]}><Select options={topic.concepts.map((item) => ({ value: item.id, label: item.title }))} /></Form.Item>
        <Form.Item name="to_concept" label="目标概念" rules={[{ required: true }]}><Select options={topic.concepts.map((item) => ({ value: item.id, label: item.title }))} /></Form.Item>
        <Form.Item name="relation_type" label="关系类型" rules={[{ required: true }]}><Input /></Form.Item>
        <Form.Item name="description" label="说明"><Input.TextArea rows={3} /></Form.Item>
      </Form>
      {relation && (
        <div style={{ textAlign: 'right', marginTop: 16 }}>
          <Popconfirm title="删除这条关系？" onConfirm={async () => { await deleteConceptRelation(relation.id); setRelationOpen(false); await load(); }}>
            <Button danger type="link" icon={<DeleteOutlined />}>删除此关系</Button>
          </Popconfirm>
        </div>
      )}
    </Modal>
    <Modal title="编辑概念" open={editOpen} onCancel={() => setEditOpen(false)} onOk={() => conceptForm.submit()}><Form form={conceptForm} layout="vertical" onFinish={async (values) => { if (selected) await updateConcept(selected.id, values); setEditOpen(false); await load(); }}><Form.Item name="title" label="名称"><Input /></Form.Item><Form.Item name="definition" label="定义"><Input.TextArea rows={3} /></Form.Item><Form.Item name="principle" label="原理"><Input.TextArea rows={3} /></Form.Item><Form.Item name="pitfalls" label="易错点"><Input.TextArea rows={3} /></Form.Item><Form.Item name="applications" label="应用"><Input.TextArea rows={3} /></Form.Item></Form></Modal>
  </div>;
};

export default TopicMap;
