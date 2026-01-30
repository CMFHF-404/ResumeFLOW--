-- 检查用户注册数据脚本
-- 在 Supabase SQL Editor 中运行此脚本来查看注册用户的信息

-- 1. 查看所有注册用户
SELECT 
    id AS user_id,
    created_at,
    AGE(NOW(), created_at) AS registered_duration
FROM users
ORDER BY created_at DESC;

-- 2. 查看用户的 profile 信息
SELECT 
    p.user_id,
    p.full_name,
    p.title,
    p.email,
    p.phone,
    p.location,
    p.updated_at,
    u.created_at AS user_created_at
FROM profiles p
LEFT JOIN users u ON p.user_id = u.id
ORDER BY u.created_at DESC;

-- 3. 统计信息
SELECT 
    (SELECT COUNT(*) FROM users) AS total_users,
    (SELECT COUNT(*) FROM profiles) AS total_profiles,
    (SELECT COUNT(*) FROM master_experiences) AS total_experiences,
    (SELECT COUNT(*) FROM certifications) AS total_certifications,
    (SELECT COUNT(*) FROM resumes) AS total_resumes;

-- 4. 检查是否有用户但没有 profile（理论上应该自动创建）
SELECT u.id AS user_without_profile
FROM users u
LEFT JOIN profiles p ON u.id = p.user_id
WHERE p.user_id IS NULL;

-- 5. 查看最近注册的用户详情（最近5个）
SELECT 
    u.id,
    u.created_at,
    p.full_name,
    p.email,
    CASE 
        WHEN p.user_id IS NOT NULL THEN 'Has Profile'
        ELSE 'No Profile'
    END AS profile_status
FROM users u
LEFT JOIN profiles p ON u.id = p.user_id
ORDER BY u.created_at DESC
LIMIT 5;
