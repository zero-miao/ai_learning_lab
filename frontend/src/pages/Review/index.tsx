import React, { useEffect, useState } from 'react';
import { Button, Card, Empty, Form, Input, List, Modal, Space, Tag, Typography, message } from 'antd';
import { useNavigate } from 'react-router-dom';
import { createReviewPrompt, getReviews, submitReview } from '../../api';
import type { ReviewRecord } from '../../api';

const ReviewPage: React.FC = () => {
  const [reviews, setReviews] = useState<ReviewRecord[]>([]);
  const [active, setActive] = useState<ReviewRecord | null>(null);
  const [form] = Form.useForm<{ response_text: string }>();
  const navigate = useNavigate();
  const load = async () => setReviews((await getReviews()).data);
  useEffect(() => { void load(); }, []);
  const submit = async ({ response_text }: { response_text: string }) => {
    if (!active) return;
    await submitReview(active.id, response_text);
    message.success('已提交复盘反馈任务');
    setActive(null);
    form.resetFields();
  };
  return <div style={{ maxWidth: 1100, margin: '0 auto', padding: 24 }}>
    <Card title="复习计划" extra={<Button onClick={() => void load()}>刷新</Button>}>
      <List dataSource={reviews} locale={{ emptyText: <Empty description="暂无复习计划" /> }} renderItem={(item) => (
        <List.Item actions={[
          item.result === 'pending' ? <Button key="prompt" onClick={async () => { await createReviewPrompt(item.id); message.success('已提交复习提示任务'); }}>生成提示</Button> : null,
          item.result === 'pending' ? <Button key="submit" type="primary" onClick={() => { setActive(item); form.setFieldsValue({ response_text: item.response_text }); }}>提交复盘</Button> : null,
          <Button key="topic" type="link" onClick={() => navigate(`/topics/${item.topic}`)}>进入主题</Button>,
        ]}>
          <List.Item.Meta title={<Space><span>{item.topic_title}</span><Tag color={item.result === 'completed' ? 'success' : 'blue'}>{item.result_display}</Tag></Space>} description={<Space direction="vertical" size={2}><Typography.Text type="secondary">应复习：{new Date(item.due_at).toLocaleString()}</Typography.Text>{item.review_prompt && <Typography.Paragraph style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{item.review_prompt}</Typography.Paragraph>}{item.feedback && <Typography.Text>反馈：{item.feedback}</Typography.Text>}</Space>} />
        </List.Item>
      )} />
    </Card>
    <Modal title="提交复盘" open={Boolean(active)} onCancel={() => setActive(null)} onOk={() => form.submit()}>
      {active?.review_prompt && <Typography.Paragraph style={{ whiteSpace: 'pre-wrap' }}>{active.review_prompt}</Typography.Paragraph>}
      <Form form={form} layout="vertical" onFinish={(values) => void submit(values)}><Form.Item name="response_text" label="本次主动回忆与应用" rules={[{ required: true }]}><Input.TextArea rows={8} /></Form.Item></Form>
    </Modal>
  </div>;
};

export default ReviewPage;
