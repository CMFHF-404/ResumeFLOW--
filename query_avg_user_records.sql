-- 文件路径: d:\ResumeFLOW项目\query_avg_user_records.sql

-- 统计每个用户的经历记录（工作 + 项目）、技能CARD记录与证书的数量，并求平均值
WITH UserStats AS (
    SELECT 
        u.id AS user_id,
        -- 统计该用户的工作和项目经历数量（排除已归档的记录）
        COUNT(DISTINCT CASE WHEN me.category IN ('work', 'project') AND me.is_archived = false THEN me.id END) AS work_project_count,
        -- 统计该用户的技能CARD数量
        COUNT(DISTINCT us.id) AS skill_count,
        -- 统计该用户的证书数量
        COUNT(DISTINCT c.id) AS cert_count
    FROM 
        users u
    LEFT JOIN 
        master_experiences me ON u.id = me.user_id
    LEFT JOIN 
        user_skills us ON u.id = us.user_id
    LEFT JOIN 
        certifications c ON u.id = c.user_id
    GROUP BY 
        u.id
)
SELECT 
    ROUND(AVG(work_project_count), 2) AS avg_work_project_count,
    ROUND(AVG(skill_count), 2) AS avg_skill_count,
    ROUND(AVG(cert_count), 2) AS avg_cert_count,
    ROUND(AVG(work_project_count + skill_count + cert_count), 2) AS avg_total_records_per_user
FROM 
    UserStats;
