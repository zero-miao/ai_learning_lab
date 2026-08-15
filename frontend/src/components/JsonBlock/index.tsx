import { Typography } from 'antd';

export default function JsonBlock({
  value,
}: {
  value: Record<string, unknown>;
}) {
  if (!Object.keys(value).length) {
    return <Typography.Text type="secondary">无结果数据</Typography.Text>;
  }
  return (
    <pre
      style={{
        margin: 0,
        maxHeight: 420,
        overflow: 'auto',
        whiteSpace: 'pre-wrap',
        overflowWrap: 'anywhere',
        padding: 12,
        borderRadius: 4,
        backgroundColor: 'rgba(0, 0, 0, 0.02)',
        border: '1px solid rgba(0, 0, 0, 0.06)',
        fontSize: 13,
        lineHeight: 1.6,
      }}
    >
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}
