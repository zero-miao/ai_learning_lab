import './popup.css';

type CaptureMode = 'auto' | 'article' | 'document' | 'selection' | 'visible';

interface CaptureResponse {
  ok: boolean;
  error?: string;
  snapshot?: Record<string, unknown>;
  assets?: Array<{
    sourceUrl: string;
    id?: string;
    contentType?: string;
    data?: string;
  }>;
}

interface BackgroundAssetResponse {
  ok: boolean;
  data?: string;
  contentType?: string;
  digest?: string;
  error?: string;
}

type CaptureAsset = NonNullable<CaptureResponse['assets']>[number];

interface PreparedAsset {
  asset: CaptureAsset;
  assetId: string;
  bytes: Uint8Array<ArrayBuffer>;
  contentType: string;
  index: number;
}

const ASSET_DOWNLOAD_BATCH_SIZE = 3;
const connection = document.querySelector<HTMLSpanElement>('#connection')!;
const title = document.querySelector<HTMLDivElement>('#page-title')!;
const mode = document.querySelector<HTMLSelectElement>('#mode')!;
const topic = document.querySelector<HTMLSelectElement>('#topic')!;
const serviceInput = document.querySelector<HTMLInputElement>('#service-url')!;
const stay = document.querySelector<HTMLInputElement>('#stay')!;
const captureButton = document.querySelector<HTMLButtonElement>('#capture')!;
const progress = document.querySelector<HTMLDivElement>('#progress')!;

function normalizedServiceUrl() {
  return serviceInput.value.trim().replace(/\/+$/, '');
}

function appUrl(serviceUrl: string) {
  const url = new URL(serviceUrl);
  url.port = url.port === '8000' ? '5173' : url.port;
  return url.origin;
}

function base64Bytes(data: string): Uint8Array<ArrayBuffer> {
  const binary = atob(data);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function detectedImageType(bytes: Uint8Array) {
  const ascii = (start: number, end: number) =>
    String.fromCharCode(...bytes.subarray(start, end));
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    ascii(1, 4) === 'PNG' &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (bytes.length >= 6 && ['GIF87a', 'GIF89a'].includes(ascii(0, 6))) {
    return 'image/gif';
  }
  if (bytes.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') {
    return 'image/webp';
  }
  if (
    bytes.length >= 12 &&
    ascii(4, 8) === 'ftyp' &&
    ['avif', 'avis'].includes(ascii(8, 12))
  ) {
    return 'image/avif';
  }
  return null;
}

async function prepareAsset(
  asset: CaptureAsset,
  index: number,
  snapshot: Record<string, unknown>,
): Promise<PreparedAsset | null> {
  let assetId = asset.id;
  let data = asset.data;
  if (!assetId || !data) {
    const fetched = (await chrome.runtime.sendMessage({
      type: 'FETCH_CAPTURE_ASSET',
      url: asset.sourceUrl,
    })) as BackgroundAssetResponse;
    if (!fetched?.ok || !fetched.data || !fetched.digest) {
      const warnings = snapshot.warnings as string[] | undefined;
      warnings?.push(
        `图片采集失败：${asset.sourceUrl}（${fetched?.error || '未知错误'}）`,
      );
      return null;
    }
    assetId = `sha256:${fetched.digest}`;
    data = fetched.data;
  }
  const bytes = base64Bytes(data);
  const contentType = detectedImageType(bytes);
  if (!contentType) {
    const warnings = snapshot.warnings as string[] | undefined;
    warnings?.push(`图片 ${index + 1} 不是支持的位图格式，已跳过。`);
    const blocks = snapshot.blocks as Array<Record<string, unknown>>;
    for (const block of blocks) {
      if (block.source_url === asset.sourceUrl) delete block.asset_id;
    }
    return null;
  }
  return { asset, assetId, bytes, contentType, index };
}

async function responseError(response: Response, fallback: string) {
  try {
    const payload = await response.json();
    const detail = payload.detail || payload.snapshot_json || payload.title;
    if (detail) {
      return `${fallback}：${Array.isArray(detail) ? detail.join('；') : String(detail)}`;
    }
  } catch {
    // Ignore non-JSON error bodies and keep the status-based fallback.
  }
  return `${fallback}（${response.status}）`;
}

async function currentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('无法读取当前标签页。');
  return tab;
}

async function requestCapture(tabId: number, captureMode: CaptureMode): Promise<CaptureResponse> {
  try {
    return await chrome.tabs.sendMessage(tabId, {
      type: 'CAPTURE_PAGE_V2',
      mode: captureMode,
    });
  } catch {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['assets/content.js'] });
    return chrome.tabs.sendMessage(tabId, {
      type: 'CAPTURE_PAGE_V2',
      mode: captureMode,
    });
  }
}

async function loadConnection() {
  const saved = await chrome.storage.local.get(['serviceUrl', 'captureMode', 'stayOnPage', 'topic']);
  serviceInput.value = typeof saved.serviceUrl === 'string' ? saved.serviceUrl : serviceInput.value;
  mode.value = typeof saved.captureMode === 'string' ? saved.captureMode : 'auto';
  stay.checked = Boolean(saved.stayOnPage);
  const serviceUrl = normalizedServiceUrl();
  try {
    const health = await fetch(`${serviceUrl}/api/health/`, { credentials: 'omit' });
    if (!health.ok) throw new Error();
    connection.textContent = '服务已连接';
    connection.classList.add('online');
    const response = await fetch(`${serviceUrl}/api/topics/?page_size=100`, { credentials: 'omit' });
    if (response.ok) {
      const payload = await response.json();
      for (const item of payload.results || []) {
        topic.add(new Option(item.title, String(item.id)));
      }
      topic.value = typeof saved.topic === 'string' ? saved.topic : '';
    }
  } catch {
    connection.textContent = '服务未连接';
    connection.classList.remove('online');
  }
}

