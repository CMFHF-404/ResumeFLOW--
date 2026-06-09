import type { Profile } from '../../services/profileService';
import type { ExperienceBankPdfRenderSnapshot } from '../../types/experienceBankExport';
import { resolveLinkedInLink } from '../profileUtils';

const sortById = <T extends { id: string }>(items: T[]) => (
  [...items].sort((left, right) => left.id.localeCompare(right.id))
);

export const buildExperienceBankSummaryPayload = (
  profile: Profile | null,
  snapshot: ExperienceBankPdfRenderSnapshot
) => ({
  mode: 'bank' as const,
  profile: {
    name: profile?.full_name || '',
    email: profile?.email || '',
    phone: profile?.phone || '',
    location: profile?.location || '',
    linkedin: profile ? resolveLinkedInLink(profile) : '',
  },
  workExperiences: sortById(snapshot.workItems.map((item) => ({
    id: item.master.id,
    title: item.latest_version?.title || '',
    org: item.latest_version?.org || '',
    start_date: item.latest_version?.start_date,
    end_date: item.latest_version?.end_date,
    is_current: item.latest_version?.is_current ?? false,
    star: item.latest_version?.star || {},
    summary: item.latest_version?.summary || '',
  }))),
  projectExperiences: sortById(snapshot.projectItems.map((item) => ({
    id: item.master.id,
    title: item.latest_version?.title || '',
    org: item.latest_version?.org || '',
    start_date: item.latest_version?.start_date,
    end_date: item.latest_version?.end_date,
    is_current: item.latest_version?.is_current ?? false,
    star: item.latest_version?.star || {},
    summary: item.latest_version?.summary || '',
  }))),
  educationExperiences: sortById(snapshot.educationItems.map((item) => ({
    id: item.master.id,
    school: item.latest_version?.org || '',
    major: item.latest_version?.title || '',
    start_date: item.latest_version?.start_date,
    end_date: item.latest_version?.end_date,
    is_current: item.latest_version?.is_current ?? false,
    summary: item.latest_version?.summary || '',
    star: item.latest_version?.star || {},
  }))),
  certifications: sortById(snapshot.certifications.map((cert) => ({
    id: cert.id,
    name: cert.name,
    issuer: cert.issuer || '',
    issue_date: cert.issue_date || '',
  }))),
  skills: sortById(snapshot.skills.map((skill) => ({
    id: skill.id,
    name: skill.name,
    category: skill.category || '',
  }))),
});
