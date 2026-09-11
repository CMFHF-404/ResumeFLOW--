export async function waitForResumeRenderReady(
  root: HTMLElement,
  {signal, deadlineMs}: {signal: AbortSignal; deadlineMs: number},
): Promise<void> {
  if (!Number.isFinite(deadlineMs)) throw new Error('排版等待截止时间无效。');
  const remaining = deadlineMs - Date.now();
  if (signal.aborted || remaining <= 0) throw new Error('排版等待已取消或超时。');
  let timer: ReturnType<typeof setTimeout>;
  let onAbort: () => void;
  let stopped = false;
  let revision = 0;
  const observer = new MutationObserver(() => { revision += 1; });
  observer.observe(root, {subtree:true,childList:true,characterData:true,attributes:true});
  const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  const work = async () => {
    while (!stopped) {
      const before = revision;
      await document.fonts?.ready;
      const images = [...root.querySelectorAll<HTMLImageElement>('img')];
      const urls = new Set<string>();
      for (const element of [root,...root.querySelectorAll('*')]) {
        for (const match of getComputedStyle(element).backgroundImage.matchAll(/url\((?:"([^"]+)"|'([^']+)'|([^)'"\s]+))\)/g)) {
          urls.add(match[1] ?? match[2] ?? match[3]);
        }
      }
      for (const url of urls) {const image = new Image(); image.src=url; images.push(image);}
      await Promise.all(images.map(async image => {
        if (!image.currentSrc && !image.src) return;
        await image.decode();
        if (!image.complete || image.naturalWidth === 0) throw new Error('简历图片加载失败。');
      }));
      await frame(); await frame();
      if (stopped) return;
      if (!root.isConnected) throw new Error('排版预览已失效。');
      if (document.fonts && [...document.fonts].some(font => font.status === 'error')) {
        throw new Error('简历字体加载失败。');
      }
      if (before === revision && (!document.fonts || document.fonts.status === 'loaded')) return;
    }
  };
  try {
    await Promise.race([work(),new Promise<never>((_, reject) => {
      onAbort = () => reject(new Error('排版等待已取消。'));
      signal.addEventListener('abort',onAbort,{once:true});
      timer = setTimeout(() => reject(new Error('简历资源加载超时，请重试。')),remaining);
    })]);
  } finally {
    stopped=true;
    clearTimeout(timer!);
    signal.removeEventListener('abort',onAbort!);
    observer.disconnect();
  }
}
