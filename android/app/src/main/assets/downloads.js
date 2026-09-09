(() => {
  if (window.top !== window || window.__rfDownloadsInstalled || !window.ResumeFlowDownload) return;
  window.__rfDownloadsInstalled = true;
  const bridge = window.ResumeFlowDownload;
  // Retain the original Blob while its object URL exists. Fetching blob: would violate
  // the site's connect-src CSP, and changing production CSP is unnecessary.
  const blobs = new Map();
  const createObjectURL = URL.createObjectURL.bind(URL);
  const revokeObjectURL = URL.revokeObjectURL.bind(URL);
  URL.createObjectURL = value => {
    const url = createObjectURL(value);
    if (value instanceof Blob) blobs.set(url, value);
    return url;
  };
  URL.revokeObjectURL = url => { blobs.delete(url); revokeObjectURL(url); };
  const maxBytes = 64 * 1024 * 1024;
  const chunkSize = 48 * 1024;
  let active = false;
  let receiver;
  bridge.onmessage = event => { if (receiver) receiver(JSON.parse(event.data)); };
  const send = payload => new Promise((resolve, reject) => {
    const timer = setTimeout(() => { receiver = null; reject(new Error('保存超时，请重试')); }, 30000);
    receiver = result => {
      clearTimeout(timer); receiver = null;
      result.ok ? resolve() : reject(new Error('无法保存文件，请完成当前保存或重试'));
    };
    bridge.postMessage(JSON.stringify(payload));
  });
  const base64 = bytes => {
    let value = '';
    for (let i = 0; i < bytes.length; i++) value += String.fromCharCode(bytes[i]);
    return btoa(value);
  };
  async function save(anchor) {
    if (active) { alert('请先完成当前文件保存'); return; }
    active = true;
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    let started = false;
    try {
      // Read synchronously before the website revokes the object URL.
      const blob = blobs.get(anchor.href);
      if (!blob) throw new Error('文件已失效，请重新导出后保存');
      if (blob.size > maxBytes) throw new Error('文件超过 64 MB，请在浏览器中下载');
      await send({ type: 'begin', id, name: anchor.download || '原子简历文件', mime: blob.type, size: blob.size });
      started = true;
      for (let offset = 0; offset < blob.size; offset += chunkSize) {
        const bytes = new Uint8Array(await blob.slice(offset, offset + chunkSize).arrayBuffer());
        await send({ type: 'chunk', id, data: base64(bytes) });
      }
      await send({ type: 'end', id });
    } catch (error) {
      if (started) { try { await send({ type: 'abort', id }); } catch (_) {} }
      alert(error.message || '文件保存失败，请重试');
    } finally { active = false; }
  }
  document.addEventListener('click', event => {
    const anchor = event.target.closest && event.target.closest('a');
    if (!anchor || !anchor.href.startsWith(`blob:${location.origin}/`)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    void save(anchor);
  }, true);
})();
