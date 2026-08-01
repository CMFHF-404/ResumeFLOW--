export type SquareCropBox = {
  sourceX: number;
  sourceY: number;
  sourceSize: number;
};

export const resolveSquareCropBox = (
  naturalWidth: number,
  naturalHeight: number,
): SquareCropBox => {
  const sourceSize = Math.min(naturalWidth, naturalHeight);
  return {
    sourceX: (naturalWidth - sourceSize) / 2,
    sourceY: (naturalHeight - sourceSize) / 2,
    sourceSize,
  };
};

const loadImage = (source: string) => new Promise<HTMLImageElement>((resolve, reject) => {
  const image = new Image();
  image.onload = () => resolve(image);
  image.onerror = () => reject(new Error('头像图片加载失败'));
  image.src = source;
});

export const normalizeAvatarImageToSquare = async (
  source: string,
  outputSize = 512,
): Promise<string> => {
  if (!source || typeof Image === 'undefined' || typeof document === 'undefined') {
    return source;
  }

  const image = await loadImage(source);
  if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth === image.naturalHeight) {
    return source;
  }

  const crop = resolveSquareCropBox(image.naturalWidth, image.naturalHeight);
  const canvas = document.createElement('canvas');
  canvas.width = outputSize;
  canvas.height = outputSize;
  const context = canvas.getContext('2d');
  if (!context) {
    return source;
  }

  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, outputSize, outputSize);
  context.drawImage(
    image,
    crop.sourceX,
    crop.sourceY,
    crop.sourceSize,
    crop.sourceSize,
    0,
    0,
    outputSize,
    outputSize,
  );
  return canvas.toDataURL('image/jpeg', 0.88);
};
