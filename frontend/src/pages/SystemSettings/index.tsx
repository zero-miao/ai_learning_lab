import React, { useEffect, useState } from 'react';
import {
  Alert,
  AutoComplete,
  Button,
  Card,
  Col,
  Form,
  Input,
  InputNumber,
  Row,
  Select,
  Space,
  Typography,
  message,
} from 'antd';
import { ReloadOutlined, SaveOutlined } from '@ant-design/icons';
import {
  discoverProviderModels,
  getSystemConfiguration,
  setApiTimeout,
  updateSystemConfiguration,
} from '../../api';
import type { SystemConfiguration } from '../../api';
import { siteThemeOptions } from '../../appearance';

type ConfigurationForm = Omit<SystemConfiguration, 'updated_at'>;

const taskModelFields: Array<{
  name: keyof ConfigurationForm;
  label: string;
}> = [
  { name: 'llm_model_management_assistant', label: '全站管理助手' },
  { name: 'llm_model_topic_chat', label: '学习讨论' },
  { name: 'llm_model_supplement_query', label: '补料检索词' },
  { name: 'llm_model_supplement_evaluate', label: '补料相关度评估' },
  { name: 'llm_model_briefing', label: '材料摘要' },
  { name: 'llm_model_clean_text', label: '正文清洗' },
  { name: 'llm_model_answer_question', label: '阅读问答' },
  { name: 'llm_model_concept_draft', label: '概念草稿' },
  { name: 'llm_model_generate_exam', label: '评估出题' },
  { name: 'llm_model_grade_exam', label: '评估阅卷' },
  { name: 'llm_model_review_prompt', label: '复习提示' },
  { name: 'llm_model_grade_review', label: '复盘评分' },
];

const requiredRule = [{ required: true, whitespace: true, message: '请填写此项' }];

