from __future__ import annotations

import json
import unittest
from unittest.mock import AsyncMock, patch

from app.domain.ai.public_errors import AiProviderPayloadError
from app.domain.resume_optimization.context_service import FrozenOptimizationContext
from app.domain.resume_optimization.normalizers import (
    OptimizationPlanNormalizationError,
    action_markdown_rendered_marker_indices,
    normalize_action_paragraph_endings,
    normalize_optimization_plan,
)
from app.domain.resume_optimization.planner_service import (
    OptimizationAnswerRewriteNormalizationError,
    _plan_resume_optimization_v3 as plan_resume_optimization,
    rewrite_answered_modules,
)
from app.domain.resume_optimization.prompts import (
    ANSWER_REWRITE_SYSTEM_PROMPT,
    OPTIMIZATION_SYSTEM_PROMPT,
)
from app.domain.resume_optimization.safety import verify_plan_changes
from app.domain.resume_optimization.schemas import (
    OptimizationAction,
    OptimizationAnswer,
    OptimizationPlan,
)


SELECTED_ID = "exp-selected"
OTHER_ID = "exp-other"
SECOND_SELECTED_ID = "exp-second-selected"


def _change(issue_id: str = "I1", **overrides):
    value = {
        "changeId": f"CHG_{issue_id}",
        "issueIds": [issue_id],
        "dimension": "STAR应用",
        "moduleType": "experience_star",
        "moduleId": SELECTED_ID,
        "fieldPath": "star.a",
        "actionKind": "rewrite_now",
        "scope": "general",
        "beforeValue": "参与交付",
        "generalValue": "完成已明确的交付工作",
        "targetedValue": "完成已明确的交付工作",
        "sourceRefs": [f"/currentResume/experiences/{SELECTED_ID}/star/a"],
        "introducedTerms": [],
        "rationale": "重组已有事实",
        "expectedScoreGain": 3,
        "defaultSelected": True,
    }
    value.update(overrides)
    return value


def _question(**overrides):
    value = {
        "questionId": "Q1",
        "moduleId": SELECTED_ID,
        "fieldPath": "star.r",
        "text": "是否有可确认的结果？",
        "reason": "不能编造结果",
        "answerType": "single_choice_with_text",
        "choices": [{"value": "no_data", "label": "没有数据"}],
        "affectsChangeIds": ["CHG_I1"],
        "priority": 1,
    }
    value.update(overrides)
    return value


def _unsupported_change(issue_id: str, **overrides):
    value = {
        "changeId": f"CHG_{issue_id}",
        "issueIds": [issue_id],
        "dimension": "内容完整",
        "moduleType": "personal_summary",
        "moduleId": "current_resume",
        "fieldPath": "unsupported",
        "actionKind": "leave_unchanged",
        "scope": "general",
        "beforeValue": None,
        "generalValue": None,
        "targetedValue": None,
        "sourceRefs": [],
        "introducedTerms": [],
        "rationale": "Gate A 不直接修改教育或证书内容",
        "expectedScoreGain": 0,
        "defaultSelected": False,
    }
    value.update(overrides)
    return value


def _normalize(raw, *, issues=None, issue_dimensions=None):
    known_issue_ids = set(issues or {"I1"})
    raw_changes = raw.get("changes", []) if isinstance(raw, dict) else []
    resolved_issue_dimensions = issue_dimensions or {
        issue_id: next(
            (
                change.get("dimension")
                for change in raw_changes
                if issue_id in change.get("issueIds", [])
            ),
            "STAR应用",
        )
        for issue_id in known_issue_ids
    }
    return normalize_optimization_plan(
        raw,
        known_issue_dimensions=resolved_issue_dimensions,
        selected_master_ids={SELECTED_ID},
        selected_skill_ids={"skill-a", "skill-b"},
        current_section_order=["summary", "experience", "skills"],
    )


def _context() -> FrozenOptimizationContext:
    return FrozenOptimizationContext(
        resume_id="resume-1",
        resume_updated_at="2026-09-01T00:00:00+00:00",
        evaluation_signature="evaluation-signature",
        jd_signature="jd-signature",
        target_role="Product Manager",
        evaluation={
            "evaluationVersion": "resume_flow_v1",
            "issues": [
                {
                    "issueId": "I1",
                    "primaryDimension": "STAR应用",
                    "description": "行动层表达不清",
                }
            ],
        },
        current_resume={
            "section_order": ["summary", "experience", "skills"],
            "profile": {
                "name": "Candidate Secret",
                "email": "private@example.com",
                "phone": "+852 5555 0101",
                "linkedin": "linkedin.com/in/private-candidate",
                "location": "Private Location",
            },
            "personal_summary": "Current summary",
            "experiences": {
                SELECTED_ID: {
                    "id": SELECTED_ID,
                    "category": "work",
                    "star": {
                        "s": "参与交付",
                        "t": "参与交付",
                        "a": "参与交付",
                        "r": "参与交付",
                    },
                }
            },
            "skills": [
                {"id": "skill-a", "name": "Discovery"},
                {"id": "skill-b", "name": "Delivery"},
            ],
            "educations": [
                {"id": "edu-1", "school": "Example University", "major": "Design"}
            ],
            "certifications": [
                {"id": "cert-1", "name": "Current Certificate"}
            ],
        },
        selected_source_experiences={
            SELECTED_ID: {
                "id": SELECTED_ID,
                "category": "work",
                "star": {"s": "source S", "t": "source T", "a": "source A", "r": "source R"},
            }
        },
        selected_master_experience_ids=[SELECTED_ID],
        selected_experience_links={SELECTED_ID: {"link_id": "link-1"}},
        bank_suggestion_candidates=[
            {"id": OTHER_ID, "title": "UNSELECTED SECRET", "score": 99}
        ],
        fact_metadata=[
            {
                "fact_id": "FACT_PROFILE",
                "content": "Candidate Secret",
                "source": "/currentResume/profile/name",
            },
            {
                "fact_id": "FACT_EXPERIENCE",
                "content": "参与交付",
                "source": f"/currentResume/experiences/{SELECTED_ID}/star/a",
            },
            {
                "fact_id": "FACT_EDUCATION",
                "content": "Design",
                "source": "/currentResume/educations/0/major",
            },
        ],
    )


class PromptContractTests(unittest.TestCase):
    def test_system_prompt_contains_every_truth_and_output_contract(self) -> None:
        prompt = OPTIMIZATION_SYSTEM_PROMPT.lower()
        required = (
            "only current assembled resume is modified",
            "selected full source versions may supplement the same experience",
            "unselected experiences cannot support a rewrite",
            "do not invent numbers, tools, methods, ownership, causality, courses, or skills",
            "rewrite_now / ask_user / leave_unchanged",
            "maximum five questions",
            "no_data is valid",
            "generalvalue and targetedvalue",
            "each change references issue ids and sourcerefs",
            "six-dimensional report",
            "never generate bank suggestions",
            "education and certification content unchanged",
            "reorder only existing skill and section ids",
        )
        for contract in required:
            with self.subTest(contract=contract):
                self.assertIn(contract, prompt)

    def test_answer_prompt_requires_the_complete_existing_id_set_unchanged(self) -> None:
        prompt = ANSWER_REWRITE_SYSTEM_PROMPT.lower()
        self.assertIn("return every existing changeid unchanged", prompt)
        self.assertIn("do not add new or modify ids", prompt)

    def test_system_prompt_defines_the_read_only_unsupported_issue_sentinel(self) -> None:
        prompt = OPTIMIZATION_SYSTEM_PROMPT.lower()
        for contract in (
            "education, certification, and other unsupported gate a issues",
            "moduletype=personal_summary",
            "moduleid=current_resume",
            "fieldpath=unsupported",
            "actionkind=leave_unchanged",
            "expectedscoregain=0",
            "defaultselected=false",
        ):
            with self.subTest(contract=contract):
                self.assertIn(contract, prompt)

    def test_system_prompt_defines_the_exact_flat_plan_schema(self) -> None:
        prompt = OPTIMIZATION_SYSTEM_PROMPT.lower()
        for contract in (
            r"root object must contain `changes`, `questions`, and `safecleanupcandidates` arrays",
            r"never group\s+changes under action names",
            r"fieldpath must be exactly one of star\.s,\s+star\.t, star\.a, star\.r",
            r"affectschangeids must reference the\s+exact changeid",
            r"only when every covered issue has the same primarydimension",
            r"at most one rewrite_now or ask_user change for each mutable persisted field",
            r"otherwise route the additional issue as leave_unchanged",
        ):
            with self.subTest(contract=contract):
                self.assertRegex(prompt, contract)

    def test_system_prompt_preserves_rich_text_and_repairs_visible_punctuation_only(self) -> None:
        prompt = OPTIMIZATION_SYSTEM_PROMPT
        self.assertIn("preserve allowed rich-text markup", prompt)
        self.assertIn("never treat those markers as stray HTML", prompt)
        self.assertIn("sentence-ending punctuation", prompt)
        self.assertIn('Chinese full stop "。"', prompt)
        self.assertIn("do not use semicolons as list terminators", prompt)


