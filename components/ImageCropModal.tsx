import React, { useState, useRef, useCallback, useEffect } from 'react';
import { X, Upload, Trash2, ZoomIn, ZoomOut, Check, Camera } from 'lucide-react';

// ─── 裁剪区域常量（2:3 比例）──────────────────────────────────────────────────
// 视口尺寸（裁剪交互区域）
const VIEW_WIDTH = 300;
const VIEW_HEIGHT = 400;

// 裁剪框尺寸（居中放置，四周留 padding）
const CROP_FRAME_WIDTH = 200;
const CROP_FRAME_HEIGHT = 300;
const CROP_FRAME_X = (VIEW_WIDTH - CROP_FRAME_WIDTH) / 2;   // 50
const CROP_FRAME_Y = (VIEW_HEIGHT - CROP_FRAME_HEIGHT) / 2; // 50

// 输出尺寸（2:3 高质量）
const OUTPUT_WIDTH = 400;
const OUTPUT_HEIGHT = 600;
const MODAL_HORIZONTAL_PADDING = 32; // fixed inset from the outer modal wrapper (`p-4`)
const CROP_SURFACE_HORIZONTAL_MARGIN = 24; // `mx-3` around the crop surface

// ─── 纯函数工具 ───────────────────────────────────────────────────────────────

/**
 * 将图片按当前位置和缩放裁剪为 Base64 DataURL。
 * 裁剪框在视口中固定，图片在视口中移动。
 */
function cropImageToDataUrl(
  imgElement: HTMLImageElement,
  imgX: number,
  imgY: number,
  scale: number,
): string {
  // 把视口中的裁剪框坐标转换为原始图片坐标
  const srcX = (CROP_FRAME_X - imgX) / scale;
  const srcY = (CROP_FRAME_Y - imgY) / scale;
  const srcW = CROP_FRAME_WIDTH / scale;
  const srcH = CROP_FRAME_HEIGHT / scale;

  const canvas = document.createElement('canvas');
  canvas.width = OUTPUT_WIDTH;
  canvas.height = OUTPUT_HEIGHT;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(imgElement, srcX, srcY, srcW, srcH, 0, 0, OUTPUT_WIDTH, OUTPUT_HEIGHT);
  return canvas.toDataURL('image/jpeg', 0.85);
}

/**
 * 确保图片始终覆盖裁剪框（不能拖出边界）。
 */
function clampImagePosition(
  x: number,
  y: number,
  scale: number,
  naturalWidth: number,
  naturalHeight: number,
): { x: number; y: number } {
  const scaledW = naturalWidth * scale;
  const scaledH = naturalHeight * scale;
  return {
    x: Math.min(CROP_FRAME_X, Math.max(CROP_FRAME_X + CROP_FRAME_WIDTH - scaledW, x)),
    y: Math.min(CROP_FRAME_Y, Math.max(CROP_FRAME_Y + CROP_FRAME_HEIGHT - scaledH, y)),
  };
}

/**
 * 计算初始缩放（图片恰好覆盖裁剪框）和居中位置。
 */
function computeInitialCropState(
  naturalWidth: number,
  naturalHeight: number,
): { scale: number; x: number; y: number } {
  const scale = Math.max(
    CROP_FRAME_WIDTH / naturalWidth,
    CROP_FRAME_HEIGHT / naturalHeight,
  );
  const imgW = naturalWidth * scale;
  const imgH = naturalHeight * scale;
  return {
    scale,
    x: CROP_FRAME_X + (CROP_FRAME_WIDTH - imgW) / 2,
    y: CROP_FRAME_Y + (CROP_FRAME_HEIGHT - imgH) / 2,
  };
}

// ─── 裁剪交互框覆盖层 ─────────────────────────────────────────────────────────

/** 在图片上绘制四周暗色遮罩 + 裁剪框白色边线 */
const CropOverlay: React.FC = () => (
  <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
    {/* 上 */}
    <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: CROP_FRAME_Y, background: 'rgba(0,0,0,0.6)' }} />
    {/* 下 */}
    <div style={{ position: 'absolute', top: CROP_FRAME_Y + CROP_FRAME_HEIGHT, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)' }} />
    {/* 左 */}
    <div style={{ position: 'absolute', top: CROP_FRAME_Y, left: 0, width: CROP_FRAME_X, height: CROP_FRAME_HEIGHT, background: 'rgba(0,0,0,0.6)' }} />
    {/* 右 */}
    <div style={{ position: 'absolute', top: CROP_FRAME_Y, left: CROP_FRAME_X + CROP_FRAME_WIDTH, right: 0, height: CROP_FRAME_HEIGHT, background: 'rgba(0,0,0,0.6)' }} />
    {/* 裁剪框边线 */}
    <div style={{
      position: 'absolute',
      left: CROP_FRAME_X,
      top: CROP_FRAME_Y,
      width: CROP_FRAME_WIDTH,
      height: CROP_FRAME_HEIGHT,
      border: '2px solid rgba(255,255,255,0.85)',
      borderRadius: 6,
      boxShadow: '0 0 0 1px rgba(255,255,255,0.2)',
    }} />
    {/* 比例提示 */}
    <div style={{
      position: 'absolute',
      left: CROP_FRAME_X,
      top: CROP_FRAME_Y + CROP_FRAME_HEIGHT + 8,
      width: CROP_FRAME_WIDTH,
      textAlign: 'center',
      fontSize: 11,
      color: 'rgba(255,255,255,0.6)',
      fontFamily: 'sans-serif',
    }}>
      2 : 3
    </div>
  </div>
);

