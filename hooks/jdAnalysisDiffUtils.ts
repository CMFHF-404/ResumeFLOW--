import { diffJDItemSignatures } from "../utils/resumeHelpers";

export type JDItemDiff = ReturnType<typeof diffJDItemSignatures>;

export const buildEmptyDiff = (): JDItemDiff => ({
  experiences: new Set(),
  certifications: new Set(),
  skills: new Set(),
});

export const cloneDiff = (diff: JDItemDiff): JDItemDiff => ({
  experiences: new Set(diff.experiences),
  certifications: new Set(diff.certifications),
  skills: new Set(diff.skills),
});

export const hasDiff = (diff: JDItemDiff) =>
  diff.experiences.size > 0 ||
  diff.certifications.size > 0 ||
  diff.skills.size > 0;

export const mergeDiffInto = (target: JDItemDiff, incoming: JDItemDiff) => {
  incoming.experiences.forEach((id) => target.experiences.add(id));
  incoming.certifications.forEach((id) => target.certifications.add(id));
  incoming.skills.forEach((id) => target.skills.add(id));
};

export const clearDiffTargets = (target: JDItemDiff, toClear: JDItemDiff) => {
  toClear.experiences.forEach((id) => target.experiences.delete(id));
  toClear.certifications.forEach((id) => target.certifications.delete(id));
  toClear.skills.forEach((id) => target.skills.delete(id));
};

export const subtractDiff = (source: JDItemDiff, toRemove: JDItemDiff): JDItemDiff => ({
  experiences: new Set(
    [...source.experiences].filter((id) => !toRemove.experiences.has(id))
  ),
  certifications: new Set(
    [...source.certifications].filter((id) => !toRemove.certifications.has(id))
  ),
  skills: new Set([...source.skills].filter((id) => !toRemove.skills.has(id))),
});

export const mergeDiffs = (...diffs: JDItemDiff[]) => {
  const merged = buildEmptyDiff();
  diffs.forEach((diff) => mergeDiffInto(merged, diff));
  return merged;
};
