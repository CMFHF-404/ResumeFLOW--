-- 添加 users.is_admin 字段与索引
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_users_is_admin
    ON users (is_admin)
    WHERE is_admin = TRUE;
