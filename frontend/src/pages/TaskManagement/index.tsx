import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Card, Descriptions, Select, Space, Spin, Table, Tag, Typography, message } from 'antd';
import type { TableColumnsType } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { getAITask, listAITasks, retryAITask } from '../../api';
import type { AITask, AITaskStatus, AITaskSummary } from '../../api';

const statusColor: Record<AITaskStatus, string> = {
  pending: 'processing',
  running: 'blue',
  succeeded: 'success',
  failed: 'error',
  cancelled: 'default',
};

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString() : '-';
}

function JsonBlock({ value }: { value: Record<string, unknown> }) {
  return Object.keys(value).length ? (
    <pre style={{
      margin: 0,
      maxHeight: 420,
      overflow: 'auto',
      whiteSpace: 'pre-wrap',
      overflowWrap: 'anywhere',
      padding: '12px',
      borderRadius: '4px',
      backgroundColor: 'rgba(0, 0, 0, 0.02)',
      border: '1px solid rgba(0, 0, 0, 0.06)',
      fontSize: '13px'
    }}>
      {JSON.stringify(value, null, 2)}
    </pre>
  ) : <Typography.Text type="secondary">无结果数据</Typography.Text>;
}

const TaskManagement: React.FC = () => {
  const [tasks, setTasks] = useState<AITaskSummary[]>([]);
  const [taskDetails, setTaskDetails] = useState<Record<number, AITask>>({});
  const [status, setStatus] = useState<AITaskStatus | 'all'>('all');
  const [taskType, setTaskType] = useState('all');
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [total, setTotal] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await listAITasks({
        page,
        page_size: pageSize,
        ...(status !== 'all' ? { status } : {}),
        ...(taskType !== 'all' ? { task_type: taskType } : {}),
      });
      setTasks(response.data.results);
      setTotal(response.data.count);
      setTaskDetails({});
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, status, taskType]);
  useEffect(() => { void load(); }, [load]);
  const types = useMemo(() => {
    const map = new Map<string, string>();
    tasks.forEach((task) => {
      if (!map.has(task.task_type)) {
        map.set(task.task_type, task.task_type_display);
      }
    });
    return Array.from(map.entries()).map(([value, label]) => ({ value, label }));
  }, [tasks]);
  const retry = async (task: AITaskSummary) => {
    await retryAITask(task.id);
    message.success('任务已重新进入队列');
    await load();
  };
  const loadDetail = async (taskId: number) => {
    if (taskDetails[taskId]) return;
    try {
      const response = await getAITask(taskId);
      setTaskDetails((current) => ({ ...current, [taskId]: response.data }));
    } catch {
      message.error('加载任务详情失败');
    }
  };
  const columns: TableColumnsType<AITaskSummary> = [
    { title: 'ID', dataIndex: 'id', width: 72 },
    { title: '任务', key: 'task', render: (_, task) => <Space direction="vertical" size={0}><Typography.Text strong>{task.task_type_display}</Typography.Text><Typography.Text type="secondary" style={{ fontSize: '12px' }}>{task.task_type}</Typography.Text></Space> },
    { title: '状态', key: 'status', width: 110, render: (_, task) => <Tag color={statusColor[task.status]}>{task.status_display}</Tag> },
    { title: '触发源', key: 'trigger', render: (_, task) => `${task.trigger_type} #${task.trigger_id ?? '-'}` },
    { title: '执行', key: 'attempt', width: 115, render: (_, task) => `${task.attempt_count} / ${task.max_attempts}` },
    { title: '模型', dataIndex: 'model', width: 160, render: (value) => value || '-' },
    { title: '创建时间', key: 'created', width: 170, render: (_, task) => formatDate(task.created_at) },
    { title: '操作', key: 'actions', width: 90, render: (_, task) => ['failed', 'cancelled'].includes(task.status) ? <Button type="link" icon={<ReloadOutlined />} onClick={() => void retry(task)}>重试</Button> : '-' },
  ];

  return (
    <div style={{ maxWidth: 1480, margin: '0 auto', padding: 24 }}>
      <Card title={`任务管理 (${total})`} extra={<Button onClick={() => void load()} loading={loading}>刷新</Button>}>
        <Space style={{ marginBottom: 16 }} wrap>
          <Select value={status} onChange={(value) => { setStatus(value); setPage(1); }} style={{ width: 150 }} options={[
            { value: 'all', label: '全部状态' },
            { value: 'pending', label: '排队中' },
            { value: 'running', label: '执行中' },
            { value: 'succeeded', label: '已完成' },
            { value: 'failed', label: '失败' },
            { value: 'cancelled', label: '已取消' },
          ]} />
          <Select value={taskType} onChange={(value) => { setTaskType(value); setPage(1); }} style={{ width: 220 }} options={[{ value: 'all', label: '全部任务类型' }, ...types]} />
        </Space>
        <Table
          rowKey="id"
          columns={columns}
          dataSource={tasks}
          loading={loading}
          scroll={{ x: 1050 }}
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
          expandable={{
            onExpand: (expanded, task) => {
              if (expanded) void loadDetail(task.id);
            },
            expandedRowRender: (summary) => {
              const task = taskDetails[summary.id];
              if (!task) return <Spin size="small" tip="正在加载任务详情" />;
              return (
              <Descriptions size="small" column={1} bordered>
                <Descriptions.Item label="开始时间">{formatDate(task.started_at)}</Descriptions.Item>
                <Descriptions.Item label="完成时间">{formatDate(task.finished_at)}</Descriptions.Item>
                <Descriptions.Item label="下一次运行">{formatDate(task.next_run_at)}</Descriptions.Item>
                <Descriptions.Item label="错误信息">{task.error_message || '无'}</Descriptions.Item>
                <Descriptions.Item label="任务数据 (task_data)">
                  <JsonBlock value={task.task_data} />
                </Descriptions.Item>
                <Descriptions.Item label="LLM 完整上下文 (full_context)">
                  {task.full_context ? (
                    <pre style={{
                      margin: 0,
                      maxHeight: 600,
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
                      {task.full_context}
                    </pre>
                  ) : '无上下文记录'}
                </Descriptions.Item>
                <Descriptions.Item label="任务结果 (result_json)">
                  <JsonBlock value={task.result_json} />
                </Descriptions.Item>
              </Descriptions>
              );
            },
          }}
        />
      </Card>
    </div>
  );
};

export default TaskManagement;
