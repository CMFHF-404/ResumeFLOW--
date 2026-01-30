-- 完整数据库迁移脚本
-- 用途：确保所有表结构与代码模型定义完全一致
-- 执行方式：在 Supabase SQL Editor 中运行此脚本
-- 说明：使用 IF NOT EXISTS 确保幂等，可以安全地重复执行

-- ============================================================
-- 1. 创建必要的扩展和枚举类型
-- ============================================================
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'experience_category') THEN
        CREATE TYPE experience_category AS ENUM ('work', 'project', 'education');
    END IF;
END $$;

-- ============================================================
-- 2. 确保 users 表结构
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- 3. 确保 profiles 表结构（最关键）
-- ============================================================
CREATE TABLE IF NOT EXISTS profiles (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE
);

-- 添加所有可能缺失的列
ALTER TABLE profiles
    ADD COLUMN IF NOT EXISTS full_name TEXT,
    ADD COLUMN IF NOT EXISTS title TEXT,
    ADD COLUMN IF NOT EXISTS summary TEXT,
    ADD COLUMN IF NOT EXISTS location TEXT,
    ADD COLUMN IF NOT EXISTS phone TEXT,
    ADD COLUMN IF NOT EXISTS email TEXT,
    ADD COLUMN IF NOT EXISTS social_links JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS extra_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- ============================================================
-- 4. 确保 profile_links 表结构
-- ============================================================
CREATE TABLE IF NOT EXISTS profile_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    url TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0
);

-- ============================================================
-- 5. 确保 resumes 表结构
-- ============================================================
CREATE TABLE IF NOT EXISTS resumes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    target_role TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 添加可能缺失的列
ALTER TABLE resumes
    ADD COLUMN IF NOT EXISTS target_role TEXT,
    ADD COLUMN IF NOT EXISTS config JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- ============================================================
-- 6. 确保 master_experiences 表结构
-- ============================================================
CREATE TABLE IF NOT EXISTS master_experiences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category experience_category NOT NULL,
    latest_version_id UUID,
    is_archived BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- 7. 确保 experience_versions 表结构
-- ============================================================
CREATE TABLE IF NOT EXISTS experience_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    master_experience_id UUID NOT NULL REFERENCES master_experiences(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    title TEXT NOT NULL,
    org TEXT,
    location TEXT,
    start_date DATE,
    end_date DATE,
    is_current BOOLEAN NOT NULL DEFAULT FALSE,
    summary TEXT,
    highlights TEXT[] NOT NULL DEFAULT '{}'::text[],
    star JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 添加外键约束（幂等）
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'master_experiences_latest_version_fk'
    ) THEN
        ALTER TABLE master_experiences
            ADD CONSTRAINT master_experiences_latest_version_fk
            FOREIGN KEY (latest_version_id)
            REFERENCES experience_versions(id);
    END IF;
END $$;

-- ============================================================
-- 8. 确保 resume_experiences 表结构
-- ============================================================
CREATE TABLE IF NOT EXISTS resume_experiences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    resume_id UUID NOT NULL REFERENCES resumes(id) ON DELETE CASCADE,
    experience_version_id UUID NOT NULL REFERENCES experience_versions(id) ON DELETE RESTRICT,
    display_order INTEGER NOT NULL DEFAULT 0,
    overrides_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 重命名旧列名（幂等）
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'resume_experiences'
          AND column_name = 'position'
    ) AND NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'resume_experiences'
          AND column_name = 'display_order'
    ) THEN
        ALTER TABLE resume_experiences RENAME COLUMN position TO display_order;
    END IF;
END $$;

-- 添加可能缺失的列
ALTER TABLE resume_experiences
    ADD COLUMN IF NOT EXISTS display_order INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS overrides_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- 删除已废弃的列
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'resume_experiences'
          AND column_name = 'section'
    ) THEN
        ALTER TABLE resume_experiences DROP COLUMN section;
    END IF;
END $$;

-- ============================================================
-- 9. 确保 skills 表结构
-- ============================================================
CREATE TABLE IF NOT EXISTS skills (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    category TEXT
);

-- ============================================================
-- 10. 确保 user_skills 表结构
-- ============================================================
CREATE TABLE IF NOT EXISTS user_skills (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    skill_id UUID NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
    proficiency INTEGER
);

-- ============================================================
-- 11. 确保 experience_version_skills 表结构
-- ============================================================
CREATE TABLE IF NOT EXISTS experience_version_skills (
    experience_version_id UUID NOT NULL REFERENCES experience_versions(id) ON DELETE CASCADE,
    skill_id UUID NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
    PRIMARY KEY (experience_version_id, skill_id)
);

-- ============================================================
-- 12. 确保 resume_skills 表结构
-- ============================================================
CREATE TABLE IF NOT EXISTS resume_skills (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    resume_id UUID NOT NULL REFERENCES resumes(id) ON DELETE CASCADE,
    skill_name_snapshot TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0
);

-- ============================================================
-- 13. 确保 certifications 表结构
-- ============================================================
CREATE TABLE IF NOT EXISTS certifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    issuer TEXT,
    issue_date DATE,
    expiry_date DATE,
    credential_id TEXT,
    credential_url TEXT,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- 14. 创建必要的索引
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_resumes_user_id ON resumes(user_id);
CREATE INDEX IF NOT EXISTS idx_master_experiences_user_id ON master_experiences(user_id);
CREATE INDEX IF NOT EXISTS idx_experience_versions_master_id ON experience_versions(master_experience_id);
CREATE INDEX IF NOT EXISTS idx_resume_experiences_resume_id ON resume_experiences(resume_id);
CREATE INDEX IF NOT EXISTS idx_certifications_user_id ON certifications(user_id);

-- ============================================================
-- 15. 验证结果
-- ============================================================
-- 查看所有表的列数
SELECT 
    table_name,
    COUNT(*) AS column_count
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN (
      'users', 'profiles', 'profile_links', 'resumes', 
      'master_experiences', 'experience_versions', 'resume_experiences',
      'skills', 'user_skills', 'experience_version_skills', 
      'resume_skills', 'certifications'
  )
GROUP BY table_name
ORDER BY table_name;
