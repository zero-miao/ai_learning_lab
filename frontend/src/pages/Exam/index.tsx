import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Alert, Button, Card, Descriptions, Input, Layout, Result, Space, Spin, Tag, Typography, message } from 'antd';
import { ArrowLeftOutlined, CheckCircleOutlined, FileTextOutlined, ReloadOutlined } from '@ant-design/icons';
import { createExam, getExam, getTopic, listAITasks, retryAITask, submitExam } from '../../api';
import type { Exam, Topic } from '../../api';
import { useAITaskPolling } from '../../hooks/useAITaskPolling';

const { Content } = Layout;
const { Paragraph, Text, Title } = Typography;

const ExamPage: React.FC = () => {
  const { topicId } = useParams<{ topicId: string }>();
  const navigate = useNavigate();
  const [topic, setTopic] = useState<Topic | null>(null);
  const [exam, setExam] = useState<Exam | null>(null);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(true);
  const [taskId, setTaskId] = useState<number | null>(null);
  const [taskKind, setTaskKind] = useState<'generate_exam' | 'grade_exam' | null>(null);

  const loadTopic = useCallback(async () => {
    if (!topicId) return;
    const response = await getTopic(Number(topicId));
    setTopic(response.data);
  }, [topicId]);

  const loadExam = useCallback(async (examId: number) => {
    const response = await getExam(examId);
    setExam(response.data);
  }, []);

  const task = useAITaskPolling(taskId, {
    onSucceeded: (nextTask) => {
      const examId = nextTask.result_json.exam_id;
      if (examId) void loadExam(examId);
      void loadTopic();
      setTaskId(null);
      setTaskKind(null);
    },
  });

  useEffect(() => {
    void loadTopic()
      .catch((error) => {
        console.error('Failed to load topic for exam:', error);
        message.error('加载学习主题失败');
      })
      .finally(() => setLoading(false));
  }, [loadTopic]);

  useEffect(() => {
    if (!topic || taskId || exam) return;
    void listAITasks({ topic: topic.id }).then((response) => {
      const latestGeneration = response.data.find((item) => item.task_type === 'generate_exam');
      if (latestGeneration) {
        setTaskId(latestGeneration.id);
        setTaskKind('generate_exam');
      }
    });
  }, [exam, taskId, topic]);

  const handleGenerate = async () => {
    if (!topic) return;
    try {
      const response = await createExam(topic.id);
      setTaskId(response.data.task.id);
      setTaskKind('generate_exam');
      message.info('已提交出题任务，可继续学习或稍后返回。');
    } catch (error) {
      console.error('Failed to create exam:', error);
      message.error('生成考试任务提交失败');
    }
  };

  const handleSubmit = async () => {
    if (!exam || !topic) return;
    if (exam.questions.some((question) => !answers[question.id]?.trim())) {
      message.warning('请完成全部题目后再提交');
      return;
    }
    try {
      const response = await submitExam(exam.id, exam.questions.map((question) => ({
        id: question.id,
        answer_text: answers[question.id].trim(),
      })));
      setTaskId(response.data.task.id);
      setTaskKind('grade_exam');
      setExam({ ...exam, status: 'submitted', status_display: '已提交' });
      message.info('已提交阅卷任务，可返回主题继续学习。');
    } catch (error) {
      console.error('Failed to submit exam:', error);
      message.error('阅卷任务提交失败');
    }
  };

  const handleRetry = async () => {
    if (!task) return;
    const response = await retryAITask(task.id);
    setTaskId(response.data.id);
    if (response.data.task_type === 'generate_exam' || response.data.task_type === 'grade_exam') {
      setTaskKind(response.data.task_type);
    }
  };

  if (loading) return <Spin style={{ display: 'block', margin: '80px auto' }} size="large" />;
  if (!topic) return <Result status="404" title="未找到学习主题" />;

  const isTaskPending = task?.status === 'pending' || task?.status === 'running';
  const taskFailed = task?.status === 'failed' || task?.status === 'cancelled';

  return (
    <Content style={{ maxWidth: 960, margin: '0 auto', padding: '32px 24px' }}>
      <Button icon={<ArrowLeftOutlined />} onClick={() => navigate(`/topics/${topic.id}`)}>返回主题</Button>
      <Card style={{ marginTop: 20 }}>
        <Space direction="vertical" size="small" style={{ display: 'flex' }}>
          <Title level={2} style={{ margin: 0 }}>掌握度评估</Title>
          <Text type="secondary">题目会将材料中的知识放入新场景，重点检验你能否迁移运用，而不是复述原文。</Text>
          <Descriptions size="small" column={2}>
            <Descriptions.Item label="学习主题">{topic.title}</Descriptions.Item>
            <Descriptions.Item label="当前掌握度"><Tag color="blue">{topic.mastery_level_display}</Tag></Descriptions.Item>
          </Descriptions>
        </Space>
      </Card>

      {isTaskPending && (
        <Card style={{ marginTop: 20 }}>
          <Result
            icon={<Spin size="large" />}
            title={taskKind === 'grade_exam' ? '正在根据评分标准阅卷' : '正在依据材料设计迁移题'}
            subTitle="此任务在后台执行。你可以留在此页等待，也可以返回主题继续学习。"
          />
        </Card>
      )}

      {taskFailed && (
        <Alert
          style={{ marginTop: 20 }}
          type="error"
          showIcon
          message="AI 任务失败"
          description={task?.error_message || '请重试。'}
          action={<Button size="small" icon={<ReloadOutlined />} onClick={() => void handleRetry()}>重新尝试</Button>}
        />
      )}

      {!exam && !isTaskPending && (
        <Card style={{ marginTop: 20 }}>
          <Result icon={<FileTextOutlined />} title="准备开始主题综合测验" subTitle="系统将根据已导入且处理成功的材料生成 3 道场景化开放题。" extra={<Button type="primary" onClick={() => void handleGenerate()}>生成考试</Button>} />
        </Card>
      )}

      {exam?.status === 'draft' && !isTaskPending && (
        <Space direction="vertical" size="middle" style={{ display: 'flex', marginTop: 20 }}>
          {exam.questions.map((question, index) => (
            <Card key={question.id} title={`第 ${index + 1} 题`}>
              {question.scenario && <Alert type="info" showIcon message="迁移场景" description={question.scenario} style={{ marginBottom: 16 }} />}
              <Paragraph strong>{question.question_text}</Paragraph>
              <Input.TextArea rows={6} value={answers[question.id]} placeholder="请用自己的话分析并作答..." onChange={(event) => setAnswers((current) => ({ ...current, [question.id]: event.target.value }))} />
            </Card>
          ))}
          <Button type="primary" size="large" onClick={() => void handleSubmit()}>提交并获取反馈</Button>
        </Space>
      )}

      {exam?.status === 'graded' && (
        <Space direction="vertical" size="middle" style={{ display: 'flex', marginTop: 20 }}>
          <Result status="success" icon={<CheckCircleOutlined />} title={`本次得分 ${exam.score ?? 0} 分`} subTitle={exam.feedback || '评分已完成。'} />
          <Card title="主题状态"><Space><Tag color="green">掌握度：{topic.mastery_level_display}</Tag><Tag color="blue">已进入复习阶段</Tag>{exam.review_due_at && <Text type="secondary">首次复习：{new Date(exam.review_due_at).toLocaleString()}</Text>}</Space></Card>
          {exam.questions.map((question, index) => (
            <Card key={question.id} title={`第 ${index + 1} 题：${question.score ?? 0} 分`}>
              {question.scenario && <Paragraph type="secondary">场景：{question.scenario}</Paragraph>}
              <Paragraph strong>{question.question_text}</Paragraph>
              <Paragraph><Text strong>你的回答：</Text>{question.answer_text}</Paragraph>
              <Alert type="success" showIcon message="评分反馈" description={question.feedback || '无额外反馈。'} />
            </Card>
          ))}
        </Space>
      )}
    </Content>
  );
};

export default ExamPage;
