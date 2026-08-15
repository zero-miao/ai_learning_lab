import { useEffect } from 'react';
import { Form, Input, Modal } from 'antd';
import type { Concept } from '../../api';

interface ConceptEditorProps {
  open: boolean;
  concept?: Partial<Concept> | null;
  creating?: boolean;
  onCancel: () => void;
  onSubmit: (values: Partial<Concept>) => void | Promise<void>;
}

export function ConceptEditorModal({
  open,
  concept,
  creating = false,
  onCancel,
  onSubmit,
}: ConceptEditorProps) {
  const [form] = Form.useForm<Partial<Concept>>();
  useEffect(() => {
    if (!open) return;
    form.setFieldsValue(concept ?? {});
  }, [concept, form, open]);

  return (
    <Modal
      title={creating ? '标记概念' : '编辑概念'}
      open={open}
      focusTriggerAfterClose={false}
      onCancel={onCancel}
      onOk={() => form.submit()}
    >
      <Form form={form} layout="vertical" onFinish={onSubmit}>
        <Form.Item name="title" label="名称" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Form.Item name="definition" label="定义">
          <Input.TextArea rows={3} />
        </Form.Item>
        <Form.Item name="principle" label="原理">
          <Input.TextArea rows={3} />
        </Form.Item>
        <Form.Item name="pitfalls" label="易错点">
          <Input.TextArea rows={3} />
        </Form.Item>
        <Form.Item name="applications" label="应用">
          <Input.TextArea rows={3} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

interface HighlightEditorProps {
  open: boolean;
  note?: string;
  creating?: boolean;
  onCancel: () => void;
  onSubmit: (values: { user_note: string }) => void | Promise<void>;
}

export function HighlightEditorModal({
  open,
  note = '',
  creating = false,
  onCancel,
  onSubmit,
}: HighlightEditorProps) {
  const [form] = Form.useForm<{ user_note: string }>();
  useEffect(() => {
    if (open) form.setFieldsValue({ user_note: note });
  }, [form, note, open]);

  return (
    <Modal
      title={creating ? '添加高亮' : '编辑高亮'}
      open={open}
      focusTriggerAfterClose={false}
      onCancel={onCancel}
      onOk={() => form.submit()}
    >
      <Form form={form} layout="vertical" onFinish={onSubmit}>
        <Form.Item name="user_note" label="笔记内容">
          <Input.TextArea rows={4} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
