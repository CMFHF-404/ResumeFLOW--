import type {
  ExperienceDraftCardData,
  ExperienceDraftCardDataInput,
} from '../types/experienceDraft';

export const projectExperienceDraftCardData = (
  cardData: ExperienceDraftCardDataInput
): ExperienceDraftCardData => ({
  org: cardData.org,
  title: cardData.title,
  start_date: cardData.start_date,
  end_date: cardData.end_date,
  star: {
    s: cardData.star.s,
    t: cardData.star.t,
    a: cardData.star.a,
    r: cardData.star.r,
  },
});
