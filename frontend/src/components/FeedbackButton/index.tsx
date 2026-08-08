import { useEffect, useState } from 'react';
import { FormOutlined } from '@ant-design/icons';
import { Button, Form, Input, Modal, Select, Typography, message } from 'antd';
import { createUserFeedback } from '../../api';
import type { FeedbackCategory, FeedbackFeature } from '../../api';
import './styles.css';

const DRAFT_KEY = 'user-feedback-draft';

interface FeedbackDraft {
  category: FeedbackCategory;
  feature: FeedbackFeature;
  description: string;
}

const featureOptions: Array<{ value: FeedbackFeature; label: string }> = [
  { value: 'management_assistant', label: '全站管理助手' },
  { value: 'topic_management', label: '话题管理' },
  { value: 'topic_detail', label: '话题详情' },
  { value: 'material_reader', label: '学习阅读' },
  { value: 'material_management', label: '材料管理' },
  { value: 'exam', label: '掌握度评估' },
  { value: 'review', label: '复习计划' },
  { value: 'task_management', label: '任务管理' },
  { value: 'system_settings', label: '系统设置' },
  { value: 'feedback', label: '反馈功能' },
  { value: 'other', label: '其他' },
];

function inferFeature(pathname: string): FeedbackFeature {
  if (/^\/topics\/\d+\/materials\/\d+/.test(pathname)) return 'material_reader';
  if (/^\/topics\/\d+\/exam/.test(pathname)) return 'exam';
  if (/^\/topics\/\d+/.test(pathname)) return 'topic_detail';
  if (pathname.startsWith('/topics')) return 'topic_management';
  if (pathname.startsWith('/materials')) return 'material_management';
  if (pathname.startsWith('/reviews')) return 'review';
  if (pathname.startsWith('/tasks')) return 'task_management';
  if (pathname.startsWith('/settings')) return 'system_settings';
  return 'other';
}

function getDefaultDraft(): FeedbackDraft {
  return {
    category: 'usability',
    feature: inferFeature(window.location.pathname),
    description: '',
  };
}

function loadDraft(): FeedbackDraft {
  try {
    const saved = JSON.parse(window.localStorage.getItem(DRAFT_KEY) ?? '{}');
    return {
      category: saved.category ?? 'usability',
      feature: saved.feature ?? inferFeature(window.location.pathname),
      description: saved.description ?? '',
    };
  } catch {
    return getDefaultDraft();
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
        feature: draft.feature,
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
      setDraft(getDefaultDraft());
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
          <Form.Item label="所属页面或功能" required>
            <Select
              value={draft.feature}
              options={featureOptions}
              showSearch
              optionFilterProp="label"
              onChange={(feature) =>
                setDraft((current) => ({ ...current, feature }))
              }
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
