import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Button,
  Card,
  Descriptions,
  Empty,
  Input,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import type { TableColumnsType } from 'antd';
import { CheckCircleFilled, CloseCircleFilled, LinkOutlined, ReloadOutlined } from '@ant-design/icons';
import { getMaterials, reImportMaterial } from '../../api';
import type { Material, MaterialStatus } from '../../api';
import { message } from 'antd';

const { Paragraph, Text } = Typography;

const statusColor: Record<MaterialStatus, string> = {
  pending: 'default',
  importing: 'processing',
  cleaning: 'processing',
  summarizing: 'processing',
  generating_audio: 'processing',
  ready: 'success',
  failed: 'error',
};

function formatDate(value: string) {
  return new Date(value).toLocaleString();
}

function JsonBlock({ value }: { value: Record<string, unknown> }) {
  if (!Object.keys(value).length) return <Text type="secondary">无</Text>;
  return (
    <pre style={{
      margin: 0,
      maxHeight: 400,
      overflow: 'auto',
      whiteSpace: 'pre-wrap',
      overflowWrap: 'anywhere',
      padding: '12px',
      borderRadius: '4px',
      backgroundColor: 'rgba(0, 0, 0, 0.02)',
      border: '1px solid rgba(0, 0, 0, 0.06)',
      fontSize: '13px',
      lineHeight: 1.6
    }}>
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

const MaterialManagement: React.FC = () => {
  const [materials, setMaterials] = useState<Material[]>([]);
  const [keyword, setKeyword] = useState('');
  const [status, setStatus] = useState<MaterialStatus | 'all'>('all');

  const load = async () => setMaterials((await getMaterials()).data);
  useEffect(() => { void load(); }, []);
  const handleReImport = async (id: number) => {
    try {
      await reImportMaterial(id);
      message.success('已触发重新导入任务');
      void load();
    } catch (error) {
      console.error('Re-import failed:', error);
      message.error('触发重新导入失败');
    }
  };

  const visible = useMemo(
    () => materials.filter((item) =>
      (status === 'all' || item.status === status) &&
      (!keyword || [item.title, item.media_uri, item.digest].join(' ').toLowerCase().includes(keyword.toLowerCase())),
    ),
    [keyword, materials, status],
  );

  const columns: TableColumnsType<Material> = [
    { title: 'ID', dataIndex: 'id', width: 70, responsive: ['md'] },
    {
      title: '材料信息',
      key: 'info',
      render: (_, material) => (
        <Space direction="vertical" size={0}>
          <Text strong>{material.title}</Text>
          <div style={{ fontSize: '12px' }}>
            {material.media_type === 'web_page' && material.media_uri ? (
              <a href={material.media_uri} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                <LinkOutlined style={{ marginRight: 4 }} />
                原始链接
              </a>
            ) : (
              <Text type="secondary" ellipsis={{ tooltip: material.media_uri }}>
                {material.media_uri || '-'}
              </Text>
            )}
          </div>
        </Space>
      )
    },
    {
      title: '关联主题',
      key: 'topics',
      width: 200,
      render: (_, material) => (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
          {material.topic_links.length > 0 ? (
            material.topic_links.map((link) => (
              <Link key={link.topic} to={`/topics/${link.topic}`} onClick={(e) => e.stopPropagation()}>
                <Tag color="blue" style={{ margin: 0, cursor: 'pointer' }} icon={<LinkOutlined />}>
                  {link.topic_title}
                </Tag>
              </Link>
            ))
          ) : (
            <Text type="secondary" style={{ fontSize: '12px' }}>无关联</Text>
          )}
        </div>
      )
    },
    {
      title: '处理进度',
      key: 'progress',
      width: 150,
      render: (_, material) => {
        const items = [
          { label: '原', value: !!material.raw_text, tooltip: '原文' },
          { label: '清', value: !!material.clean_text, tooltip: '清洗文本' },
          { label: '摘', value: !!material.digest, tooltip: '摘要' },
        ];
        return (
          <Space size={8}>
            {items.map((item) => (
              <Tooltip key={item.label} title={`${item.tooltip}: ${item.value ? '已就绪' : '未生成'}`}>
                <Space size={2}>
                  <Text type="secondary" style={{ fontSize: '12px' }}>{item.label}</Text>
                  {item.value ? (
                    <CheckCircleFilled style={{ color: '#52c41a', fontSize: '12px' }} />
                  ) : (
                    <CloseCircleFilled style={{ color: '#ff4d4f', fontSize: '12px' }} />
                  )}
                </Space>
              </Tooltip>
            ))}
          </Space>
        );
      }
    },
    { title: '类型', dataIndex: 'media_type', width: 90, render: (type) => <Tag>{type}</Tag> },
    {
      title: '状态',
      key: 'status',
      width: 100,
      render: (_, material) => {
        const tag = <Tag color={statusColor[material.status]} style={{ margin: 0 }}>{material.status_display || material.status}</Tag>;
        if (material.status === 'failed' && material.error) {
          return (
            <Tooltip title={material.error}>
              <span style={{ cursor: 'help' }}>{tag}</span>
            </Tooltip>
          );
        }
        return tag;
      }
    },
    { title: '来源', dataIndex: 'created_by', width: 90, render: (c) => <Tag color={c === 'ai_recommended' ? 'purple' : 'default'}>{c === 'ai_recommended' ? 'AI' : '人工'}</Tag> },
    { title: '更新时间', dataIndex: 'updated_at', width: 160, render: (v) => formatDate(v) },
    { 
      title: '操作', 
      key: 'actions', 
      width: 80, 
      fixed: 'right',
      render: (_, material) => (
        <Button 
          type="link" 
          size="small" 
          icon={<ReloadOutlined />} 
          onClick={(e) => { e.stopPropagation(); handleReImport(material.id); }}
          loading={material.status === 'pending'}
        >
          重导
        </Button>
      )
    },
  ];

  return (
    <div style={{ maxWidth: 1480, margin: '0 auto', padding: 24 }}>
      <Card title={`全局材料管理 (${visible.length})`} extra={<Button onClick={() => void load()}>刷新</Button>}>
        <Space style={{ marginBottom: 16 }} wrap>
          <Input.Search style={{ width: 320 }} placeholder="搜索标题、媒体引用或摘要" value={keyword} onChange={(event) => setKeyword(event.target.value)} allowClear />
          <Select value={status} onChange={setStatus} style={{ width: 150 }} options={[
            { value: 'all', label: '全部状态' },
            { value: 'pending', label: '待处理' },
            { value: 'importing', label: '导入中' },
            { value: 'cleaning', label: '清洗中' },
            { value: 'summarizing', label: '摘要中' },
            { value: 'ready', label: '已就绪' },
            { value: 'failed', label: '失败' },
          ]} />
        </Space>
        
        <Table
          rowKey="id"
          columns={columns}
          dataSource={visible}
          pagination={{ pageSize: 20, showSizeChanger: true }}
          locale={{ emptyText: <Empty description="没有符合条件的全局材料" /> }}
          expandable={{
            expandedRowRender: (material) => (
              <div style={{ padding: '8px 24px' }}>
                <Descriptions column={{ xs: 1, sm: 2, lg: 3 }} size="small" bordered>
                  <Descriptions.Item label="媒体引用" span={2}>
                    {material.media_type === 'web_page' && material.media_uri ? <a href={material.media_uri} target="_blank" rel="noreferrer">{material.media_uri}</a> : material.media_uri || '无'}
                  </Descriptions.Item>
                  <Descriptions.Item label="媒体地址">{material.media_url || '无'}</Descriptions.Item>
                  <Descriptions.Item label="片段数">{material.chunks.length}</Descriptions.Item>
                  <Descriptions.Item label="原始字符数">{material.raw_text.length}</Descriptions.Item>
                  <Descriptions.Item label="清洗后字符数">{material.clean_text.length}</Descriptions.Item>
                  <Descriptions.Item label="关联主题" span={3}>
                    {material.topic_links.length ? (
                      <Space wrap>
                        {material.topic_links.map((link) => (
                          <Link key={link.topic} to={`/topics/${link.topic}`}>
                            <Tag icon={<LinkOutlined />} color="blue">
                              {link.topic_title} · {link.category === 'exam_material' ? '考试材料' : '推荐阅读'}
                              {link.relevance_score === null ? '' : ` · ${Math.round(link.relevance_score * 100)}%`}
                            </Tag>
                          </Link>
                        ))}
                      </Space>
                    ) : '当前未关联任何主题'}
                  </Descriptions.Item>
                  <Descriptions.Item label="材料摘要" span={3}>
                    {material.digest || '无'}
                  </Descriptions.Item>
                  <Descriptions.Item label="处理错误" span={3}>
                    {material.error ? <Text type="danger">{material.error}</Text> : '无'}
                  </Descriptions.Item>
                  <Descriptions.Item label="媒体元信息" span={3}>
                    <JsonBlock value={material.media_meta} />
                  </Descriptions.Item>
                  <Descriptions.Item label="清洗后的正文" span={3}>
                    <Paragraph style={{ whiteSpace: 'pre-wrap', margin: 0, maxHeight: 400, overflow: 'auto' }}>
                      {material.clean_text || material.raw_text || '无正文内容'}
                    </Paragraph>
                  </Descriptions.Item>
                </Descriptions>
              </div>
            ),
          }}
        />
      </Card>
    </div>
  );
};

export default MaterialManagement;
