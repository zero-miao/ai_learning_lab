import React, { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { Link } from 'react-router-dom';
import {
  Button,
  Card,
  Descriptions,
  Empty,
  Input,
  List,
  Modal,
  Pagination,
  Popconfirm,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import type { TableColumnsType } from 'antd';
import {
  CheckCircleFilled,
  CloseCircleFilled,
  DeleteOutlined,
  LinkOutlined,
  PlusOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import {
  deleteMaterial,
  getMaterial,
  getMaterials,
  getTopics,
  linkMaterialToTopic,
  reImportMaterial,
} from '../../api';
import type { Material, MaterialStatus, MaterialSummary, TopicSummary } from '../../api';
import { message } from 'antd';
import { useMediaQuery } from '../../useMediaQuery';
import JsonBlock from '../../components/JsonBlock';
import './styles.css';

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

const MaterialManagement: React.FC = () => {
  const [materials, setMaterials] = useState<MaterialSummary[]>([]);
  const [materialDetails, setMaterialDetails] = useState<Record<number, Material>>({});
  const [loadingDetailIds, setLoadingDetailIds] = useState<Set<number>>(new Set());
  const [keyword, setKeyword] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [status, setStatus] = useState<MaterialStatus | 'all'>('all');
  const [topicFilter, setTopicFilter] = useState<string>('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [topics, setTopics] = useState<TopicSummary[]>([]);
  const [linkingMaterial, setLinkingMaterial] = useState<MaterialSummary | null>(null);
  const [linkingTopicId, setLinkingTopicId] = useState<number | null>(null);
  const [linking, setLinking] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [expandedMobileId, setExpandedMobileId] = useState<number | null>(null);
  const isMobile = useMediaQuery('(max-width: 767px)');

  const loadMaterials = useCallback(async () => {
    setLoading(true);
    try {
      const response = await getMaterials({
        page,
        page_size: pageSize,
        ...(searchQuery ? { q: searchQuery } : {}),
        ...(status !== 'all' ? { status } : {}),
        ...(topicFilter !== 'all' ? { topic: topicFilter } : {}),
      });
      setMaterials(response.data.results);
      setTotal(response.data.count);
      setMaterialDetails({});
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, searchQuery, status, topicFilter]);

  const loadTopicOptions = useCallback(async (query = '') => {
    const response = await getTopics({
      page_size: 20,
      q: query || undefined,
    });
    setTopics(response.data.results);
  }, []);

  useEffect(() => { void loadMaterials(); }, [loadMaterials]);
  useEffect(() => { void loadTopicOptions(); }, [loadTopicOptions]);
  const handleReImport = async (id: number) => {
    try {
      await reImportMaterial(id);
      message.success('已触发重新导入任务');
      void loadMaterials();
    } catch (error) {
      console.error('Re-import failed:', error);
      const detail = axios.isAxiosError(error) ? error.response?.data?.detail : null;
      message.error(
        typeof detail === 'string' ? detail : '触发重新导入失败',
      );
    }
  };
  const handleDelete = async (material: MaterialSummary) => {
    setDeletingId(material.id);
    try {
      await deleteMaterial(material.id);
      message.success('材料及相关媒体文件已删除');
      if (materials.length === 1 && page > 1) setPage((current) => current - 1);
      else void loadMaterials();
    } catch (error) {
      console.error('Delete material failed:', error);
      message.error('删除材料失败');
    } finally {
      setDeletingId(null);
    }
  };
  const loadDetail = async (materialId: number) => {
    if (materialDetails[materialId] || loadingDetailIds.has(materialId)) return;
    setLoadingDetailIds((current) => new Set(current).add(materialId));
    try {
      const response = await getMaterial(materialId);
      setMaterialDetails((current) => ({ ...current, [materialId]: response.data }));
    } catch {
      message.error('加载材料详情失败');
    } finally {
      setLoadingDetailIds((current) => {
        const next = new Set(current);
        next.delete(materialId);
        return next;
      });
    }
  };
  const handleLinkTopic = async () => {
    if (!linkingMaterial || linkingTopicId === null) return;
    setLinking(true);
    try {
      await linkMaterialToTopic(linkingMaterial.id, linkingTopicId);
      message.success('已关联话题');
      setLinkingMaterial(null);
      setLinkingTopicId(null);
      await loadMaterials();
    } catch {
      message.error('关联话题失败');
    } finally {
      setLinking(false);
    }
  };

  const columns: TableColumnsType<MaterialSummary> = [
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
          <Button
            type="text"
            size="small"
            icon={<PlusOutlined />}
            aria-label={`为 ${material.title} 增加关联话题`}
            onClick={(event) => {
              event.stopPropagation();
              setLinkingMaterial(material);
            }}
          />
        </div>
      )
    },
    {
      title: '处理进度',
      key: 'progress',
      width: 150,
      render: (_, material) => {
        const items = [
          { label: '原', value: material.raw_text_length > 0, tooltip: '原文' },
          { label: '清', value: material.clean_text_length > 0, tooltip: '清洗文本' },
          { label: '摘', value: material.digest_length > 0, tooltip: '摘要' },
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
    {
      title: '朗读音频',
      key: 'tts',
      width: 170,
      render: (_, material) =>
        material.tts_assets.length ? (
          <Space wrap size={[4, 4]}>
            {material.tts_assets.map((asset) => (
              <Tooltip
                key={asset.voice}
                title={
                  asset.status === 'ready'
                    ? `${asset.label}: 已就绪`
                    : `${asset.label}: ${asset.error || '生成失败'}`
                }
              >
                <Tag
                  color={asset.status === 'ready' ? 'success' : 'error'}
                  icon={
                    asset.status === 'ready'
                      ? <CheckCircleFilled />
                      : <CloseCircleFilled />
                  }
                  style={{ margin: 0 }}
                >
                  {asset.label}
                </Tag>
              </Tooltip>
            ))}
          </Space>
        ) : (
          <Text type="secondary" style={{ fontSize: 12 }}>未生成</Text>
        ),
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
      width: 130,
      fixed: 'right',
      render: (_, material) => (
        <Space size={0} onClick={(event) => event.stopPropagation()}>
          <Tooltip title="重新导入">
            <Button
              type="text"
              size="small"
              icon={<ReloadOutlined />}
              onClick={() => void handleReImport(material.id)}
              loading={material.status === 'pending'}
            />
          </Tooltip>
          <Popconfirm
            title={`删除“${material.title}”？`}
            description="将删除全局材料、主题关联、标注定位及 backend/media 中的相关文件，且无法恢复。"
            okText="删除"
            okButtonProps={{ danger: true, loading: deletingId === material.id }}
            cancelText="取消"
            onConfirm={() => void handleDelete(material)}
          >
            <Button
              danger
              type="text"
              size="small"
              title="删除材料"
              icon={<DeleteOutlined />}
              aria-label={`删除材料 ${material.title}`}
            />
          </Popconfirm>
        </Space>
      )
    },
  ];

  const renderMobileMaterial = (material: MaterialSummary) => {
    const detail = materialDetails[material.id];
    const expanded = expandedMobileId === material.id;
    return (
      <List.Item className="material-management__mobile-item">
        <Card
          size="small"
          className="material-management__mobile-card"
          title={<Text strong>{material.title}</Text>}
          extra={
            <Tag color={statusColor[material.status]} style={{ margin: 0 }}>
              {material.status_display || material.status}
            </Tag>
          }
        >
          <Space orientation="vertical" size={12} style={{ display: 'flex' }}>
            <Space wrap size={[6, 6]}>
              <Tag>{material.media_type}</Tag>
              <Tag color={material.created_by === 'ai_recommended' ? 'purple' : 'default'}>
                {material.created_by === 'ai_recommended' ? 'AI 推荐' : '人工添加'}
              </Tag>
              <Text type="secondary">{formatDate(material.updated_at)}</Text>
            </Space>

            <div className="material-management__mobile-section">
              <Text type="secondary">关联话题</Text>
              <div className="material-management__mobile-tags">
                {material.topic_links.map((link) => (
                  <Link key={link.topic} to={`/topics/${link.topic}`}>
                    <Tag color="blue" icon={<LinkOutlined />}>{link.topic_title}</Tag>
                  </Link>
                ))}
                {!material.topic_links.length && <Text type="secondary">无关联</Text>}
                <Button
                  type="text"
                  size="small"
                  icon={<PlusOutlined />}
                  onClick={() => setLinkingMaterial(material)}
                >
                  关联
                </Button>
              </div>
            </div>

            <Space wrap size={[8, 8]}>
              <Text type="secondary">
                原文 {material.raw_text_length ? '已就绪' : '未生成'}
              </Text>
              <Text type="secondary">
                清洗 {material.clean_text_length ? '已就绪' : '未生成'}
              </Text>
              <Text type="secondary">
                摘要 {material.digest_length ? '已就绪' : '未生成'}
              </Text>
              <Text type="secondary">片段 {material.chunk_count}</Text>
            </Space>

            {material.tts_assets.length > 0 && (
              <Space wrap size={[4, 4]}>
                <Text type="secondary">朗读：</Text>
                {material.tts_assets.map((asset) => (
                  <Tag
                    key={asset.voice}
                    color={asset.status === 'ready' ? 'success' : 'error'}
                  >
                    {asset.label}
                  </Tag>
                ))}
              </Space>
            )}

            {expanded && (
              <div className="material-management__mobile-detail">
                {loadingDetailIds.has(material.id) || !detail ? (
                  <Spin size="small" />
                ) : (
                  <>
                    <Text strong>材料摘要</Text>
                    <Paragraph ellipsis={{ rows: 6, expandable: true, symbol: '展开' }}>
                      {detail.digest || '无摘要'}
                    </Paragraph>
                    {detail.error && <Text type="danger">{detail.error}</Text>}
                  </>
                )}
              </div>
            )}

            <div className="material-management__mobile-actions">
              <Button
                onClick={() => {
                  const next = expanded ? null : material.id;
                  setExpandedMobileId(next);
                  if (next) void loadDetail(next);
                }}
              >
                {expanded ? '收起详情' : '查看详情'}
              </Button>
              <Button
                icon={<ReloadOutlined />}
                loading={material.status === 'pending'}
                onClick={() => void handleReImport(material.id)}
              >
                重新导入
              </Button>
              <Popconfirm
                title={`删除“${material.title}”？`}
                description="将删除全局材料及相关文件，且无法恢复。"
                okText="删除"
                okButtonProps={{ danger: true, loading: deletingId === material.id }}
                onConfirm={() => void handleDelete(material)}
              >
                <Button danger icon={<DeleteOutlined />}>删除</Button>
              </Popconfirm>
            </div>
          </Space>
        </Card>
      </List.Item>
    );
  };

  return (
    <div className="material-management" style={{ maxWidth: 1480, margin: '0 auto', padding: 24 }}>
      <Card title={`全局材料管理 (${total})`} extra={<Button onClick={() => void loadMaterials()} loading={loading}>刷新</Button>}>
        <Space className="material-management__filters" style={{ marginBottom: 16 }} wrap>
          <Input.Search
            style={{ width: 320 }}
            placeholder="搜索标题、媒体引用或摘要"
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
              const query = value.trim();
              setSearchQuery(query);
              setPage(1);
            }}
            allowClear
          />
          <Select
            value={status}
            onChange={(value) => {
              setStatus(value);
              setPage(1);
            }}
            style={{ width: 150 }}
            options={[
            { value: 'all', label: '全部状态' },
            { value: 'pending', label: '待处理' },
            { value: 'importing', label: '导入中' },
            { value: 'cleaning', label: '清洗中' },
            { value: 'summarizing', label: '摘要中' },
            { value: 'ready', label: '已就绪' },
            { value: 'failed', label: '失败' },
            ]}
          />
          <Select
            showSearch
            filterOption={false}
            onSearch={(value) => void loadTopicOptions(value.trim())}
            value={topicFilter}
            onChange={(value) => {
              setTopicFilter(value);
              setPage(1);
            }}
            style={{ width: 220 }}
            options={[
              { value: 'all', label: '全部关联状态' },
              { value: 'unlinked', label: '未关联任何话题' },
              ...topics.map((topic) => ({
                value: String(topic.id),
                label: topic.title,
              })),
            ]}
          />
        </Space>
        
        {isMobile ? (
          <>
            <List
              className="material-management__mobile-list"
              loading={loading}
              dataSource={materials}
              renderItem={renderMobileMaterial}
              locale={{ emptyText: <Empty description="没有符合条件的全局材料" /> }}
            />
            <Pagination
              current={page}
              pageSize={pageSize}
              total={total}
              showSizeChanger={false}
              onChange={setPage}
            />
          </>
        ) : (
        <Table
          rowKey="id"
          columns={columns}
          dataSource={materials}
          loading={loading}
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
          locale={{ emptyText: <Empty description="没有符合条件的全局材料" /> }}
          expandable={{
            onExpand: (expanded, material) => {
              if (expanded) void loadDetail(material.id);
            },
            expandedRowRender: (summary) => {
              const material = materialDetails[summary.id];
              if (!material) {
                return <Spin size="small" tip="正在加载材料详情" />;
              }
              return (
              <div style={{ padding: '8px 24px' }}>
                <Descriptions column={{ xs: 1, sm: 2, lg: 3 }} size="small" bordered>
                  <Descriptions.Item label="媒体引用" span={2}>
                    {material.media_type === 'web_page' && material.media_uri ? <a href={material.media_uri} target="_blank" rel="noreferrer">{material.media_uri}</a> : material.media_uri || '无'}
                  </Descriptions.Item>
                  <Descriptions.Item label="媒体地址">{material.media_url || '无'}</Descriptions.Item>
                  <Descriptions.Item label="片段数">{material.chunks.length}</Descriptions.Item>
                  <Descriptions.Item label="朗读音频">
                    {material.tts_assets.length ? (
                      <Space wrap>
                        {material.tts_assets.map((asset) => (
                          <Tag
                            key={asset.voice}
                            color={asset.status === 'ready' ? 'success' : 'error'}
                          >
                            {asset.label} · {asset.status === 'ready' ? '已就绪' : '失败'}
                          </Tag>
                        ))}
                      </Space>
                    ) : '未生成'}
                  </Descriptions.Item>
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
              );
            },
          }}
        />
        )}
      </Card>
      <Modal
        title={`为“${linkingMaterial?.title ?? ''}”关联话题`}
        open={Boolean(linkingMaterial)}
        onCancel={() => {
          setLinkingMaterial(null);
          setLinkingTopicId(null);
        }}
        onOk={() => void handleLinkTopic()}
        confirmLoading={linking}
        okButtonProps={{ disabled: linkingTopicId === null }}
        okText="关联"
      >
        <Select
          showSearch
          filterOption={false}
          onSearch={(value) => void loadTopicOptions(value.trim())}
          style={{ width: '100%' }}
          placeholder="选择要关联的话题"
          value={linkingTopicId}
          onChange={setLinkingTopicId}
          options={topics
            .filter(
              (topic) =>
                !linkingMaterial?.topic_links.some((link) => link.topic === topic.id),
            )
            .map((topic) => ({ value: topic.id, label: topic.title }))}
        />
      </Modal>
    </div>
  );
};

export default MaterialManagement;
