import { useEffect, useState } from 'react';
import { FormOutlined } from '@ant-design/icons';
import { Button, Form, Input, Modal, Select, Typography, message } from 'antd';
import { createUserFeedback } from '../../api';
import type { FeedbackCategory } from '../../api';
import './styles.css';

const DRAFT_KEY = 'user-feedback-draft';

interface FeedbackDraft {
  category: FeedbackCategory;
  description: string;
}

const defaultDraft: FeedbackDraft = {
  category: 'usability',
  description: '',
};

function loadDraft(): FeedbackDraft {
  try {
    const saved = JSON.parse(window.localStorage.getItem(DRAFT_KEY) ?? '{}');
    return {
      category: saved.category ?? defaultDraft.category,
      description: saved.description ?? '',
    };
  } catch {
    return defaultDraft;
  }
}

export default function FeedbackButton() {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [draft, setDraft] = useState<FeedbackDraft>(loadDraft);

  useEffect(() => {
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  }, [draft]);

  const submit = async () => {
    const description = draft.description.trim();
    if (!description) {
      message.warning('请描述遇到的问题或建议');
      return;
    }
    setSubmitting(true);
    try {
      await createUserFeedback({
        category: draft.category,
        description,
        page_url: window.location.href.slice(0, 2000),
        page_title: document.title.slice(0, 255),
        user_agent: navigator.userAgent,
        context: {
          path: window.location.pathname,
          search: window.location.search,
          viewport: {
            width: window.innerWidth,
            height: window.innerHeight,
          },
          screen: {
            width: window.screen.width,
            height: window.screen.height,
          },
          language: navigator.language,
        },
      });
      setDraft(defaultDraft);
      window.localStorage.removeItem(DRAFT_KEY);
      setOpen(false);
      message.success('反馈已记录');
    } catch {
      message.error('反馈提交失败，请检查服务后重试');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Button
        className="global-feedback-button"
        type="primary"
        shape="circle"
        size="large"
        icon={<FormOutlined />}
        aria-label="记录使用反馈"
        title="记录使用反馈"
        onClick={() => setOpen(true)}
      />
      <Modal
        title="记录使用反馈"
        open={open}
        okText="提交反馈"
        cancelText="稍后再说"
        confirmLoading={submitting}
        focusTriggerAfterClose={false}
        onOk={() => void submit()}
        onCancel={() => setOpen(false)}
      >
        <Typography.Paragraph type="secondary">
          当前页面和设备信息会自动附上，便于后续定位问题。
        </Typography.Paragraph>
        <Form layout="vertical">
          <Form.Item label="反馈类型" required>
            <Select
              value={draft.category}
              options={[
                { value: 'usability', label: '不好用' },
                { value: 'bug', label: '功能异常' },
                { value: 'content', label: '内容问题' },
                { value: 'suggestion', label: '功能建议' },
                { value: 'other', label: '其他' },
              ]}
              onChange={(category) => setDraft((current) => ({
                ...current,
                category,
              }))}
            />
          </Form.Item>
          <Form.Item label="具体情况" required>
            <Input.TextArea
              autoFocus
              value={draft.description}
              autoSize={{ minRows: 5, maxRows: 12 }}
              maxLength={4000}
              showCount
              placeholder="哪里不好用？你原本想完成什么？"
              onChange={(event) => setDraft((current) => ({
                ...current,
                description: event.target.value,
              }))}
            />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