class OptimizationPlanNormalizerTests(unittest.TestCase):
    def assertRejected(self, raw, *, issues=None, issue_dimensions=None):  # noqa: N802
        with self.assertRaises(OptimizationPlanNormalizationError):
            _normalize(
                raw,
                issues=issues,
                issue_dimensions=issue_dimensions,
            )

    def test_normalizes_every_action_paragraph_ending_without_losing_rich_text(self) -> None:
        self.assertEqual(
            normalize_action_paragraph_endings(
                '第一段；\n第二段;<br><strong>第三段</strong>'
            ),
            '第一段。\n第二段。<br><strong>第三段。</strong>',
        )
        self.assertEqual(
            normalize_action_paragraph_endings(
                '<ul><li>第一段；</li><li><em>第二段</em></li></ul>'
            ),
            '<ul><li>第一段。</li><li><em>第二段。</em></li></ul>',
        )

    def test_normalizes_action_punctuation_inside_closing_markup_suffixes(self) -> None:
        cases = {
            '<strong>action;</strong>\u200b': '<strong>action。</strong>\u200b',
            '<strong>action;\u200b</strong>': '<strong>action。\u200b</strong>',
            '<strong>action;</strong><!--note--> \u200b': (
                '<strong>action。</strong><!--note--> \u200b'
            ),
            '<em><strong>action;</strong> \u200b</em><!--note-->': (
                '<em><strong>action。</strong> \u200b</em><!--note-->'
            ),
            'action;<!-- x > y\n hidden -->': 'action。<!-- x > y\n hidden -->',
            '<strong>action;</strong>”': '<strong>action。</strong>”',
            '<strong>action;</strong>&#8203;': '<strong>action。</strong>&#8203;',
            '<p>x</p>&#8203;': '<p>x。</p>&#8203;',
            '<p>x</p>&ZeroWidthSpace;': '<p>x。</p>&ZeroWidthSpace;',
            '<p>x</p>&zwnj;': '<p>x。</p>&zwnj;',
            '<p>x</p>&zwj;': '<p>x。</p>&zwj;',
            '<p>x;</p>\u0085': '<p>x。</p>\u0085。',
            '<p>x;</p>\u001c': '<p>x。</p>\u001c。',
            '<p>x;</p>\u001d': '<p>x。</p>\u001d。',
            '<p>x;</p>\u001e': '<p>x。</p>\u001e。',
            '<p>x;</p>\u001f': '<p>x。</p>\u001f。',
            '<p>x;</p>\u0600': '<p>x。</p>\u0600。',
            '<p>x;</p><!-- x > y -->': '<p>x。</p><!-- x > y -->',
            'x;<!--a-->x<!--b-->': 'x;<!--a-->x。<!--b-->',
            'x;***': 'x;***。',
            '<p>x;</p>*': '<p>x。</p>*。',
            '<p>x;</p>**': '<p>x。</p>**。',
            '<p>x;</p>***': '<p>x。</p>***。',
            '<p>x;</p>__': '<p>x。</p>__。',
            '<p>x;</p>＊＊': '<p>x。</p>＊＊。',
            '<p>x;</p>&#42;': '<p>x。</p>&#42;。',
            '<p>x;</p>&#95;&#95;': '<p>x。</p>&#95;&#95;。',
            '<p>x;</p>&ApplyFunction;': '<p>x。</p>&ApplyFunction;',
            '<p>x;</p>&af;': '<p>x。</p>&af;',
            '<p>x;</p>&InvisibleTimes;': '<p>x。</p>&InvisibleTimes;',
            '<p>x;</p>&it;': '<p>x。</p>&it;',
            '<p>x;</p>&InvisibleComma;': '<p>x。</p>&InvisibleComma;',
            '<p>x;</p>&ic;': '<p>x。</p>&ic;',
            '<strong>x;</strong>&#0008221;': '<strong>x。</strong>&#0008221;',
            '<p>x;</p>&ZEROWIDTHSPACE;': '<p>x。</p>&ZEROWIDTHSPACE;。',
            '<strong>x;</strong>&CloseCurlyDoubleQuote;': '<strong>x。</strong>&CloseCurlyDoubleQuote;',
            '<strong>x;</strong>&CloseCurlyQuote;': '<strong>x。</strong>&CloseCurlyQuote;',
            '<strong>x;</strong>&rdquor;': '<strong>x。</strong>&rdquor;',
            '<strong>x;</strong>&rsquor;': '<strong>x。</strong>&rsquor;',
            '<strong>x;</strong>&CLOSECURLYQUOTE;': '<strong>x;</strong>&CLOSECURLYQUOTE;。',
            '**x;***': '**x;***。',
            '__x;___': '__x;___。',
            '＊＊x;＊＊＊': '＊＊x;＊＊＊。',
            '***x;****': '***x;****。',
            '**x;***<!--end-->': '**x;***。<!--end-->',
            '<strong>**x;***</strong>': '<strong>**x;***。</strong>',
            '<em>**x;**</em><!--note-->***': '<em>**x;**</em><!--note-->***。',
            'x&#133;': 'x。',
            'x&#x00085;': 'x。',
            '<strong>x;</strong>&#146;': '<strong>x。</strong>&#146;',
            '<strong>x;</strong>&#000146;': '<strong>x。</strong>&#000146;',
            '<strong>x;</strong>&#148;': '<strong>x。</strong>&#148;',
            '<strong>x;</strong>&#x00094;': '<strong>x。</strong>&#x00094;',
            '<strong>x;</strong>&nbsp;': '<strong>x。</strong>&nbsp;',
            '<strong>x;</strong>&Tab;': '<strong>x。</strong>&Tab;',
            '<strong>x;</strong>&#9;': '<strong>x。</strong>&#9;',
            '<strong>x;</strong>&#160;': '<strong>x。</strong>&#160;',
            '<strong>x;\t</strong>': '<strong>x。\t</strong>',
            '<strong>x;\u00a0</strong>': '<strong>x。\u00a0</strong>',
        }
        for before, expected in cases.items():
            with self.subTest(before=before):
                self.assertEqual(normalize_action_paragraph_endings(before), expected)
                self.assertEqual(normalize_action_paragraph_endings(expected), expected)

    def test_normalizes_action_ending_after_html_entity_without_corrupting_entity(self) -> None:
        cases = {
            '<p>行动&nbsp;</p>': '<p>行动&nbsp;。</p>',
            '<p>行动&nbsp;;</p>': '<p>行动&nbsp;。</p>',
            '<p>行动&#160;;</p>': '<p>行动&#160;。</p>',
            '<p>行动”</p>': '<p>行动。”</p>',
            '<p>行动&rdquo;</p>': '<p>行动。&rdquo;</p>',
            '<p>行动&#8221;</p>': '<p>行动。&#8221;</p>',
            '<p>行动&#x201D;</p>': '<p>行动。&#x201D;</p>',
            '<p>行动&rsquo;</p>': '<p>行动。&rsquo;</p>',
            '<p>行动&#8217;</p>': '<p>行动。&#8217;</p>',
            '<p>行动&#x2019;</p>': '<p>行动。&#x2019;</p>',
            '<p>行动&quot;</p>': '<p>行动。&quot;</p>',
            '<p>行动&#34;</p>': '<p>行动。&#34;</p>',
            '<p>行动&#x22;</p>': '<p>行动。&#x22;</p>',
            '<p>行动&apos;</p>': '<p>行动。&apos;</p>',
            '<p>行动&#39;</p>': '<p>行动。&#39;</p>',
            '<p>行动&#x27;</p>': '<p>行动。&#x27;</p>',
            '<p>行动&nbsp;；&rdquo;</p>': '<p>行动&nbsp;。&rdquo;</p>',
            '<p>行动&nbsp;；&apos;</p>': '<p>行动&nbsp;。&apos;</p>',
            '[项目](https://example.com/resume?from=optimizer&lang=zh)': (
                '[项目](https://example.com/resume?from=optimizer&lang=zh)。'
            ),
            '[项目](https://example.com/path_(legacy)?v=1)': (
                '[项目](https://example.com/path_(legacy)?v=1)。'
            ),
            '[查看 [项目]](https://e.test/a_(b)?v=1)': (
                '[查看 [项目]](https://e.test/a_(b)?v=1)。'
            ),
            r'[查看 \]](https://e.test/a_(b)?v=1)': (
                r'[查看 \]](https://e.test/a_(b)?v=1)。'
            ),
        }
        for before, expected in cases.items():
            with self.subTest(before=before):
                self.assertEqual(normalize_action_paragraph_endings(before), expected)

    def test_normalizes_terminal_punctuation_inside_markdown_link_labels(self) -> None:
        cases = {
            '[完成交付；](https://example.com/path;a=1?note=&#59;)': (
                '[完成交付。](https://example.com/path;a=1?note=&#59;)'
            ),
            '[完成交付。](https://example.com/path_(legacy)?v=1)': (
                '[完成交付。](https://example.com/path_(legacy)?v=1)'
            ),
            '[完成交付&#59;](https://example.com/path_(legacy)?v=1)': (
                '[完成交付。](https://example.com/path_(legacy)?v=1)'
            ),
            '[完成交付&#x3B;](https://example.com/path_(legacy)?v=1)': (
                '[完成交付。](https://example.com/path_(legacy)?v=1)'
            ),
            '[完成交付&semi;](https://example.com/path_(legacy)?v=1)': (
                '[完成交付。](https://example.com/path_(legacy)?v=1)'
            ),
            '[完成交付&Semi;](https://example.com/path_(legacy)?v=1)': (
                '[完成交付&Semi;](https://example.com/path_(legacy)?v=1)。'
            ),
            '[完成交付&Period;](https://example.com/path_(legacy)?v=1)': (
                '[完成交付&Period;](https://example.com/path_(legacy)?v=1)。'
            ),
            '[完成交付&#x3002;](https://example.com/path_(legacy)?v=1)': (
                '[完成交付。](https://example.com/path_(legacy)?v=1)'
            ),
            '[完成交付&nbsp;&#59;&rdquo;](https://example.com/path_(legacy)?v=1)': (
                '[完成交付&nbsp;。&rdquo;](https://example.com/path_(legacy)?v=1)'
            ),
            '参考 [查看 [项目]；](https://e.test/a_(b)?v=1)': (
                '参考 [查看 [项目]。](https://e.test/a_(b)?v=1)'
            ),
            '[**项目；**](https://example.com/path_(legacy)?v=1)': (
                '[**项目。**](https://example.com/path_(legacy)?v=1)'
            ),
            '[*项目；*](https://example.com/path_(legacy)?v=1)': (
                '[*项目。*](https://example.com/path_(legacy)?v=1)'
            ),
            '[<strong>项目；</strong>](https://example.com/path_(legacy)?v=1)': (
                '[<strong>项目；</strong>](https://example.com/path_(legacy)?v=1)。'
            ),
            '[项目；](https://e.test "a ) b")': (
                '[项目。](https://e.test "a ) b")'
            ),
            '[项目&#59;](https://e.test "a ( b")': (
                '[项目。](https://e.test "a ( b")'
            ),
            '[a;](https://x\u0085y)': '[a。](https://x\u0085y)',
            '[a;](https://x\u001cy)': '[a。](https://x\u001cy)',
            '[a;](https://x\u001fy)': '[a。](https://x\u001fy)',
            '[a;](https://x\ufeffy)': '[a;](https://x\ufeffy)。',
            '[a;](https://x\u00a0y)': '[a;](https://x\u00a0y)。',
            '[a;](https://x\u0085"title")': '[a。](https://x\u0085"title")',
            '[a;](https://x\ufeff"title")': '[a。](https://x\ufeff"title")',
            '[a;](https://x\u00a0"title")': '[a。](https://x\u00a0"title")',
        }
        for before, expected in cases.items():
            with self.subTest(before=before):
                self.assertEqual(normalize_action_paragraph_endings(before), expected)
                self.assertEqual(normalize_action_paragraph_endings(expected), expected)

    def test_normalizes_terminal_punctuation_inside_valid_nested_markdown_link_labels(self) -> None:
        cases = {
            '[*x;**y;***](https://e.test)': (
                '[*x;**y。***](https://e.test)'
            ),
            '[***x;***](https://e.test/a_(b)?v=1)': (
                '[***x。***](https://e.test/a_(b)?v=1)'
            ),
            '[__x;**y;**__](https://e.test "a ) b")': (
                '[__x;**y。**__](https://e.test "a ) b")'
            ),
            '[**x;__y;__**](https://e.test/path_(legacy)?v=1)': (
                '[**x;__y。__**](https://e.test/path_(legacy)?v=1)'
            ),
            '[*x;__y;**z;**__*](https://e.test/a_(b)?v=1)': (
                '[*x;__y;**z。**__*](https://e.test/a_(b)?v=1)'
            ),
        }
        for before, expected in cases.items():
            with self.subTest(before=before):
                self.assertEqual(normalize_action_paragraph_endings(before), expected)
                self.assertEqual(normalize_action_paragraph_endings(expected), expected)

    def test_exposes_renderer_consumed_markers_for_apply_materialization(self) -> None:
        self.assertEqual(
            action_markdown_rendered_marker_indices('*x;**y;***'),
            frozenset({0, 3, 4, 7, 8, 9}),
        )
        self.assertEqual(
            action_markdown_rendered_marker_indices('**__x;__**'),
            frozenset({0, 1, 2, 3, 6, 7, 8, 9}),
        )
        self.assertIsNone(
            action_markdown_rendered_marker_indices('**x;*y;***')
        )
        self.assertIsNone(
            action_markdown_rendered_marker_indices('<strong>**x;**')
        )

    def test_does_not_rebind_invalid_markdown_across_link_or_comment_boundaries(self) -> None:
        cases = {
            '[*x;**y;**](https://e.test)': '[*x;**y;**](https://e.test)。',
            '[**x;**y;***](https://e.test)': '[**x;**y;***](https://e.test)。',
            '[**x;*y;***](https://e.test)': '[**x;*y;***](https://e.test)。',
            '[__x;**y;**_](https://e.test)': '[__x;**y;**_](https://e.test)。',
            '[**x;**<!--c-->*](https://e.test)': (
                '[**x;**<!--c-->*](https://e.test)。'
            ),
            '[项目；<!--c-->x](https://e.test)': (
                '[项目；<!--c-->x](https://e.test)。'
            ),
            '**x;**<!--c-->*': '**x;**<!--c-->*。',
        }
        for before, expected in cases.items():
            with self.subTest(before=before):
                self.assertEqual(normalize_action_paragraph_endings(before), expected)
                self.assertEqual(normalize_action_paragraph_endings(expected), expected)

    def test_action_parentheses_and_brackets_are_content_not_quote_closers(self) -> None:
        cases = {
            "协调团队（含复盘）": "协调团队（含复盘）。",
            "整理清单[含验收项]": "整理清单[含验收项]。",
            "说明【内部版本】": "说明【内部版本】。",
            "参考《交付手册》": "参考《交付手册》。",
        }
        for before, expected in cases.items():
            with self.subTest(before=before):
                self.assertEqual(normalize_action_paragraph_endings(before), expected)

    def test_normalizes_each_nested_action_block(self) -> None:
        self.assertEqual(
            normalize_action_paragraph_endings(
                '<div><p>第一段</p><p><a href="https://e.test">第二段&nbsp;</a></p></div>'
            ),
            '<div><p>第一段。</p><p><a href="https://e.test">第二段&nbsp;。</a></p></div>',
        )

    def test_normalizes_parent_and_child_nested_list_items_at_list_boundaries(self) -> None:
        self.assertEqual(
            normalize_action_paragraph_endings(
                "<ul><li>Parent<ul><li>Child</li></ul></li></ul>"
            ),
            "<ul><li>Parent。<ul><li>Child。</li></ul></li></ul>",
        )

    def test_action_boundaries_ignore_greater_than_inside_quoted_attributes(self) -> None:
        self.assertEqual(
            normalize_action_paragraph_endings(
                '<ul data-x=">"><li title=\'1 > 0\'>第一段</li>'
                '<li data-note="a > b">第二段；</li></ul>'
            ),
            '<ul data-x=">"><li title=\'1 > 0\'>第一段。</li>'
            '<li data-note="a > b">第二段。</li></ul>',
        )

    def test_normalized_plan_canonicalizes_general_and_targeted_action_endings(self) -> None:
        plan = _normalize({
            "changes": [_change(
                generalValue="第一段；\n第二段",
                targetedValue="第一段;<br><strong>第二段</strong>",
            )],
            "questions": [],
        })

        self.assertEqual(plan.changes[0].general_value, "第一段。\n第二段。")
        self.assertEqual(
            plan.changes[0].targeted_value,
            "第一段。<br><strong>第二段。</strong>",
        )

    def test_normalized_action_noop_becomes_non_applicable(self) -> None:
        plan = _normalize({
            "changes": [_change(
                beforeValue="完成任务。",
                generalValue="完成任务;",
                targetedValue="完成任务；",
                expectedScoreGain=5,
                defaultSelected=True,
            )],
            "questions": [],
        })

        change = plan.changes[0]
        self.assertEqual(change.action_kind.value, "leave_unchanged")
        self.assertEqual(change.general_value, change.before_value)
        self.assertEqual(change.targeted_value, change.before_value)
        self.assertEqual(change.expected_score_gain, 0)
        self.assertFalse(change.default_selected)

    def test_rejects_non_object_root(self) -> None:
        for raw in (None, [], "{}"):
            with self.subTest(raw=raw):
                self.assertRejected(raw)

    def test_rejects_duplicate_change_or_question_ids(self) -> None:
        self.assertRejected({"changes": [_change(), _change()], "questions": []})
        ask_change = _change(actionKind="ask_user", generalValue=None, targetedValue=None, sourceRefs=[])
        self.assertRejected(
            {"changes": [ask_change], "questions": [_question(), _question()]}
        )

    def test_rejects_duplicate_ask_user_question_coverage(self) -> None:
        ask_change = _change(
            actionKind="ask_user",
            generalValue=None,
            targetedValue=None,
            sourceRefs=[],
        )
        self.assertRejected({
            "changes": [ask_change],
            "questions": [_question(affectsChangeIds=["CHG_I1", "CHG_I1"])],
        })
        self.assertRejected({
            "changes": [ask_change],
            "questions": [
                _question(),
                _question(questionId="Q2", affectsChangeIds=["CHG_I1"]),
            ],
        })

    def test_rejects_rewrite_changes_with_duplicate_targets(self) -> None:
        self.assertRejected(
            {
                "changes": [_change("I1"), _change("I2")],
                "questions": [],
            },
            issues={"I1", "I2"},
        )

    def test_rejects_an_ask_user_change_sharing_a_rewrite_target(self) -> None:
        ask_change = _change(
            "I2",
            actionKind="ask_user",
            generalValue=None,
            targetedValue=None,
            sourceRefs=[],
        )
        self.assertRejected(
            {
                "changes": [_change("I1"), ask_change],
                "questions": [
                    _question(questionId="Q2", affectsChangeIds=["CHG_I2"]),
                ],
            },
            issues={"I1", "I2"},
        )

    def test_rejects_ask_user_changes_with_duplicate_targets(self) -> None:
        first = _change(
            "I1",
            actionKind="ask_user",
            generalValue=None,
            targetedValue=None,
            sourceRefs=[],
        )
        second = _change(
            "I2",
            actionKind="ask_user",
            generalValue=None,
            targetedValue=None,
            sourceRefs=[],
        )
        self.assertRejected(
            {
                "changes": [first, second],
                "questions": [
                    _question(questionId="Q1", affectsChangeIds=["CHG_I1"]),
                    _question(questionId="Q2", affectsChangeIds=["CHG_I2"]),
                ],
            },
            issues={"I1", "I2"},
        )

    def test_rejects_personal_summary_target_aliases(self) -> None:
        self.assertRejected(
            {
                "changes": [
                    _change(
                        "I1",
                        moduleType="personal_summary",
                        moduleId="personal_summary",
                        fieldPath="personal_summary",
                    ),
                    _change(
                        "I2",
                        moduleType="personal_summary",
                        moduleId="resume",
                        fieldPath="personalSummary",
                    ),
                ],
                "questions": [],
            },
            issues={"I1", "I2"},
        )

    def test_rejects_skills_order_target_aliases(self) -> None:
        base = {
            "moduleType": "skills_order",
            "moduleId": "skills",
            "beforeValue": ["skill-a", "skill-b"],
            "generalValue": ["skill-b", "skill-a"],
            "targetedValue": ["skill-b", "skill-a"],
            "sourceRefs": [],
        }
        self.assertRejected(
            {
                "changes": [
                    _change("I1", **{**base, "fieldPath": "skills.order"}),
                    _change("I2", **{**base, "fieldPath": "selection.skillIds"}),
                ],
                "questions": [],
            },
            issues={"I1", "I2"},
        )

    def test_rejects_section_order_target_aliases(self) -> None:
        base = {
            "moduleType": "section_order",
            "moduleId": "sections",
            "beforeValue": ["summary", "experience", "skills"],
            "generalValue": ["experience", "summary", "skills"],
            "targetedValue": ["experience", "summary", "skills"],
            "sourceRefs": [],
        }
        self.assertRejected(
            {
                "changes": [
                    _change("I1", **{**base, "fieldPath": "section_order"}),
                    _change("I2", **{**base, "fieldPath": "sectionOrder"}),
                ],
                "questions": [],
            },
            issues={"I1", "I2"},
        )

    def test_rejects_unknown_missing_duplicate_or_uncovered_issue_ids(self) -> None:
        self.assertRejected({"changes": [_change(issueIds=[])], "questions": []})
        self.assertRejected({"changes": [_change(issueIds=["UNKNOWN"])], "questions": []})
        self.assertRejected(
            {
                "changes": [_change("I1"), _change("I2", issueIds=["I1"])],
                "questions": [],
            },
            issues={"I1"},
        )
        self.assertRejected(
            {"changes": [_change("I1")], "questions": []},
            issues={"I1", "I2"},
        )

    def test_rejects_change_dimension_outside_fixed_six_dimensions(self) -> None:
        self.assertRejected(
            {"changes": [_change(dimension="任意维度")], "questions": []},
            issue_dimensions={"I1": "STAR应用"},
        )

    def test_rejects_change_dimension_mismatching_its_issue(self) -> None:
        self.assertRejected(
            {"changes": [_change(dimension="STAR应用")], "questions": []},
            issue_dimensions={"I1": "内容可读"},
        )

    def test_rejects_change_combining_issues_from_different_dimensions(self) -> None:
        self.assertRejected(
            {
                "changes": [
                    _change(issueIds=["I1", "I2"], dimension="STAR应用")
                ],
                "questions": [],
            },
            issue_dimensions={"I1": "STAR应用", "I2": "成果量化"},
        )

    def test_rejects_unsupported_selection_changing_module_or_path(self) -> None:
        self.assertRejected(
            {"changes": [_change(fieldPath="selectedMasterExperienceIds")], "questions": []}
        )
        self.assertRejected(
            {"changes": [_change(moduleType="education")], "questions": []}
        )
        self.assertRejected(
            {"changes": [_change(moduleId=OTHER_ID)], "questions": []}
        )

    def test_rejects_unselected_or_cross_project_questions(self) -> None:
        ask_change = _change(actionKind="ask_user", generalValue=None, targetedValue=None, sourceRefs=[])
        self.assertRejected(
            {"changes": [ask_change], "questions": [_question(moduleId=OTHER_ID)]}
        )
        self.assertRejected(
            {
                "changes": [ask_change],
                "questions": [
                    _question(text="在另一个项目中你是否主导过发布？")
                ],
            }
        )

    def test_rejects_more_than_five_questions(self) -> None:
        changes = []
        questions = []
        issues = set()
        for index in range(6):
            issue_id = f"I{index}"
            change_id = f"CHG_{issue_id}"
            issues.add(issue_id)
            changes.append(
                _change(
                    issue_id,
                    changeId=change_id,
                    actionKind="ask_user",
                    generalValue=None,
                    targetedValue=None,
                    sourceRefs=[],
                )
            )
            questions.append(
                _question(
                    questionId=f"Q{index}",
                    affectsChangeIds=[change_id],
                )
            )
        self.assertRejected({"changes": changes, "questions": questions}, issues=issues)

    def test_rejects_oversized_strings_and_empty_rewrite_sources(self) -> None:
        self.assertRejected(
            {"changes": [_change(rationale="x" * 20_001)], "questions": []}
        )
        self.assertRejected(
            {"changes": [_change(sourceRefs=[])], "questions": []}
        )

    def test_rejects_fake_pointer_roots_and_planning_user_answer_refs(self) -> None:
        self.assertRejected(
            {
                "changes": [
                    _change(sourceRefs=["/currentResumeBogus/experiences/exp-selected/star/a"])
                ],
                "questions": [],
            }
        )
        self.assertRejected(
            {
                "changes": [_change(sourceRefs=["/userAnswers/Q1/value"])],
                "questions": [],
            }
        )

    def test_experience_sources_must_resolve_to_the_same_module(self) -> None:
        for source_ref in (
            f"/currentResume/experiences/{OTHER_ID}/star/a",
            f"/selectedSourceExperiences/{OTHER_ID}/star/a",
        ):
            with self.subTest(source_ref=source_ref):
                self.assertRejected(
                    {"changes": [_change(sourceRefs=[source_ref])], "questions": []}
                )

    def test_personal_summary_may_use_multiple_selected_sources(self) -> None:
        raw = {
            "changes": [
                _change(
                    moduleType="personal_summary",
                    moduleId="personal_summary",
                    fieldPath="personal_summary",
                    sourceRefs=[
                        f"/currentResume/experiences/{SELECTED_ID}/star/a",
                        f"/selectedSourceExperiences/{SECOND_SELECTED_ID}/star/r",
                    ],
                )
            ],
            "questions": [],
        }
        plan = normalize_optimization_plan(
            raw,
            known_issue_dimensions={"I1": "STAR应用"},
            selected_master_ids={SELECTED_ID, SECOND_SELECTED_ID},
            selected_skill_ids={"skill-a", "skill-b"},
            current_section_order=["summary", "experience", "skills"],
        )
        self.assertEqual(plan.changes[0].module_type.value, "personal_summary")

    def test_rejects_any_model_generated_bank_suggestion(self) -> None:
        self.assertRejected(
            {
                "changes": [_change()],
                "questions": [],
                "bankSuggestions": [{"suggestionId": "MODEL_BANK"}],
            }
        )

    def test_rejects_both_bank_suggestion_root_aliases_even_when_empty(self) -> None:
        self.assertRejected(
            {
                "changes": [_change()],
                "questions": [],
                "bankSuggestions": [],
                "bank_suggestions": [],
            }
        )

    def test_rejects_invalid_order_arrays_or_new_ids(self) -> None:
        base = {
            "moduleType": "skills_order",
            "moduleId": "skills",
            "fieldPath": "skills.order",
            "beforeValue": ["skill-a", "skill-b"],
            "generalValue": ["skill-b", "skill-a"],
            "targetedValue": ["skill-b", "skill-a"],
            "sourceRefs": [],
        }
        new_target = {**base, "targetedValue": ["skill-a", "skill-new"]}
        self.assertRejected(
            {"changes": [_change(**new_target)], "questions": []}
        )
        invalid_before = {**base, "beforeValue": ["skill-a", "skill-new"]}
        self.assertRejected(
            {"changes": [_change(**invalid_before)], "questions": []}
        )

    def test_generates_deterministic_ids_only_when_missing_and_rejects_collisions(self) -> None:
        raw = {
            "changes": [_change(changeId=None)],
            "questions": [],
        }
        first = _normalize(raw)
        second = _normalize(raw)
        self.assertEqual(first.changes[0].change_id, second.changes[0].change_id)
        self.assertTrue(first.changes[0].change_id.startswith("CHG_"))

        ask_change = _change(
            changeId="CHG_I1",
            actionKind="ask_user",
            generalValue=None,
            targetedValue=None,
            sourceRefs=[],
        )
        question = _question(questionId=None)
        first_question = _normalize({"changes": [ask_change], "questions": [question]})
        second_question = _normalize({"changes": [ask_change], "questions": [question]})
        self.assertEqual(
            first_question.questions[0].question_id,
            second_question.questions[0].question_id,
        )

        generated = first.changes[0].change_id
        self.assertRejected(
            {
                "changes": [
                    _change(changeId=None),
                    _change("I2", changeId=generated),
                ],
                "questions": [],
            },
            issues={"I1", "I2"},
        )

    def test_accepts_safe_plan_and_keeps_no_questions_valid(self) -> None:
        plan = _normalize({"changes": [_change()], "questions": []})
        self.assertEqual([change.issue_ids for change in plan.changes], [["I1"]])
        self.assertEqual(plan.questions, [])
        self.assertEqual(plan.bank_suggestions, [])

    def test_accepts_read_only_sentinels_for_education_and_certification_issues(self) -> None:
        plan = _normalize(
            {
                "changes": [
                    _unsupported_change(
                        "I_EDUCATION",
                        dimension="内容完整",
                        rationale="教育课程描述不属于 Gate A 可改范围",
                    ),
                    _unsupported_change(
                        "I_CERTIFICATION",
                        dimension="内容完整",
                        rationale="证书正文不属于 Gate A 可改范围",
                    ),
                ],
                "questions": [],
            },
            issues={"I_EDUCATION", "I_CERTIFICATION"},
        )
        self.assertEqual(len(plan.changes), 2)
        for change in plan.changes:
            self.assertEqual(change.module_type.value, "personal_summary")
            self.assertEqual(change.module_id, "current_resume")
            self.assertEqual(change.field_path, "unsupported")
            self.assertEqual(change.action_kind.value, "leave_unchanged")
            self.assertFalse(change.default_selected)

    def test_unsupported_sentinel_still_requires_exact_issue_coverage(self) -> None:
        self.assertRejected(
            {
                "changes": [_unsupported_change("I_EDUCATION")],
                "questions": [],
            },
            issues={"I_EDUCATION", "I_CERTIFICATION"},
        )

    def test_rejects_every_unsafe_unsupported_sentinel_variation(self) -> None:
        unsafe_variants = {
            "rewrite": {"actionKind": "rewrite_now"},
            "question": {"actionKind": "ask_user"},
            "before": {"beforeValue": "existing course"},
            "general": {"generalValue": "new course"},
            "targeted": {"targetedValue": "new certificate"},
            "source": {"sourceRefs": ["/currentResume/educations/0/major"]},
            "selected": {"defaultSelected": True},
            "gain": {"expectedScoreGain": 1},
        }
        for label, overrides in unsafe_variants.items():
            with self.subTest(label=label):
                self.assertRejected(
                    {
                        "changes": [
                            _unsupported_change("I_EDUCATION", **overrides)
                        ],
                        "questions": [],
                    },
                    issues={"I_EDUCATION"},
                )


