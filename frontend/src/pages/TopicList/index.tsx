import React, { useState, useEffect } from 'react';
import { List, Card, Button, Typography, Tag, Modal, Form, Input, message } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { getTopics, createTopic } from '../../api';
import type { Topic } from '../../api';

const { Title, Paragraph } = Typography;

const TopicList: React.FC = () => {
  const [topics, setTopics] = useState<Topic[]>([]);
  const [loading, setLoading] = useState(false);
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [form] = Form.useForm();
  const navigate = useNavigate();

  const fetchTopics = async () => {
    setLoading(true);
    try {
      const response = await getTopics();
      setTopics(response.data);
    } catch (error) {
      console.error('Failed to fetch topics:', error);
      message.error('获取主题列表失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTopics();
  }, []);

  const handleCreate = async (values: any) => {
    try {
      await createTopic(values);
      message.success('创建主题成功');
      setIsModalVisible(false);
      form.resetFields();
      fetchTopics();
    } catch (error) {
      console.error('Failed to create topic:', error);
      message.error('创建主题失败');
    }
  };

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      draft: 'default',
      learning: 'processing',
      exam_ready: 'warning',
      reviewing: 'success',
      archived: 'error',
    };
    return colors[status] || 'default';
  };

  return (
    <div style={{ padding: '24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <Title level={2} style={{ margin: 0 }}>学习主题</Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setIsModalVisible(true)}>
          新建主题
        </Button>
      </div>

      <List
        grid={{ gutter: 16, xs: 1, sm: 2, md: 3, lg: 3, xl: 4, xxl: 4 }}
        loading={loading}
        dataSource={topics}
        renderItem={(item) => (
          <List.Item>
            <Card
              hoverable
              title={item.title}
              extra={<Tag color={getStatusColor(item.status)}>{item.status_display}</Tag>}
              onClick={() => navigate(`/topics/${item.id}`)}
            >
              <Paragraph ellipsis={{ rows: 2 }}>
                {item.goal || '暂无学习目标'}
              </Paragraph>
              <div style={{ marginTop: '16px' }}>
                <Tag color="blue">掌握度: {item.mastery_level_display}</Tag>
              </div>
            </Card>
          </List.Item>
        )}
      />

      <Modal
        title="新建学习主题"
        open={isModalVisible}
        onCancel={() => setIsModalVisible(false)}
        onOk={() => form.submit()}
        confirmLoading={loading}
      >
        <Form form={form} layout="vertical" onFinish={handleCreate}>
          <Form.Item
            name="title"
            label="主题标题"
            rules={[{ required: true, message: '请输入主题标题' }]}
          >
            <Input placeholder="例如：深入理解 Django ORM" />
          </Form.Item>
          <Form.Item name="goal" label="学习目标">
            <Input.TextArea rows={3} placeholder="你希望通过学习达到什么程度？" />
          </Form.Item>
          <Form.Item name="scope" label="学习范围">
            <Input.TextArea rows={3} placeholder="涵盖哪些具体知识点？" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default TopicList;
