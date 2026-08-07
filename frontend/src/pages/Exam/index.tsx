import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Alert, Button, Card, Input, List, Result, Space, Spin, Tag, Typography, message } from 'antd';
import { ArrowLeftOutlined, ReloadOutlined, SaveOutlined } from '@ant-design/icons';
import {
  createExam,
  getAITask,
  getExam,
  getExams,
  getTopic,
  listAITasks,
  retryAITask,
  saveExamAnswers,
  submitExam,
} from '../../api';
import type { AITaskSummary, Exam, Topic } from '../../api';

const activeTaskStatuses = ['pending', 'running'];
const visibleTaskStatuses = ['pending', 'running', 'failed', 'cancelled'];

const ExamPage: React.FC = () => {
  const { topicId } = useParams<{ topicId: string }>();
  const navigate = useNavigate();
  const [topic, setTopic] = useState<Topic | null>(null);
  const [exam, setExam] = useState<Exam | null>(null);
  const [task, setTask] = useState<AITaskSummary | null>(null);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [history, setHistory] = useState<Exam[]>([]);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyPageSize, setHistoryPageSize] = useState(10);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const selectExam = useCallback((selected: Exam | null) => {
    setExam(selected);
    setAnswers(
      selected
        ? Object.fromEntries(selected.questions.map((item) => [item.id, item.answer_text]))
        : {},
    );
    setDirty(false);
  }, []);

  const load = useCallback(async (preferredExamId?: number) => {
    if (!topicId) return;
    const numericTopicId = Number(topicId);
    const [topicResponse, examsResponse, generationTasksResponse] = await Promise.all([
      getTopic(numericTopicId),
      getExams({
        topic: numericTopicId,
        page: historyPage,
        page_size: historyPageSize,
      }),
      listAITasks({
        trigger_type: 'Topic',
        trigger_id: numericTopicId,
        task_type: 'generate_exam',
      }),
    ]);
    setTopic(topicResponse.data);
    const exams = examsResponse.data.results;
    setHistory(exams);
    setHistoryTotal(examsResponse.data.count);
    const current = (
      exams.find((item) => item.id === preferredExamId)
      ?? exams.find((item) => ['draft', 'submitted'].includes(item.status))
      ?? exams[0]
      ?? null
    );
    selectExam(current);

    if (current?.status === 'submitted') {
      const gradingTasks = (
        await listAITasks({
          trigger_type: 'Exam',
          trigger_id: current.id,
          task_type: 'grade_exam',
        })
      ).data.results;
      setTask(gradingTasks.find((item) => visibleTaskStatuses.includes(item.status)) ?? null);
      return;
    }

    const latestExamCreatedAt = exams[0]?.created_at;
    const generationTask = generationTasksResponse.data.results.find(
      (item) => visibleTaskStatuses.includes(item.status)
        && (!latestExamCreatedAt || new Date(item.created_at) > new Date(latestExamCreatedAt)),
    );
    setTask(generationTask ?? null);
  }, [historyPage, historyPageSize, selectExam, topicId]);

  useEffect(() => { void load().catch(() => message.error('加载掌握度评估失败')); }, [load]);

  useEffect(() => {
    if (!task || !activeTaskStatuses.includes(task.status)) return;
    const timer = window.setInterval(async () => {
      try {
        const next = (await getAITask(task.id)).data;
        setTask(next);
        if (next.status === 'succeeded') {
          const examId = next.result_json.exam_id;
          if (typeof examId === 'number') {
            selectExam((await getExam(examId)).data);
          }
          await load(typeof examId === 'number' ? examId : undefined);
          message.success(`${next.task_type_display}已完成`);
        }
      } catch {
        message.error('刷新评估任务状态失败');
      }
    }, 1500);
    return () => window.clearInterval(timer);
  }, [load, selectExam, task]);

  const generate = async () => {
    if (!topic) return;
    try {
      setTask((await createExam(topic.id)).data.task);
    } catch {
      message.error('提交评估生成任务失败');
    }
  };

  const save = async () => {
    if (!exam) return;
    setSaving(true);
    try {
      const response = await saveExamAnswers(
        exam.id,
        exam.questions.map((item) => ({ id: item.id, answer_text: answers[item.id] ?? '' })),
      );
      setExam(response.data);
      setHistory((current) => current.map(
        (item) => item.id === response.data.id ? response.data : item,
      ));
      setDirty(false);
      message.success('评估草稿已保存');
    } catch {
      message.error('保存评估草稿失败');
    } finally {
      setSaving(false);
    }
  };

  const submit = async () => {
    if (!exam) return;
    if (exam.questions.some((item) => !answers[item.id]?.trim())) return message.warning('请完成全部题目');
    try {
      setTask((
        await submitExam(
          exam.id,
          exam.questions.map((item) => ({ id: item.id, answer_text: answers[item.id] })),
        )
      ).data.task);
      setExam({ ...exam, status: 'submitted', status_display: '已提交' });
      setDirty(false);
    } catch {
      message.error('提交评估失败');
    }
  };

  const retry = async () => {
    if (!task) return;
    try {
      setTask((await retryAITask(task.id)).data);
      message.info('评估任务已重新进入队列');
    } catch {
      message.error('重试评估任务失败');
    }
  };

  const hasUnfinishedExam = history.some((item) => ['draft', 'submitted'].includes(item.status));
  const taskRunning = Boolean(task && activeTaskStatuses.includes(task.status));

  if (!topic) return <Spin style={{ display: 'block', margin: 80 }} />;
  return <div style={{ maxWidth: 960, margin: '0 auto', padding: 24 }}>
    <Button icon={<ArrowLeftOutlined />} onClick={() => navigate(`/topics/${topic.id}`)}>返回主题</Button>
    <Card
      title="掌握度评估"
      style={{ marginTop: 16 }}
      extra={!hasUnfinishedExam && !taskRunning ? <Button type="primary" onClick={() => void generate()}>生成新评估</Button> : null}
    >
      <Typography.Paragraph>基于当前主题的可学习材料生成迁移题，评估理解与应用能力。</Typography.Paragraph>
      {task && activeTaskStatuses.includes(task.status) && (
        <Alert
          type="info"
          showIcon
          message={`${task.task_type_display}${task.status === 'pending' ? '正在排队' : '正在执行'}`}
          style={{ marginBottom: 16 }}
        />
      )}
      {task && ['failed', 'cancelled'].includes(task.status) && (
        <Alert
          type="error"
          showIcon
          message={`${task.task_type_display}${task.status === 'failed' ? '失败' : '已取消'}`}
          description={task.error_message || '任务未完成，可以重新提交。'}
          action={<Button icon={<ReloadOutlined />} onClick={() => void retry()}>重试</Button>}
          style={{ marginBottom: 16 }}
        />
      )}
      {!exam && !task && <Result title="准备开始评估" extra={<Button type="primary" onClick={() => void generate()}>生成评估</Button>} />}
      {exam?.status === 'draft' && <Space direction="vertical" style={{ display: 'flex' }}>
        {exam.questions.map((item, index) => (
          <Card key={item.id} size="small" title={`第 ${index + 1} 题`}>
            <Typography.Paragraph>{item.scenario}</Typography.Paragraph>
            <Typography.Text strong>{item.question_text}</Typography.Text>
            <Input.TextArea
              rows={5}
              value={answers[item.id]}
              onChange={(event) => {
                setAnswers((current) => ({ ...current, [item.id]: event.target.value }));
                setDirty(true);
              }}
              style={{ marginTop: 12 }}
            />
          </Card>
        ))}
        <Space>
          <Button icon={<SaveOutlined />} loading={saving} disabled={!dirty} onClick={() => void save()}>保存草稿</Button>
          <Button type="primary" disabled={taskRunning} onClick={() => void submit()}>提交并评分</Button>
        </Space>
      </Space>}
      {exam?.status === 'submitted' && !task && <Alert type="info" showIcon message="评估已提交，正在等待评分任务状态" />}
      {exam?.status === 'failed' && <Alert type="error" showIcon message="评估未完成" description={exam.feedback || '请重新生成评估。'} />}
      {exam?.status === 'graded' && (
        <Space direction="vertical" style={{ display: 'flex' }} size="middle">
          <Result status="success" title={`得分 ${exam.score ?? 0}`} subTitle={exam.feedback} />
          {exam.questions.map((item, index) => (
            <Card
              key={item.id}
              size="small"
              title={`第 ${index + 1} 题`}
              extra={<Tag color="blue">{item.score ?? 0} 分</Tag>}
            >
              {item.scenario && <Typography.Paragraph type="secondary">{item.scenario}</Typography.Paragraph>}
              <Typography.Paragraph strong>{item.question_text}</Typography.Paragraph>
              <Typography.Title level={5}>你的回答</Typography.Title>
              <Typography.Paragraph>{item.answer_text || '未作答'}</Typography.Paragraph>
              <Typography.Title level={5}>评分反馈</Typography.Title>
              <Typography.Paragraph>{item.feedback || '暂无反馈'}</Typography.Paragraph>
            </Card>
          ))}
        </Space>
      )}
      <Card title="历史评估" style={{ marginTop: 20 }}>
        <List
          dataSource={history}
          pagination={{
            current: historyPage,
            pageSize: historyPageSize,
            total: historyTotal,
            showSizeChanger: true,
            onChange: (page, pageSize) => {
              setHistoryPage(pageSize === historyPageSize ? page : 1);
              setHistoryPageSize(pageSize);
            },
          }}
          locale={{ emptyText: '暂无历史评估' }}
          renderItem={(item) => (
            <List.Item actions={[<Button key="view" type="link" onClick={() => selectExam(item)}>查看</Button>]}>
              <List.Item.Meta
                title={`${new Date(item.created_at).toLocaleString()} · ${item.status_display}`}
                description={item.status === 'graded' ? `得分 ${item.score ?? 0}：${item.feedback}` : `${item.questions.length} 道题`}
              />
            </List.Item>
          )}
        />
      </Card>
    </Card>
  </div>;
};

export default ExamPage;
