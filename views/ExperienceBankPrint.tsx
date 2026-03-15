import React from 'react';
import type { Certification } from '../services/certificationsService';
import type { ExperienceListItem } from '../services/experienceService';
import type { Profile } from '../services/profileService';
import type { UserSkill } from '../services/skillsService';
import { buildExperienceDate, formatYearMonth } from '../utils/dateUtils';
import { buildEduCardData, buildEducationDateLabel } from '../utils/educationUtils';
import { buildExperienceBankExportDateLabel } from '../utils/exportFilename';
import { stripRichTextToText } from '../utils/richText';
import { parseYearMonthValue } from './experienceUtils';
import { resolveLinkedInLink } from './profileUtils';
import { CERT_META_PREFIX } from './ResumeEditor/constants';

const ST_SEPARATOR = '； ';

const normalizePlainText = (value: unknown) => {
  if (value === null || value === undefined) {
    return '';
  }
  const raw = String(value);
  return stripRichTextToText(raw).replace(/\s+/g, ' ').trim();
};

// 导出规则：ST 同行、A/R 分行，且不输出字母标签。
const buildStarLines = (star?: Record<string, any>) => {
  const s = normalizePlainText(star?.s);
  const t = normalizePlainText(star?.t);
  const a = normalizePlainText(star?.a);
  const r = normalizePlainText(star?.r);
  const stLine = [s, t].filter(Boolean).join(ST_SEPARATOR);
  return [stLine, a, r].filter(Boolean);
};

const buildExperienceDateLabel = (item: ExperienceListItem) => {
  const version = item.latest_version;
  return buildExperienceDate(
    version?.start_date,
    version?.end_date,
    version?.is_current
  );
};

const sortByStartDateDesc = (items: ExperienceListItem[]) => {
  return [...items].sort((a, b) => {
    const valueA = parseYearMonthValue(a.latest_version?.start_date) ?? -1;
    const valueB = parseYearMonthValue(b.latest_version?.start_date) ?? -1;
    return valueB - valueA;
  });
};

const formatCertDate = (value?: string | null) => {
  if (!value) {
    return '';
  }
  return formatYearMonth(value);
};

const resolveCertificationDescription = (description?: string | null) => {
  const normalized = normalizePlainText(description);
  if (!normalized) {
    return '';
  }
  if (normalized.startsWith(CERT_META_PREFIX)) {
    return '';
  }
  return normalized;
};

const buildCertDateLabel = (cert: Certification) => {
  const issue = formatCertDate(cert.issue_date);
  const expiry = formatCertDate(cert.expiry_date);
  return [issue, expiry].filter(Boolean).join(' - ');
};