class PlannerServiceTests(unittest.IsolatedAsyncioTestCase):
    async def test_pointer_typo_can_bind_identical_owned_text_but_not_foreign_facts(self):
        snapshot=_context().snapshot_payload()
        snapshot["current_resume"]["experiences"][SECOND_SELECTED_ID]={"star":{"a":"参与交付"}}
        snapshot["selected_source_experiences"][SECOND_SELECTED_ID]={"star":{"a":"source A"}}
        snapshot["selected_master_experience_ids"].append(SECOND_SELECTED_ID)
        raw={"changes":[_change(sourceRefs=[f"/currentResume/experiences/{SECOND_SELECTED_ID}/star/a"])],"questions":[]}
        with patch("app.domain.resume_optimization.planner_service._call_llm",AsyncMock(return_value=raw)):
            result=await plan_resume_optimization(FrozenOptimizationContext(**snapshot))
        self.assertEqual(result.changes[0].source_refs,[f"/currentResume/experiences/{SELECTED_ID}/star/a"])
        snapshot["current_resume"]["experiences"][SECOND_SELECTED_ID]["star"]["a"]="另一段经历的独有事实"
        with patch("app.domain.resume_optimization.planner_service._call_llm",AsyncMock(return_value=raw)):
            with self.assertRaises(OptimizationPlanNormalizationError):
                await plan_resume_optimization(FrozenOptimizationContext(**snapshot))

    async def test_answer_patch_uses_server_identity_and_mirrors_missing_targeted_variant(self):
        context=_context()
        plan=_normalize({"changes":[_change(actionKind="ask_user",generalValue=None,targetedValue=None,sourceRefs=[])],"questions":[_question()]})
        reply={"changes":[{"changeId":"CHANGE_001","actionKind":"rewrite","generalValue":"完成交付工作。","targetedValue":None,"sourceRefs":["/userAnswers/QUESTION_001/value"],"introducedTerms":[],"rationale":"使用补充事实","expectedScoreGain":3}]}
        with patch("app.domain.resume_optimization.planner_service._call_llm",AsyncMock(return_value=reply)):
            changes=await rewrite_answered_modules(context=context,existing_plan=plan,answers=[OptimizationAnswer(question_id="Q1",state="answered",value="完成交付工作。")])
        self.assertEqual(changes[0].action_kind.value,"rewrite_now")
        self.assertEqual(changes[0].general_value,changes[0].targeted_value)
        for key in ("before_value","module_id","field_path","issue_ids","dimension","scope","default_selected"):
            self.assertEqual(getattr(changes[0],key),getattr(plan.changes[0],key))
        self.assertEqual(changes[0].source_refs,["/userAnswers/Q1/value"])

    async def test_generated_answer_choices_cannot_offer_unverified_metrics(self):
        raw={"changes":[_change(actionKind="ask_user",generalValue=None,targetedValue=None,sourceRefs=[])],"questions":[_question(choices=[{"value":"80%","label":"提升80%"}])]}
        with patch("app.domain.resume_optimization.planner_service._call_llm",AsyncMock(return_value=raw)):
            plan=await plan_resume_optimization(_context())
        self.assertEqual([(c.value,c.label) for c in plan.questions[0].choices],[("no_data","暂无可确认的信息")])

    def test_static_order_address_alias_does_not_allow_unselected_ids(self):
        raw=_change(moduleType="skills_order",moduleId="current_resume",fieldPath="skills.order",beforeValue=["skill-a","skill-b"],generalValue=["skill-b","skill-a"],targetedValue=["skill-b","skill-a"],sourceRefs=[])
        self.assertEqual(_normalize({"changes":[raw]}).changes[0].module_id,"skills")
        for invalid in ({**raw,"moduleId":"another_resume"},{**raw,"moduleId":[]},{**raw,"generalValue":["unselected","skill-a"]}):
            with self.assertRaises(OptimizationPlanNormalizationError):_normalize({"changes":[invalid]})

    async def test_summary_can_cite_selected_skill_but_still_requires_semantic_review(self):
        context=_context()
        raw={"changes":[_change(moduleType="personal_summary",moduleId="current_resume",fieldPath="personal_summary",beforeValue="Current summary",generalValue="Discovery",targetedValue="Discovery",sourceRefs=["/currentResume/skills/0/name"])],"questions":[]}
        with patch("app.domain.resume_optimization.planner_service._call_llm",AsyncMock(return_value=raw)):
            plan=await plan_resume_optimization(context)
        checked,_=verify_plan_changes(plan=plan,source_documents=context.source_documents)
        self.assertEqual(checked[0].safety_status,"pending")

    async def test_plan_uses_bounded_json_transport_and_only_model_payload(self) -> None:
        context = _context()
        llm_result = {"changes": [_change()], "questions": []}
        transport = AsyncMock(return_value=llm_result)

        with patch(
            "app.domain.resume_optimization.planner_service._call_llm",
            transport,
        ):
            plan = await plan_resume_optimization(context)

        self.assertEqual(len(plan.changes), 1)
        args, kwargs = transport.call_args
        self.assertTrue(kwargs["json_mode"])
        self.assertEqual(kwargs["request_label"], "resume_optimization_plan")
        self.assertEqual(kwargs["gemini_thinking_level"], "low")
        self.assertEqual(len(args[0]), 2)
        payload = json.loads(args[0][1]["content"])
        minimized_evaluation = payload["context"]["evaluation"]
        self.assertEqual(
            minimized_evaluation["evaluationVersion"],
            context.evaluation["evaluationVersion"],
        )
        self.assertEqual(
            minimized_evaluation["issues"][0]["issueId"],
            "ISSUE_001",
        )
        self.assertEqual(
            minimized_evaluation["issues"][0]["description"],
            "[evaluation text omitted]",
        )
        self.assertEqual(
            payload["context"]["selectedSourceExperiences"],
            context.selected_source_experiences,
        )
        self.assertNotIn("profile", payload["context"]["currentResume"])
        self.assertEqual(
            payload["context"]["currentResume"]["educations"],
            context.current_resume["educations"],
        )
        self.assertEqual(
            payload["context"]["currentResume"]["certifications"],
            context.current_resume["certifications"],
        )
        self.assertEqual(
            [fact["fact_id"] for fact in payload["context"]["factMetadata"]],
            ["FACT_EXPERIENCE", "FACT_EDUCATION"],
        )
        serialized = json.dumps(payload, ensure_ascii=False)
        self.assertNotIn("bankSuggestionCandidates", serialized)
        self.assertNotIn("UNSELECTED SECRET", serialized)
        for pii in (
            "Candidate Secret",
            "private@example.com",
            "+852 5555 0101",
            "linkedin.com/in/private-candidate",
            "Private Location",
        ):
            with self.subTest(pii=pii):
                self.assertNotIn(pii, serialized)
        self.assertEqual(
            payload["allowedSourceRoots"],
            ["/currentResume", "/selectedSourceExperiences", "/userAnswers"],
        )

    async def test_plan_removes_profile_evidence_and_scrubs_copied_profile_pii(self) -> None:
        snapshot = _context().snapshot_payload()
        profile = snapshot["current_resume"]["profile"]
        profile["email"] = "Private@Example.COM"
        profile["phone"] = "+1 (415) 555-2671 ext. 123"
        profile["linkedin"] = (
            "https://www.linkedin.com/in/private-candidate/?trk=public_profile"
        )
        snapshot["current_resume"]["skills"][0]["category"] = profile["location"]
        pii_values = tuple(profile.values())
        pii_variants = (
            profile["name"].lower(),
            profile["email"].lower(),
            "415-555-2671",
            "linkedin.com/in/private-candidate",
            "Ｐｒｉｖａｔｅ Ｌｏｃａｔｉｏｎ",
        )
        snapshot["fact_metadata"] = [
            {
                "fact_id": "FACT_001",
                "content": profile["name"],
                "source": "/currentResume/profile/name",
            },
            {
                "fact_id": "FACT_002",
                "content": profile["email"],
                "source": "/currentResume/profile/email",
            },
            {
                "fact_id": "FACT_006",
                "content": "source A",
                "source": f"/currentResume/experiences/{SELECTED_ID}/star/a",
            },
            {
                "fact_id": "FACT_007",
                "content": profile["location"],
                "source": "/currentResume/skills/0/category",
            },
        ]
        snapshot["evaluation"] = {
            "evaluationVersion": "resume_flow_v1",
            "issues": [
                {
                    "issueId": "I1",
                    "primaryDimension": "STAR应用",
                    "description": (
                        f"请为 {pii_variants[0]} 改写；联系邮箱 {pii_variants[1]}"
                    ),
                    "evidenceIds": ["E_PROFILE_NAME", "E_PROFILE_EMAIL", "E_KEEP"],
                }
            ],
            "evidence": [
                {
                    "evidenceId": "E_PROFILE_NAME",
                    "sourceText": profile["name"],
                    "location": f"resume.profile.name at {pii_variants[4]}",
                    "factId": "FACT_001",
                },
                {
                    "evidenceId": "E_PROFILE_EMAIL",
                    "sourceText": f"Email: {profile['email']}",
                    "location": "resume.profile.email",
                    "factId": "FACT_002",
                },
                {
                    "evidenceId": "E_KEEP",
                    "sourceText": "source A",
                    "location": "resume.experiences[0].star.a",
                    "factId": "FACT_006",
                },
            ],
            "dimensions": [
                {
                    "dimension": "STAR应用",
                    "subscores": [
                        {
                            "name": "行动",
                            "score": 50,
                            "evidenceIds": ["E_PROFILE_NAME", "E_KEEP"],
                        }
                    ],
                    "strengths": [f"电话 {pii_variants[2]}"],
                    "issues": ["I1"],
                    "improvementQuestions": [
                        f"是否更新 {pii_variants[3]}？"
                    ],
                }
            ],
            "riskFlags": [
                {
                    "riskId": "R1",
                    "description": f"候选人位于 {profile['location']}",
                    "evidenceIds": ["E_PROFILE_EMAIL", "E_KEEP"],
                }
            ],
            "topPriorities": [
                {
                    "priority": 1,
                    "recommendation": (
                        f"避免在建议中复制 {profile['name']} 或 {profile['phone']}"
                    ),
                    "evidenceIds": ["E_PROFILE_NAME"],
                }
            ],
        }
        context = FrozenOptimizationContext(**snapshot)
        transport = AsyncMock(return_value={"changes": [_change()], "questions": []})

        with patch(
            "app.domain.resume_optimization.planner_service._call_llm",
            transport,
        ):
            await plan_resume_optimization(context)

        args, _kwargs = transport.call_args
        payload = json.loads(args[0][1]["content"])
        model_context = payload["context"]
        serialized = json.dumps(payload, ensure_ascii=False)
        for pii in pii_values:
            with self.subTest(pii=pii):
                self.assertNotIn(pii, serialized)
        for pii in pii_variants:
            with self.subTest(pii_variant=pii):
                self.assertNotIn(pii, serialized)

        self.assertEqual(
            [fact["fact_id"] for fact in model_context["factMetadata"]],
            ["FACT_006", "FACT_007"],
        )
        self.assertEqual(
            model_context["currentResume"]["skills"][0]["category"],
            "[profile data omitted]",
        )
        self.assertEqual(
            model_context["factMetadata"][1]["content"],
            model_context["currentResume"]["skills"][0]["category"],
        )
        evaluation = model_context["evaluation"]
        self.assertEqual(
            [item["evidenceId"] for item in evaluation["evidence"]],
            ["EVIDENCE_001"],
        )
        self.assertEqual(evaluation["issues"][0]["issueId"], "ISSUE_001")
        self.assertEqual(
            evaluation["issues"][0]["evidenceIds"],
            ["EVIDENCE_001"],
        )
        self.assertEqual(
            evaluation["dimensions"][0]["subscores"][0]["evidenceIds"],
            ["EVIDENCE_001"],
        )
        self.assertEqual(
            evaluation["riskFlags"][0]["evidenceIds"],
            ["EVIDENCE_001"],
        )
        self.assertEqual(evaluation["topPriorities"][0]["evidenceIds"], [])

        referenced_evidence_ids: set[str] = set()

        def collect_evidence_references(value) -> None:
            if isinstance(value, dict):
                for key, nested in value.items():
                    if key == "evidenceIds" and isinstance(nested, list):
                        referenced_evidence_ids.update(nested)
                    else:
                        collect_evidence_references(nested)
            elif isinstance(value, list):
                for nested in value:
                    collect_evidence_references(nested)

        collect_evidence_references(evaluation)
        self.assertLessEqual(referenced_evidence_ids, {"EVIDENCE_001"})

    async def test_profile_redaction_does_not_rewrite_structural_identifiers(self) -> None:
        snapshot = _context().snapshot_payload()
        snapshot["current_resume"]["profile"]["name"] = "A"
        snapshot["current_resume"]["profile"]["location"] = "US"
        snapshot["current_resume"]["profile"]["linkedin"] = " "
        snapshot["target_role"] = "Business Analyst"
        snapshot["current_resume"]["target_role"] = "Business Analyst"
        snapshot["current_resume"]["personal_summary"] = "Business operations leader"
        snapshot["fact_metadata"][0] = {
            "fact_id": "FACT_001",
            "content": "A",
            "source": "/currentResume/profile/name",
        }
        snapshot["evaluation"] = {
            "evaluationVersion": "resume_flow_v1",
            "issues": [
                {
                    "issueId": "I1",
                    "primaryDimension": "STAR应用",
                    "description": "Improve business impact",
                    "evidenceIds": ["E_KEEP"],
                }
            ],
            "evidence": [
                {
                    "evidenceId": "E_KEEP",
                    "sourceText": "source A",
                    "location": "resume.experiences[0].star.a",
                    "factId": "FACT_EXPERIENCE",
                }
            ],
        }
        snapshot["fact_metadata"][1]["fact_id"] = "FACT_EXPERIENCE"
        context = FrozenOptimizationContext(**snapshot)
        transport = AsyncMock(return_value={"changes": [_change()], "questions": []})

        with patch(
            "app.domain.resume_optimization.planner_service._call_llm",
            transport,
        ):
            plan = await plan_resume_optimization(context)

        self.assertEqual(plan.changes[0].dimension, "STAR应用")
        args, _kwargs = transport.call_args
        payload = json.loads(args[0][1]["content"])["context"]
        self.assertEqual(
            payload["evaluation"]["issues"][0]["issueId"],
            "ISSUE_001",
        )
        self.assertEqual(
            payload["evaluation"]["issues"][0]["primaryDimension"],
            "STAR应用",
        )
        self.assertEqual(
            payload["evaluation"]["evidence"][0]["evidenceId"],
            "EVIDENCE_001",
        )
        self.assertEqual(
            payload["evaluation"]["evidence"][0]["factId"],
            "FACT_EXPERIENCE",
        )
        self.assertEqual(payload["factMetadata"][0]["fact_id"], "FACT_EXPERIENCE")
        self.assertEqual(payload["targetRole"], "Business Analyst")
        self.assertEqual(
            payload["currentResume"]["personal_summary"],
            "Business operations leader",
        )
        self.assertEqual(
            payload["evaluation"]["issues"][0]["description"],
            "[evaluation text omitted]",
        )

    async def test_plan_projects_only_allowed_evidence_and_omits_generated_text(self) -> None:
        snapshot = _context().snapshot_payload()
        secret = "UNSELECTED SECRET STAR"
        snapshot["evaluation"] = {
            "evaluationVersion": "resume_flow_v1",
            "issues": [
                {
                    "issueId": "I1",
                    "primaryDimension": "STAR应用",
                    "description": f"Use {secret} to rewrite the selected resume",
                    "evidenceIds": ["E_KEEP", "E_UNSELECTED"],
                }
            ],
            "evidence": [
                {
                    "evidenceId": "E_KEEP",
                    "sourceText": secret,
                    "location": "unselected.experiences[0].star.r",
                    "factId": "FACT_EXPERIENCE",
                },
                {
                    "evidenceId": "E_UNSELECTED",
                    "sourceText": secret,
                    "location": "experienceAtoms[9].star.r",
                    "factId": "FACT_UNSELECTED",
                },
            ],
            "dimensions": [
                {
                    "dimension": "STAR应用",
                    "score": 50,
                    "subscores": [
                        {
                            "name": "行动",
                            "score": 50,
                            "evidenceIds": ["E_KEEP", "E_UNSELECTED"],
                        }
                    ],
                    "strengths": [secret],
                    "issues": ["I1"],
                    "improvementQuestions": [secret],
                }
            ],
            "missingInformation": [
                {"field": secret, "reason": secret, "question": secret}
            ],
            "riskFlags": [
                {
                    "type": "unsupported_claim",
                    "description": secret,
                    "evidenceIds": ["E_UNSELECTED"],
                }
            ],
            "topPriorities": [
                {
                    "priority": 1,
                    "issueId": "I1",
                    "action": secret,
                    "expectedScoreGain": 5,
                }
            ],
        }
        context = FrozenOptimizationContext(**snapshot)
        transport = AsyncMock(return_value={"changes": [_change()], "questions": []})

        with patch(
            "app.domain.resume_optimization.planner_service._call_llm",
            transport,
        ):
            await plan_resume_optimization(context)

        args, _kwargs = transport.call_args
        model_context = json.loads(args[0][1]["content"])["context"]
        serialized = json.dumps(model_context, ensure_ascii=False)
        self.assertNotIn(secret, serialized)
        self.assertNotIn("FACT_UNSELECTED", serialized)
        self.assertNotIn("E_UNSELECTED", serialized)
        self.assertIn("Current summary", serialized)
        self.assertIn("source A", serialized)

        evaluation = model_context["evaluation"]
        self.assertEqual(evaluation["issues"][0]["issueId"], "ISSUE_001")
        self.assertEqual(
            evaluation["issues"][0]["evidenceIds"],
            ["EVIDENCE_001"],
        )
        self.assertEqual(
            evaluation["dimensions"][0]["issues"],
            ["ISSUE_001"],
        )
        self.assertEqual(
            evaluation["dimensions"][0]["subscores"][0]["evidenceIds"],
            ["EVIDENCE_001"],
        )
        self.assertEqual(
            evaluation["topPriorities"][0]["issueId"],
            "ISSUE_001",
        )
        self.assertEqual(
            evaluation["evidence"],
            [
                {
                    "evidenceId": "EVIDENCE_001",
                    "sourceText": "参与交付",
                    "location": (
                        f"/currentResume/experiences/{SELECTED_ID}/star/a"
                    ),
                    "factId": "FACT_EXPERIENCE",
                }
            ],
        )

    async def test_plan_scrubs_limited_name_and_natural_email_aliases(self) -> None:
        snapshot = _context().snapshot_payload()
        snapshot["current_resume"]["profile"]["name"] = "Jane Alice Doe"
        snapshot["current_resume"]["profile"]["email"] = "private@example.com"
        aliased_contact = "Jane led roadmap; contact private at example dot com"
        snapshot["current_resume"]["personal_summary"] = aliased_contact
        snapshot["fact_metadata"].append(
            {
                "fact_id": "FACT_SUMMARY",
                "content": aliased_contact,
                "source": "/currentResume/personal_summary",
            }
        )
        snapshot["evaluation"] = {
            "evaluationVersion": "resume_flow_v1",
            "issues": [
                {
                    "issueId": "I1",
                    "primaryDimension": "STAR应用",
                    "description": "Jane contact: private at example dot com",
                    "evidenceIds": ["E_SUMMARY"],
                }
            ],
            "evidence": [
                {
                    "evidenceId": "E_SUMMARY",
                    "sourceText": aliased_contact,
                    "location": "resume.personal_summary",
                    "factId": "FACT_SUMMARY",
                }
            ],
        }
        context = FrozenOptimizationContext(**snapshot)
        transport = AsyncMock(return_value={"changes": [_change()], "questions": []})

        with patch(
            "app.domain.resume_optimization.planner_service._call_llm",
            transport,
        ):
            await plan_resume_optimization(context)

        args, _kwargs = transport.call_args
        model_context = json.loads(args[0][1]["content"])["context"]
        serialized = json.dumps(model_context, ensure_ascii=False).casefold()
        self.assertNotIn("jane", serialized)
        self.assertNotIn("private@example.com", serialized)
        self.assertNotIn("private at example dot com", serialized)
        self.assertIn("led roadmap", serialized)
        self.assertIn("contact", serialized)
        self.assertEqual(
            model_context["factMetadata"][-1]["content"],
            model_context["currentResume"]["personal_summary"],
        )
        self.assertEqual(
            model_context["evaluation"]["evidence"][0]["sourceText"],
            model_context["currentResume"]["personal_summary"],
        )

    async def test_plan_aliases_provider_generated_graph_ids_and_restores_issue_ids(self) -> None:
        snapshot = _context().snapshot_payload()
        secret_issue_id = "UNSELECTED SECRET STAR"
        secret_evidence_id = "UNSELECTED SECRET EVIDENCE"
        snapshot["evaluation"] = {
            "evaluationVersion": "resume_flow_v1",
            "issues": [
                {
                    "issueId": secret_issue_id,
                    "primaryDimension": "STAR应用",
                    "description": secret_issue_id,
                    "evidenceIds": [secret_evidence_id],
                }
            ],
            "evidence": [
                {
                    "evidenceId": secret_evidence_id,
                    "sourceText": "source A",
                    "location": "resume.experiences[0].star.a",
                    "factId": "FACT_EXPERIENCE",
                }
            ],
            "dimensions": [
                {
                    "dimension": "STAR应用",
                    "subscores": [
                        {
                            "name": "行动",
                            "score": 50,
                            "evidenceIds": [secret_evidence_id],
                        }
                    ],
                    "strengths": [],
                    "issues": [secret_issue_id],
                    "improvementQuestions": [],
                }
            ],
            "topPriorities": [
                {
                    "priority": 1,
                    "issueId": secret_issue_id,
                    "action": secret_issue_id,
                    "expectedScoreGain": 5,
                }
            ],
        }
        context = FrozenOptimizationContext(**snapshot)
        transport = AsyncMock(
            return_value={
                "changes": [
                    _change(
                        changeId="CHG_SAFE",
                        issueIds=["ISSUE_001"],
                    )
                ],
                "questions": [],
            }
        )

        with patch(
            "app.domain.resume_optimization.planner_service._call_llm",
            transport,
        ):
            plan = await plan_resume_optimization(context)

        args, _kwargs = transport.call_args
        model_context = json.loads(args[0][1]["content"])["context"]
        serialized = json.dumps(model_context, ensure_ascii=False)
        self.assertNotIn(secret_issue_id, serialized)
        self.assertNotIn(secret_evidence_id, serialized)
        evaluation = model_context["evaluation"]
        self.assertEqual(evaluation["issues"][0]["issueId"], "ISSUE_001")
        self.assertEqual(
            evaluation["evidence"][0]["evidenceId"],
            "EVIDENCE_001",
        )
        self.assertEqual(
            evaluation["issues"][0]["evidenceIds"],
            ["EVIDENCE_001"],
        )
        self.assertEqual(evaluation["dimensions"][0]["issues"], ["ISSUE_001"])
        self.assertEqual(
            evaluation["topPriorities"][0]["issueId"],
            "ISSUE_001",
        )
        self.assertEqual(plan.changes[0].issue_ids, [secret_issue_id])

    async def test_plan_preserves_business_words_shared_with_name_components(self) -> None:
        cases = (
            ("Grant Lee", "Secured grant funding"),
            ("Grant Lee", "Grant funding supported product delivery"),
            ("Mark Lee", "Established a quality mark for product delivery"),
        )
        for name, original in cases:
            with self.subTest(name=name, original=original):
                snapshot = _context().snapshot_payload()
                snapshot["current_resume"]["profile"]["name"] = name
                snapshot["current_resume"]["experiences"][SELECTED_ID]["star"]["a"] = original
                snapshot["fact_metadata"][1]["content"] = original
                context = FrozenOptimizationContext(**snapshot)
                transport = AsyncMock(return_value={
                    "changes": [_change(
                        actionKind="ask_user",
                        beforeValue=original,
                        generalValue=None,
                        targetedValue=None,
                        sourceRefs=[],
                    )],
                    "questions": [_question()],
                })

                with patch(
                    "app.domain.resume_optimization.planner_service._call_llm",
                    transport,
                ):
                    plan = await plan_resume_optimization(context)

                model_context = json.loads(transport.call_args.args[0][1]["content"])["context"]
                self.assertEqual(
                    model_context["currentResume"]["experiences"][SELECTED_ID]["star"]["a"],
                    original,
                )
                self.assertEqual(model_context["factMetadata"][0]["content"], original)
                self.assertEqual(plan.changes[0].action_kind, OptimizationAction.ASK_USER)
                self.assertEqual(plan.changes[0].before_value, original)
                self.assertEqual(len(plan.questions), 1)
                self.assertEqual(plan.questions[0].affects_change_ids, ["CHG_I1"])

    async def test_plan_preserves_calendar_months_but_protects_name_mentions(self) -> None:
        cases = (
            (
                "Launched onboarding in April 2025",
                "Launched onboarding in April 2025",
                "ask_user",
            ),
            (
                "Launched on 30 April",
                "Launched on 30 April",
                "ask_user",
            ),
            (
                "Delivered in April/May 2025",
                "Delivered in April/May 2025",
                "ask_user",
            ),
            (
                "April led onboarding in April 2025",
                "[profile data omitted] led onboarding in April 2025",
                "leave_unchanged",
            ),
            (
                "April Chen led onboarding in April 2025",
                "[profile data omitted] led onboarding in April 2025",
                "leave_unchanged",
            ),
        )
        for original, expected_model_value, expected_action in cases:
            with self.subTest(original=original):
                snapshot = _context().snapshot_payload()
                snapshot["current_resume"]["profile"]["name"] = "April Chen"
                snapshot["current_resume"]["experiences"][SELECTED_ID]["star"]["a"] = original
                snapshot["fact_metadata"][1]["content"] = original
                context = FrozenOptimizationContext(**snapshot)
                transport = AsyncMock(return_value={
                    "changes": [_change(
                        actionKind="ask_user",
                        beforeValue=original,
                        generalValue=None,
                        targetedValue=None,
                        sourceRefs=[],
                    )],
                    "questions": [_question()],
                })

                with patch(
                    "app.domain.resume_optimization.planner_service._call_llm",
                    transport,
                ):
                    plan = await plan_resume_optimization(context)

                model_context = json.loads(transport.call_args.args[0][1]["content"])["context"]
                self.assertEqual(
                    model_context["currentResume"]["experiences"][SELECTED_ID]["star"]["a"],
                    expected_model_value,
                )
                self.assertEqual(
                    plan.changes[0].action_kind.value,
                    expected_action,
                )
                self.assertEqual(
                    len(plan.questions),
                    1 if expected_action == "ask_user" else 0,
                )

    async def test_plan_distinguishes_bill_and_will_names_from_common_words(self) -> None:
        cases = (
            (
                "Bill Lee",
                "Reduced the bill processing time",
                "Reduced the bill processing time",
                "ask_user",
            ),
            (
                "Will Chen",
                "This change will improve conversion",
                "This change will improve conversion",
                "ask_user",
            ),
            (
                "Will Chen",
                "We will improve conversion",
                "We will improve conversion",
                "ask_user",
            ),
            (
                "Will Chen",
                "It will reduce processing time",
                "It will reduce processing time",
                "ask_user",
            ),
            (
                "Will Chen",
                "This will improve conversion",
                "This will improve conversion",
                "ask_user",
            ),
            (
                "Will Chen",
                "Automation will improve conversion",
                "Automation will improve conversion",
                "ask_user",
            ),
            (
                "Bill Lee",
                "Bill reduced processing time",
                "[profile data omitted] reduced processing time",
                "leave_unchanged",
            ),
            (
                "Will Chen",
                "Will improved conversion",
                "[profile data omitted] improved conversion",
                "leave_unchanged",
            ),
            (
                "Will Chen",
                "Contact: Will",
                "Contact: [profile data omitted]",
                "leave_unchanged",
            ),
            (
                "Will Chen",
                "Contact Will",
                "Contact [profile data omitted]",
                "leave_unchanged",
            ),
            (
                "Will Chen",
                "Will Chen improved conversion",
                "[profile data omitted] improved conversion",
                "leave_unchanged",
            ),
        )
        for name, original, expected_model_value, expected_action in cases:
            with self.subTest(name=name, original=original):
                snapshot = _context().snapshot_payload()
                snapshot["current_resume"]["profile"]["name"] = name
                snapshot["current_resume"]["experiences"][SELECTED_ID]["star"]["a"] = original
                snapshot["fact_metadata"][1]["content"] = original
                context = FrozenOptimizationContext(**snapshot)
                transport = AsyncMock(return_value={
                    "changes": [_change(
                        actionKind="ask_user",
                        beforeValue=original,
                        generalValue=None,
                        targetedValue=None,
                        sourceRefs=[],
                    )],
                    "questions": [_question()],
                })

                with patch(
                    "app.domain.resume_optimization.planner_service._call_llm",
                    transport,
                ):
                    plan = await plan_resume_optimization(context)

                model_context = json.loads(transport.call_args.args[0][1]["content"])["context"]
                self.assertEqual(
                    model_context["currentResume"]["experiences"][SELECTED_ID]["star"]["a"],
                    expected_model_value,
                )
                self.assertEqual(plan.changes[0].action_kind.value, expected_action)
                self.assertEqual(
                    len(plan.questions),
                    1 if expected_action == "ask_user" else 0,
                )

    async def test_plan_preserves_business_words_for_single_word_names(self) -> None:
        cases = (
            (
                "Grace Hopper",
                "Managed the grace period for invoice reconciliation",
                "Managed the grace period for invoice reconciliation",
                "ask_user",
            ),
            (
                "Grace Hopper",
                "Grace improved invoice reconciliation",
                "[profile data omitted] improved invoice reconciliation",
                "leave_unchanged",
            ),
            (
                "May",
                "Delivered the release in May 2025",
                "Delivered the release in May 2025",
                "ask_user",
            ),
            (
                "May",
                "May led the release in May 2025",
                "[profile data omitted] led the release in May 2025",
                "leave_unchanged",
            ),
            (
                "Bill",
                "Reduced the bill processing time",
                "Reduced the bill processing time",
                "ask_user",
            ),
            (
                "Bill",
                "Bill reduced processing time",
                "[profile data omitted] reduced processing time",
                "leave_unchanged",
            ),
            (
                "Will",
                "This change will improve conversion",
                "This change will improve conversion",
                "ask_user",
            ),
            (
                "Will",
                "Will improved conversion",
                "[profile data omitted] improved conversion",
                "leave_unchanged",
            ),
        )
        for name, original, expected_model_value, expected_action in cases:
            with self.subTest(name=name, original=original):
                snapshot = _context().snapshot_payload()
                snapshot["current_resume"]["profile"]["name"] = name
                snapshot["current_resume"]["experiences"][SELECTED_ID]["star"]["a"] = original
                snapshot["fact_metadata"][1]["content"] = original
                context = FrozenOptimizationContext(**snapshot)
                transport = AsyncMock(return_value={
                    "changes": [_change(
                        actionKind="ask_user",
                        beforeValue=original,
                        generalValue=None,
                        targetedValue=None,
                        sourceRefs=[],
                    )],
                    "questions": [_question()],
                })

                with patch(
                    "app.domain.resume_optimization.planner_service._call_llm",
                    transport,
                ):
                    plan = await plan_resume_optimization(context)

                model_context = json.loads(transport.call_args.args[0][1]["content"])["context"]
                self.assertEqual(
                    model_context["currentResume"]["experiences"][SELECTED_ID]["star"]["a"],
                    expected_model_value,
                )
                self.assertEqual(plan.changes[0].action_kind.value, expected_action)
                self.assertEqual(
                    len(plan.questions),
                    1 if expected_action == "ask_user" else 0,
                )

    async def test_name_protection_distinguishes_person_mentions_from_business_words(self) -> None:
        cases = (
            ("Grant Lee", "GRANT LEE secured grant funding", "grant lee", "grant funding"),
            ("Grant Lee", "Grant  Lee secured grant funding", "grant  lee", "grant funding"),
            ("Grant Lee", "Grant\tLee secured grant funding", "grant\tlee", "grant funding"),
            ("Grant Lee", "Grant led the grant funding project", "grant led", "grant funding"),
            ("Grant Lee", "Contact: Grant; secured grant funding", "contact: grant", "grant funding"),
            ("Jane Alice Doe", "Worked with Jane on roadmap", "jane", "roadmap"),
            ("Jane Alice Doe", "Jane's work improved delivery", "jane", "delivery"),
            ("Jane Alice Doe", "Jane successfully led roadmap", "jane", "roadmap"),
            ("Jane Alice Doe", "Jane improved onboarding", "jane", "onboarding"),
            ("Grant Funding Lee", "Grant Funding Lee led research", "grant funding lee", "research"),
        )
        for name, original, private_mention, public_text in cases:
            with self.subTest(original=original):
                snapshot = _context().snapshot_payload()
                snapshot["current_resume"]["profile"]["name"] = name
                snapshot["current_resume"]["experiences"][SELECTED_ID]["star"]["a"] = original
                snapshot["fact_metadata"][1]["content"] = original
                context = FrozenOptimizationContext(**snapshot)
                transport = AsyncMock(return_value={
                    "changes": [_change(beforeValue=original)],
                    "questions": [],
                })

                with patch(
                    "app.domain.resume_optimization.planner_service._call_llm",
                    transport,
                ):
                    plan = await plan_resume_optimization(context)

                model_context = json.loads(transport.call_args.args[0][1]["content"])["context"]
                model_action = model_context["currentResume"]["experiences"][SELECTED_ID]["star"]["a"]
                self.assertNotIn(private_mention, model_action.casefold())
                self.assertIn(public_text, model_action)
                self.assertEqual(plan.changes[0].action_kind, OptimizationAction.LEAVE_UNCHANGED)
                self.assertEqual(plan.changes[0].general_value, original)

    async def test_name_protection_preserves_title_case_business_words(self) -> None:
        cases = (
            (
                "Grant Lee",
                "Grant Lee led research. Grant Funding supported delivery.",
                "grant lee",
                "Grant Funding",
            ),
            (
                "Mark Lee",
                "Mark Lee led research. Quality Mark supported delivery.",
                "mark lee",
                "Quality Mark",
            ),
            (
                "Grace Hopper",
                "Grace Hopper led research. Grace Period improved retention.",
                "grace hopper",
                "Grace Period",
            ),
        )
        for name, original, private_mention, public_text in cases:
            with self.subTest(name=name):
                snapshot = _context().snapshot_payload()
                snapshot["current_resume"]["profile"]["name"] = name
                snapshot["current_resume"]["experiences"][SELECTED_ID]["star"]["a"] = original
                snapshot["fact_metadata"][1]["content"] = original
                context = FrozenOptimizationContext(**snapshot)
                transport = AsyncMock(return_value={
                    "changes": [_change(beforeValue=original)],
                    "questions": [],
                })

                with patch(
                    "app.domain.resume_optimization.planner_service._call_llm",
                    transport,
                ):
                    plan = await plan_resume_optimization(context)

                model_context = json.loads(transport.call_args.args[0][1]["content"])["context"]
                model_action = model_context["currentResume"]["experiences"][SELECTED_ID]["star"]["a"]
                self.assertNotIn(private_mention, model_action.casefold())
                self.assertIn(public_text, model_action)
                self.assertEqual(plan.changes[0].action_kind, OptimizationAction.LEAVE_UNCHANGED)
                self.assertEqual(plan.changes[0].general_value, original)

    async def test_answer_rewrite_preserves_business_words_shared_with_name_components(self) -> None:
        original = "Secured grant funding"
        snapshot = _context().snapshot_payload()
        snapshot["current_resume"]["profile"]["name"] = "Grant Lee"
        snapshot["current_resume"]["experiences"][SELECTED_ID]["star"]["a"] = original
        snapshot["selected_source_experiences"][SELECTED_ID]["star"]["a"] = original
        context = FrozenOptimizationContext(**snapshot)
        existing_plan = _normalize({
            "changes": [_change(
                actionKind="ask_user",
                beforeValue=original,
                generalValue=None,
                targetedValue=None,
                sourceRefs=[],
            )],
            "questions": [_question()],
        })
        rewritten = "Secured grant funding for product research"
        transport = AsyncMock(return_value={"changes": [_change(
            beforeValue=original,
            generalValue=rewritten,
            targetedValue=rewritten,
            sourceRefs=["/userAnswers/Q1/value"],
        )]})

        with patch(
            "app.domain.resume_optimization.planner_service._call_llm",
            transport,
        ):
            changes = await rewrite_answered_modules(
                context=context,
                existing_plan=existing_plan,
                answers=[OptimizationAnswer(question_id="Q1", state="answered", value=rewritten)],
            )

        transport.assert_awaited_once()
        payload = json.loads(transport.call_args.args[0][1]["content"])
        self.assertEqual(
            payload["sourceDocuments"]["currentResume"]["experiences"][SELECTED_ID]["star"]["a"],
            original,
        )
        self.assertEqual(payload["submittedAnswers"][0]["value"], rewritten)
        self.assertEqual(changes[0].action_kind, OptimizationAction.REWRITE_NOW)
        self.assertIn("grant funding", changes[0].general_value)

    async def test_plan_leaves_a_privacy_scrubbed_mutable_target_unchanged(self) -> None:
        original = "Jane led roadmap; contact private at example dot com"
        scrubbed = (
            "[profile data omitted] led roadmap; contact [profile data omitted]"
        )
        snapshot = _context().snapshot_payload()
        snapshot["current_resume"]["profile"]["name"] = "Jane Alice Doe"
        snapshot["current_resume"]["profile"]["email"] = "private@example.com"
        snapshot["current_resume"]["experiences"][SELECTED_ID]["star"]["a"] = original
        snapshot["fact_metadata"][1]["content"] = original
        context = FrozenOptimizationContext(**snapshot)
        transport = AsyncMock(
            return_value={
                "changes": [
                    _change(
                        beforeValue=scrubbed,
                        generalValue=f"{scrubbed}; optimized",
                        targetedValue=f"{scrubbed}; targeted",
                    )
                ],
                "questions": [],
            }
        )

        with patch(
            "app.domain.resume_optimization.planner_service._call_llm",
            transport,
        ):
            plan = await plan_resume_optimization(context)

        change = plan.changes[0]
        self.assertEqual(change.action_kind, OptimizationAction.LEAVE_UNCHANGED)
        self.assertEqual(change.before_value, original)
        self.assertEqual(change.general_value, original)
        self.assertEqual(change.targeted_value, original)
        self.assertFalse(change.default_selected)
        self.assertEqual(change.expected_score_gain, 0)
        self.assertEqual(change.rationale, "目标字段含个人信息，已保持原文不变。")
        self.assertNotIn("Private target", change.rationale)
        self.assertNotIn("[profile data omitted]", change.model_dump_json())

        verified, summary = verify_plan_changes(
            plan=plan,
            source_documents=context.source_documents,
        )
        self.assertEqual(verified[0].action_kind, OptimizationAction.LEAVE_UNCHANGED)
        self.assertEqual(verified[0].safety_status, "pending")
        self.assertEqual(verified[0].safety_findings, [])
        self.assertEqual(summary.findings, [])

    async def test_privacy_protection_preserves_an_unsupported_read_only_sentinel(self) -> None:
        snapshot = _context().snapshot_payload()
        snapshot["current_resume"]["profile"]["name"] = "Jane Alice Doe"
        snapshot["current_resume"]["personal_summary"] = "Jane led roadmap"
        snapshot["evaluation"]["issues"][0]["primaryDimension"] = "内容完整"
        context = FrozenOptimizationContext(**snapshot)
        transport = AsyncMock(
            return_value={
                "changes": [_unsupported_change("I1")],
                "questions": [],
            }
        )

        with patch(
            "app.domain.resume_optimization.planner_service._call_llm",
            transport,
        ):
            plan = await plan_resume_optimization(context)

        change = plan.changes[0]
        self.assertEqual(change.field_path, "unsupported")
        self.assertEqual(change.action_kind, OptimizationAction.LEAVE_UNCHANGED)
        self.assertIsNone(change.before_value)
        self.assertIsNone(change.general_value)
        self.assertIsNone(change.targeted_value)
        renormalized = _normalize(
            {
                "changes": [
                    change.model_dump(
                        mode="json",
                        exclude={"safety_status", "safety_findings", "semantic_review"},
                    )
                ],
                "questions": [],
            },
            issues={"I1"},
            issue_dimensions={"I1": "内容完整"},
        )
        self.assertIsNone(renormalized.changes[0].before_value)
        self.assertIsNone(renormalized.changes[0].general_value)
        self.assertIsNone(renormalized.changes[0].targeted_value)

    async def test_plan_binds_dimension_to_its_authoritative_evaluation_issue(self) -> None:
        snapshot = _context().snapshot_payload()
        snapshot["evaluation"]["issues"][0]["primaryDimension"] = "内容可读"
        context = FrozenOptimizationContext(**snapshot)

        with patch(
            "app.domain.resume_optimization.planner_service._call_llm",
            AsyncMock(return_value={"changes": [_change()], "questions": []}),
        ):
            plan=await plan_resume_optimization(context)
        self.assertEqual(plan.changes[0].dimension,"内容可读")

    async def test_answer_rewrite_sends_and_accepts_only_affected_changes(self) -> None:
        context = _context()
        ask_change = _change(
            actionKind="ask_user",
            generalValue=None,
            targetedValue=None,
            sourceRefs=[],
        )
        existing_plan = _normalize(
            {"changes": [ask_change], "questions": [_question()]}
        )
        rewritten = _change(
            changeId="CHANGE_001",
            actionKind="rewrite_now",
            generalValue="完成三轮迭代",
            targetedValue="完成三轮迭代",
            sourceRefs=["/userAnswers/QUESTION_001/value"],
            introducedTerms=["迭代"],
        )
        transport = AsyncMock(return_value={"changes": [rewritten]})

        with patch(
            "app.domain.resume_optimization.planner_service._call_llm",
            transport,
        ):
            changes = await rewrite_answered_modules(
                context=context,
                existing_plan=existing_plan,
                answers=[
                    OptimizationAnswer(
                        question_id="Q1",
                        state="answered",
                        value="完成三轮迭代",
                    )
                ],
            )

        self.assertEqual([item.change_id for item in changes], ["CHG_I1"])
        args, kwargs = transport.call_args
        self.assertTrue(kwargs["json_mode"])
        self.assertEqual(kwargs["request_label"], "resume_optimization_answer")
        self.assertEqual(kwargs["gemini_thinking_level"], "low")
        self.assertTrue(kwargs["gemini_stream"])
        response_schema = kwargs["gemini_response_json_schema"]
        self.assertEqual(response_schema["type"], "object")
        self.assertEqual(response_schema["required"], ["changes"])
        change_schema = response_schema["properties"]["changes"]["items"]
        properties = change_schema["properties"]
        self.assertIn(
            "/userAnswers/QUESTION_001/value",
            properties["sourceRefs"]["items"]["enum"],
        )
        self.assertEqual(properties["introducedTerms"], {
            "type": "array", "items": {"type": "string"},
        })
        self.assertEqual(changes[0].introduced_terms, ["迭代"])
        self.assertIn("changeId", change_schema["required"])
        self.assertIn("targetedValue", change_schema["required"])
        self.assertFalse(change_schema["additionalProperties"])
        payload = json.loads(args[0][1]["content"])
        serialized = json.dumps(payload, ensure_ascii=False)
        self.assertIn("CHANGE_001", serialized)
        self.assertNotIn("CHG_I1", serialized)
        self.assertEqual(
            payload["affectedChanges"][0]["issue_ids"],
            ["ISSUE_001"],
        )
        self.assertIn(SELECTED_ID, serialized)
        self.assertIn("完成三轮迭代", serialized)
        self.assertNotIn(OTHER_ID, serialized)
        self.assertNotIn("UNSELECTED SECRET", serialized)
        self.assertEqual(
            set(payload["sourceDocuments"]),
            {"currentResume", "selectedSourceExperiences", "userAnswers"},
        )
        self.assertEqual(
            set(payload["sourceDocuments"]["currentResume"]),
            {"experiences"},
        )
        self.assertEqual(
            set(payload["sourceDocuments"]["currentResume"]["experiences"]),
            {SELECTED_ID},
        )
        self.assertEqual(
            set(payload["sourceDocuments"]["selectedSourceExperiences"]),
            {SELECTED_ID},
        )
        self.assertEqual(
            payload["sourceDocuments"]["userAnswers"],
            {"QUESTION_001": {"state": "answered", "value": "完成三轮迭代"}},
        )

    async def test_answer_rewrite_skips_provider_for_a_private_historical_target(self) -> None:
        secret_issue_id = "UNSELECTED SECRET STAR"
        aliased_contact = "Jane led roadmap; contact private at example dot com"
        snapshot = _context().snapshot_payload()
        snapshot["current_resume"]["profile"]["name"] = "Jane Alice Doe"
        snapshot["current_resume"]["profile"]["email"] = "private@example.com"
        snapshot["current_resume"]["experiences"][SELECTED_ID]["star"]["a"] = (
            aliased_contact
        )
        snapshot["selected_source_experiences"][SELECTED_ID]["star"]["a"] = (
            aliased_contact
        )
        snapshot["evaluation"] = {
            "evaluationVersion": "resume_flow_v1",
            "issues": [
                {
                    "issueId": secret_issue_id,
                    "primaryDimension": "STAR应用",
                    "description": secret_issue_id,
                }
            ],
        }
        context = FrozenOptimizationContext(**snapshot)
        ask_change = _change(
            secret_issue_id,
            changeId="CHG_SAFE",
            actionKind="ask_user",
            generalValue=None,
            targetedValue=None,
            sourceRefs=[],
        )
        existing_plan = _normalize(
            {
                "changes": [ask_change],
                "questions": [_question(affectsChangeIds=["CHG_SAFE"])],
            },
            issues={secret_issue_id},
            issue_dimensions={secret_issue_id: "STAR应用"},
        )
        transport = AsyncMock()

        with patch(
            "app.domain.resume_optimization.planner_service._call_llm",
            transport,
        ):
            changes = await rewrite_answered_modules(
                context=context,
                existing_plan=existing_plan,
                answers=[
                    OptimizationAnswer(
                        question_id="Q1",
                        state="answered",
                        value="confirmed result",
                    )
                ],
            )

        transport.assert_not_awaited()
        self.assertEqual(changes[0].issue_ids, [secret_issue_id])
        self.assertEqual(
            changes[0].action_kind,
            OptimizationAction.LEAVE_UNCHANGED,
        )
        self.assertEqual(changes[0].before_value, aliased_contact)
        self.assertEqual(changes[0].general_value, aliased_contact)
        self.assertEqual(changes[0].targeted_value, aliased_contact)
        self.assertNotIn("[profile data omitted]", changes[0].model_dump_json())
        verified, summary = verify_plan_changes(
            plan=OptimizationPlan(changes=changes),
            source_documents=context.source_documents,
        )
        self.assertEqual(verified[0].safety_status, "pending")
        self.assertEqual(verified[0].safety_findings, [])
        self.assertEqual(summary.findings, [])

    async def test_answer_rewrite_skips_a_historical_change_with_untrusted_text(self) -> None:
        secret = "UNSELECTED SECRET STAR"
        context = _context()
        ask_change = _change(
            changeId="CHG_SAFE",
            actionKind="ask_user",
            beforeValue=secret,
            generalValue=None,
            targetedValue=None,
            sourceRefs=[],
            rationale=secret,
        )
        existing_plan = _normalize(
            {
                "changes": [ask_change],
                "questions": [_question(affectsChangeIds=["CHG_SAFE"])],
            }
        )
        transport = AsyncMock()

        with patch(
            "app.domain.resume_optimization.planner_service._call_llm",
            transport,
        ):
            changes = await rewrite_answered_modules(
                context=context,
                existing_plan=existing_plan,
                answers=[
                    OptimizationAnswer(
                        question_id="Q1",
                        state="answered",
                        value="confirmed result",
                    )
                ],
            )

        transport.assert_not_awaited()
        self.assertEqual(len(changes), 1)
        change = changes[0]
        self.assertEqual(change.action_kind, OptimizationAction.LEAVE_UNCHANGED)
        self.assertEqual(change.before_value, "参与交付")
        self.assertEqual(change.general_value, "参与交付")
        self.assertEqual(change.targeted_value, "参与交付")
        self.assertNotIn(secret, change.model_dump_json())
        self.assertEqual(change.rationale, "该变更与当前简历不一致，已保持原文不变。")
        verified, summary = verify_plan_changes(
            plan=OptimizationPlan(changes=changes),
            source_documents=context.source_documents,
        )
        self.assertEqual(verified[0].safety_status, "pending")
        self.assertEqual(verified[0].safety_findings, [])
        self.assertEqual(summary.findings, [])

    async def test_answer_rewrite_sends_only_public_changes_in_a_mixed_batch(self) -> None:
        secret_issue_id = "UNSELECTED SECRET STAR"
        secret_question_id = "UNSELECTED SECRET QUESTION"
        aliased_contact = "Jane led roadmap; contact private at example dot com"
        snapshot = _context().snapshot_payload()
        snapshot["current_resume"]["profile"]["name"] = "Jane Alice Doe"
        snapshot["current_resume"]["profile"]["email"] = "private@example.com"
        snapshot["current_resume"]["experiences"][SELECTED_ID]["star"]["a"] = (
            aliased_contact
        )
        snapshot["selected_source_experiences"][SELECTED_ID]["star"]["a"] = (
            aliased_contact
        )
        snapshot["evaluation"] = {
            "evaluationVersion": "resume_flow_v1",
            "issues": [
                {
                    "issueId": secret_issue_id,
                    "primaryDimension": "STAR应用",
                    "description": secret_issue_id,
                },
                {
                    "issueId": "I2",
                    "primaryDimension": "STAR应用",
                    "description": "Public result needs clarification",
                },
            ],
        }
        context = FrozenOptimizationContext(**snapshot)
        private_change = _change(
            secret_issue_id,
            changeId="CHG_PRIVATE",
            fieldPath="star.a",
            actionKind="ask_user",
            generalValue=None,
            targetedValue=None,
            sourceRefs=[],
        )
        public_change = _change(
            "I2",
            changeId="CHG_PUBLIC",
            fieldPath="star.r",
            actionKind="ask_user",
            generalValue=None,
            targetedValue=None,
            sourceRefs=[],
        )
        existing_plan = _normalize(
            {
                "changes": [private_change, public_change],
                "questions": [
                    _question(
                        questionId="Q1",
                        fieldPath="star.a",
                        affectsChangeIds=["CHG_PRIVATE"],
                    ),
                    _question(
                        questionId=secret_question_id,
                        fieldPath="star.r",
                        affectsChangeIds=["CHG_PUBLIC"],
                    ),
                ],
            },
            issues={secret_issue_id, "I2"},
            issue_dimensions={secret_issue_id: "STAR应用", "I2": "STAR应用"},
        )
        rewritten_public = _change(
            "I2",
            changeId="CHANGE_001",
            issueIds=["ISSUE_002"],
            fieldPath="star.r",
            actionKind="rewrite_now",
            generalValue="public result",
            targetedValue="public result",
            sourceRefs=["/userAnswers/QUESTION_001/value"],
        )
        transport = AsyncMock(return_value={"changes": [rewritten_public]})

        with patch(
            "app.domain.resume_optimization.planner_service._call_llm",
            transport,
        ):
            changes = await rewrite_answered_modules(
                context=context,
                existing_plan=existing_plan,
                answers=[
                    OptimizationAnswer(
                        question_id="Q1",
                        state="answered",
                        value="SECRET ANSWER",
                    ),
                    OptimizationAnswer(
                        question_id=secret_question_id,
                        state="answered",
                        value="public result",
                    ),
                ],
            )

        args, _kwargs = transport.call_args
        payload = json.loads(args[0][1]["content"])
        serialized = json.dumps(payload, ensure_ascii=False).casefold()
        self.assertNotIn(secret_issue_id.casefold(), serialized)
        self.assertNotIn(secret_question_id.casefold(), serialized)
        self.assertNotIn("secret answer", serialized)
        self.assertNotIn("jane", serialized)
        self.assertNotIn("private@example.com", serialized)
        self.assertNotIn("private at example dot com", serialized)
        self.assertIn("led roadmap", serialized)
        self.assertIn("contact", serialized)
        self.assertEqual(payload["affectedChangeIds"], ["CHANGE_001"])
        self.assertEqual(
            [item["question_id"] for item in payload["submittedAnswers"]],
            ["QUESTION_001"],
        )
        self.assertEqual(
            payload["affectedChanges"][0]["issue_ids"],
            ["ISSUE_002"],
        )
        self.assertEqual(
            [change.change_id for change in changes],
            ["CHG_PRIVATE", "CHG_PUBLIC"],
        )
        self.assertEqual(
            changes[0].action_kind,
            OptimizationAction.LEAVE_UNCHANGED,
        )
        self.assertEqual(changes[0].before_value, aliased_contact)
        self.assertEqual(changes[1].action_kind, OptimizationAction.REWRITE_NOW)
        self.assertEqual(changes[1].issue_ids, ["I2"])

    async def test_answer_rewrite_accepts_local_issue_subset_of_full_evaluation(self) -> None:
        snapshot = _context().snapshot_payload()
        snapshot["evaluation"]["issues"].append(
            {
                "issueId": "I2",
                "primaryDimension": "内容可读",
                "description": "表达不够清晰",
            }
        )
        context = FrozenOptimizationContext(**snapshot)
        ask_change = _change(
            actionKind="ask_user",
            generalValue=None,
            targetedValue=None,
            sourceRefs=[],
        )
        existing_plan = _normalize(
            {"changes": [ask_change], "questions": [_question()]}
        )
        rewritten = _change(
            actionKind="rewrite_now",
            generalValue="完成三轮迭代",
            targetedValue="完成三轮迭代",
            sourceRefs=["/userAnswers/Q1/value"],
        )

        with patch(
            "app.domain.resume_optimization.planner_service._call_llm",
            AsyncMock(return_value={"changes": [rewritten]}),
        ):
            changes = await rewrite_answered_modules(
                context=context,
                existing_plan=existing_plan,
                answers=[
                    OptimizationAnswer(
                        question_id="Q1",
                        state="answered",
                        value="完成三轮迭代",
                    )
                ],
            )

        self.assertEqual([change.change_id for change in changes], ["CHG_I1"])
        self.assertEqual(changes[0].issue_ids, ["I1"])
        self.assertEqual(changes[0].dimension, "STAR应用")

    async def test_answer_rewrite_wraps_invalid_provider_payload_as_retryable(self) -> None:
        context = _context()
        ask_change = _change(
            actionKind="ask_user",
            generalValue=None,
            targetedValue=None,
            sourceRefs=[],
        )
        existing_plan = _normalize(
            {"changes": [ask_change], "questions": [_question()]}
        )

        with patch(
            "app.domain.resume_optimization.planner_service._call_llm",
            AsyncMock(side_effect=AiProviderPayloadError("private provider body")),
        ):
            with self.assertRaises(OptimizationAnswerRewriteNormalizationError) as caught:
                await rewrite_answered_modules(
                    context=context,
                    existing_plan=existing_plan,
                    answers=[
                        OptimizationAnswer(
                            question_id="Q1",
                            state="answered",
                            value="完成三轮迭代",
                        )
                    ],
                )

        self.assertTrue(caught.exception.retryable)
        self.assertEqual(caught.exception.status_code, 502)
        self.assertIsInstance(caught.exception.__cause__, AiProviderPayloadError)

    async def test_answer_rewrite_rechecks_dimension_against_frozen_evaluation(self) -> None:
        snapshot = _context().snapshot_payload()
        snapshot["evaluation"]["issues"][0]["primaryDimension"] = "内容可读"
        context = FrozenOptimizationContext(**snapshot)
        ask_change = _change(
            actionKind="ask_user",
            generalValue=None,
            targetedValue=None,
            sourceRefs=[],
        )
        existing_plan = _normalize(
            {"changes": [ask_change], "questions": [_question()]}
        )
        rewritten = _change(
            actionKind="rewrite_now",
            generalValue="完成三轮迭代",
            targetedValue="完成三轮迭代",
            sourceRefs=["/userAnswers/Q1/value"],
        )

        with patch(
            "app.domain.resume_optimization.planner_service._call_llm",
            AsyncMock(return_value={"changes": [rewritten]}),
        ):
            with self.assertRaises(OptimizationAnswerRewriteNormalizationError):
                await rewrite_answered_modules(
                    context=context,
                    existing_plan=existing_plan,
                    answers=[
                        OptimizationAnswer(
                            question_id="Q1",
                            state="answered",
                            value="完成三轮迭代",
                        )
                    ],
                )

    async def test_answer_rewrite_rejects_new_or_unaffected_changes(self) -> None:
        context = _context()
        ask_change = _change(
            actionKind="ask_user",
            generalValue=None,
            targetedValue=None,
            sourceRefs=[],
        )
        existing_plan = _normalize(
            {"changes": [ask_change], "questions": [_question()]}
        )
        transport = AsyncMock(
            return_value={"changes": [_change(changeId="CHG_NEW")]}
        )

        with patch(
            "app.domain.resume_optimization.planner_service._call_llm",
            transport,
        ):
            with self.assertRaises(OptimizationPlanNormalizationError):
                await rewrite_answered_modules(
                    context=context,
                    existing_plan=existing_plan,
                    answers=[
                        OptimizationAnswer(
                            question_id="Q1",
                            state="answered", value="确认现有事实",
                        )
                    ],
                )

    async def test_answer_rewrite_rejects_unsubmitted_or_wrong_module_answer_refs(self) -> None:
        context = _context()
        ask_change = _change(
            actionKind="ask_user",
            generalValue=None,
            targetedValue=None,
            sourceRefs=[],
        )
        existing_plan = _normalize(
            {"changes": [ask_change], "questions": [_question()]}
        )
        for source_ref in ("/userAnswers/Q2/value", "/userAnswers/Q1/state"):
            with self.subTest(source_ref=source_ref):
                transport = AsyncMock(
                    return_value={
                        "changes": [
                            _change(
                                sourceRefs=[source_ref],
                                generalValue="改写",
                                targetedValue="改写",
                            )
                        ]
                    }
                )
                with patch(
                    "app.domain.resume_optimization.planner_service._call_llm",
                    transport,
                ):
                    with self.assertRaises(OptimizationPlanNormalizationError):
                        await rewrite_answered_modules(
                            context=context,
                            existing_plan=existing_plan,
                            answers=[
                                OptimizationAnswer(
                                    question_id="Q1",
                                    state="answered",
                                    value="已确认",
                                )
                            ],
                        )

        summary_change = _change(
            "I2",
            changeId="CHG_I2",
            moduleType="personal_summary",
            moduleId="personal_summary",
            fieldPath="personal_summary",
            actionKind="ask_user",
            generalValue=None,
            targetedValue=None,
            sourceRefs=[],
        )
        two_module_plan = _normalize(
            {
                "changes": [ask_change, summary_change],
                "questions": [
                    _question(),
                    _question(
                        questionId="Q2",
                        moduleId="personal_summary",
                        fieldPath="personal_summary",
                        affectsChangeIds=["CHG_I2"],
                    ),
                ],
            },
            issues={"I1", "I2"},
        )
        cross_module_transport = AsyncMock(
            return_value={
                "changes": [
                    _change(
                        sourceRefs=["/userAnswers/Q2/value"],
                        generalValue="越界改写",
                        targetedValue="越界改写",
                    ),
                    _change(
                        "I2",
                        changeId="CHG_I2",
                        moduleType="personal_summary",
                        moduleId="personal_summary",
                        fieldPath="personal_summary",
                        sourceRefs=["/userAnswers/Q2/value"],
                        generalValue="摘要改写",
                        targetedValue="摘要改写",
                    ),
                ]
            }
        )
        with patch(
            "app.domain.resume_optimization.planner_service._call_llm",
            cross_module_transport,
        ):
            with self.assertRaises(OptimizationPlanNormalizationError):
                await rewrite_answered_modules(
                    context=context,
                    existing_plan=two_module_plan,
                    answers=[
                        OptimizationAnswer(
                            question_id="Q1", state="answered", value="经历回答"
                        ),
                        OptimizationAnswer(
                            question_id="Q2", state="answered", value="摘要回答"
                        ),
                    ],
                )

    async def test_answer_rewrite_rejects_identity_tampering(self) -> None:
        context = _context()
        ask_change = _change(
            actionKind="ask_user",
            generalValue=None,
            targetedValue=None,
            sourceRefs=[],
        )
        existing_plan = _normalize(
            {"changes": [ask_change], "questions": [_question()]}
        )
        tampered_fields = {
            "dimension": "成果量化",
            "scope": "jd_targeted",
            "defaultSelected": False,
        }
        for field_name, field_value in tampered_fields.items():
            with self.subTest(field_name=field_name):
                rewritten = _change(
                    sourceRefs=["/userAnswers/Q1/value"],
                    generalValue="已确认改写",
                    targetedValue="已确认改写",
                    **{field_name: field_value},
                )
                transport = AsyncMock(return_value={"changes": [rewritten]})
                with patch(
                    "app.domain.resume_optimization.planner_service._call_llm",
                    transport,
                ):
                    with self.assertRaises(OptimizationPlanNormalizationError):
                        await rewrite_answered_modules(
                            context=context,
                            existing_plan=existing_plan,
                            answers=[
                                OptimizationAnswer(
                                    question_id="Q1",
                                    state="answered",
                                    value="已确认",
                                )
                            ],
                        )

    async def test_answer_provenance_enforces_all_answer_states(self) -> None:
        context = _context()
        ask_change = _change(
            actionKind="ask_user",
            generalValue=None,
            targetedValue=None,
            sourceRefs=[],
        )
        existing_plan = _normalize(
            {"changes": [ask_change], "questions": [_question()]}
        )

        answered_transport = AsyncMock(
            return_value={
                "changes": [
                    _change(sourceRefs=["/userAnswers/Q1/value"])
                ]
            }
        )
        with patch(
            "app.domain.resume_optimization.planner_service._call_llm",
            answered_transport,
        ):
            answered = await rewrite_answered_modules(
                context=context,
                existing_plan=existing_plan,
                answers=[
                    OptimizationAnswer(
                        question_id="Q1", state="answered", value="确认事实"
                    )
                ],
            )
        self.assertEqual(answered[0].action_kind.value, "rewrite_now")

        for state in ("no_data", "unknown", "not_my_work", "skipped"):
            with self.subTest(state=state, result="rewrite_now"):
                invalid_rewrite = AsyncMock(
                    return_value={
                        "changes": [
                            _change(sourceRefs=["/userAnswers/Q1/value"])
                        ]
                    }
                )
                with patch(
                    "app.domain.resume_optimization.planner_service._call_llm",
                    invalid_rewrite,
                ):
                    unchanged = await rewrite_answered_modules(
                        context=context, existing_plan=existing_plan,
                        answers=[OptimizationAnswer(question_id="Q1", state=state)],
                    )
                invalid_rewrite.assert_not_awaited()
                self.assertEqual(unchanged[0].action_kind.value, "leave_unchanged")
                self.assertIsNone(unchanged[0].general_value)
                self.assertEqual(unchanged[0].source_refs, [])
                self.assertEqual(unchanged[0].default_selected, existing_plan.changes[0].default_selected)

            with self.subTest(state=state, result="leave_unchanged"):
                safe_leave = AsyncMock(
                    return_value={
                        "changes": [
                            _change(
                                actionKind="leave_unchanged",
                                generalValue=None,
                                targetedValue=None,
                                sourceRefs=[],
                            )
                        ]
                    }
                )
                with patch(
                    "app.domain.resume_optimization.planner_service._call_llm",
                    safe_leave,
                ):
                    unchanged = await rewrite_answered_modules(
                        context=context,
                        existing_plan=existing_plan,
                        answers=[OptimizationAnswer(question_id="Q1", state=state)],
                    )
                self.assertEqual(unchanged[0].action_kind.value, "leave_unchanged")
                safe_leave.assert_not_awaited()

        invented_leave = AsyncMock(
            return_value={
                "changes": [
                    _change(
                        actionKind="leave_unchanged",
                        generalValue="new candidate",
                        targetedValue=None,
                        sourceRefs=[],
                    )
                ]
            }
        )
        with patch(
            "app.domain.resume_optimization.planner_service._call_llm",
            invented_leave,
        ):
            unchanged = await rewrite_answered_modules(
                context=context, existing_plan=existing_plan,
                answers=[OptimizationAnswer(question_id="Q1", state="no_data")],
            )
        invented_leave.assert_not_awaited()
        self.assertIsNone(unchanged[0].general_value)

    async def test_mixed_answers_allow_only_linked_answered_sources(self) -> None:
        snapshot = _context().snapshot_payload()
        snapshot["evaluation"]["issues"].append({
            "issueId": "I2",
            "primaryDimension": "STAR应用",
            "description": "结果层表达不清",
        })
        context = FrozenOptimizationContext(**snapshot)
        ask_change = _change(
            actionKind="ask_user",
            generalValue=None,
            targetedValue=None,
            sourceRefs=[],
        )
        second_ask_change = _change(
            "I2",
            changeId="CHG_I2",
            fieldPath="star.r",
            actionKind="ask_user",
            generalValue=None,
            targetedValue=None,
            sourceRefs=[],
        )
        existing_plan = _normalize(
            {
                "changes": [ask_change, second_ask_change],
                "questions": [
                    _question(),
                    _question(questionId="Q2", affectsChangeIds=["CHG_I2"]),
                ],
            },
            issues={"I1", "I2"},
        )
        answers = [
            OptimizationAnswer(question_id="Q1", state="answered", value="确认事实"),
            OptimizationAnswer(question_id="Q2", state="no_data"),
        ]
        valid = AsyncMock(
            return_value={
                "changes": [
                    _change(sourceRefs=["/userAnswers/Q1/value"]),
                ]
            }
        )
        with patch(
            "app.domain.resume_optimization.planner_service._call_llm", valid
        ):
            changes = await rewrite_answered_modules(
                context=context,
                existing_plan=existing_plan,
                answers=answers,
            )
        self.assertEqual(changes[0].action_kind.value, "rewrite_now")
        self.assertEqual(changes[1].action_kind.value, "leave_unchanged")
        payload = json.loads(valid.call_args.args[0][1]["content"])
        self.assertEqual(len(payload["affectedChangeIds"]), 1)
        self.assertEqual(len(payload["submittedAnswers"]), 1)

        invalid = AsyncMock(
            return_value={
                "changes": [
                    _change(sourceRefs=["/userAnswers/Q1/value"]),
                    _change(
                        "I2",
                        changeId="CHG_I2",
                        fieldPath="star.r",
                        generalValue="新增结果",
                        targetedValue="新增结果",
                        sourceRefs=["/userAnswers/Q2/value"],
                    ),
                ]
            }
        )
        with patch(
            "app.domain.resume_optimization.planner_service._call_llm", invalid
        ):
            with self.assertRaises(OptimizationPlanNormalizationError):
                await rewrite_answered_modules(
                    context=context,
                    existing_plan=existing_plan,
                    answers=answers,
                )


if __name__ == "__main__":
    unittest.main()