// ─── ImageCropModal ───────────────────────────────────────────────────────────

interface ImageCropModalProps {
  /** 待裁剪图片 DataURL；null 时弹窗关闭 */
  imageSrc: string | null;
  /** 是否已有现有头像（用于显示删除按钮） */
  hasExistingAvatar: boolean;
  onConfirm: (dataUrl: string) => void;
  onCancel: () => void;
  onDelete: () => void;
}

export const ImageCropModal: React.FC<ImageCropModalProps> = ({
  imageSrc,
  hasExistingAvatar,
  onConfirm,
  onCancel,
  onDelete,
}) => {
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);
  const [imgPos, setImgPos] = useState({ x: 0, y: 0 });
  const [scale, setScale] = useState(1);
  const [viewportScale, setViewportScale] = useState(1);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const isDraggingRef = useRef(false);
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const updateViewportScale = () => {
      const availableWidth = Math.max(
        0,
        window.innerWidth - MODAL_HORIZONTAL_PADDING - CROP_SURFACE_HORIZONTAL_MARGIN,
      );
      setViewportScale(Math.min(1, availableWidth / VIEW_WIDTH));
    };
    updateViewportScale();
    window.addEventListener('resize', updateViewportScale);
    return () => window.removeEventListener('resize', updateViewportScale);
  }, []);

  // 加载图片，计算初始裁剪状态
  useEffect(() => {
    if (!imageSrc) {
      setNaturalSize(null);
      return;
    }
    const img = new Image();
    img.onload = () => {
      imgRef.current = img;
      const { scale: initScale, x, y } = computeInitialCropState(img.naturalWidth, img.naturalHeight);
      setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
      setScale(initScale);
      setImgPos({ x, y });
    };
    img.src = imageSrc;
  }, [imageSrc]);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    isDraggingRef.current = true;
    lastPointerRef.current = { x: e.clientX, y: e.clientY };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDraggingRef.current || !lastPointerRef.current || !naturalSize) return;
    const dx = (e.clientX - lastPointerRef.current.x) / viewportScale;
    const dy = (e.clientY - lastPointerRef.current.y) / viewportScale;
    lastPointerRef.current = { x: e.clientX, y: e.clientY };
    setImgPos(prev => clampImagePosition(prev.x + dx, prev.y + dy, scale, naturalSize.w, naturalSize.h));
  }, [naturalSize, scale, viewportScale]);

  const handlePointerUp = useCallback(() => {
    isDraggingRef.current = false;
    lastPointerRef.current = null;
  }, []);

  const handleScaleChange = useCallback((newScale: number) => {
    if (!naturalSize) return;
    setScale(newScale);
    setImgPos(prev => clampImagePosition(prev.x, prev.y, newScale, naturalSize.w, naturalSize.h));
  }, [naturalSize]);

  const handleConfirm = useCallback(() => {
    if (!imgRef.current || !naturalSize) return;
    const dataUrl = cropImageToDataUrl(imgRef.current, imgPos.x, imgPos.y, scale);
    onConfirm(dataUrl);
  }, [imgPos, naturalSize, onConfirm, scale]);

  const minScale = naturalSize
    ? Math.max(CROP_FRAME_WIDTH / naturalSize.w, CROP_FRAME_HEIGHT / naturalSize.h)
    : 1;
  const maxScale = minScale * 4;
  const displayedViewWidth = VIEW_WIDTH * viewportScale;
  const displayedViewHeight = VIEW_HEIGHT * viewportScale;

  if (!imageSrc) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* 背景遮罩 */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onCancel} />

      {/* 弹窗主体 */}
      <div className="relative z-10 bg-white dark:bg-gray-900 rounded-2xl shadow-2xl overflow-hidden w-full"
        style={{ maxWidth: VIEW_WIDTH + 24 }}
      >
        {/* 标题栏 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800">
          <h3 className="font-semibold text-gray-900 dark:text-white text-sm">裁剪职业照片</h3>
          <button
            onClick={onCancel}
            className="p-1 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 裁剪交互区 */}
        <div
          className="relative overflow-hidden bg-gray-950 cursor-grab active:cursor-grabbing select-none mx-3 mt-3 rounded-xl"
          style={{
            width: displayedViewWidth,
            height: displayedViewHeight,
            touchAction: 'none',
          }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
          onPointerCancel={handlePointerUp}
        >
          <div
            style={{
              position: 'relative',
              width: VIEW_WIDTH,
              height: VIEW_HEIGHT,
              transform: `scale(${viewportScale})`,
              transformOrigin: 'top left',
              pointerEvents: 'none',
            }}
          >
            {naturalSize && (
              <img
                src={imageSrc}
                alt="裁剪预览"
                style={{
                  position: 'absolute',
                  left: imgPos.x,
                  top: imgPos.y,
                  width: naturalSize.w * scale,
                  height: naturalSize.h * scale,
                  userSelect: 'none',
                  pointerEvents: 'none',
                }}
                draggable={false}
              />
            )}
            <CropOverlay />
          </div>
        </div>

        {/* 缩放滑块 */}
        <div className="px-5 py-3 flex items-center gap-3">
          <ZoomOut className="w-4 h-4 text-gray-400 shrink-0" />
          <input
            type="range"
            min={minScale}
            max={maxScale}
            step={0.005}
            value={scale}
            onChange={e => handleScaleChange(parseFloat(e.target.value))}
            className="flex-1 accent-primary h-1.5"
            disabled={!naturalSize}
          />
          <ZoomIn className="w-4 h-4 text-gray-400 shrink-0" />
        </div>

        {/* 操作按钮 */}
        <div className="px-5 pb-5 flex items-center justify-between gap-3 border-t border-gray-100 dark:border-gray-800 pt-4">
          <div>
            {hasExistingAvatar && (
              <button
                onClick={onDelete}
                className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                删除照片
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onCancel}
              className="px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800 rounded-lg transition-colors"
            >
              取消
            </button>
            <button
              onClick={handleConfirm}
              disabled={!naturalSize}
              className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Check className="w-4 h-4" />
              确认裁剪
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// ─── ProfileAvatarZone ────────────────────────────────────────────────────────

interface ProfileAvatarZoneProps {
  avatarDataUrl: string | null;
  /** 是否显示可点击状态（进入编辑或自动进入编辑） */
  isClickable: boolean;
  size: 'sm' | 'md';
  onUploadClick: () => void;
}

const AVATAR_SIZES = {
  sm: { width: 64, height: 96 },
  md: { width: 96, height: 144 },
};

/**
 * 个人照片上传入口。
 * - 有图：显示头像，编辑模式下 hover 显示相机图标
 * - 无图：显示虚线框 + 提示文字（仅可点击时显示提示）
 */
export const ProfileAvatarZone: React.FC<ProfileAvatarZoneProps> = ({
  avatarDataUrl,
  isClickable,
  size,
  onUploadClick,
}) => {
  const { width, height } = AVATAR_SIZES[size];

  const containerStyle: React.CSSProperties = { width, height, flexShrink: 0 };

  if (avatarDataUrl) {
    return (
      <div
        style={containerStyle}
        className={`relative rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700 ${isClickable ? 'cursor-pointer' : ''}`}
        onClick={isClickable ? onUploadClick : undefined}
        title={isClickable ? '点击更换照片' : undefined}
      >
        <img src={avatarDataUrl} alt="个人照片" className="w-full h-full object-cover" />
        {isClickable && (
          <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity">
            <Camera className="text-white" style={{ width: size === 'sm' ? 16 : 22, height: size === 'sm' ? 16 : 22 }} />
          </div>
        )}
      </div>
    );
  }

  // 无图时：虚线上传框
  return (
    <div
      style={containerStyle}
      className={`rounded-lg border-2 border-dashed flex flex-col items-center justify-center gap-1 transition-colors
        ${isClickable
          ? 'border-primary/40 bg-primary/5 hover:border-primary hover:bg-primary/10 cursor-pointer'
          : 'border-gray-200 dark:border-gray-700'
        }`}
      onClick={isClickable ? onUploadClick : undefined}
      title={isClickable ? '点击上传个人图像' : undefined}
    >
      {isClickable ? (
        <>
          <Upload style={{ width: size === 'sm' ? 14 : 18, height: size === 'sm' ? 14 : 18 }} className="text-primary/50" />
          <span style={{ fontSize: size === 'sm' ? 9 : 10 }} className="text-primary/50 text-center leading-tight px-1">
            点击上传<br />个人图像
          </span>
        </>
      ) : (
        <span style={{ fontSize: 10 }} className="text-gray-400 dark:text-gray-600 text-center px-1 leading-tight">
          暂无<br />照片
        </span>
      )}
    </div>
  );
};
