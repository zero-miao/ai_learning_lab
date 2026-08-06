import { useEffect } from 'react';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { Button, Layout, Typography } from 'antd';
import TopicList from './pages/TopicList';
import TopicDetail from './pages/TopicDetail';
import MaterialReader from './pages/MaterialReader';
import TopicMap from './pages/TopicMap';
import TaskManagement from './pages/TaskManagement';
import MaterialManagement from './pages/MaterialManagement';
import ExamPage from './pages/Exam';
import ReviewPage from './pages/Review';
import DiscussionTopic from './pages/DiscussionTopic';

const { Header, Content, Footer } = Layout;
const { Title } = Typography;

function App() {
  const navigate = useNavigate();

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

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header style={{
        display: 'flex',
        alignItems: 'center',
        background: '#fff',
        borderBottom: '1px solid #f0f0f0',
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
      </Header>
      <Content style={{ background: '#f5f7fa' }}>
        <Routes>
          <Route path="/" element={<Navigate to="/topics" replace />} />
          <Route path="/topics" element={<TopicList />} />
          <Route path="/topics/:id" element={<TopicDetail />} />
          <Route path="/topics/:id/discussion" element={<DiscussionTopic />} />
          <Route path="/topics/:id/map" element={<TopicMap />} />
          <Route path="/topics/:topicId/materials/:materialId" element={<MaterialReader />} />
          <Route path="/topics/:topicId/exam" element={<ExamPage />} />
          <Route path="/materials" element={<MaterialManagement />} />
          <Route path="/tasks" element={<TaskManagement />} />
          <Route path="/reviews" element={<ReviewPage />} />
        </Routes>
      </Content>
      <Footer style={{ textAlign: 'center' }}>
        AI Learning Lab ©{new Date().getFullYear()} Created for Personal Learning
      </Footer>
    </Layout>
  );
}

export default App;