const SystemSettings: React.FC = () => {
  const [form] = Form.useForm<ConfigurationForm>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [updatedAt, setUpdatedAt] = useState('');
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelError, setModelError] = useState('');

  const loadModels = async (
    values: Pick<
      ConfigurationForm,
      'llm_provider_type' | 'llm_base_url' | 'llm_api_key'
    >,
  ) => {
    setModelsLoading(true);
    setModelError('');
    try {
      const response = await discoverProviderModels(values);
      setAvailableModels(response.data.models);
      if (!response.data.models.length) {
        setModelError('Provider 未返回可用模型，可继续手动输入模型名。');
      }
    } catch {
      setAvailableModels([]);
      setModelError('无法读取 Provider 模型列表，可检查连接配置或手动输入。');
    } finally {
      setModelsLoading(false);
    }
  };

  useEffect(() => {
    void getSystemConfiguration()
      .then((response) => {
        form.setFieldsValue(response.data);
        setApiTimeout(response.data.api_timeout_ms);
        setUpdatedAt(response.data.updated_at);
        void loadModels(response.data);
      })
      .catch(() => message.error('加载系统设置失败'))
      .finally(() => setLoading(false));
  }, [form]);

  const refreshModels = async () => {
    const values = await form.validateFields([
      'llm_provider_type',
      'llm_base_url',
      'llm_api_key',
    ]);
    await loadModels(values);
  };

  const renderModelInput = () => (
    <AutoComplete
      options={availableModels.map((model) => ({ value: model }))}
      placeholder="选择或输入模型名"
      filterOption={(input, option) =>
        String(option?.value ?? '')
          .toLowerCase()
          .includes(input.toLowerCase())
      }
    />
  );

  const save = async (values: ConfigurationForm) => {
    setSaving(true);
    try {
      const response = await updateSystemConfiguration(values);
      form.setFieldsValue(response.data);
      setUpdatedAt(response.data.updated_at);
      setApiTimeout(response.data.api_timeout_ms);
      message.success('系统设置已保存并生效');
    } catch {
      message.error('保存系统设置失败，请检查输入');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ maxWidth: 1120, margin: '0 auto', padding: 24 }}>
      <Form
        form={form}
        layout="vertical"
        disabled={loading}
        onValuesChange={(changedValues) => {
          if (
            'llm_provider_type' in changedValues
            || 'llm_base_url' in changedValues
            || 'llm_api_key' in changedValues
          ) {
            setAvailableModels([]);
            setModelError('Provider 配置已修改，请重新读取可用模型。');
          }
        }}
        onFinish={(values) => void save(values)}
      >
        <Space
          align="center"
          style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}
        >
          <div>
            <Typography.Title level={2} style={{ margin: 0 }}>
              系统设置
            </Typography.Title>
            <Typography.Text type="secondary">
              配置持久化在本地数据库，新任务会使用保存后的设置。
              {updatedAt ? ` 最近保存：${new Date(updatedAt).toLocaleString()}` : ''}
            </Typography.Text>
          </div>
          <Button
            type="primary"
            htmlType="submit"
            icon={<SaveOutlined />}
            loading={saving}
          >
            保存
          </Button>
        </Space>

        <Card title="LLM 服务" loading={loading} style={{ marginBottom: 16 }}>
          {modelError && (
            <Alert
              type="warning"
              showIcon
              title={modelError}
              style={{ marginBottom: 16 }}
            />
          )}
          <Row gutter={16}>
            <Col xs={24} md={8}>
              <Form.Item name="llm_provider_type" label="服务类型">
                <Select
                  options={[
                    { value: 'ollama', label: 'Ollama' },
                    { value: 'openai', label: 'OpenAI 兼容服务' },
                  ]}
                />
              </Form.Item>
            </Col>
            <Col xs={24} md={16}>
              <Form.Item name="llm_base_url" label="接口地址" rules={requiredRule}>
                <Input placeholder="http://localhost:11434/v1" />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="llm_api_key" label="API Key">
                <Input.Password placeholder="本地 Ollama 可填写 ollama" />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="llm_model" label="默认模型" rules={requiredRule}>
                {renderModelInput()}
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="ollama_keep_alive" label="Ollama 保活时间">
                <Input placeholder="2m" />
              </Form.Item>
            </Col>
          </Row>
        </Card>

        <Card
          title={`任务模型${availableModels.length ? `（可选 ${availableModels.length} 个）` : ''}`}
          loading={loading}
          style={{ marginBottom: 16 }}
          extra={
            <Button
              icon={<ReloadOutlined />}
              loading={modelsLoading}
              onClick={() => void refreshModels()}
            >
              读取可用模型
            </Button>
          }
        >
          <Row gutter={16}>
            {taskModelFields.map((field) => (
              <Col xs={24} md={12} lg={8} key={field.name}>
                <Form.Item
                  name={field.name}
                  label={field.label}
                  rules={requiredRule}
                >
                  {renderModelInput()}
                </Form.Item>
              </Col>
            ))}
          </Row>
        </Card>

        <Card title="本地服务与补料" loading={loading} style={{ marginBottom: 16 }}>
          <Row gutter={16}>
            <Col xs={24} md={8}>
              <Form.Item name="asr_model" label="语音识别模型" rules={requiredRule}>
                <Input placeholder="small" />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item
                name="supplement_relevance_threshold"
                label="补料最低相关度"
                rules={[{ required: true, message: '请填写相关度' }]}
              >
                <InputNumber min={0.85} max={1} step={0.05} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="searxng_base_url" label="SearxNG 地址" rules={requiredRule}>
                <Input />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="crawl4ai_base_url" label="Crawl4AI 地址" rules={requiredRule}>
                <Input />
              </Form.Item>
            </Col>
            <Col span={24}>
              <Form.Item
                name="supplement_excluded_domains"
                label="补料排除域名"
                extra="英文逗号或换行分隔，自动排除对应子域名。"
              >
                <Input.TextArea
                  rows={2}
                  placeholder="wikipedia.org,weread.qq.com,douban.com,dedao.cn"
                />
              </Form.Item>
            </Col>
            <Col span={24}>
              <Form.Item
                name="tts_voices"
                label="Edge TTS 音色"
                extra="多个音色用英文逗号分隔，可使用“音色|显示名”设置标签。"
                rules={requiredRule}
              >
                <Input.TextArea rows={3} />
              </Form.Item>
            </Col>
          </Row>
        </Card>

        <Card title="界面默认值" loading={loading}>
          <Row gutter={16}>
            <Col xs={24} md={8}>
              <Form.Item name="default_site_theme" label="全局背景">
                <Select
                  options={siteThemeOptions.map((item) => ({
                    value: item.value,
                    label: item.label,
                  }))}
                />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="default_reader_font" label="学习页正文字体">
                <Select
                  options={[
                    { value: 'system', label: '系统字体' },
                    { value: 'song', label: '宋体' },
                    { value: 'kai', label: '楷体' },
                    { value: 'serif', label: '衬线字体' },
                  ]}
                />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="default_tts_voice" label="默认朗读音色">
                <Input placeholder="zh-CN-YunxiNeural" />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="default_speech_rate" label="默认朗读语速">
                <InputNumber min={0.5} max={3} step={0.25} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item
                name="api_timeout_ms"
                label="前端请求超时（毫秒）"
                rules={[{ required: true, message: '请填写超时时间' }]}
              >
                <InputNumber min={1000} step={1000} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
        </Card>
      </Form>
    </div>
  );
};

export default SystemSettings;
