import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Alert, Button, Card, Input, List, Result, Space, Spin, Typography, message } from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import { createExam, getAITask, getExam, getExams, getTopic, submitExam } from '../../api';
import type { AITask, Exam, Topic } from '../../api';

const ExamPage: React.FC = () => {
  const { topicId } = useParams<{ topicId: string }>();
  const navigate = useNavigate();
  const [topic, setTopic] = useState<Topic | null>(null);
  const [exam, setExam] = useState<Exam | null>(null);
  const [task, setTask] = useState<AITask | null>(null);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [history, setHistory] = useState<Exam[]>([]);

  const load = useCallback(async () => {
    if (!topicId) return;
    const [topicResponse, examsResponse] = await Promise.all([getTopic(Number(topicId)), getExams({ topic: Number(topicId) })]);
    setTopic(topicResponse.data);
    setHistory(examsResponse.data);
    const current = examsResponse.data.find((item) => item.status === 'draft') ?? examsResponse.data[0] ?? null;
    setExam(current);
    if (current) setAnswers(Object.fromEntries(current.questions.map((item) => [item.id, item.answer_text])));
  }, [topicId]);
  useEffect(() => { void load().catch(() => message.error('加载掌握度评估失败')); }, [load]);
  useEffect(() => {
    if (!task || !['pending', 'running'].includes(task.status)) return;
    const timer = window.setInterval(async () => {
      const next = (await getAITask(task.id)).data;
      setTask(next);
      if (next.status === 'succeeded') {
        const examId = next.result_json.exam_id;
        if (typeof examId === 'number') setExam((await getExam(examId)).data);
        await load();
      }
      if (next.status === 'failed') message.error(next.error_message || '评估任务失败');
    }, 1500);
    return () => window.clearInterval(timer);
  }, [load, task]);
  const generate = async () => { if (topic) setTask((await createExam(topic.id)).data.task); };
  const submit = async () => {
    if (!exam) return;
    if (exam.questions.some((item) => !answers[item.id]?.trim())) return message.warning('请完成全部题目');
    setTask((await submitExam(exam.id, exam.questions.map((item) => ({ id: item.id, answer_text: answers[item.id] })))).data.task);
  };
  if (!topic) return <Spin style={{ display: 'block', margin: 80 }} />;
  return <div style={{ maxWidth: 960, margin: '0 auto', padding: 24 }}>
    <Button icon={<ArrowLeftOutlined />} onClick={() => navigate(`/topics/${topic.id}`)}>返回主题</Button>
    <Card title="掌握度评估" style={{ marginTop: 16 }}>
      <Typography.Paragraph>基于当前主题的可学习材料生成迁移题，评估理解与应用能力。</Typography.Paragraph>
      {task && ['pending', 'running'].includes(task.status) && <Alert type="info" showIcon message={`${task.task_type_display}正在执行`} />}
      {!exam && !task && <Result title="准备开始评估" extra={<Button type="primary" onClick={() => void generate()}>生成评估</Button>} />}
      {exam?.status === 'draft' && <Space direction="vertical" style={{ display: 'flex' }}>
        {exam.questions.map((item, index) => <Card key={item.id} size="small" title={`第 ${index + 1} 题`}><Typography.Paragraph>{item.scenario}</Typography.Paragraph><Typography.Text strong>{item.question_text}</Typography.Text><Input.TextArea rows={5} value={answers[item.id]} onChange={(event) => setAnswers((current) => ({ ...current, [item.id]: event.target.value }))} style={{ marginTop: 12 }} /></Card>)}
        <Button type="primary" onClick={() => void submit()}>提交并评分</Button>
      </Space>}
      {exam?.status === 'graded' && <Result status="success" title={`得分 ${exam.score ?? 0}`} subTitle={exam.feedback} />}
      <Card title="历史评估" style={{ marginTop: 20 }}>
        <List
          dataSource={history}
          locale={{ emptyText: '暂无历史评估' }}
          renderItem={(item) => (
            <List.Item actions={[<Button key="view" type="link" onClick={() => { setExam(item); setAnswers(Object.fromEntries(item.questions.map((question) => [question.id, question.answer_text]))); }}>查看</Button>]}>
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