async function submitCapture() {
  captureButton.disabled = true;
  progress.classList.remove('error');
  let createdId: number | null = null;
  try {
    const tab = await currentTab();
    progress.textContent = '正在读取页面结构和图片...';
    const result = await requestCapture(tab.id!, mode.value as CaptureMode);
    if (!result.ok || !result.snapshot) throw new Error(result.error || '页面采集失败。');
    const serviceUrl = normalizedServiceUrl();
    await chrome.storage.local.set({
      serviceUrl,
      captureMode: mode.value,
      stayOnPage: stay.checked,
      topic: topic.value,
    });
    progress.textContent = `已读取 ${(result.snapshot.blocks as unknown[])?.length || 0} 个内容块，正在提交...`;
    const createdResponse = await fetch(`${serviceUrl}/api/browser-captures/`, {
      method: 'POST',
      credentials: 'omit',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ snapshot_json: result.snapshot }),
    });
    if (!createdResponse.ok) {
      throw new Error(await responseError(createdResponse, '创建采集记录失败'));
    }
    const created = await createdResponse.json();
    createdId = created.id;
    const assets = result.assets || [];
    let uploadedCount = 0;
    for (let offset = 0; offset < assets.length; offset += ASSET_DOWNLOAD_BATCH_SIZE) {
      const batch = assets.slice(offset, offset + ASSET_DOWNLOAD_BATCH_SIZE);
      const batchEnd = offset + batch.length;
      progress.textContent = `正在下载图片 ${offset + 1}-${batchEnd}/${assets.length}...`;
      const prepared = await Promise.all(
        batch.map((asset, batchIndex) =>
          prepareAsset(asset, offset + batchIndex, result.snapshot!),
        ),
      );
      for (const item of prepared) {
        if (!item) continue;
        progress.textContent = `正在上传图片 ${item.index + 1}/${assets.length}...`;
        const blocks = result.snapshot.blocks as Array<Record<string, unknown>>;
        for (const block of blocks) {
          if (block.source_url === item.asset.sourceUrl) {
            block.asset_id = item.assetId;
          }
        }
        const form = new FormData();
        form.append(
          'file',
          new Blob([item.bytes], { type: item.contentType }),
          'capture-image',
        );
        const uploaded = await fetch(
          `${serviceUrl}/api/browser-captures/${created.id}/assets/${encodeURIComponent(item.assetId)}/`,
          { method: 'PUT', credentials: 'omit', body: form },
        );
        if (!uploaded.ok) {
          throw new Error(
            await responseError(uploaded, `图片 ${item.index + 1} 上传失败`),
          );
        }
        uploadedCount += 1;
      }
    }
    const imageCount = (result.snapshot.blocks as Array<Record<string, unknown>>).filter(
      (block) => block.type === 'image',
    ).length;
    if (result.snapshot.adapter === 'feishu-document' && imageCount > 0 && uploadedCount === 0) {
      throw new Error(
        `检测到 ${imageCount} 张正文图片，但未能下载。请保持飞书页面登录后重试。`,
      );
    }
    const updated = await fetch(`${serviceUrl}/api/browser-captures/${created.id}/`, {
      method: 'PATCH',
      credentials: 'omit',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ snapshot_json: result.snapshot }),
    });
    if (!updated.ok) {
      throw new Error(await responseError(updated, '更新采集快照失败'));
    }
    const completed = await fetch(`${serviceUrl}/api/browser-captures/${created.id}/complete/`, {
      method: 'POST',
      credentials: 'omit',
    });
    if (!completed.ok) {
      throw new Error(await responseError(completed, '完成采集失败'));
    }
    progress.textContent = `采集完成，共 ${uploadedCount} 张图片。`;
    if (!stay.checked) {
      const query = topic.value ? `?topic=${encodeURIComponent(topic.value)}` : '';
      await chrome.tabs.create({ url: `${appUrl(serviceUrl)}/captures/${created.id}${query}` });
      window.close();
    }
  } catch (error) {
    if (createdId !== null) {
      const serviceUrl = normalizedServiceUrl();
      await fetch(`${serviceUrl}/api/browser-captures/${createdId}/`, {
        method: 'DELETE',
        credentials: 'omit',
      }).catch(() => undefined);
    }
    progress.textContent = error instanceof Error ? error.message : String(error);
    progress.classList.add('error');
  } finally {
    captureButton.disabled = false;
  }
}

void currentTab()
  .then((tab) => {
    title.textContent = tab.title || '未命名页面';
  })
  .catch((error) => {
    title.textContent = String(error);
  });
chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === 'CAPTURE_PROGRESS' && typeof message.message === 'string') {
    progress.textContent = message.message;
  }
});
void loadConnection();
captureButton.addEventListener('click', () => void submitCapture());
