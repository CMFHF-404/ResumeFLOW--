"""One semantic score contract used by generation and independent auditing.

These anchors guide evidence judgments; they never assign marks by keywords.
"""
RUBRIC_VERSION = 'resume_evidence_anchors_v4_3'

STAR_ASSESSMENTS = {
    'Situation情境': {'clear_context':15, 'partial_context':8, 'absent':0},
    'Task任务': {'clear_task':15, 'partial_task':8, 'absent':0},
    'Action行动': {'concrete_action':35, 'partial_action':18, 'generic_role_only':10, 'absent':0},
    'Result结果': {'clear_result':35, 'partial_result':18, 'generic_completion':10, 'absent':0},
}

SHARED_RUBRIC = """
AUTHORITATIVE EVIDENCE AND CALIBRATION CONTRACT:
Judge the actual claim against its named criterion, not an imagined ideal applicant.
Full credit means the criterion is met, not that the work is unusually impressive.

Professional expression: assess each selected experience separately for each of
the five 20-point criteria, then average those criterion scores and round_half_up.
Use 20=met; 15=localized minor defect; 10=material defect in some statements;
5=predominantly generic/ambiguous; 0=no qualifying evidence or contradiction.
Material (10) requires a mixture of criterion-satisfying substance and actual
defects; it is not an alternative for an experience consisting entirely of vague
role placeholders. For that criterion, all or nearly all generic statements use
predominantly_vague (5). Minor (15) requires only a localized defect with the rest
meeting the criterion. Cite the actual mixture when claiming partial attainment.
Concrete actions such as interviewing administrators, organizing feedback and
writing requirements can earn 20 for action verbs. Accurate ordinary work terms
can earn 20 for terminology. Assess terminology correctness, never its density,
sophistication, JD keyword coverage or presence of named methodologies.
An explicit action and object can earn 20 for precision without numbers or length.
A clearly stated personal task, including support/collaboration, can earn 20 for
responsibility without leadership, project ownership, originality or sole credit.
Bounded, non-contradictory wording can earn 20 for objectivity without independent
verification, business numbers or impressive outcomes. User-claimed evidence is
eligible; it limits evaluation confidence, not these wording marks. Actual vague
actions, inflated responsibility, contradictions or exclusive causal claims DO
lose marks with specific cited defects. A repetitive summary belongs to readability;
it does not erase concrete experience evidence. An actual exaggerated summary
claim still affects objectivity and the existing exaggerated-claim safety cap.

Readability: terminal punctuation alone belongs to 语法与自然度, not professional
expression or sentence clarity. If otherwise grammatical complete prose only lacks
terminal punctuation, deduct 1 point per affected prose item, capped at 3 of 15.
Do not deduct all 15 for punctuation. Labels, fragments, URLs and permitted markup
are not prose punctuation defects. Other genuine grammar defects are judged
separately; do not charge the same defect again in another subscore/dimension.

Content completeness / 求职方向 (10): judge evidence in the CURRENT RESUME.
A named intended function/role or a coherent summary plus work titles that clearly
establish that function earns 10; a broad industry/domain without a clear function
earns 5; no identifiable direction or conflicting directions earns 0. A separate
intent field, exact JD title match, seniority or more ambitious role is NOT required.
The externally supplied target_role/JD alone is not resume evidence. If role titles
and summary together specify product requirements and delivery as product work,
that is a clear function even without the literal words 求职意向. Cite actual fields.
Other completeness items count present eligible facts, not their sophistication:
basic name/email/phone coverage; education school/major/degree coverage; core
experience presence; title/org/start/end field coverage; selected skills (15) or
certifications alone (8); supplementary selected project or certification (5).
Calibration preserves the model's semantic direction judgment; it does not require
a special field or automatically infer it from the requested target role.

STAR: an existing qualitative deliverable, acceptance or deployment is a Result.
Absence of numbers does not mean absent Result, Action, Task or Situation. Judge
their substantive evidence separately from numeric coverage; invent no facts.
Action is substantive work performed, not merely the existence of a nonempty A
field. Repeated role labels or unspecified "related work" without identifiable
actions and objects cannot justify near-full Action credit. Explain the limited
substance using the actual text. Simple but concrete work may earn full credit;
do not demand senior responsibilities, named methods, metrics or longer wording.
Assess STAR execution detail separately from professional word choice; if both
lose credit, bind each deduction to its distinct criterion-specific missing detail,
not the same vague statement copied as two identical reasons.
For each experience classify each STAR component before assigning marks:
clear_context means an identifiable actual problem or operating context;
partial_context provides some context but leaves its concrete meaning incomplete.
clear_task identifies the intended task/goal; partial_task gives only a partly
specified task. concrete_action identifies what was done and to what/whom, with
enough execution detail to understand the work; ordinary work can qualify without
named methods, numbers or leadership. partial_action has identifiable executed
work but leaves its execution or object materially incomplete. generic_role_only
contains only role labels/responsibility placeholders, even if repeated at length;
it is not partial_action. absent means no evidence of that component.
clear_result identifies an actual delivered/accepted/deployed qualitative or
quantitative outcome, preserving its subject and attribution restrictions;
partial_result identifies an outcome whose meaning is materially incomplete;
generic_completion merely asserts completion without identifying what resulted.
Read all current STAR fields of the SAME experience, not just the matching field;
a result already stated in Action is still a result. Do not borrow another
experience's component or treat a hoped-for result as an achieved outcome.
Use the fixed component points below and average each component across experiences
with round_half_up. Do not choose an arbitrary score inside an assessment category.

Quantification: for EACH of its six criteria, first identify explicit positive
claims that semantically support THAT criterion; then count distinct supported
selected experiences / all selected experiences * maxScore, using round_half_up.
Do not grade rhetorical strength or replace this coverage fraction with an arbitrary
completion level. A numerator of zero earns zero. Cite every supporting experience.
结果指标: achieved numeric business outcome, not a task count.
基线与前后对比: comparable before/after outcome values with compatible units.
覆盖规模: actual business/service rollout or usage reach (people/accounts/channels),
not research/interview sample size or document counts. Research sample counts
support process quantity; they support business reach only if the text explicitly
states that those people/accounts also used or received the delivered service.
时间窗口: measurement/observation duration, not employment/calendar dates.
过程数量: explicit counted action/deliverable (e.g. 15 interviews, 20 feedback items).
数据可信度: any eligible quantitative claim with clear measure, scope and attribution,
including a clear process count; independent verification or business impact is NOT
required. With no quantitative claim it earns zero, without doubting qualitative
facts or deducting professional objectivity. Process-only numbers do not earn result
metric/baseline credit, but must not lose their process or credibility credit merely
for not being business results. Calendar dates, contact numbers, identifiers, GPA,
negated/hypothetical values and counts of resume entries never earn numeric credit.
A disclosed concurrent intervention/attribution limitation is honest evidence, not
a credibility defect. Missing business numbers cannot be deducted again elsewhere.
The server counts eligible cited facts and normalizes arithmetic. Audit whether
those facts actually support the criterion; do not automatically trust a calibrated
score, or reject its fraction merely because it differs from a generic anchor.
""".strip() + '\nSTAR_ASSESSMENT_POINTS: ' + repr(STAR_ASSESSMENTS)