const buildSkillGroups = (skills: UserSkill[]) => {
  const map = new Map<string, string[]>();
  skills.forEach((skill) => {
    const category = skill.category?.trim() || '未分类';
    const list = map.get(category) ?? [];
    list.push(skill.name);
    map.set(category, list);
  });
  return Array.from(map.entries())
    .map(([name, list]) => ({
      name,
      skills: list.filter(Boolean),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
};

const SectionTitle: React.FC<{ title: string }> = ({ title }) => (
  <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-gray-600 border-b border-gray-200 pb-2">
    {title}
  </h2>
);

const SectionWrapper: React.FC<{
  title: string;
  children: React.ReactNode;
}> = ({ title, children }) => (
  <section className="space-y-3">
    <SectionTitle title={title} />
    {children}
  </section>
);

const ExperienceItem: React.FC<{ item: ExperienceListItem }> = ({ item }) => {
  const version = item.latest_version;
  if (!version) {
    return null;
  }
  const org = normalizePlainText(version.org);
  const title = normalizePlainText(version.title);
  const dateLabel = buildExperienceDateLabel(item);
  const starLines = buildStarLines(version.star);

  return (
    <div className="rf-break-avoid space-y-2 border-b border-gray-200 pb-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-gray-900 truncate">
            {org || title || '未命名经历'}
          </div>
          {org && title ? (
            <div className="text-xs text-gray-600 mt-0.5 truncate">{title}</div>
          ) : null}
        </div>
        {dateLabel ? (
          <div className="text-xs text-gray-500 whitespace-nowrap">{dateLabel}</div>
        ) : null}
      </div>

      {starLines.length > 0 ? (
        <div className="space-y-1 text-xs text-gray-800 leading-relaxed">
          {starLines.map((line, index) => (
            <div key={`${item.master.id}-star-${index}`}>{line}</div>
          ))}
        </div>
      ) : null}
    </div>
  );
};

const EducationItem: React.FC<{ item: ExperienceListItem }> = ({ item }) => {
  const data = buildEduCardData(item);
  const dateLabel = buildEducationDateLabel(data);
  const detailLines = [
    data.degree ? `学位：${data.degree}` : '',
    data.gpa ? `绩点：${data.gpa}` : '',
    data.courses ? `课程：${data.courses}` : '',
  ].filter(Boolean);

  return (
    <div className="rf-break-avoid space-y-2 border-b border-gray-200 pb-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-sm font-semibold text-gray-900">
            {data.school || '未命名学校'}
          </div>
          {data.major ? (
            <div className="text-xs text-gray-600 mt-0.5">{data.major}</div>
          ) : null}
        </div>
        {dateLabel ? (
          <div className="text-xs text-gray-500 whitespace-nowrap">{dateLabel}</div>
        ) : null}
      </div>
      {detailLines.length > 0 ? (
        <div className="space-y-1 text-xs text-gray-700 leading-relaxed">
          {detailLines.map((line, index) => (
            <div key={`${item.master.id}-edu-${index}`}>{line}</div>
          ))}
        </div>
      ) : null}
    </div>
  );
};

const CertificationItem: React.FC<{ cert: Certification }> = ({ cert }) => {
  const dateLabel = buildCertDateLabel(cert);
  const description = resolveCertificationDescription(cert.description);
  const extraLines = [
    cert.credential_id ? `证书编号：${cert.credential_id}` : '',
    cert.credential_url ? `链接：${cert.credential_url}` : '',
    description,
  ].filter(Boolean);

  return (
    <div className="rf-break-avoid space-y-2 border-b border-gray-200 pb-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-sm font-semibold text-gray-900">{cert.name}</div>
          {cert.issuer ? (
            <div className="text-xs text-gray-600 mt-0.5">{cert.issuer}</div>
          ) : null}
        </div>
        {dateLabel ? (
          <div className="text-xs text-gray-500 whitespace-nowrap">{dateLabel}</div>
        ) : null}
      </div>
      {extraLines.length > 0 ? (
        <div className="space-y-1 text-xs text-gray-700 leading-relaxed">
          {extraLines.map((line, index) => (
            <div key={`${cert.id}-extra-${index}`}>{line}</div>
          ))}
        </div>
      ) : null}
    </div>
  );
};

const SkillGroupItem: React.FC<{ name: string; skills: string[] }> = ({
  name,
  skills,
}) => (
  <div className="rf-break-avoid space-y-1">
    <div className="text-xs font-semibold text-gray-700">{name}</div>
    <div className="text-xs text-gray-600 leading-relaxed">
      {skills.join('、')}
    </div>
  </div>
);

export type ExperienceBankPrintProps = {
  profile: Profile | null;
  workItems: ExperienceListItem[];
  projectItems: ExperienceListItem[];
  educationItems: ExperienceListItem[];
  certifications: Certification[];
  skills: UserSkill[];
  exportDateLabel?: string | null;
};

type ProfileField = { label: string; value: string };

const buildProfileFields = (profile: Profile | null): ProfileField[] => {
  if (!profile) {
    return [];
  }
  const fields: ProfileField[] = [];
  if (profile.full_name) fields.push({ label: '姓名', value: profile.full_name });
  if (profile.email) fields.push({ label: '邮箱', value: profile.email });
  if (profile.phone) fields.push({ label: '电话', value: profile.phone });
  if (profile.location) fields.push({ label: '地点', value: profile.location });
  const linkedInUrl = resolveLinkedInLink(profile);
  if (linkedInUrl) {
    fields.push({ label: '链接', value: linkedInUrl });
  }
  return fields;
};

const PrintHeader: React.FC<{ dateLabel: string }> = ({ dateLabel }) => (
  <header className="space-y-2">
    <div className="text-xl font-semibold tracking-wide">经历库导出</div>
    <div className="text-xs text-gray-500">导出日期：{dateLabel}</div>
  </header>
);

const ProfileSection: React.FC<{ fields: ProfileField[] }> = ({ fields }) => {
  if (fields.length === 0) {
    return null;
  }
  return (
    <SectionWrapper title="个人信息">
      <div className="grid grid-cols-2 gap-3 text-xs">
        {fields.map((field, index) => (
          <div key={`profile-${index}`} className="flex gap-2">
            <span className="text-gray-500">{field.label}：</span>
            <span className="text-gray-800">{field.value}</span>
          </div>
        ))}
      </div>
    </SectionWrapper>
  );
};

const ExperienceSectionBlock: React.FC<{
  title: string;
  items: ExperienceListItem[];
}> = ({ title, items }) => {
  if (items.length === 0) {
    return null;
  }
  return (
    <SectionWrapper title={title}>
      <div className="space-y-4">
        {items.map((item) => (
          <ExperienceItem key={item.master.id} item={item} />
        ))}
      </div>
    </SectionWrapper>
  );
};

const EducationSectionBlock: React.FC<{ items: ExperienceListItem[] }> = ({ items }) => {
  if (items.length === 0) {
    return null;
  }
  return (
    <SectionWrapper title="教育经历">
      <div className="space-y-4">
        {items.map((item) => (
          <EducationItem key={item.master.id} item={item} />
        ))}
      </div>
    </SectionWrapper>
  );
};

const CertificationSectionBlock: React.FC<{ items: Certification[] }> = ({ items }) => {
  if (items.length === 0) {
    return null;
  }
  return (
    <SectionWrapper title="证书">
      <div className="space-y-4">
        {items.map((cert) => (
          <CertificationItem key={cert.id} cert={cert} />
        ))}
      </div>
    </SectionWrapper>
  );
};

const SkillSectionBlock: React.FC<{ groups: Array<{ name: string; skills: string[] }> }> = ({ groups }) => {
  if (groups.length === 0) {
    return null;
  }
  return (
    <SectionWrapper title="技能">
      <div className="grid grid-cols-2 gap-3">
        {groups.map((group) => (
          <SkillGroupItem key={group.name} name={group.name} skills={group.skills} />
        ))}
      </div>
    </SectionWrapper>
  );
};

const ExperienceBankPrint: React.FC<ExperienceBankPrintProps> = ({
  profile,
  workItems,
  projectItems,
  educationItems,
  certifications,
  skills,
  exportDateLabel,
}) => {
  const profileFields = buildProfileFields(profile);
  const sortedWork = sortByStartDateDesc(workItems);
  const sortedProject = sortByStartDateDesc(projectItems);
  const sortedEducation = sortByStartDateDesc(educationItems);
  const skillGroups = buildSkillGroups(skills);

  return (
    <div className="rf-print-preview mx-auto w-[210mm] min-h-[297mm] bg-white text-gray-900 px-10 py-8 space-y-8">
      <PrintHeader dateLabel={exportDateLabel || buildExperienceBankExportDateLabel()} />
      <ProfileSection fields={profileFields} />
      <ExperienceSectionBlock title="工作经历" items={sortedWork} />
      <ExperienceSectionBlock title="项目经历" items={sortedProject} />
      <EducationSectionBlock items={sortedEducation} />
      <CertificationSectionBlock items={certifications} />
      <SkillSectionBlock groups={skillGroups} />
    </div>
  );
};

export default ExperienceBankPrint;
