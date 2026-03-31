-- 为 feedback 表新增图片 base64 列表字段
-- 每张图片存储为 base64 字符串，默认为空数组
ALTER TABLE feedback
    ADD COLUMN IF NOT EXISTS image_base64_list TEXT[] NOT NULL DEFAULT '{}';
