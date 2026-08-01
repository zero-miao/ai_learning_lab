import { BookOutlined, LinkOutlined, MoonOutlined, SunOutlined } from '@ant-design/icons';
import { Button, Divider, Space, Tag, Typography } from 'antd';
import type { Material } from '../../api';
import './styles.css';

const { Title, Text } = Typography;

interface UniversalReaderProps {
  material: Material;
  darkMode: boolean;
  onDarkModeChange: (enabled: boolean) => void;
  onSelectText: (selectedText: string) => void;
}

function getParagraphs(cleanText: string) {
  return cleanText
    .split(/\n\s*\n|\n(?=[#*-]\s)/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

export default function UniversalReader({
  material,
  darkMode,
  onDarkModeChange,
  onSelectText,
}: UniversalReaderProps) {
  const paragraphs = getParagraphs(material.clean_text);

  const handleMouseUp = () => {
    const selection = window.getSelection();
    const selectedText = selection?.toString().trim() ?? '';
    if (selectedText) {
      onSelectText(selectedText);
    }
  };

  return (
    <article className={`universal-reader ${darkMode ? 'universal-reader--dark' : ''}`}>
      <header className="universal-reader__header">
        <div>
          <Space size={8} wrap>
            <Tag icon={<BookOutlined />} color={material.source_type === 'manual' ? 'default' : 'purple'}>
              {material.source_type_display}
            </Tag>
            <Text type="secondary">{material.type_display}</Text>
          </Space>
          <Title level={1} className="universal-reader__title">
            {material.title}
          </Title>
        </div>
        <Space>
          {material.source_url && (
            <Button
              icon={<LinkOutlined />}
              href={material.source_url}
              target="_blank"
              rel="noreferrer"
            >
              原始来源
            </Button>
          )}
          <Button
            aria-label={darkMode ? '切换浅色阅读模式' : '切换深色阅读模式'}
            icon={darkMode ? <SunOutlined /> : <MoonOutlined />}
            onClick={() => onDarkModeChange(!darkMode)}
          />
        </Space>
      </header>

      <Divider className="universal-reader__divider" />

      <div className="universal-reader__content" onMouseUp={handleMouseUp}>
        {paragraphs.map((paragraph, index) => (
          <p id={`reader-paragraph-${index}`} key={`${index}-${paragraph.slice(0, 20)}`}>
            {paragraph}
          </p>
        ))}
      </div>
    </article>
  );
}
