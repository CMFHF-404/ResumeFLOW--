import { stripRichTextToText } from './richText';

type SmartCompleteExperiencePromptInput = {
  jdText?: string;
  org: string;
  title: string;
  startDate?: string;
  endDate?: string;
  isCurrent?: boolean;
  star: {
    s?: string;
    t?: string;
    a?: string;
    r?: string;
  };
};

const resolveDateRange = (startDate?: string, endDate?: string, isCurrent?: boolean) => (
  `${startDate || '未填写'} - ${endDate || (isCurrent ? '至今' : '未填写')}`
);

export const buildSmartCompleteAssistantPrompt = ({
  jdText,
  org,
  title,
  startDate,
  endDate,
  isCurrent,
  star,
}: SmartCompleteExperiencePromptInput) => (
  `请按智能补全模式处理这段经历：先诊断当前 STAR 内容是否足够支撑目标 JD；如果证据不足，只围绕当前这段经历内真实、可能可补充的事实追问 0-3 个问题，不要询问其他项目、课程项目、个人练习、专业背景或非本项目案例，也不要为了凑数量编问题；如果当前经历明显没有相关素材，请直接说明差距，不要要求我提供无关经历。不要急着生成成稿，等我补充或确认后再输出可确认的经历卡片。\n\n目标 JD：${jdText || '未填写'}\n\n组织/项目：${org || '未填写'}\n角色：${title || '未填写'}\n时间：${resolveDateRange(startDate, endDate, isCurrent)}\nS：${stripRichTextToText(star.s ?? '') || '未填写'}\nT：${stripRichTextToText(star.t ?? '') || '未填写'}\nA：${stripRichTextToText(star.a ?? '') || '未填写'}\nR：${stripRichTextToText(star.r ?? '') || '未填写'}`
);
