import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Empty,
  Input,
  List,
  Modal,
  Select,
  Space,
  Spin,
  Tag,
  Typography,
  message,
} from 'antd';
import {
  ArrowLeftOutlined,
  DeleteOutlined,
  EditOutlined,
  ImportOutlined,
  InboxOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import MarkdownContent from '../../components/MarkdownContent';
import {
  createDraftFromBrowserCapture,
  deleteBrowserCapture,
  getBrowserCapture,
  getBrowserCaptures,
  getTopics,
  importBrowserCapture,
  updateBrowserCapture,
  type CapturedDocument,
  type CapturedDocumentSummary,
  type TopicSummary,
} from '../../api';
import './styles.css';

const { Text, Title } = Typography;

const statusLabels: Record<CapturedDocument['status'], string> = {
  receiving: '接收中',
  ready: '待整理',
  imported: '已导入',
  failed: '失败',
};

export default function BrowserCaptures() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [captures, setCaptures] = useState<CapturedDocumentSummary[]>([]);
  const [captureCount, setCaptureCount] = useState(0);
  const [page, setPage] = useState(1);
  const [active, setActive] = useState<CapturedDocument | null>(null);
  const [topics, setTopics] = useState<TopicSummary[]>([]);
  const [topicId, setTopicId] = useState<number | undefined>(
    Number(searchParams.get('topic')) || undefined,
  );
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState<'import' | 'draft' | 'delete' | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleValue, setTitleValue] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [captureResponse, topicResponse] = await Promise.all([
        getBrowserCaptures({ page, page_size: 20 }),
        getTopics({ page_size: 100 }),
      ]);
      setCaptures(captureResponse.data.results);
      setCaptureCount(captureResponse.data.count);
      setTopics(topicResponse.data.results);
      if (id) {
        const detail = await getBrowserCapture(Number(id));
        setActive(detail.data);
        setTitleValue(detail.data.title);
      } else {
        setActive(null);
      }
    } catch {
      message.error('采集收件箱加载失败');
    } finally {
      setLoading(false);
    }
  }, [id, page]);

  useEffect(() => {
    void load();
  }, [load]);

  const outline = useMemo(
    () =>
      (active?.snapshot_json.blocks || [])
        .filter((block) => block.type === 'heading')
        .map((block) => String(block.text || '未命名标题')),
    [active],
  );

  const saveTitle = async () => {
    if (!active || !titleValue.trim()) return;
    try {
      const response = await updateBrowserCapture(active.id, { title: titleValue.trim() });
      setActive(response.data);
      setCaptures((items) => items.map((item) => item.id === active.id ? response.data : item));
      setEditingTitle(false);
    } catch {
      message.error('标题保存失败');
    }
  };

  const importCapture = async (asDraft: boolean) => {
    if (!active || !topicId) {
      message.warning('请先选择学习话题');
      return;
    }
    setAction(asDraft ? 'draft' : 'import');
    try {
      if (asDraft) {
        await createDraftFromBrowserCapture(active.id, topicId);
        message.success('已创建 Markdown 草稿');
        navigate(`/topics/${topicId}`);
      } else {
        const response = await importBrowserCapture(active.id, topicId);
        message.success('材料已导入，正在生成摘要');
        navigate(`/topics/${topicId}/materials/${response.data.material}`);
      }
    } catch {
      message.error(asDraft ? '创建草稿失败' : '导入材料失败');
    } finally {
      setAction(null);
    }
  };

  const removeCapture = async () => {
    if (!active) return;
    setAction('delete');
    try {
      await deleteBrowserCapture(active.id);
      message.success('已从收件箱删除');
      navigate('/captures');
    } catch {
      message.error('该采集记录已关联草稿或材料，不能删除');
    } finally {
      setAction(null);
    }
  };

  return (
    <div className="browser-captures">
      <header className="browser-captures__header">
        <div>
          <Title level={2}><InboxOutlined /> 采集收件箱</Title>
          <Text type="secondary">整理浏览器扩展采集的页面</Text>
        </div>
        <Button icon={<ReloadOutlined />} onClick={() => void load()} aria-label="刷新采集收件箱" />
      </header>
      <div className="browser-captures__workspace">
        <aside className={`browser-captures__list ${active ? 'browser-captures__list--has-active' : ''}`}>
          {loading && !captures.length ? (
            <Spin />
          ) : (
            <List
              dataSource={captures}
              locale={{ emptyText: '还没有浏览器采集内容' }}
              pagination={captureCount > 20 ? {
                current: page,
                pageSize: 20,
                total: captureCount,
                showSizeChanger: false,
                onChange: setPage,
              } : false}
              renderItem={(capture) => (
                <List.Item
                  className={capture.id === active?.id ? 'is-active' : ''}
                  onClick={() => navigate(`/captures/${capture.id}`)}
                >
                  <List.Item.Meta
                    title={capture.title}
                    description={
                      <>
                        <span>{capture.site_name || '未知站点'}</span>
                        <span>{new Date(capture.created_at).toLocaleString()}</span>
                        <span>{capture.block_count} 块 · {capture.asset_count} 图</span>
                      </>
                    }
                  />
                  <Tag>{statusLabels[capture.status]}</Tag>
                </List.Item>
              )}
            />
          )}
        </aside>
        <main className="browser-captures__preview">
          {!active ? (
            <Empty description="选择一条采集记录查看预览" />
          ) : (
            <>
              <Button
                className="browser-captures__back"
                type="text"
                icon={<ArrowLeftOutlined />}
                onClick={() => navigate('/captures')}
                aria-label="返回采集收件箱"
              />
              <div className="browser-captures__actions">
                <div className="browser-captures__title">
                  {editingTitle ? (
                    <Input
                      value={titleValue}
                      autoFocus
                      onChange={(event) => setTitleValue(event.target.value)}
                      onPressEnter={() => void saveTitle()}
                      onBlur={() => void saveTitle()}
                    />
                  ) : (
                    <Title level={3}>
                      {active.title}
                      {active.status === 'ready' && (
                        <Button
                          type="text"
                          icon={<EditOutlined />}
                          onClick={() => setEditingTitle(true)}
                          aria-label="修改采集标题"
                        />
                      )}
                    </Title>
                  )}
                  {active.source_url && (
                    <a href={active.source_url} target="_blank" rel="noreferrer">
                      {active.site_name || active.source_url}
                    </a>
                  )}
                </div>
                {active.status === 'ready' && (
                  <Space wrap>
                    <Select
                      value={topicId}
                      placeholder="选择学习话题"
                      showSearch
                      optionFilterProp="label"
                      options={topics.map((topic) => ({ value: topic.id, label: topic.title }))}
                      onChange={setTopicId}
                    />
                    <Button
                      icon={<EditOutlined />}
                      loading={action === 'draft'}
                      onClick={() => void importCapture(true)}
                    >
                      保存为草稿
                    </Button>
                    <Button
                      type="primary"
                      icon={<ImportOutlined />}
                      loading={action === 'import'}
                      onClick={() => void importCapture(false)}
                    >
                      直接导入
                    </Button>
                    <Button
                      danger
                      icon={<DeleteOutlined />}
                      onClick={() => Modal.confirm({
                        title: '删除这条采集记录？',
                        content: '尚未导入的正文和图片将一并删除。',
                        okButtonProps: { danger: true },
                        onOk: removeCapture,
                      })}
                      aria-label="删除采集记录"
                    />
                  </Space>
                )}
              </div>
              {active.warnings.length > 0 && (
                <Alert
                  type="warning"
                  showIcon
                  message={`采集有 ${active.warnings.length} 项告警`}
                  description={active.warnings.join('\n')}
                />
              )}
              <div className="browser-captures__document">
                <article>
                  <MarkdownContent>{active.markdown}</MarkdownContent>
                </article>
                <aside>
                  <Title level={5}>文档大纲</Title>
                  {outline.length ? (
                    <ol>{outline.map((heading, index) => <li key={`${heading}-${index}`}>{heading}</li>)}</ol>
                  ) : (
                    <Text type="secondary">未识别到标题</Text>
                  )}
                  <Title level={5}>资源</Title>
                  <Text>{active.asset_count} 张本地图片</Text>
                </aside>
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
