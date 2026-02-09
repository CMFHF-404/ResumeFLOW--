-- 数据库表结构验证脚本
-- 用途：检查 Supabase 数据库中所有表的列是否与代码模型定义一致
-- 执行方式：在 Supabase SQL Editor 中运行此脚本

-- ============================================================
-- 1. 检查 users 表
-- ============================================================
SELECT 'users' AS table_name, 
       CASE 
           WHEN COUNT(*) >= 2 THEN '✓ OK' 
           ELSE '✗ 缺少列' 
       END AS status,
       STRING_AGG(column_name, ', ' ORDER BY ordinal_position) AS existing_columns
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'users';

-- 应该包含的列: id, created_at

-- ============================================================
-- 2. 检查 profiles 表
-- ============================================================
SELECT 'profiles' AS table_name,
       CASE 
           WHEN COUNT(*) >= 10 THEN '✓ OK' 
           ELSE '✗ 缺少列 (应有10列)' 
       END AS status,
       STRING_AGG(column_name, ', ' ORDER BY ordinal_position) AS existing_columns
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'profiles';

-- 应该包含的列: user_id, full_name, title, summary, location, phone, email, social_links, extra_json, updated_at

-- ============================================================
-- 3. 检查 profile_links 表
-- ============================================================
SELECT 'profile_links' AS table_name,
       CASE 
           WHEN COUNT(*) >= 5 THEN '✓ OK' 
           ELSE '✗ 缺少列' 
       END AS status,
       STRING_AGG(column_name, ', ' ORDER BY ordinal_position) AS existing_columns
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'profile_links';

-- 应该包含的列: id, user_id, label, url, position

-- ============================================================
-- 4. 检查 resumes 表
-- ============================================================
SELECT 'resumes' AS table_name,
       CASE 
           WHEN COUNT(*) >= 7 THEN '✓ OK' 
           ELSE '✗ 缺少列' 
       END AS status,
       STRING_AGG(column_name, ', ' ORDER BY ordinal_position) AS existing_columns
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'resumes';

-- 应该包含的列: id, user_id, title, target_role, config, created_at, updated_at

-- ============================================================
-- 5. 检查 master_experiences 表
-- ============================================================
SELECT 'master_experiences' AS table_name,
       CASE 
           WHEN COUNT(*) >= 7 THEN '✓ OK' 
           ELSE '✗ 缺少列' 
       END AS status,
       STRING_AGG(column_name, ', ' ORDER BY ordinal_position) AS existing_columns
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'master_experiences';

-- 应该包含的列: id, user_id, category, latest_version_id, is_archived, created_at, updated_at

-- ============================================================
-- 6. 检查 experience_versions 表
-- ============================================================
SELECT 'experience_versions' AS table_name,
       CASE 
           WHEN COUNT(*) >= 13 THEN '✓ OK' 
           ELSE '✗ 缺少列' 
       END AS status,
       STRING_AGG(column_name, ', ' ORDER BY ordinal_position) AS existing_columns
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'experience_versions';

-- 应该包含的列: id, master_experience_id, version, title, org, location, start_date, end_date, is_current, summary, highlights, star, created_at

-- ============================================================
-- 7. 检查 resume_experiences 表
-- ============================================================
SELECT 'resume_experiences' AS table_name,
       CASE 
           WHEN COUNT(*) >= 6 THEN '✓ OK' 
           ELSE '✗ 缺少列' 
       END AS status,
       STRING_AGG(column_name, ', ' ORDER BY ordinal_position) AS existing_columns
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'resume_experiences';

-- 应该包含的列: id, resume_id, experience_version_id, display_order, overrides_json, created_at

-- ============================================================
-- 8. 检查 skills 表
-- ============================================================
SELECT 'skills' AS table_name,
       CASE 
           WHEN COUNT(*) >= 3 THEN '✓ OK' 
           ELSE '✗ 缺少列' 
       END AS status,
       STRING_AGG(column_name, ', ' ORDER BY ordinal_position) AS existing_columns
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'skills';

-- 应该包含的列: id, name, category

-- ============================================================
-- 9. 检查 user_skills 表
-- ============================================================
SELECT 'user_skills' AS table_name,
       CASE 
           WHEN COUNT(*) >= 4 THEN '✓ OK' 
           ELSE '✗ 缺少列' 
       END AS status,
       STRING_AGG(column_name, ', ' ORDER BY ordinal_position) AS existing_columns
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'user_skills';

-- 应该包含的列: id, user_id, skill_id, proficiency

-- ============================================================
-- 10. 检查 experience_version_skills 表
-- ============================================================
SELECT 'experience_version_skills' AS table_name,
       CASE 
           WHEN COUNT(*) >= 2 THEN '✓ OK' 
           ELSE '✗ 缺少列' 
       END AS status,
       STRING_AGG(column_name, ', ' ORDER BY ordinal_position) AS existing_columns
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'experience_version_skills';

-- 应该包含的列: experience_version_id, skill_id

-- ============================================================
-- 11. 检查 resume_skills 表
-- ============================================================
SELECT 'resume_skills' AS table_name,
       CASE 
           WHEN COUNT(*) >= 4 THEN '✓ OK' 
           ELSE '✗ 缺少列' 
       END AS status,
       STRING_AGG(column_name, ', ' ORDER BY ordinal_position) AS existing_columns
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'resume_skills';

-- 应该包含的列: id, resume_id, skill_name_snapshot, position

-- ============================================================
-- 12. 检查 certifications 表
-- ============================================================
SELECT 'certifications' AS table_name,
       CASE 
           WHEN COUNT(*) >= 11 THEN '✓ OK' 
           ELSE '✗ 缺少列' 
       END AS status,
       STRING_AGG(column_name, ', ' ORDER BY ordinal_position) AS existing_columns
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'certifications';

-- 应该包含的列: id, user_id, name, issuer, issue_date, expiry_date, credential_id, credential_url, description, created_at, updated_at

-- ============================================================
-- 13. 检查 feedback 表
-- ============================================================
SELECT 'feedback' AS table_name,
       CASE 
           WHEN COUNT(*) >= 7 THEN '✓ OK' 
           ELSE '✗ 缺少列' 
       END AS status,
       STRING_AGG(column_name, ', ' ORDER BY ordinal_position) AS existing_columns
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'feedback';

-- 应该包含的列: id, user_id, category, content, contact, context_json, created_at

-- ============================================================
-- 详细列检查：查看每个表的所有列
-- ============================================================
SELECT 
    table_name,
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN (
      'users', 'profiles', 'profile_links', 'resumes', 
      'master_experiences', 'experience_versions', 'resume_experiences',
      'skills', 'user_skills', 'experience_version_skills', 
      'resume_skills', 'certifications', 'feedback'
  )
ORDER BY table_name, ordinal_position;
