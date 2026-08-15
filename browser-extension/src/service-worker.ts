const MENU_ID = 'capture-selection';

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MENU_ID,
    title: '将选中内容采集到 AI Learning Lab',
    contexts: ['selection'],
  });
});

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId !== MENU_ID) return;
  void chrome.storage.local
    .set({ captureMode: 'selection' })
    .then(() => chrome.action.openPopup())
    .catch(() => undefined);
});

function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'FETCH_CAPTURE_ASSET') return;
  const url = String(message.url || '');
  if (!/^https?:\/\//.test(url)) {
    sendResponse({ ok: false, error: '仅支持 HTTP 图片地址。' });
    return;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  fetch(url, { credentials: 'include', signal: controller.signal })
    .then(async (response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength > 20 * 1024 * 1024) throw new Error('图片超过 20 MB');
      const digest = Array.from(
        new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
      )
        .map((value) => value.toString(16).padStart(2, '0'))
        .join('');
      sendResponse({
        ok: true,
        data: bytesToBase64(bytes),
        contentType:
          response.headers.get('content-type') || 'application/octet-stream',
        digest,
      });
    })
    .catch((error) => {
      sendResponse({ ok: false, error: String(error.message || error) });
    })
    .finally(() => {
      clearTimeout(timeout);
    });
  return true;
});
