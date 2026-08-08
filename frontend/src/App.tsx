import { lazy, Suspense, useEffect } from 'react';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { BgColorsOutlined, SettingOutlined } from '@ant-design/icons';
import { Button, ConfigProvider, Layout, Popover, Space, Spin, Typography, theme } from 'antd';
import {
  applySiteTheme,
  hasStoredSiteTheme,
  siteThemeOptions,
  useSiteTheme,
} from './appearance';
import { getSystemConfiguration, setApiTimeout } from './api';
import FeedbackButton from './components/FeedbackButton';

const { Header, Content, Footer } = Layout;
const { Title } = Typography;
const TopicList = lazy(() => import('./pages/TopicList'));
const TopicDetail = lazy(() => import('./pages/TopicDetail'));
const MaterialReader = lazy(() => import('./pages/MaterialReader'));
const TopicMap = lazy(() => import('./pages/TopicMap'));
const TaskManagement = lazy(() => import('./pages/TaskManagement'));
const MaterialManagement = lazy(() => import('./pages/MaterialManagement'));
const ExamPage = lazy(() => import('./pages/Exam'));
const ReviewPage = lazy(() => import('./pages/Review'));
const SystemSettings = lazy(() => import('./pages/SystemSettings'));

function App() {
  const navigate = useNavigate();
  const { option, setSiteTheme, siteTheme } = useSiteTheme();

  useEffect(() => {
    const handleSelectAll = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'a') {
        return;
      }
      const target = event.target;
      const isTextInput =
        target instanceof HTMLInputElement &&
        !['button', 'checkbox', 'radio', 'submit'].includes(target.type);
      if (isTextInput || target instanceof HTMLTextAreaElement) {
        event.preventDefault();
        target.select();
      }
    };
    document.addEventListener('keydown', handleSelectAll);
    return () => document.removeEventListener('keydown', handleSelectAll);
  }, []);

  useEffect(() => {
    void getSystemConfiguration()
      .then((response) => {
        setApiTimeout(response.data.api_timeout_ms);
        if (!hasStoredSiteTheme()) {
          applySiteTheme(response.data.default_site_theme);
        }
        if (!window.localStorage.getItem('reader-font')) {
          window.localStorage.setItem(
            'reader-font',
            response.data.default_reader_font,
          );
        }
      })
      .catch(() => undefined);
  }, []);

  return (
    <ConfigProvider theme={{ algorithm: option.dark ? theme.darkAlgorithm : theme.defaultAlgorithm }}>
    <Layout
      className={`site-theme site-theme--${siteTheme}`}
      style={{ minHeight: '100vh', background: option.page }}
    >
      <Header style={{
        display: 'flex',
        alignItems: 'center',
        background: option.dark ? 'rgba(24, 24, 24, 0.96)' : 'rgba(255, 255, 255, 0.94)',
        borderBottom: `1px solid ${option.dark ? '#3a3a3a' : '#f0f0f0'}`,
        position: 'sticky',
        top: 0,
        zIndex: 1,
        width: '100%'
      }}>
        <Title level={3} style={{ margin: 0, cursor: 'pointer' }} onClick={() => navigate('/')}>
          AI Learning Lab
        </Title>
        <Button style={{ marginLeft: 'auto' }} onClick={() => navigate('/materials')}>材料管理</Button>
        <Button onClick={() => navigate('/tasks')}>任务管理</Button>
        <Button onClick={() => navigate('/reviews')}>复习计划</Button>
        <Button
          icon={<SettingOutlined />}
          aria-label="系统设置"
          title="系统设置"
          onClick={() => navigate('/settings')}
        />
        <Popover
          trigger="click"
          placement="bottomRight"
          content={
            <Space direction="vertical" size={4}>
              {siteThemeOptions.map((item) => (
                <Button
                  key={item.value}
                  type={siteTheme === item.value ? 'primary' : 'text'}
                  block
                  onClick={() => setSiteTheme(item.value)}
                >
                  <span
                    style={{
                      width: 14,
                      height: 14,
                      borderRadius: '50%',
                      background: item.color,
                      border: '1px solid rgba(127,127,127,.45)',
                    }}
                  />
                  {item.label}
                </Button>
              ))}
            </Space>
          }
        >
          <Button
            icon={<BgColorsOutlined />}
            aria-label="选择全站背景"
            title={`全站背景：${option.label}`}
          />
        </Popover>
      </Header>
      <Content style={{ background: option.page, transition: 'background-color 160ms ease' }}>
        <Suspense fallback={<Spin size="large" style={{ display: 'block', margin: 80 }} />}>
          <Routes>
            <Route path="/" element={<Navigate to="/topics" replace />} />
            <Route path="/topics" element={<TopicList />} />
            <Route path="/topics/:id" element={<TopicDetail />} />
            <Route path="/topics/:id/map" element={<TopicMap />} />
            <Route path="/topics/:topicId/materials/:materialId" element={<MaterialReader />} />
            <Route path="/topics/:topicId/exam" element={<ExamPage />} />
            <Route path="/materials" element={<MaterialManagement />} />
            <Route path="/tasks" element={<TaskManagement />} />
            <Route path="/reviews" element={<ReviewPage />} />
            <Route path="/settings" element={<SystemSettings />} />
          </Routes>
        </Suspense>
      </Content>
      <Footer style={{ textAlign: 'center' }}>
        AI Learning Lab ©{new Date().getFullYear()} Created for Personal Learning
      </Footer>
      <FeedbackButton />
    </Layout>
    </ConfigProvider>
  );
}

export default App;
