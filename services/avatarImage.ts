// One portrait ratio for upload, profile display, resume preview and PDF export.
export const AVATAR_ASPECT_RATIO = '3 / 4';
export const AVATAR_OUTPUT_WIDTH = 384;
export const AVATAR_OUTPUT_HEIGHT = 512;

// Budget the serialized backup separately from the cropped photo and other
// profile fields so both images fit below the 10 MiB API request limit.
export const MAX_AVATAR_ORIGINAL_DATA_URL_LENGTH = 1_400_000;
const MAX_AVATAR_ORIGINAL_DIMENSION = 2048;

export const prepareAvatarOriginalForSave = async (source: string): Promise<string> => {
  if (source.length <= MAX_AVATAR_ORIGINAL_DATA_URL_LENGTH) {
    return source;
  }
  if (typeof Image === 'undefined' || typeof document === 'undefined') {
    throw new Error('无法压缩头像原图，请重新选择照片。');
  }
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const candidate = new Image();
    candidate.onload = () => resolve(candidate);
    candidate.onerror = () => reject(new Error('头像原图加载失败，请重新选择照片。'));
    candidate.src = source;
  });
  if (!image.naturalWidth || !image.naturalHeight) {
    throw new Error('头像原图尺寸无效，请重新选择照片。');
  }
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('无法压缩头像原图，请重新选择照片。');
  }
  let longestSide = MAX_AVATAR_ORIGINAL_DIMENSION;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const scale = Math.min(1, longestSide / Math.max(image.naturalWidth, image.naturalHeight));
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    // Preserve the whole source for later recropping, including both ends.
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const prepared = canvas.toDataURL('image/jpeg', 0.85);
    if (prepared.startsWith('data:image/jpeg;base64,')
      && prepared.length <= MAX_AVATAR_ORIGINAL_DATA_URL_LENGTH) {
      return prepared;
    }
    longestSide = Math.max(1, Math.floor(Math.max(canvas.width, canvas.height) * 0.75));
  }
  throw new Error('头像原图过大，请重新选择照片。');
};

export const resolveAvatarCropSource = (
  extraJson: Record<string, unknown>,
  avatarDataUrl: string,
): string => (
  typeof extraJson.avatar_original_data_url === 'string'
  && extraJson.avatar_original_data_url.trim()
    ? extraJson.avatar_original_data_url
    : avatarDataUrl
);

export const withAvatarCrop = (
  extraJson: Record<string, unknown>,
  originalSource: string,
  croppedSource: string,
): Record<string, unknown> => ({
  ...extraJson,
  avatar_data_url: croppedSource,
  avatar_original_data_url: originalSource,
});

export const withoutAvatar = (
  extraJson: Record<string, unknown>,
): Record<string, unknown> => {
  const next = { ...extraJson };
  delete next.avatar_data_url;
  delete next.avatar_original_data_url;
  return next;
};
