import copy
import unittest
from semantic_review_test_support import with_supported_review

from app.domain.resume_optimization.safety import (
    _fact_visible_text,
    _invalid_chinese_quantities,
    _numeric_expressions,
    preserves_rich_text_structure,
    resolve_source_ref,
    verify_plan_changes,
)
from app.domain.resume_optimization.normalizers import (
    normalize_action_paragraph_endings,
)
from app.domain.resume_optimization.schemas import (
    OptimizationChange,
    OptimizationPlan,
    OptimizationQuestion,
)


EXP_A = "exp-a"
EXP_B = "exp-b"


def _documents(
    *,
    current_a: str = "参与支付页面改版",
    current_b: str = "完成数据平台开发",
    selected_a: str = "参与支付页面改版",
    answers: dict | None = None,
) -> dict:
    return {
        "currentResume": {
            "personal_summary": "产品与研发协作经验",
            "experiences": {
                EXP_A: {"star": {"a": current_a, "r": "项目上线后转化率提高"}},
                EXP_B: {"star": {"a": current_b, "r": "按期交付"}},
            },
        },
        "selectedSourceExperiences": {
            EXP_A: {"star": {"a": selected_a, "r": "项目上线后转化率提高"}},
            EXP_B: {"star": {"a": current_b, "r": "按期交付"}},
        },
        "userAnswers": answers or {},
    }


def _change(**overrides) -> OptimizationChange:
    values = {
        "change_id": "CHG_A",
        "issue_ids": ["I1"],
        "dimension": "STAR应用",
        "module_type": "experience_star",
        "module_id": EXP_A,
        "field_path": "star.a",
        "action_kind": "rewrite_now",
        "scope": "general",
        "before_value": "参与支付页面改版",
        "general_value": "参与支付页面改版",
        "targeted_value": "参与支付页面改版",
        "source_refs": [f"/currentResume/experiences/{EXP_A}/star/a"],
        "introduced_terms": [],
        "rationale": "在已有事实范围内优化表达",
    }
    values.update(overrides)
    return OptimizationChange(**values)


def _question(
    *,
    question_id: str = "Q1",
    module_id: str = EXP_A,
    affects: list[str] | None = None,
) -> OptimizationQuestion:
    return OptimizationQuestion(
        question_id=question_id,
        module_id=module_id,
        field_path="star.r",
        text="是否有可确认的结果？",
        reason="需要确认结果边界",
        affects_change_ids=affects or ["CHG_A"],
    )


def _verify(change: OptimizationChange, documents: dict, *, questions=None):
    documents = copy.deepcopy(documents)
    preserve_frozen_mismatch = bool(
        documents.pop("__preserveFrozenMismatch__", False)
    )
    if (
        not preserve_frozen_mismatch
        and change.module_type == "experience_star"
        and change.module_id == EXP_A
        and change.field_path == "star.a"
    ):
        current_star = documents["currentResume"]["experiences"][EXP_A]["star"]
        if current_star.get("a") != change.before_value:
            displaced_source = current_star.get("a")
            current_star["a"] = change.before_value
            if isinstance(displaced_source, str):
                documents["selectedSourceExperiences"][EXP_A]["star"]["a"] = displaced_source
                selected_ref = f"/selectedSourceExperiences/{EXP_A}/star/a"
                if selected_ref not in change.source_refs:
                    change = change.model_copy(
                        update={"source_refs": [*change.source_refs, selected_ref]}
                    )
    return verify_plan_changes(
        plan=OptimizationPlan(changes=[with_supported_review(change, documents)], questions=questions or []),
        source_documents=documents,
    )


class SourceResolutionTests(unittest.TestCase):
    def test_resolves_strict_rfc6901_mapping_and_array_paths(self) -> None:
        documents = {
            "currentResume": {"a/b~c": [{"value": "ok"}]},
            "selectedSourceExperiences": {},
            "userAnswers": {},
        }
        self.assertEqual(
            resolve_source_ref(documents, "/currentResume/a~1b~0c/0/value"),
            "ok",
        )

    def test_rejects_malformed_unknown_parent_and_missing_pointers(self) -> None:
        documents = {
            "currentResume": {"items": ["first"], "..": "not traversable"},
            "selectedSourceExperiences": {},
            "userAnswers": {},
        }
        invalid = (
            "currentResume/items/0",
            "/resume/items/0",
            "/currentResume/items/~2",
            "/currentResume/items/~",
            "/currentResume/../items",
            "/currentResume/items/01",
            "/currentResume/items/-1",
            "/currentResume/items/2",
            "/currentResume/items/0/value",
            "/currentResume/missing",
            "/currentResume//value",
        )
        for source_ref in invalid:
            with self.subTest(source_ref=source_ref):
                with self.assertRaises(ValueError):
                    resolve_source_ref(documents, source_ref)


class RequiredSafetyMatrixTests(unittest.TestCase):
    def assertBlocked(self, change: OptimizationChange, documents: dict, *, questions=None):
        changes, summary = _verify(change, documents, questions=questions)
        self.assertEqual(changes[0].safety_status, "blocked")
        self.assertEqual(changes[0].general_value, change.before_value)
        self.assertEqual(changes[0].targeted_value, change.before_value)
        self.assertFalse(changes[0].default_selected)
        self.assertEqual(summary.blocked_change_ids, [change.change_id])
        self.assertTrue(changes[0].safety_findings)
        return changes[0]

    def assertAllowed(self, change: OptimizationChange, documents: dict, *, questions=None):
        changes, summary = _verify(change, documents, questions=questions)
        self.assertEqual(changes[0].safety_status, "allowed")
        self.assertEqual(summary.allowed_change_ids, [change.change_id])
        self.assertEqual(summary.blocked_change_ids, [])
        return changes[0]


    def test_blocks_new_number_without_evidence(self) -> None:
        self.assertBlocked(
            _change(general_value="提升 30%", targeted_value="提升 30%"),
            _documents(),
        )

    def test_blocks_removing_rich_text_links_or_emphasis(self) -> None:
        cases = (
            ('完成交付（<a href="https://example.com/project">项目链接</a>）', '完成交付（项目链接）'),
            ('负责 <strong>核心流程</strong> 设计', '负责核心流程设计'),
            ('负责 <strong>核心流程</strong> 设计', '负责 <b>核心流程</b> 设计'),
            ('输出 **高保真原型** 与 *交互说明*', '输出高保真原型与交互说明'),
            (
                '参考 [项目](https://example.com/path_(legacy)?v=1)',
                '参考 [项目](https://example.com/path_(legacy)?v=2)',
            ),
            (
                '[查看 [项目]](https://e.test/a_(b)?v=1)',
                '[查看 [项目]](https://e.test/a_(b)?v=2)',
            ),
            (
                r'[查看 \]](https://e.test/a_(b)?v=1)',
                r'[查看 \]](https://e.test/a_(b)?v=2)',
            ),
        )
        self.assertBlocked(
            _change(
                before_value="supported operations",
                general_value="served 100 users",
                targeted_value="served 100 users",
            ),
            _documents(
                current_a="served &amp;#49;00 users",
                selected_a="served &amp;#49;00 users",
            ),
        )
        for before, candidate in cases:
            with self.subTest(before=before):
                blocked = self.assertBlocked(
                    _change(
                        before_value=before,
                        general_value=candidate,
                        targeted_value=candidate,
                    ),
                    _documents(current_a=before),
                )
                self.assertTrue(any('富文本' in finding for finding in blocked.safety_findings))

    def test_link_targets_are_exact_and_dangerous_schemes_are_rejected(self) -> None:
        before_html = '<a href="https://safe.example/project">旧项目</a>'
        before_markdown = '[旧项目](https://safe.example/project "title ) text")'
        cases = (
            (
                before_html,
                '<a href="https://evil.example">新项目</a>'
                '<a href="https://safe.example/project">旧 URL decoy</a>',
            ),
            (
                before_html,
                '<a href="https://safe.example/project">新项目</a>'
                '<a href="https://safe.example/project">重复 URL</a>',
            ),
            (
                before_markdown,
                '[新项目](https://evil.example "title ) text") '
                '[旧 URL decoy](https://safe.example/project "title ) text")',
            ),
            ('普通文本', '<a href="javascript&#58;alert(1)">危险链接</a>'),
            ('普通文本', '[危险链接](javascript&#58;alert(1))'),
        )
        for before, candidate in cases:
            with self.subTest(before=before, candidate=candidate):
                self.assertFalse(preserves_rich_text_structure(before, candidate))

        self.assertTrue(
            preserves_rich_text_structure(
                before_markdown,
                '[新项目](https://safe.example/project "title ) text")',
            )
        )
        self.assertTrue(
            preserves_rich_text_structure(
                '普通文本',
                '<strong>安全的格式添加</strong>',
            )
        )

    def test_markdown_link_signature_ignores_renderer_literal_fragments(self) -> None:
        before = '[safe](https://safe.example)'
        for malformed_prefix in (
            r'\[evil](https://evil.example)',
            '[evil\nlabel](https://evil.example)',
            '[evil](https://evil.example "unfinished)',
        ):
            with self.subTest(malformed_prefix=malformed_prefix):
                self.assertTrue(
                    preserves_rich_text_structure(
                        before,
                        f'{malformed_prefix} {before}',
                    )
                )
        self.assertTrue(
            preserves_rich_text_structure(
                '[safe](https://safe.example/path_(v1) "old title")',
                '[new](https://safe.example/path_(v1) "new title")',
            )
        )
        self.assertTrue(
            preserves_rich_text_structure(
                '<a href="https://safe.example/?a=1&amp;b=2">safe</a>',
                '<a href="https://safe.example/?a=1&b=2">new</a>',
            )
        )
        self.assertFalse(
            preserves_rich_text_structure(
                '[safe](https://safe.example/?a=1&amp;b=2)',
                '[new](https://safe.example/?a=1&b=2)',
            )
        )

    def test_rich_text_rejects_malformed_comments_and_raw_text_containers(self) -> None:
        for candidate in (
            '正文<!--><a href="https://attacker.example/a">点击</a>',
            '<noscript><a href="https://attacker.example/a">点击</a></noscript>',
        ):
            with self.subTest(candidate=candidate):
                self.assertFalse(preserves_rich_text_structure('正文', candidate))

    def test_action_entity_normalization_matches_frontend_contract(self) -> None:
        cases = (
            ('<span title="<br>">行动；</span>', '<span title="<br>">行动。</span>'),
            ('<a href="https://safe.example/?x=&NewLine;">行动；</a>', '<a href="https://safe.example/?x=&NewLine;">行动。</a>'),
            ('行动；&NewLine;下一段；', '行动。&NewLine;下一段。'),
            ('行动；&#0010;下一段；', '行动。&#0010;下一段。'),
            ('行动；&#X000A;下一段；', '行动。&#X000A;下一段。'),
            ('行动；&newline;', '行动&newline;。'),
            ('行动；&#10;', '行动。&#10;'),
            ('行动；<!--note-->\u200b', '行动。<!--note-->\u200b'),
            ('行动；\u2060', '行动。\u2060'),
            ('[项目；](https://safe.example "unfinished)', '[项目；](https://safe.example "unfinished)。'),
            ('行动&hellip;', '行动。'),
            ('行动&#8230;', '行动。'),
            ('行动&#x2026;', '行动。'),
            ('[项目&hellip;](https://safe.example "title ) text")',
             '[项目。](https://safe.example "title ) text")'),
            ("[项目&#x2026;](https://safe.example 'title ) text')",
             "[项目。](https://safe.example 'title ) text')"),
        )
        for source, expected in cases:
            with self.subTest(source=source):
                normalized = normalize_action_paragraph_endings(source)
                self.assertEqual(normalized, expected)
                self.assertEqual(normalize_action_paragraph_endings(normalized), expected)

    def test_requires_existing_rich_text_structural_tag_sequence(self) -> None:
        cases = (
            ("第一行<br>第二行", "第一行第二行"),
            ("<ul><li>甲</li></ul>", "<li>甲</li>"),
            ("<ol><li>甲</li></ol>", "<li>甲</li>"),
            ("<ul><li>甲</li><li>乙</li></ul>", "<ul>甲乙</ul>"),
        )
        for before, candidate in cases:
            with self.subTest(before=before, candidate=candidate):
                self.assertFalse(preserves_rich_text_structure(before, candidate))

    def test_requires_existing_list_tree_and_valid_list_content_model(self) -> None:
        cases = (
            (
                "<ul><li>one</li><li>two</li></ul>",
                "<ul><li>one</li></ul><ul><li>two</li></ul>",
            ),
            (
                "<ul><li>one</li></ul>",
                "<li><ul><li>one</li></ul></li>",
            ),
            (
                "<ul><li>one</li></ul>",
                "<ul><div><li>one</li></div></ul>",
            ),
        )
        for before, candidate in cases:
            with self.subTest(candidate=candidate):
                self.assertFalse(preserves_rich_text_structure(before, candidate))
                blocked = self.assertBlocked(
                    _change(
                        before_value=before,
                        general_value=candidate,
                        targeted_value=candidate,
                    ),
                    _documents(current_a=before),
                )
                self.assertTrue(any("富文本" in finding for finding in blocked.safety_findings))

        self.assertTrue(
            preserves_rich_text_structure(
                "<ul><li>old</li></ul>",
                "<ul><li>new</li></ul>",
            )
        )
        self.assertFalse(
            preserves_rich_text_structure(
                "<ul><div><li>old</li></div></ul>",
                "<ul><li>new</li></ul>",
            )
        )
        self.assertTrue(preserves_rich_text_structure("old", "<ul><li>new</li></ul>"))
        self.assertTrue(preserves_rich_text_structure("<p>old</p>", "<div>new</div>"))

    def test_allows_adding_rich_text_structure_to_plain_text(self) -> None:
        self.assertTrue(
            preserves_rich_text_structure(
                "第一项\n第二项",
                "<ul><li>第一项</li><li>第二项</li></ul>",
            )
        )

    def test_requires_protected_tags_to_keep_nonempty_visible_content(self) -> None:
        cases = (
            (
                '<a href="https://example.com">项目链接</a>',
                '<a href="https://example.com"></a>项目链接',
            ),
            (
                '负责 <strong>核心流程</strong>',
                '<strong></strong>负责核心流程',
            ),
            (
                '负责 <strong>核心流程</strong>',
                '<strong>&nbsp;</strong>负责核心流程',
            ),
            (
                '<ul><li>甲</li><li>乙</li></ul>',
                '<ul><li></li><li></li></ul>甲乙',
            ),
            (
                '<strong><em>核心流程</em></strong>',
                '<strong><em></em></strong>核心流程',
            ),
        )
        for before, candidate in cases:
            with self.subTest(before=before, candidate=candidate):
                self.assertFalse(preserves_rich_text_structure(before, candidate))

    def test_allows_rewriting_nonempty_protected_tag_content(self) -> None:
        self.assertTrue(
            preserves_rich_text_structure(
                '<a href="https://example.com">旧链接</a> '
                '<strong>旧重点</strong><ul><li>旧甲</li><li>旧乙</li></ul>',
                '<a href="https://example.com">新链接</a> '
                '<strong>新重点</strong><ul><li>新甲</li><li>新乙</li></ul>',
            )
        )

    def test_rejects_rebinding_links_or_emphasis_to_adjacent_visible_text(self) -> None:
        cases = (
            (
                '<a href="https://safe.example">OpenAI</a> engineer',
                'OpenAI <a href="https://safe.example">engineer</a>',
            ),
            (
                '[OpenAI](https://safe.example) engineer',
                'OpenAI [engineer](https://safe.example)',
            ),
            (
                '<strong>Python</strong> developer',
                'Python <strong>developer</strong>',
            ),
            (
                '**Python** developer',
                'Python **developer**',
            ),
            (
                '<a href="https://safe.example">重复</a> 重复',
                '重复 <a href="https://safe.example">重复</a>',
            ),
            ('<b>重复</b> 重复', '重复 <b>重复</b>'),
            ('**重复** 重复', '重复 **重复**'),
            (
                '<a href="https://safe.example">旧</a> 旧',
                '新 <a href="https://safe.example">新</a>',
            ),
            ('<b>旧</b> 旧', '新 <b>新</b>'),
            ('**旧** 旧', '新 **新**'),
            (
                '<a href="https://safe.example">重复</a> 重复',
                '重复 <a href="https://safe.example">改写重复</a>',
            ),
            ('<b>重复</b> 重复', '重复 <b>改写重复</b>'),
            ('**重复** 重复', '重复 **改写重复**'),
            ('重复 <b>重复</b> 重复 重复', '重复 重复 <b>改写重复</b> 重复'),
            (
                '重复 <a href="https://safe.example">重复</a> 重复 重复',
                '重复 重复 <a href="https://safe.example">改写重复</a> 重复',
            ),
            ('重复 **重复** 重复 重复', '重复 重复 **改写重复** 重复'),
            ('重复，<b>重复</b>，重复，重复', '重复，重复，<b>改写重复</b>，重复'),
            (
                '重复，<a href="https://safe.example">重复</a>，重复，重复',
                '重复，重复，<a href="https://safe.example">改写重复</a>，重复',
            ),
            ('重复，**重复**，重复，重复', '重复，重复，**改写重复**，重复'),
        )
        for before, candidate in cases:
            with self.subTest(before=before, candidate=candidate):
                self.assertFalse(preserves_rich_text_structure(before, candidate))
                blocked = self.assertBlocked(
                    _change(
                        before_value=before,
                        general_value=candidate,
                        targeted_value=candidate,
                    ),
                    _documents(current_a=before, selected_a=before),
                )
                self.assertTrue(
                    any("富文本" in finding for finding in blocked.safety_findings)
                )
        for before, candidate in (
            ('<b>旧</b> 旧', '<b>新</b> 新'),
            (
                '<a href="https://safe.example">旧</a> 旧',
                '<a href="https://safe.example">新</a> 新',
            ),
            ('**旧** 旧', '**新** 新'),
        ):
            with self.subTest(before=before, candidate=candidate):
                self.assertTrue(preserves_rich_text_structure(before, candidate))

    def test_repeated_emphasis_allows_unrelated_prefix_edits_but_not_rebinding(self) -> None:
        before = "Python project; expert in <strong>Python</strong>"
        self.assertAllowed(
            _change(
                before_value=before,
                general_value="A Python project; expert in <strong>Python</strong>",
                targeted_value="A Python project; expert in <strong>Python</strong>",
            ),
            _documents(current_a=before, selected_a=before),
        )
        self.assertBlocked(
            _change(
                before_value=before,
                general_value="<strong>Python</strong> project; expert in Python",
                targeted_value="<strong>Python</strong> project; expert in Python",
            ),
            _documents(current_a=before, selected_a=before),
        )

    def test_rejects_illegal_protected_html_nesting_without_browser_reparse(self) -> None:
        before = '<a href="https://safe.example">项目链接</a>'
        cases = (
            '<a href="https://safe.example"><a href="https://evil.example">项目链接</a></a>',
            '<a href="https://safe.example"><strong>项目链接</a></strong>',
            '<a href="https://safe.example">项目链接',
            '<strong>项目链接</em>',
        )
        for candidate in cases:
            with self.subTest(candidate=candidate):
                self.assertFalse(preserves_rich_text_structure(before, candidate))
                blocked = self.assertBlocked(
                    _change(
                        before_value=before,
                        general_value=candidate,
                        targeted_value=candidate,
                    ),
                    _documents(current_a=before),
                )
                self.assertTrue(any('富文本' in finding for finding in blocked.safety_findings))

    def test_rejects_malformed_protected_html_in_before_value(self) -> None:
        cases = (
            ("<strong>old", "<strong>new</strong>"),
            ("<a href=\"/safe\"><em>old</a></em>", "<a href=\"/safe\"><em>new</em></a>"),
            ("< strong>old</ strong>", "<strong>new</strong>"),
        )
        for before, candidate in cases:
            with self.subTest(before=before):
                self.assertFalse(preserves_rich_text_structure(before, candidate))

    def test_rejects_valueless_anchor_href_in_either_value(self) -> None:
        malformed = "<a href>old</a>"
        valid = '<a href="">new</a>'
        self.assertTrue(preserves_rich_text_structure(valid, valid))
        self.assertFalse(preserves_rich_text_structure(malformed, malformed))
        self.assertFalse(preserves_rich_text_structure(malformed, valid))
        self.assertFalse(preserves_rich_text_structure(valid, malformed))

    def test_rejects_whitespace_inside_protected_html_tag_open_syntax(self) -> None:
        before = "<strong>old</strong>"
        for candidate in (
            "<strong>new</ strong>",
            "< strong>new</ strong>",
        ):
            with self.subTest(candidate=candidate):
                self.assertFalse(preserves_rich_text_structure(before, candidate))
                blocked = self.assertBlocked(
                    _change(
                        before_value=before,
                        general_value=candidate,
                        targeted_value=candidate,
                    ),
                    _documents(current_a=before),
                )
                self.assertTrue(any('富文本' in finding for finding in blocked.safety_findings))

    def test_protected_html_validation_keeps_valid_attributes_and_br_spacing(self) -> None:
        self.assertTrue(
            preserves_rich_text_structure(
                '<strong class="old">old</strong><br />next',
                '<strong class="new" data-kind="resume">new</strong><br />next',
            )
        )

    def test_rejects_candidates_without_nonempty_visible_content(self) -> None:
        before = "原行动"
        for candidate in ("", "<br>", "<p></p>", "<strong>&nbsp;</strong>"):
            with self.subTest(candidate=candidate):
                self.assertFalse(preserves_rich_text_structure(before, candidate))
                blocked = self.assertBlocked(
                    _change(
                        before_value=before,
                        general_value=candidate,
                        targeted_value=candidate,
                    ),
                    _documents(current_a=before),
                )
                self.assertTrue(any('富文本' in finding for finding in blocked.safety_findings))

        self.assertTrue(preserves_rich_text_structure("", ""))

    def test_rejects_zero_width_format_only_candidates_but_keeps_emoji_zwj_visible(self) -> None:
        before = "原行动"
        for candidate in (
            "&#8203;",
            "&#x200B;",
            "&ZeroWidthSpace;",
            "&#65039;",
            "&#xFE0F;",
            "\u200b",
            "\u200c\u200d\u2060\ufeff",
            "\ufe0f",
            "\U000e0100",
        ):
            with self.subTest(candidate=candidate):
                self.assertFalse(preserves_rich_text_structure(before, candidate))
                blocked = self.assertBlocked(
                    _change(
                        before_value=before,
                        general_value=candidate,
                        targeted_value=candidate,
                    ),
                    _documents(current_a=before),
                )
                self.assertTrue(any('富文本' in finding for finding in blocked.safety_findings))

        self.assertTrue(preserves_rich_text_structure(before, "👩‍💻"))

    def test_rejects_default_ignorable_only_candidates_without_dropping_all_marks(self) -> None:
        before = "原行动"
        for candidate in (
            "&#x034F;",
            "&#6155;",
            "\u034f",
            "\u180b\u180c\u180d\u180f",
        ):
            with self.subTest(candidate=ascii(candidate)):
                self.assertFalse(preserves_rich_text_structure(before, candidate))
                blocked = self.assertBlocked(
                    _change(
                        before_value=before,
                        general_value=candidate,
                        targeted_value=candidate,
                    ),
                    _documents(current_a=before),
                )
                self.assertTrue(any("富文本" in finding for finding in blocked.safety_findings))

        # U+0301 is a combining mark, but not Default_Ignorable_Code_Point.
        self.assertTrue(preserves_rich_text_structure(before, "\u0301"))
        self.assertTrue(preserves_rich_text_structure(before, "👩‍💻"))

    def test_anchor_signature_ignores_decoys_in_non_rendered_html_contexts(self) -> None:
        before = '<a href="/safe">old</a>'
        candidates = (
            'new<!-- <a href="/safe">comment decoy</a> -->',
            'new<script>const template = \'<a href="/safe">script decoy</a>\';</script>',
            'new<style>.x::after { content: \'<a href="/safe">style decoy</a>\'; }</style>',
            'new<template><a href="/safe">template decoy</a></template>',
            'new<script/><a href="/safe">slash script decoy</a></script>',
            'new<textarea/><a href="/safe">slash textarea decoy</a></textarea>',
            'new<resume-card data-template=\'<a href="/safe">attribute decoy</a>\'></resume-card>',
        )
        for candidate in candidates:
            with self.subTest(candidate=candidate):
                self.assertFalse(preserves_rich_text_structure(before, candidate))
                blocked = self.assertBlocked(
                    _change(
                        before_value=before,
                        general_value=candidate,
                        targeted_value=candidate,
                    ),
                    _documents(current_a=before),
                )
                self.assertTrue(
                    any('富文本' in finding for finding in blocked.safety_findings)
                )

    def test_markdown_signature_ignores_decoys_outside_rendered_text_nodes(self) -> None:
        formats = (
            ("[old](/safe)", "[decoy](/safe)"),
            ("**old**", "**decoy**"),
            ("__old__", "__decoy__"),
            ("*old*", "*decoy*"),
        )
        contexts = (
            "new<!-- {decoy} -->",
            "new<script>{decoy}</script>",
            "new<resume-card data-template='{decoy}'></resume-card>",
            "<strong title='{decoy}'>new</strong>",
            "<div data-note='{decoy}'>new</div>",
            "<br title='{decoy}'>new",
        )
        for before, decoy in formats:
            for context in contexts:
                candidate = context.format(decoy=decoy)
                with self.subTest(before=before, candidate=candidate):
                    self.assertFalse(preserves_rich_text_structure(before, candidate))
                    blocked = self.assertBlocked(
                        _change(
                            before_value=before,
                            general_value=candidate,
                            targeted_value=candidate,
                        ),
                        _documents(current_a=before),
                    )
                    self.assertTrue(
                        any('富文本' in finding for finding in blocked.safety_findings)
                    )

    def test_personal_summary_allows_only_an_explicit_empty_clear(self) -> None:
        before = "产品与研发协作经验"
        summary_change = {
            "module_type": "personal_summary",
            "module_id": "current_resume",
            "field_path": "personal_summary",
            "before_value": before,
            "source_refs": ["/currentResume/personal_summary"],
        }

        self.assertAllowed(
            _change(**summary_change, general_value="", targeted_value=""),
            _documents(),
        )
        for candidate in ("<br>", "<p></p>", "<strong>&nbsp;</strong>", "\ufe0f"):
            with self.subTest(candidate=candidate):
                self.assertBlocked(
                    _change(
                        **summary_change,
                        general_value=candidate,
                        targeted_value=candidate,
                    ),
                    _documents(),
                )

        self.assertFalse(preserves_rich_text_structure(before, ""))

    def test_quoted_attribute_tokenizer_preserves_real_anchor_href(self) -> None:
        before = '<a title=">" href="https://safe.example">old</a>'
        safe_candidate = '<a title=">" href="https://safe.example">new</a>'
        evil_candidate = '<a title=">" href="https://evil.example">new</a>'

        self.assertTrue(preserves_rich_text_structure(before, safe_candidate))
        self.assertFalse(preserves_rich_text_structure(before, evil_candidate))
        blocked = self.assertBlocked(
            _change(
                before_value=before,
                general_value=evil_candidate,
                targeted_value=evil_candidate,
            ),
            _documents(current_a=before),
        )
        self.assertTrue(any('富文本' in finding for finding in blocked.safety_findings))

    def test_anchor_href_ignores_decoys_inside_other_quoted_attributes(self) -> None:
        before = (
            "<a title='note href=\"https://decoy.example\"' "
            'href="https://safe.example">old</a>'
        )
        safe_candidate = (
            "<a title='note href=\"https://decoy.example\"' "
            'href="https://safe.example">new</a>'
        )
        evil_candidate = (
            "<a title='note href=\"https://decoy.example\"' "
            'href="https://evil.example">new</a>'
        )

        self.assertTrue(preserves_rich_text_structure(before, safe_candidate))
        self.assertFalse(preserves_rich_text_structure(before, evil_candidate))

    def test_rejects_duplicate_href_and_unclosed_quoted_attribute(self) -> None:
        before = '<a href="https://safe.example">old</a>'
        for candidate in (
            '<a href="https://safe.example" href="https://evil.example">new</a>',
            '<a title="unterminated>new</a>',
        ):
            with self.subTest(candidate=candidate):
                self.assertFalse(preserves_rich_text_structure(before, candidate))

        self.assertFalse(
            preserves_rich_text_structure(
                "<strong>old</strong>",
                '<strong class="a" class="b">new</strong>',
            )
        )

    def test_rejects_protected_tag_name_typos_even_when_inner_signature_survives(self) -> None:
        before = "<strong>项目</strong>"
        for tag_name in ("strong.foo", "strong_bar", "strong@x", "strong-x"):
            candidate = f"<{tag_name}><strong>项目</strong></{tag_name}>"
            with self.subTest(tag_name=tag_name):
                self.assertFalse(preserves_rich_text_structure(before, candidate))
                blocked = self.assertBlocked(
                    _change(
                        before_value=before,
                        general_value=candidate,
                        targeted_value=candidate,
                    ),
                    _documents(current_a=before),
                )
                self.assertTrue(any('富文本' in finding for finding in blocked.safety_findings))

        self.assertTrue(
            preserves_rich_text_structure(
                before,
                '<strong class="new">项目</strong>',
            )
        )

    def test_rejects_crossing_p_and_div_with_protected_wrappers(self) -> None:
        cases = (
            (
                '<a href="https://x.example">项目</a>',
                '<a href="https://x.example"><div>项目</a></div>',
            ),
            (
                "<strong>项目</strong>",
                "<strong><p>项目</strong></p>",
            ),
        )
        for before, candidate in cases:
            with self.subTest(candidate=candidate):
                self.assertFalse(preserves_rich_text_structure(before, candidate))
                blocked = self.assertBlocked(
                    _change(
                        before_value=before,
                        general_value=candidate,
                        targeted_value=candidate,
                    ),
                    _documents(current_a=before),
                )
                self.assertTrue(any('富文本' in finding for finding in blocked.safety_findings))

    def test_rejects_unterminated_protected_tag_like_prefixes(self) -> None:
        before = "原行动"
        for candidate in (
            "<strong",
            'text <a href="https://x.example"',
            "<div",
            "text <p class=",
            "<script",
            "<x-shell",
        ):
            with self.subTest(candidate=candidate):
                self.assertFalse(preserves_rich_text_structure(before, candidate))
                blocked = self.assertBlocked(
                    _change(
                        before_value=before,
                        general_value=candidate,
                        targeted_value=candidate,
                    ),
                    _documents(current_a=before),
                )
                self.assertTrue(any('富文本' in finding for finding in blocked.safety_findings))

        self.assertTrue(preserves_rich_text_structure(before, "2 < 3"))
        self.assertFalse(preserves_rich_text_structure(before, "<x-shell>new</x-shell>"))
        self.assertFalse(
            preserves_rich_text_structure(before, "<table><tr><td>new</td></tr></table>")
        )
        self.assertFalse(
            preserves_rich_text_structure(before, "<p>a<div>b</div>c</p>")
        )
        self.assertTrue(
            preserves_rich_text_structure(before, "new<!-- <x-shell -->")
        )
        self.assertFalse(
            preserves_rich_text_structure(
                before,
                "<script>const value = '<x-shell';</script>new",
            )
        )

    def test_blocks_numeric_metric_substitution(self) -> None:
        source = "完成 3 次迭代"
        self.assertBlocked(
            _change(
                before_value=source,
                general_value="效率提升 30%",
                targeted_value="效率提升 30%",
            ),
            _documents(current_a=source),
        )

    def test_blocks_unsupported_chinese_integer_decimal_percent_and_quantities(self) -> None:
        cases = (
            "覆盖一万用户",
            "用户规模达一万",
            "年营收两亿",
            "服务三百",
            "转化率提升百分之三十二",
            "节省三点五万元",
            "服务一百二十家客户",
            "处理时长缩短至二点五分钟",
            "错误率降低千分之五",
            "覆盖两万名用户",
        )
        for candidate in cases:
            with self.subTest(candidate=candidate):
                blocked = self.assertBlocked(
                    _change(
                        before_value="参与业务优化",
                        general_value=candidate,
                        targeted_value=candidate,
                    ),
                    _documents(current_a="参与业务优化"),
                )
                self.assertFalse(blocked.default_selected)
                self.assertTrue(
                    any("数字" in finding or "量化" in finding for finding in blocked.safety_findings)
                )

    def test_chinese_numbers_match_equivalent_sourced_arabic_quantities(self) -> None:
        cases = (
            ("覆盖 10000 用户", "覆盖一万用户"),
            ("转化率提升 32%", "转化率提升百分之三十二"),
            ("节省 3.5 万元", "节省三点五万元"),
            ("服务 120 家客户", "服务一百二十家客户"),
            ("错误率降低 0.5%", "错误率降低千分之五"),
            ("覆盖 2万用户", "覆盖两万名用户"),
            ("营收 2.5亿元", "营收二点五亿元"),
            ("覆盖两万用户", "覆盖 2 万用户"),
            ("营收二点五亿元", "营收 2.5亿元"),
            ("用户规模达 10000", "用户规模达一万"),
            ("年营收 2亿", "年营收两亿"),
            ("服务 300", "服务三百"),
        )
        for source, candidate in cases:
            with self.subTest(source=source, candidate=candidate):
                source_numbers = _numeric_expressions(source)
                candidate_numbers = _numeric_expressions(candidate)
                self.assertTrue(source_numbers)
                self.assertEqual(
                    [item.identity for item in candidate_numbers],
                    [item.identity for item in source_numbers],
                )
                self.assertAllowed(
                    _change(
                        before_value="参与业务优化",
                        general_value=candidate,
                        targeted_value=candidate,
                    ),
                    _documents(current_a=source, selected_a=source),
                )

    def test_blocks_unsourced_abbreviated_and_grouped_numbers(self) -> None:
        for candidate in (
            "服务10k用户",
            "服务10K",
            "覆盖1.5m用户",
            "处理2B订单",
            "触达10w用户",
            "服务10,000用户",
        ):
            with self.subTest(candidate=candidate):
                blocked = self.assertBlocked(
                    _change(
                        before_value="参与业务运营",
                        general_value=candidate,
                        targeted_value=candidate,
                    ),
                    _documents(current_a="参与业务运营"),
                )
                self.assertFalse(blocked.default_selected)
                self.assertTrue(any("数字" in item for item in blocked.safety_findings))

    def test_abbreviated_and_grouped_numbers_match_full_numeric_sources(self) -> None:
        for source, candidate in (
            ("服务10000用户", "服务10k用户"),
            ("服务10000", "服务10K"),
            ("覆盖1500000用户", "覆盖1.5M用户"),
            ("处理2000000000订单", "处理2b订单"),
            ("触达100000用户", "触达10W用户"),
            ("服务10000用户", "服务10,000用户"),
        ):
            with self.subTest(source=source, candidate=candidate):
                self.assertEqual(
                    [item.identity for item in _numeric_expressions(candidate)],
                    [item.identity for item in _numeric_expressions(source)],
                )
                self.assertAllowed(
                    _change(
                        before_value="参与业务运营",
                        general_value=candidate,
                        targeted_value=candidate,
                    ),
                    _documents(current_a=source, selected_a=source),
                )

    def test_abbreviated_number_boundaries_ignore_storage_metrics_and_versions(self) -> None:
        for candidate in (
            "缓存大小10KB",
            "缓存大小10 KB",
            "缓存大小10MiB",
            "发布版本 10K",
            "release version 10M",
        ):
            with self.subTest(candidate=candidate):
                expressions = _numeric_expressions(candidate)
                self.assertEqual(len(expressions), 1)
                self.assertEqual(expressions[0].unit, "opaque-token")
        for candidate in (
            "维护KPI指标",
            "发布版本v10K",
            "保留token APIv10M",
        ):
            with self.subTest(candidate=candidate):
                self.assertEqual(_numeric_expressions(candidate), [])

    def test_chinese_composite_magnitudes_cannot_fall_back_to_bare_numbers(self) -> None:
        for source, candidate in (
            ("营收1", "营收1万亿元"),
            ("覆盖1", "覆盖1万亿用户"),
            ("覆盖1", "覆盖1百万用户"),
            ("覆盖1", "覆盖1千万用户"),
            ("覆盖2", "覆盖2千用户"),
            ("营收1", "营收1百万元"),
            ("营收1", "营收1千万元"),
        ):
            with self.subTest(source=source, candidate=candidate):
                blocked = self.assertBlocked(
                    _change(
                        before_value="参与业务运营",
                        general_value=candidate,
                        targeted_value=candidate,
                    ),
                    _documents(current_a=source, selected_a=source),
                )
                self.assertFalse(blocked.default_selected)

    def test_chinese_composite_magnitudes_match_expanded_sources(self) -> None:
        for source, candidate in (
            ("营收10000亿元", "营收1万亿元"),
            ("营收1000000000000元", "营收1万亿元"),
            ("覆盖1000000000000用户", "覆盖1万亿用户"),
            ("覆盖1000000用户", "覆盖1百万用户"),
            ("覆盖10000000用户", "覆盖1千万用户"),
            ("覆盖2000用户", "覆盖2千用户"),
            ("营收100万元", "营收1百万元"),
            ("营收1000万元", "营收1千万元"),
        ):
            with self.subTest(source=source, candidate=candidate):
                self.assertEqual(
                    [item.identity for item in _numeric_expressions(candidate)],
                    [item.identity for item in _numeric_expressions(source)],
                )

    def test_english_magnitudes_cannot_fall_back_to_bare_numbers(self) -> None:
        for source, candidate in (
            ("served 1", "served 1 million users"),
            ("revenue 2", "revenue 2 billion USD"),
            ("served 1", "served 1 gazillion users"),
        ):
            with self.subTest(source=source, candidate=candidate):
                blocked = self.assertBlocked(
                    _change(
                        before_value="supported operations",
                        general_value=candidate,
                        targeted_value=candidate,
                    ),
                    _documents(current_a=source, selected_a=source),
                )
                self.assertFalse(blocked.default_selected)

    def test_english_magnitudes_and_abbreviations_match_expanded_sources(self) -> None:
        for source, candidate in (
            ("served 1000000 users", "served 1 million users"),
            ("revenue 2000000000 USD", "revenue 2 billion USD"),
            ("revenue 1000000000000 USD", "revenue 1 trillion USD"),
            ("revenue 2000000000 USD", "revenue 2B USD"),
        ):
            with self.subTest(source=source, candidate=candidate):
                self.assertEqual(
                    [item.identity for item in _numeric_expressions(candidate)],
                    [item.identity for item in _numeric_expressions(source)],
                )

    def test_english_units_are_part_of_numeric_identity(self) -> None:
        for source, candidate in (
            ("served 100 users", "served 100 orders"),
            ("delivered 5 projects", "delivered 5 years"),
            ("worked 3 months", "worked 3 days"),
            ("improved 5 percent", "improved 5 percentage points"),
            ("revenue 2 USD", "revenue 2 CNY"),
        ):
            with self.subTest(source=source, candidate=candidate):
                blocked = self.assertBlocked(
                    _change(
                        before_value="supported operations",
                        general_value=candidate,
                        targeted_value=candidate,
                    ),
                    _documents(current_a=source, selected_a=source),
                )
                self.assertFalse(blocked.default_selected)

    def test_english_unit_singular_and_plural_forms_are_equivalent(self) -> None:
        for source, candidate in (
            ("served 1 user", "served 1 users"),
            ("delivered 1 project", "delivered 1 projects"),
            ("worked 1 year", "worked 1 years"),
            ("worked 1 month", "worked 1 months"),
            ("worked 1 day", "worked 1 days"),
        ):
            with self.subTest(source=source, candidate=candidate):
                self.assertEqual(
                    [item.identity for item in _numeric_expressions(candidate)],
                    [item.identity for item in _numeric_expressions(source)],
                )

    def test_arabic_numbers_capture_full_chinese_classifier_and_unit(self) -> None:
        for source, candidate in (
            ("提升30", "提升30个百分点"),
            ("覆盖30", "覆盖30个用户"),
            ("服务30", "服务30名用户"),
            ("耗时30", "耗时30秒"),
            ("距离30", "距离30公里"),
        ):
            with self.subTest(source=source, candidate=candidate):
                blocked = self.assertBlocked(
                    _change(
                        before_value="参与业务运营",
                        general_value=candidate,
                        targeted_value=candidate,
                    ),
                    _documents(current_a=source, selected_a=source),
                )
                self.assertFalse(blocked.default_selected)

    def test_arabic_chinese_classifier_variants_keep_semantic_unit(self) -> None:
        for source, candidate in (
            ("覆盖30用户", "覆盖30个用户"),
            ("服务30用户", "服务30名用户"),
            ("服务30用户", "服务30位用户"),
        ):
            with self.subTest(source=source, candidate=candidate):
                self.assertEqual(
                    [item.identity for item in _numeric_expressions(candidate)],
                    [item.identity for item in _numeric_expressions(source)],
                )

    def test_generic_english_and_chinese_object_units_keep_identity(self) -> None:
        for source, candidate in (
            ("completed 5 tasks", "completed 5 clients"),
            ("created 5 dashboards", "created 5 models"),
            ("创建5个看板", "创建5个模型"),
            ("协助5名同事", "协助5名客户"),
        ):
            with self.subTest(source=source, candidate=candidate):
                blocked = self.assertBlocked(
                    _change(
                        before_value="参与业务运营",
                        general_value=candidate,
                        targeted_value=candidate,
                    ),
                    _documents(current_a=source, selected_a=source),
                )
                self.assertFalse(blocked.default_selected)

    def test_chinese_document_classifier_preserves_its_counted_object(self) -> None:
        for source, candidate in (
            ("每天处理100个订单", "日均处理100份订单"),
            ("每天处理一百个订单", "日均处理一百份订单"),
            ("处理5个合同", "处理5份合同"),
        ):
            with self.subTest(source=source, candidate=candidate):
                self.assertEqual(
                    [item.identity for item in _numeric_expressions(candidate)],
                    [item.identity for item in _numeric_expressions(source)],
                )
                self.assertAllowed(
                    _change(before_value=source, general_value=candidate, targeted_value=candidate),
                    _documents(current_a=source, selected_a=source),
                )
        source = "每天处理100个订单"
        for candidate in (
            "日均处理100份合同",
            "周均处理100份订单",
            "日均处理200份订单",
            "日均处理100份",
        ):
            with self.subTest(candidate=candidate):
                self.assertBlocked(
                    _change(before_value=source, general_value=candidate, targeted_value=candidate),
                    _documents(current_a=source, selected_a=source),
                )
        self.assertEqual(_numeric_expressions("处理100份")[0].unit, "份")

    def test_currency_prefix_and_rate_denominator_are_part_of_identity(self) -> None:
        for source, candidate in (
            ("revenue USD 10K", "revenue EUR 10K"),
            ("$10K budget", "$20K budget"),
            ("100 orders/day", "100 orders/year"),
            ("每月100用户", "每年100用户"),
            ("月均100用户", "年均100用户"),
            ("100用户/月", "100用户/年"),
        ):
            with self.subTest(source=source, candidate=candidate):
                self.assertBlocked(
                    _change(
                        before_value="参与业务运营",
                        general_value=candidate,
                        targeted_value=candidate,
                    ),
                    _documents(current_a=source, selected_a=source),
                )

    def test_fact_visible_numeric_text_joins_inline_nodes_only(self) -> None:
        for candidate in (
            "<strong>10</strong>00用户",
            "[10](https://example.com)00用户",
            "1&#48;00用户",
            "1\u200b000用户",
            "1<!--hidden-->000用户",
        ):
            with self.subTest(candidate=candidate):
                self.assertEqual(
                    [(item.value, item.unit) for item in _numeric_expressions(candidate)],
                    [("1000", "用户")],
                )
        self.assertNotIn(
            ("1000", "用户"),
            [(item.value, item.unit) for item in _numeric_expressions("<p>10</p><p>00用户</p>")],
        )
        self.assertNotIn(
            ("1000", "用户"),
            [(item.value, item.unit) for item in _numeric_expressions("10<br>00用户")],
        )

    def test_fact_visible_text_does_not_form_markdown_across_html_boundaries(self) -> None:
        cross_tag_term = "[Do<strong>c</strong>](https://example.com)ker"
        cross_tag_number = "[1<strong>0</strong>](https://example.com)00用户"
        self.assertEqual(
            _fact_visible_text(cross_tag_term),
            "[Doc](https://example.com)ker",
        )
        self.assertEqual(
            _fact_visible_text(cross_tag_number),
            "[10](https://example.com)00用户",
        )
        self.assertNotIn(
            ("1000", "用户"),
            [(item.value, item.unit) for item in _numeric_expressions(cross_tag_number)],
        )
        self.assertEqual(_fact_visible_text("Do<strong>c</strong>ker"), "Docker")
        self.assertEqual(_fact_visible_text("1<strong>0</strong>00用户"), "1000用户")

        for source, candidate in (
            (cross_tag_number, "服务1000用户"),
            ("[1<script>ignored</script>0](https://example.com)00用户", "服务1000用户"),
        ):
            with self.subTest(source=source):
                self.assertBlocked(
                    _change(
                        before_value="参与交付",
                        general_value=candidate,
                        targeted_value=candidate,
                        introduced_terms=[],
                        source_refs=[f"/selectedSourceExperiences/{EXP_A}/star/a"],
                    ),
                    _documents(current_a="参与交付", selected_a=source),
                )

    def test_visible_inline_markers_preserve_numeric_transition_order_checks(self) -> None:
        for source, candidate in (
            ("<strong>from</strong> 100 to 200", "<strong>from</strong> 200 to 100"),
            ("**from** 100 to 200", "**from** 200 to 100"),
            ("[from](https://example.com) 100 to 200", "[from](https://example.com) 200 to 100"),
            ("from\u200b 100 to 200", "from\u200b 200 to 100"),
        ):
            with self.subTest(source=source):
                self.assertBlocked(
                    _change(
                        before_value=source,
                        general_value=candidate,
                        targeted_value=candidate,
                    ),
                    _documents(current_a=source, selected_a=source),
                )

    def test_hidden_markup_cannot_support_visible_numeric_or_term_claims(self) -> None:
        hidden_sources = (
            "<a href='/1000用户/docker'>案例</a>负责产品交付",
            "案例<!-- 1000用户 Docker -->负责产品交付",
            "案例<script>1000用户 Docker</script>负责产品交付",
            "案例<style>1000用户 Docker</style>负责产品交付",
            "案例<title>1000用户 Docker</title>负责产品交付",
            "案例<noscript>1000用户 Docker</noscript>负责产品交付",
            "案例<span hidden>1000用户 Docker</span>负责产品交付",
            "案例<span style=display:none>1000用户 Docker</span>负责产品交付",
            "案例<span style=visibility:hidden>1000用户 Docker</span>负责产品交付",
            "案例<span style='display&#58;none'>1000用户 Docker</span>负责产品交付",
            "[案例](https://example.com/1000用户/Docker)负责产品交付",
        )
        for source in hidden_sources:
            with self.subTest(source=source, claim="number"):
                self.assertBlocked(
                    _change(
                        before_value="负责产品交付",
                        general_value="负责产品交付，服务1000用户",
                        targeted_value="负责产品交付，服务1000用户",
                    ),
                    _documents(current_a=source, selected_a=source),
                )

    def test_hidden_candidate_subtrees_cannot_bypass_visible_fact_checks(self) -> None:
        hidden_candidates = (
            "<span hidden><strong>主导项目，服务100个客户</strong></span>参与支付项目",
            "<div aria-hidden=true>主导项目，服务100个客户</div>参与支付项目",
            "<div style=display:none>主导项目，服务100个客户</div>参与支付项目",
        )
        for candidate in hidden_candidates:
            with self.subTest(candidate=candidate):
                self.assertBlocked(
                    _change(
                        before_value="参与支付项目",
                        general_value=candidate,
                        targeted_value=candidate,
                    ),
                    _documents(
                        current_a="参与支付项目",
                        selected_a="参与支付项目",
                    ),
                )
        self.assertAllowed(
            _change(
                before_value="参与支付项目",
                general_value='<strong aria-hidden="false">参与支付项目</strong>',
                targeted_value='<strong aria-hidden="false">参与支付项目</strong>',
            ),
            _documents(current_a="参与支付项目", selected_a="参与支付项目"),
        )
        self.assertAllowed(
            _change(
                before_value="参与支付项目",
                general_value="参与支付项目<!-- <span hidden>非渲染备注</span> -->",
                targeted_value="参与支付项目<!-- <span hidden>非渲染备注</span> -->",
            ),
            _documents(current_a="参与支付项目", selected_a="参与支付项目"),
        )

    def test_hidden_void_html_does_not_hide_following_visible_claims(self) -> None:
        for candidate in (
            "参与项目<br hidden>服务1000用户",
        ):
            with self.subTest(candidate=candidate):
                self.assertBlocked(
                    _change(
                        before_value="参与项目",
                        general_value=candidate,
                        targeted_value=candidate,
                        introduced_terms=[],
                    ),
                    _documents(current_a="参与项目", selected_a="参与项目"),
                )


    def test_rich_text_rejects_unsafe_controls_and_unicode_noncharacters(self) -> None:
        unsafe = (
            "正文\x01内容",
            "正文&#1;内容",
            "正文&#x0b内容",
            "正文&#127内容",
            "正文&#65534;内容",
            "正文&#xFFFF;内容",
            "正文&#1114111内容",
        )
        for candidate in unsafe:
            with self.subTest(candidate=repr(candidate)):
                self.assertFalse(preserves_rich_text_structure("正文", candidate))
        self.assertTrue(preserves_rich_text_structure("正文", "正文\t换行\n内容"))


    def test_shared_responsibility_predicate_can_expand_across_the_same_objects(self) -> None:
        for source, candidate in (
            ("开发前端和后端", "开发前端，并开发后端"),
            (
                "Developed frontend and backend",
                "Built frontend and developed backend",
            ),
        ):
            with self.subTest(source=source, candidate=candidate):
                self.assertAllowed(
                    _change(
                        before_value=source,
                        general_value=candidate,
                        targeted_value=candidate,
                    ),
                    _documents(current_a=source, selected_a=source),
                )


    def test_multiple_actor_predicates_keep_each_clause_owner(self) -> None:
        source = "The team led phase one while I drove phase two"
        self.assertAllowed(
            _change(
                before_value="I participated in the project",
                general_value="I drove phase two",
                targeted_value="I drove phase two",
            ),
            _documents(current_a=source, selected_a=source),
        )
        self.assertAllowed(
            _change(
                before_value="I analyzed metrics",
                general_value="I led the project",
                targeted_value="I led the project",
            ),
            _documents(
                current_a="I analyzed metrics by leading the project",
                selected_a="I analyzed metrics by leading the project",
            ),
        )
        for source, candidate in (
            ("Project delivery was supported by me", "I supported project delivery"),
            ("Delivered the project by leading execution", "Led execution to deliver the project"),
        ):
            with self.subTest(source=source, candidate=candidate):
                self.assertAllowed(
                    _change(
                        before_value=source,
                        general_value=candidate,
                        targeted_value=candidate,
                    ),
                    _documents(current_a=source, selected_a=source),
                )
        for source in (
            "Worked on delivery",
            "Was involved in delivery",
            "参加交付",
            "协作完成交付",
        ):
            with self.subTest(source=source):
                self.assertAllowed(
                    _change(
                        before_value=source,
                        general_value="Participated in delivery" if source[0].isascii() else "参与交付",
                        targeted_value="Participated in delivery" if source[0].isascii() else "参与交付",
                    ),
                    _documents(current_a=source, selected_a=source),
                )
        for source, candidate in (
            ("从零主导项目", "主导项目"),
            ("跨部门主导项目", "主导项目"),
            ("在项目中主导交付", "主导交付"),
            ("于业务中主导项目", "主导项目"),
        ):
            with self.subTest(source=source):
                self.assertAllowed(
                    _change(
                        before_value=source,
                        general_value=candidate,
                        targeted_value=candidate,
                    ),
                    _documents(current_a=source, selected_a=source),
                )
        self.assertAllowed(
            _change(
                before_value="协作完成交付",
                general_value="参与并完成交付",
                targeted_value="参与并完成交付",
            ),
            _documents(
                current_a="协作完成交付",
                selected_a="协作完成交付",
            ),
        )
        self.assertAllowed(
            _change(
                before_value="Not only participated but also supported delivery",
                general_value="Participated and supported delivery",
                targeted_value="Participated and supported delivery",
            ),
            _documents(
                current_a="Not only participated but also supported delivery",
                selected_a="Not only participated but also supported delivery",
            ),
        )
        self.assertAllowed(
            _change(
                before_value="Not only correlated but also contributed",
                general_value="Correlated and contributed",
                targeted_value="Correlated and contributed",
            ),
            _documents(
                current_a="Not only correlated but also contributed",
                selected_a="Not only correlated but also contributed",
            ),
        )
        self.assertAllowed(
            _change(
                before_value="After launch metrics grew",
                general_value="Following launch metrics grew",
                targeted_value="Following launch metrics grew",
            ),
            _documents(
                current_a="After launch metrics grew",
                selected_a="After launch metrics grew",
            ),
        )

    def test_public_verifier_keeps_actual_clause_before_future_clause(self) -> None:
        for source, candidate in (
            ("I led phase one and may support phase two", "I led phase one"),
            ("我主导一期并计划支持二期", "我主导一期"),
            ("I led the May launch", "Led the May launch"),
            ("主导年度计划制定", "主导年度规划制定"),
            (
                "If selected, the team would lead. I participated in testing",
                "I participated in testing",
            ),
        ):
            with self.subTest(source=source, candidate=candidate):
                self.assertAllowed(
                    _change(
                        before_value="参与项目",
                        general_value=candidate,
                        targeted_value=candidate,
                    ),
                    _documents(current_a=source, selected_a=source),
                )

    def test_conditional_causality_and_numbers_cannot_support_actual_claims(self) -> None:
        for source, candidate in (
            ("如果上线，预计将带来营收增长30%", "上线带来营收增长30%"),
            ("优化可能导致转化率提升20%", "优化导致转化率提升20%"),
            ("changes could lead to growth of 30%", "changes led to growth of 30%"),
            ("revenue may grow 30%", "revenue grew 30%"),
            ("revenue likely grows 30%", "revenue grew 30%"),
            ("revenue will grow 30%", "revenue grew 30%"),
            ("将增长30%", "增长30%"),
            ("争取营收增长30%", "营收增长30%"),
            ("营收增长30%的目标", "已实现营收增长30%"),
        ):
            with self.subTest(source=source, candidate=candidate):
                self.assertBlocked(
                    _change(
                        before_value="参与业务优化",
                        general_value=candidate,
                        targeted_value=candidate,
                    ),
                    _documents(current_a=source, selected_a=source),
                )


    def test_common_hyphenated_phrases_are_not_technical_terms(self) -> None:
        for candidate in (
            "worked cross-functional initiatives",
            "supported end-to-end delivery",
            "refined go-to-market planning",
        ):
            with self.subTest(candidate=candidate):
                self.assertAllowed(
                    _change(
                        before_value="supported delivery",
                        general_value=candidate,
                        targeted_value=candidate,
                        introduced_terms=[],
                    ),
                    _documents(current_a=candidate, selected_a=candidate),
                )
        for source, candidate in (
            ("first quarter delivery", "Q1 delivery"),
            ("best practice training", "training on best practices"),
            ("Prepared the first draft", "Completed preparation of the first draft"),
            ("参加 ISO 认证培训", "参与 ISO 认证培训"),
            ("参加 AWS 培训", "参与 AWS 培训"),
            ("生成唯一标识符", "创建唯一标识符"),
            ("Built the first solution in China", "Built China's first solution"),
            ("Helped improve quality", "Contributed to improvement"),
        ):
            with self.subTest(source=source, candidate=candidate):
                self.assertAllowed(
                    _change(
                        before_value=source,
                        general_value=candidate,
                        targeted_value=candidate,
                        introduced_terms=[],
                    ),
                    _documents(current_a=source, selected_a=source),
                )

    def test_personal_summary_cannot_cite_unrelated_current_resume_fields(self) -> None:
        documents = _documents()
        documents["currentResume"]["profile"] = {"phone": "13800138000"}
        self.assertBlocked(
            _change(
                module_type="personal_summary",
                module_id="current_resume",
                field_path="personal_summary",
                before_value="产品经理",
                general_value="产品经理，联系电话13800138000",
                targeted_value="产品经理，联系电话13800138000",
                source_refs=["/currentResume/profile/phone"],
            ),
            documents,
        )

    def test_personal_summary_may_cite_only_selected_current_resume_experiences(self) -> None:
        before = "产品与研发协作经验"
        candidate = "产品与研发协作经验，参与支付页面改版"
        self.assertAllowed(
            _change(
                module_type="personal_summary",
                module_id="current_resume",
                field_path="personal_summary",
                before_value=before,
                general_value=candidate,
                targeted_value=candidate,
                source_refs=[
                    "/currentResume/personal_summary",
                    f"/currentResume/experiences/{EXP_A}/star/a",
                ],
            ),
            _documents(),
        )
        unselected_documents = _documents()
        unselected_documents["currentResume"]["experiences"]["not-selected"] = {
            "star": {"a": "参与支付页面改版"}
        }
        self.assertBlocked(
            _change(
                module_type="personal_summary",
                module_id="current_resume",
                field_path="personal_summary",
                before_value=before,
                general_value=candidate,
                targeted_value=candidate,
                source_refs=[
                    "/currentResume/personal_summary",
                    "/currentResume/experiences/not-selected/star/a",
                ],
            ),
            unselected_documents,
        )

    def test_unchanged_candidate_cannot_forge_frozen_before_text(self) -> None:
        forged = "使用 Docker 主导项目"
        forged_documents = _documents(current_a="参与项目", selected_a="参与项目")
        forged_documents["__preserveFrozenMismatch__"] = True
        self.assertBlocked(
            _change(
                before_value=forged,
                general_value=forged,
                targeted_value=forged,
            ),
            forged_documents,
        )
        exact = "参与项目"
        self.assertAllowed(
            _change(
                before_value=exact,
                general_value=exact,
                targeted_value=exact,
            ),
            _documents(current_a=exact, selected_a=exact),
        )

    def test_every_mutable_change_binds_before_value_to_frozen_resume(self) -> None:
        for before, candidate in (
            ("伪造旧文案", "安全新文案"),
            ("另一段伪造旧文案", "另一段安全新文案"),
        ):
            with self.subTest(before=before):
                documents = _documents(
                    current_a="冻结真实文案",
                    selected_a="冻结真实文案",
                )
                documents["__preserveFrozenMismatch__"] = True
                self.assertBlocked(
                    _change(
                        before_value=before,
                        general_value=candidate,
                        targeted_value=candidate,
                    ),
                    documents,
                )
        summary_documents = _documents()
        summary_documents["currentResume"]["personal_summary"] = None
        self.assertBlocked(
            _change(
                module_type="personal_summary",
                module_id="current_resume",
                field_path="personal_summary",
                before_value="伪造旧简介",
                general_value="安全新简介",
                targeted_value="安全新简介",
                source_refs=["/currentResume/personal_summary"],
            ),
            summary_documents,
        )
        missing_documents = _documents(current_a="冻结真实文案")
        del missing_documents["currentResume"]["experiences"][EXP_A]["star"]["a"]
        missing_documents["__preserveFrozenMismatch__"] = True
        self.assertBlocked(
            _change(
                before_value="伪造旧文案",
                general_value="安全新文案",
                targeted_value="安全新文案",
            ),
            missing_documents,
        )

    def test_order_changes_bind_before_value_to_frozen_resume(self) -> None:
        documents = _documents()
        documents["currentResume"]["skills"] = [{"id": "s1"}, {"id": "s2"}]
        documents["currentResume"]["section_order"] = ["summary", "experience"]
        for module_type, module_id, field_path, frozen, forged in (
            (
                "skills_order",
                "skills",
                "skills.order",
                ["s1", "s2"],
                ["s2", "s1"],
            ),
            (
                "section_order",
                "sections",
                "section_order",
                ["summary", "experience"],
                ["experience", "summary"],
            ),
        ):
            with self.subTest(module_type=module_type):
                self.assertBlocked(
                    _change(
                        module_type=module_type,
                        module_id=module_id,
                        field_path=field_path,
                        before_value=forged,
                        general_value=forged,
                        targeted_value=forged,
                        source_refs=[],
                    ),
                    documents,
                )
                self.assertAllowed(
                    _change(
                        module_type=module_type,
                        module_id=module_id,
                        field_path=field_path,
                        before_value=frozen,
                        general_value=frozen,
                        targeted_value=frozen,
                        source_refs=[],
                    ),
                    documents,
                )


    def test_high_risk_fact_claims_allow_exact_visible_source_evidence(self) -> None:
        source = "参与项目并获评年度最佳产品"
        self.assertAllowed(
            _change(
                before_value="参与项目",
                general_value=source,
                targeted_value=source,
            ),
            _documents(current_a=source, selected_a=source),
        )


    def test_fuzzy_chinese_numerals_fail_closed_without_partial_exact_match(self) -> None:
        for candidate in (
            "增长十几个百分点",
            "服务十几人",
            "服务几十几人",
            "服务百十几人",
            "服务十几个用户",
            "覆盖百十余万用户",
        ):
            with self.subTest(candidate=candidate):
                self.assertTrue(_invalid_chinese_quantities(candidate))
                blocked = self.assertBlocked(
                    _change(
                        before_value="参与业务运营",
                        general_value=candidate,
                        targeted_value=candidate,
                    ),
                    _documents(current_a="服务10人", selected_a="服务10人"),
                )
                self.assertFalse(blocked.default_selected)

    def test_colloquial_chinese_numeric_ranges_are_not_exact_numbers(self) -> None:
        for source, candidate in (
            ("覆盖一两万用户", "覆盖12万用户"),
            ("服务两三万人", "服务23万人"),
            ("营收三四亿元", "营收34亿元"),
        ):
            with self.subTest(source=source, candidate=candidate):
                self.assertTrue(_invalid_chinese_quantities(source))
                self.assertBlocked(
                    _change(
                        before_value="参与业务运营",
                        general_value=candidate,
                        targeted_value=candidate,
                    ),
                    _documents(current_a=source, selected_a=source),
                )
        self.assertEqual(_invalid_chinese_quantities("编号二〇二四"), [])

    def test_scale_thresholds_do_not_share_exact_numeric_identity(self) -> None:
        for source, candidate in (
            ("服务一百人", "服务上百人"),
            ("服务一百人", "服务过百人"),
            ("服务一百人", "服务破百人"),
            ("服务一千人", "服务上千人"),
            ("覆盖一千万用户", "覆盖上千万用户"),
        ):
            with self.subTest(source=source, candidate=candidate):
                blocked = self.assertBlocked(
                    _change(
                        before_value="参与业务运营",
                        general_value=candidate,
                        targeted_value=candidate,
                    ),
                    _documents(current_a=source, selected_a=source),
                )
                self.assertFalse(blocked.default_selected)

    def test_numeric_qualifiers_are_not_interchangeable_with_exact_claims(self) -> None:
        for source, candidate in (
            ("覆盖10000用户", "覆盖超过10000用户"),
            ("营收1亿元", "营收突破1亿元"),
            ("转化率提升30%", "转化率提升超过30%"),
            ("转化率提升30%", "转化率提升三成多"),
            ("覆盖10000用户", "覆盖至少10000用户"),
            ("覆盖10000用户", "覆盖至多10000用户"),
            ("覆盖10000用户", "覆盖约10000用户"),
            ("覆盖10000用户", "覆盖近10000用户"),
            ("覆盖10000用户", "覆盖10000余用户"),
            ("覆盖10000用户", "覆盖10000+用户"),
            ("用户从100增长到200", "用户从超过100增长到200"),
        ):
            with self.subTest(source=source, candidate=candidate):
                blocked = self.assertBlocked(
                    _change(
                        before_value="参与业务运营",
                        general_value=candidate,
                        targeted_value=candidate,
                    ),
                    _documents(current_a=source, selected_a=source),
                )
                self.assertFalse(blocked.default_selected)

    def test_revenue_threshold_magnitude_uses_implicit_rmb_unit(self) -> None:
        self.assertAllowed(
            _change(
                before_value="营收超过1亿元",
                general_value="营收破亿",
                targeted_value="营收破亿",
            ),
            _documents(
                current_a="营收超过1亿元",
                selected_a="营收超过1亿元",
            ),
        )

    def test_equivalent_numeric_qualifiers_keep_the_same_identity(self) -> None:
        cases = (
            ("覆盖至少10000用户", "覆盖10000用户以上"),
            ("覆盖至多10000用户", "覆盖10000用户以下"),
            ("覆盖约10000用户", "覆盖10000用户左右"),
            ("覆盖约10000用户", "覆盖近10000用户"),
            ("覆盖约10000用户", "覆盖10000余用户"),
            ("覆盖至少10000用户", "覆盖10000+用户"),
            ("over 10000", "more than 10000"),
            ("at least 10000", "10000 or more"),
            ("up to 10000", "at most 10000"),
            ("up to 10000 users", "not more than 10000 users"),
            ("about 10000", "around 10000"),
        )
        for source, candidate in cases:
            with self.subTest(source=source, candidate=candidate):
                self.assertEqual(
                    [item.identity for item in _numeric_expressions(candidate)],
                    [item.identity for item in _numeric_expressions(source)],
                )
        self.assertAllowed(
            _change(
                before_value="served up to 100 users",
                general_value="served at most 100 users",
                targeted_value="served at most 100 users",
            ),
            _documents(
                current_a="served up to 100 users",
                selected_a="served up to 100 users",
            ),
        )

    def test_equivalent_approximate_qualifiers_do_not_change_the_metric(self) -> None:
        for source, candidate in (
            (
                "Improved conversion by approximately 20%.",
                "Increased conversion by about 20%.",
            ),
            (
                "Improved conversion by close to 20%.",
                "Increased conversion by about 20%.",
            ),
        ):
            with self.subTest(source=source, candidate=candidate):
                self.assertEqual(
                    [item.identity for item in _numeric_expressions(candidate)],
                    [item.identity for item in _numeric_expressions(source)],
                )
                self.assertAllowed(
                    _change(
                        before_value=source,
                        general_value=candidate,
                        targeted_value=candidate,
                    ),
                    _documents(current_a=source, selected_a=source),
                )
        source = "Improved conversion by approximately 20%."
        for unsupported in (
            "Increased retention by about 20%.",
            "Increased conversion by at least 20%.",
            "Increased conversion by about 30%.",
        ):
            with self.subTest(unsupported=unsupported):
                self.assertBlocked(
                    _change(
                        before_value=source,
                        general_value=unsupported,
                        targeted_value=unsupported,
                    ),
                    _documents(current_a=source, selected_a=source),
                )
        close_rate_source = "Improved close rate by 20%."
        self.assertBlocked(
            _change(
                before_value=close_rate_source,
                general_value="Improved rate by 20%.",
                targeted_value="Improved rate by 20%.",
            ),
            _documents(
                current_a=close_rate_source,
                selected_a=close_rate_source,
            ),
        )

    def test_equivalent_numeric_prefix_qualifiers_preserve_the_metric(self) -> None:
        qualifier_groups = (
            ("at least", "no less than", "no fewer than", "not less than", "greater than or equal to"),
            ("at most", "up to", "no more than", "not more than", "no greater than", "not greater than", "less than or equal to"),
            ("more than", "greater than", "over"),
            ("less than", "under"),
            ("about", "around", "approximately", "approx.", "roughly", "nearly", "almost", "circa", "close to"),
        )
        for qualifiers in qualifier_groups:
            source = f"Improved conversion by {qualifiers[0]} 20%."
            for qualifier in qualifiers:
                candidate = f"Increased conversion by {qualifier} 20%."
                with self.subTest(qualifier=qualifier):
                    self.assertEqual(
                        [item.identity for item in _numeric_expressions(candidate)],
                        [item.identity for item in _numeric_expressions(source)],
                    )
                    self.assertEqual(
                        _numeric_expressions(candidate)[0].metric,
                        "subject:conversion",
                    )
                    self.assertAllowed(
                        _change(
                            before_value=source,
                            general_value=candidate,
                            targeted_value=candidate,
                        ),
                        _documents(current_a=source, selected_a=source),
                    )

    def test_equivalent_qualifier_parsing_keeps_metric_value_and_boundaries(self) -> None:
        source = "Improved conversion by at least 20%."
        for candidate in (
            "Increased retention by no less than 20%.",
            "Increased conversion by no less than 30%.",
            "Increased conversion by no more than 20%.",
            "Increased conversion by greater than 20%.",
            "Increased conversion by about 20%.",
        ):
            with self.subTest(candidate=candidate):
                self.assertBlocked(
                    _change(
                        before_value=source,
                        general_value=candidate,
                        targeted_value=candidate,
                    ),
                    _documents(current_a=source, selected_a=source),
                )

    def test_daily_request_count_accepts_equivalent_period_wording_only(self) -> None:
        source = "每天处理100单客户请求。"
        candidate = "日均处理100单客户请求。"
        self.assertEqual(
            [item.identity for item in _numeric_expressions(candidate)],
            [item.identity for item in _numeric_expressions(source)],
        )
        self.assertAllowed(
            _change(
                before_value=source,
                general_value=candidate,
                targeted_value=candidate,
            ),
            _documents(current_a=source, selected_a=source),
        )
        for unsupported in (
            "每小时处理100单客户请求。",
            "日均处理100桶客户请求。",
            "日均处理200单客户请求。",
        ):
            with self.subTest(unsupported=unsupported):
                self.assertBlocked(
                    _change(
                        before_value=source,
                        general_value=unsupported,
                        targeted_value=unsupported,
                    ),
                    _documents(current_a=source, selected_a=source),
                )

    def test_total_count_adverb_is_not_a_business_segment(self) -> None:
        for source in ("累计处理100单请求。", "总计处理100单请求。"):
            candidate = "共处理100单请求。"
            with self.subTest(source=source):
                self.assertEqual(
                    [item.identity for item in _numeric_expressions(candidate)],
                    [item.identity for item in _numeric_expressions(source)],
                )
                self.assertAllowed(
                    _change(before_value=source, general_value=candidate, targeted_value=candidate),
                    _documents(current_a=source, selected_a=source),
                )
        source = "华东处理100单请求。"
        for candidate in ("华西处理100单请求。", "华东处理200单请求。"):
            with self.subTest(candidate=candidate):
                self.assertBlocked(
                    _change(before_value=source, general_value=candidate, targeted_value=candidate),
                    _documents(current_a=source, selected_a=source),
                )

    def test_quantity_objects_and_rates_ignore_sentence_ending_punctuation(self) -> None:
        for source in ("处理100份订单", "处理一百份订单", "Processed 100 requests per minute"):
            for punctuation in (".", "。", "!", "！", "?", "？", ";", "；"):
                candidate = source + punctuation
                with self.subTest(source=source, punctuation=punctuation):
                    self.assertEqual(
                        [item.identity for item in _numeric_expressions(candidate)],
                        [item.identity for item in _numeric_expressions(source)],
                    )
                    self.assertAllowed(
                        _change(before_value=source, general_value=candidate, targeted_value=candidate),
                        _documents(current_a=source, selected_a=source),
                    )

    def test_punctuated_rate_periods_remain_part_of_numeric_identity(self) -> None:
        source = "Processed 100 requests per minute."
        for candidate in (
            "Processed 100 requests per hour.",
            "Processed 100 requests each day。",
        ):
            with self.subTest(candidate=candidate):
                self.assertBlocked(
                    _change(before_value=source, general_value=candidate, targeted_value=candidate),
                    _documents(current_a=source, selected_a=source),
                )

    def test_compact_numeric_forms_keep_units_and_avoid_display_tokens(self) -> None:
        for source, candidate in (
            ("覆盖1000000用户", "覆盖1e6用户"),
            ("覆盖5000用户", "覆盖.5万用户"),
            ("覆盖至少100000用户", "覆盖10万+用户"),
            ("served at least 10000 users", "served 10000 or more users"),
        ):
            with self.subTest(source=source, candidate=candidate):
                self.assertEqual(
                    [item.identity for item in _numeric_expressions(candidate)],
                    [item.identity for item in _numeric_expressions(source)],
                )
        display_numbers = _numeric_expressions("发布4K视频")
        self.assertEqual(len(display_numbers), 1)
        self.assertEqual(display_numbers[0].unit, "opaque-token")

    def test_malformed_numbers_and_conflicting_qualifiers_fail_closed(self) -> None:
        for candidate in (
            "覆盖1,00,000用户",
            "覆盖1.2.3用户",
            "覆盖1e用户",
            "覆盖..5万用户",
            "覆盖约超过100用户",
            "覆盖至少不到100用户",
            "覆盖100+左右用户",
            "覆盖1,,000用户",
            "served 0x10 users",
            "served 0b101 users",
            "served about over 100 users",
        ):
            with self.subTest(candidate=candidate):
                blocked = self.assertBlocked(
                    _change(
                        before_value="参与业务运营",
                        general_value=candidate,
                        targeted_value=candidate,
                    ),
                    _documents(current_a=candidate, selected_a=candidate),
                )
                self.assertFalse(blocked.default_selected)

    def test_leading_decimal_values_are_not_dropped(self) -> None:
        blocked = self.assertBlocked(
            _change(
                before_value="转化率提升0.5%",
                general_value="转化率提升.6%",
                targeted_value="转化率提升.6%",
            ),
            _documents(current_a="转化率提升0.5%"),
        )
        self.assertFalse(blocked.default_selected)

    def test_per_mille_and_permyriad_normalize_to_percent(self) -> None:
        for source, candidate in (
            ("错误率降低0.5%", "错误率降低5‰"),
            ("错误率降低0.05%", "错误率降低5‱"),
            ("错误率降低千分五", "错误率降低5‰"),
        ):
            with self.subTest(source=source, candidate=candidate):
                self.assertEqual(
                    [item.identity for item in _numeric_expressions(candidate)],
                    [item.identity for item in _numeric_expressions(source)],
                )
        for candidate in ("错误率降低5‰", "错误率降低5‱"):
            with self.subTest(candidate=candidate):
                self.assertBlocked(
                    _change(
                        before_value="参与质量优化",
                        general_value=candidate,
                        targeted_value=candidate,
                    ),
                    _documents(current_a="参与质量优化"),
                )

    def test_numeric_final_audit_tokenizer_and_identity_matrix(self) -> None:
        for candidate in (
            "served .5e6 users",
            "served +.5e6 users",
            "served -.5e-6 users",
            "served .5E999999999 users",
            "served 0o10 users",
            "served 1..0 users",
            "增长多倍",
            "served myriad users",
        ):
            with self.subTest(candidate=candidate):
                self.assertBlocked(
                    _change(
                        before_value="supported operations",
                        general_value=candidate,
                        targeted_value=candidate,
                    ),
                    _documents(current_a="supported operations"),
                )
        for source, candidate in (
            ("served 60s", "served 30s"),
            ("covered 10km", "covered 100km"),
            ("handled 100kg", "handled 200kg"),
            ("served 100Kbps", "served 1000Kbps"),
            ("served 100clients", "served 1000clients"),
            ("processed 100records", "processed 1000records"),
            ("weekly served 100 users", "monthly served 100 users"),
            ("served 100 users/wk", "served 100 users/mo"),
            ("resolution 4K", "resolution 8K"),
            ("video in 4K", "video in 8K"),
            ("aimed to serve 100 users", "served 100 users"),
            ("差点达到100用户", "达到100用户"),
            ("Enterprise served 100 clients; SMB served 200 clients", "Enterprise served 200 clients; SMB served 100 clients"),
            ("Product A served 100 clients", "Product A served 100 clients and Product B served 100 clients"),
            ("admin served 100 clients; partner served 200 clients", "admin served 200 clients; partner served 100 clients"),
            ("US served 100 clients; EU served 200 clients", "US served 200 clients; EU served 100 clients"),
            ("API processed 100 requests; dashboard processed 200 requests", "API processed 200 requests; dashboard processed 100 requests"),
            ("north served 100 clients", "north served 100 clients and south served 100 clients"),
            ("weekly processed 100 orders", "monthly processed 100 orders"),
            ("latency 100ms", "latency 100000000s"),
            ("distance 100km", "distance 100m"),
            ("temperature 100°C", "temperature 100°F"),
        ):
            with self.subTest(source=source, candidate=candidate):
                self.assertBlocked(
                    _change(before_value=source, general_value=candidate, targeted_value=candidate),
                    _documents(current_a=source, selected_a=source),
                )
        for source, candidate in (
            ("served 100 users/h", "served 100 users per hour"),
            ("served 100 users/hr", "served 100 users per hour"),
            ("$100K revenue", "USD 100,000 revenue"),
            ("$1M revenue", "USD 1 million revenue"),
            ("营收100万元", "营收CNY1000000"),
            ("服务100位客户", "服务100客户"),
            ("100-person team", "team of 100 people"),
            ("served 1 out of 10 users", "served 10% users"),
            ("served 1 in 10 users", "served 1/10 users"),
            ("could not serve 100 users", "was unable to serve 100 users"),
            ("计划服务100用户", "目标服务100用户"),
            ("used HTTP/2", "delivered with HTTP/2"),
            ("used TLS1.2", "delivered with TLS1.2"),
            ("used Wi-Fi6", "delivered with Wi-Fi6"),
            ("success ratio 1/10", "success ratio 1:10"),
            ("served 1 of 10 users", "served 1 out of 10 users"),
            ("processed 102 tickets; served 202 sessions", "served 202 sessions; processed 102 tickets"),
            ("latency 100ms", "latency 100 milliseconds"),
            ("latency 1000ms", "latency 1s"),
            ("duration 60s", "duration 1min"),
            ("weight 1kg", "weight 1000g"),
            ("served 1000 users", "served ١٬٠٠٠ users"),
            ("reduced costs 50%", "reduced costs by ½"),
            ("served 75% users", "served ¾ users"),
            ("reduced costs by 1⁄2", "reduced costs by half"),
            ("served 50% of users", "served ½ of users"),
            ("served 75% of users", "served ¾ of users"),
            ("served 1/2 of users", "served half of users"),
            ("could not reach 100 users", "was unable to reach 100 users"),
            ("used HTTP/2", "utilized HTTP/2"),
            ("used TLS1.2", "utilized TLS1.2"),
            ("覆盖超过1万用户", "覆盖过万用户"),
            ("营收＞1亿元", "营收破亿元"),
        ):
            with self.subTest(source=source, candidate=candidate):
                self.assertAllowed(
                    _change(before_value=source, general_value=candidate, targeted_value=candidate),
                    _documents(current_a=source, selected_a=source),
                )

    def test_existing_numeric_occurrences_cannot_move_to_new_local_facts(self) -> None:
        for source, candidate in (
            ("预算100万元", "合同100万元"),
            ("上海服务100用户", "北京服务100用户"),
            ("A产品覆盖100用户", "B产品覆盖100用户"),
        ):
            with self.subTest(source=source, candidate=candidate):
                self.assertBlocked(
                    _change(
                        before_value=source,
                        general_value=candidate,
                        targeted_value=candidate,
                    ),
                    _documents(current_a=source, selected_a=source),
                )

    def test_numeric_assertion_opaque_tokens_and_ranges_keep_identity(self) -> None:
        for source, candidate in (
            ("served 100 users", "did not serve 100 users"),
            ("服务100用户", "没有服务100用户"),
            ("版本1.2.3", "版本1.2.4"),
            ("Node.js 20.1.0", "Node.js 21.1.0"),
            ("range 10K-20K users", "range 15K-20K users"),
        ):
            with self.subTest(source=source, candidate=candidate):
                self.assertBlocked(
                    _change(
                        before_value="参与业务运营",
                        general_value=candidate,
                        targeted_value=candidate,
                    ),
                    _documents(current_a=source, selected_a=source),
                )
        self.assertEqual(
            [item.identity for item in _numeric_expressions("not only served 100 users")],
            [item.identity for item in _numeric_expressions("served 100 users")],
        )
        self.assertAllowed(
            _change(
                before_value="served &amp;#49;00 users",
                general_value="efficiently served &amp;#49;00 users",
                targeted_value="efficiently served &amp;#49;00 users",
            ),
            _documents(
                current_a="served &amp;#49;00 users",
                selected_a="served &amp;#49;00 users",
            ),
        )
        self.assertBlocked(
            _change(
                before_value="served &amp;#49;00 users",
                general_value="served &amp;#50;00 users",
                targeted_value="served &amp;#50;00 users",
            ),
            _documents(
                current_a="served &amp;#49;00 users",
                selected_a="served &amp;#49;00 users",
            ),
        )
        for source, candidate in (
            ("latency reduced 4 ms to 2 ms", "latency reduced 2 ms to 4 ms"),
            ("latency 4 ms → 2 ms", "latency 2 ms → 4 ms"),
            ("处理时长4分钟→2分钟", "处理时长2分钟→4分钟"),
            ("served 100requests/s", "served 100requests/min"),
            ("无法达到100用户", "达到100用户"),
            (
                "web handled hundreds of requests",
                "web handled hundreds of requests and mobile handled hundreds of requests",
            ),
        ):
            with self.subTest(source=source, candidate=candidate):
                self.assertBlocked(
                    _change(
                        before_value=source,
                        general_value=candidate,
                        targeted_value=candidate,
                    ),
                    _documents(current_a=source, selected_a=source),
                )
        self.assertBlocked(
            _change(
                before_value="参与业务优化",
                general_value="成本下降大半",
                targeted_value="成本下降大半",
            ),
            _documents(current_a="参与业务优化"),
        )
        self.assertAllowed(
            _change(
                before_value="latency reduced from 4 ms to 2 ms",
                general_value="latency 4 ms → 2 ms",
                targeted_value="latency 4 ms → 2 ms",
            ),
            _documents(
                current_a="latency reduced from 4 ms to 2 ms",
                selected_a="latency reduced from 4 ms to 2 ms",
            ),
        )

    def test_ratio_qualifier_negation_and_word_number_forms_keep_semantics(self) -> None:
        for source, candidate in (
            ("ratio 1/10", "ratio 10/1"),
            ("served 100 users", "served no fewer than 100 users"),
            ("won't serve 100 users", "served 100 users"),
            ("100 users were not reached", "reached 100 users"),
            ("100 users target", "reached 100 users"),
        ):
            with self.subTest(source=source, candidate=candidate):
                self.assertBlocked(
                    _change(
                        before_value=source,
                        general_value=candidate,
                        targeted_value=candidate,
                    ),
                    _documents(current_a=source, selected_a=source),
                )
        self.assertAllowed(
            _change(
                before_value="served 120 users",
                general_value="served one hundred and twenty users",
                targeted_value="served one hundred and twenty users",
            ),
            _documents(
                current_a="served 120 users",
                selected_a="served 120 users",
            ),
        )

    def test_extreme_scientific_exponents_fail_closed_without_expanded_findings(self) -> None:
        for candidate in ("served 1e100000 users", "served 1e999999999 users"):
            with self.subTest(candidate=candidate):
                blocked = self.assertBlocked(
                    _change(
                        before_value="supported operations",
                        general_value=candidate,
                        targeted_value=candidate,
                    ),
                    _documents(current_a="supported operations"),
                )
                self.assertLess(max(map(len, blocked.safety_findings)), 240)

    def test_each_source_numeric_occurrence_can_support_only_one_new_fact(self) -> None:
        for source, candidate in (
            ("北京服务100用户", "北京服务100用户，上海服务100用户"),
            ("served 100 users", "web served 100 users and mobile served 100 users"),
            ("处理100订单", "处理100订单并支持100订单"),
        ):
            with self.subTest(source=source, candidate=candidate):
                self.assertBlocked(
                    _change(
                        before_value="参与业务运营",
                        general_value=candidate,
                        targeted_value=candidate,
                    ),
                    _documents(current_a=source, selected_a=source),
                )

    def test_existing_numeric_occurrences_cannot_be_rebound_or_duplicated(self) -> None:
        for before, candidate in (
            ("北京服务100用户，上海服务200用户", "北京服务200用户，上海服务100用户"),
            ("北京服务100用户", "北京服务100用户，上海服务100用户"),
            ("web served 100 users", "web served 100 users and mobile served 100 users"),
        ):
            with self.subTest(before=before, candidate=candidate):
                self.assertBlocked(
                    _change(
                        before_value=before,
                        general_value=candidate,
                        targeted_value=candidate,
                    ),
                    _documents(current_a=before, selected_a=before),
                )

    def test_independent_numeric_facts_can_reorder_or_combine_distinct_sources(self) -> None:
        before = "服务100用户，处理200订单"
        self.assertAllowed(
            _change(
                before_value=before,
                general_value="处理200订单，服务100用户",
                targeted_value="处理200订单，服务100用户",
            ),
            _documents(current_a=before, selected_a=before),
        )
        self.assertAllowed(
            _change(
                before_value="服务100用户",
                general_value="服务100用户，处理200订单",
                targeted_value="服务100用户，处理200订单",
                source_refs=[
                    f"/currentResume/experiences/{EXP_A}/star/a",
                    f"/selectedSourceExperiences/{EXP_A}/star/a",
                ],
            ),
            _documents(current_a="服务100用户", selected_a="处理200订单"),
        )

    def test_supported_numeric_format_equivalents_remain_allowed(self) -> None:
        for source, candidate in (
            ("weekly served 100 users", "served 100 users/week"),
            ("served 100 users weekly", "served 100 users/week"),
            ("processed 100 requests per minute", "processed 100 requests each minute"),
            ("processed 100 requests per minute", "processed 100 requests every minute"),
            ("processed 100 requests per minute", "processed 100 requests a minute"),
            ("每周服务100用户", "周均服务100用户"),
            ("每分钟处理100订单", "处理100订单/分钟"),
            ("每秒处理100请求", "处理100请求/秒"),
            ("handled 100rps", "handled 100 requests/s"),
            ("reduced costs 33.333333333333%", "reduced costs by a third"),
            ("served 100-200 users", "served between 100 and 200 users"),
            ("服务100-200用户", "服务100至200用户"),
            ("served 100-200 users", "served 100 to 200 users"),
            ("did not serve 100 users", "100 users were not served"),
            ("used Node.js 20.1.0", "delivered with Node.js 20.1.0"),
            ("ran at 10:30", "executed at 10:30"),
            ("payload 10KB", "kept payload at 10 KB"),
            ("CPU 5GHz", "used a 5 GHz CPU"),
            ("rendered 60fps", "rendered at 60 fps"),
            ("enabled 2FA", "implemented 2FA"),
        ):
            with self.subTest(source=source, candidate=candidate):
                self.assertAllowed(
                    _change(
                        before_value=source,
                        general_value=candidate,
                        targeted_value=candidate,
                        introduced_terms=[],
                    ),
                    _documents(current_a=source, selected_a=source),
                )
        self.assertBlocked(
            _change(
                before_value="processed 100 requests per minute",
                general_value="processed 100 requests each hour",
                targeted_value="processed 100 requests each hour",
            ),
            _documents(
                current_a="processed 100 requests per minute",
                selected_a="processed 100 requests per minute",
            ),
        )
        for current, selected, candidate in (
            ("服务100用户", "处理200订单", "服务100用户并处理200订单"),
            ("转化率提升30%", "留存率提升20%", "转化率提升30%且留存率提升20%"),
            ("北京服务100用户", "上海服务100用户", "北京服务100用户并在上海服务100用户"),
        ):
            with self.subTest(current=current, selected=selected):
                self.assertAllowed(
                    _change(
                        before_value=current,
                        general_value=candidate,
                        targeted_value=candidate,
                        source_refs=[
                            f"/currentResume/experiences/{EXP_A}/star/a",
                            f"/selectedSourceExperiences/{EXP_A}/star/a",
                        ],
                    ),
                    _documents(current_a=current, selected_a=selected),
                )

    def test_rejects_ambiguous_or_malformed_chinese_quantities(self) -> None:
        for source, candidate in (
            ("覆盖 10002 用户", "覆盖一万二用户"),
            ("转化率提升 30%", "转化率提升百分之三点十"),
            ("服务 100000 人", "服务十万万人"),
            ("覆盖 30000 用户", "覆盖数万用户"),
            ("覆盖 20 用户", "覆盖几十用户"),
            ("服务 300 人", "服务数百人"),
            ("服务 30 人", "服务三十余人"),
            ("转化率提升 20%", "转化率提升百分之几十"),
            ("覆盖 30000", "覆盖数万"),
        ):
            with self.subTest(source=source, candidate=candidate):
                blocked = self.assertBlocked(
                    _change(
                        before_value="参与业务优化",
                        general_value=candidate,
                        targeted_value=candidate,
                    ),
                    _documents(current_a=source, selected_a=source),
                )
                self.assertTrue(
                    any(
                        "量化" in finding or "限定" in finding
                        for finding in blocked.safety_findings
                    )
                )

    def test_ordinary_chinese_ordinals_and_lexical_numerals_are_not_quantities(self) -> None:
        for candidate in (
            "负责第二阶段方案设计",
            "打造一站式服务",
            "推动统一流程建设",
            "十分重视用户体验",
        ):
            with self.subTest(candidate=candidate):
                self.assertEqual(_numeric_expressions(candidate), [])
                self.assertAllowed(
                    _change(
                        before_value="参与方案设计",
                        general_value=candidate,
                        targeted_value=candidate,
                    ),
                    _documents(current_a=candidate, selected_a=candidate),
                )

    def test_blocks_unsourced_fixed_and_indeterminate_chinese_quantifiers(self) -> None:
        for candidate in (
            "效率提升双倍",
            "吞吐量翻倍",
            "吞吐量翻一番",
            "吞吐量翻番",
            "吞吐量倍增",
            "成本减半",
            "成本降低一半",
            "成本腰斩",
            "增长三成",
            "降低两成",
            "效率成倍增长",
            "覆盖数以万计",
            "覆盖过亿",
            "营收破亿",
            "用户上万",
            "覆盖近半用户",
            "覆盖大半用户",
        ):
            with self.subTest(candidate=candidate):
                blocked = self.assertBlocked(
                    _change(
                        before_value="参与业务优化",
                        general_value=candidate,
                        targeted_value=candidate,
                    ),
                    _documents(current_a="参与业务优化"),
                )
                self.assertFalse(blocked.default_selected)
                self.assertTrue(
                    any("数字" in finding or "量化" in finding for finding in blocked.safety_findings)
                )

    def test_fixed_chinese_quantifiers_match_equivalent_numeric_sources(self) -> None:
        for source, candidate in (
            ("效率提升至 2 倍", "效率提升双倍"),
            ("吞吐量提升一倍", "吞吐量翻倍"),
            ("吞吐量提升一倍", "吞吐量翻一番"),
            ("吞吐量提升一倍", "吞吐量翻番"),
            ("吞吐量提升一倍", "吞吐量倍增"),
            ("成本降低 50%", "成本减半"),
            ("成本降低 50%", "成本降低一半"),
            ("成本降低 50%", "成本腰斩"),
            ("增长 30%", "增长三成"),
            ("降低 20%", "降低两成"),
            ("吞吐量翻倍", "吞吐量为原来2倍"),
            ("吞吐量翻两番", "吞吐量为原来4倍"),
            ("覆盖超过1万用户", "覆盖过万用户"),
            ("营收超过1亿元", "营收破亿"),
            ("成本降低50%", "成本减少到一半"),
            ("成本降低50%", "成本降至一半"),
        ):
            with self.subTest(source=source, candidate=candidate):
                self.assertEqual(
                    [item.identity for item in _numeric_expressions(candidate)],
                    [item.identity for item in _numeric_expressions(source)],
                )
                self.assertAllowed(
                    _change(
                        before_value=source,
                        general_value=candidate,
                        targeted_value=candidate,
                    ),
                    _documents(current_a=source, selected_a=source),
                )

    def test_chinese_tenths_and_multi_folds_are_normalized(self) -> None:
        for source, candidate in (
            ("增长5%", "增长半成"),
            ("增长15%", "增长一成半"),
            ("增长30%", "增长3成"),
            ("增长35%", "增长三成五"),
            ("吞吐量提升4倍", "吞吐量翻两番"),
            ("吞吐量提升8倍", "吞吐量翻了三番"),
            ("增长150%", "增长一倍半"),
        ):
            with self.subTest(source=source, candidate=candidate):
                self.assertEqual(
                    [item.identity for item in _numeric_expressions(candidate)],
                    [item.identity for item in _numeric_expressions(source)],
                )
        for candidate in ("增长半成", "增长三成五", "吞吐量翻两番"):
            with self.subTest(candidate=candidate):
                self.assertBlocked(
                    _change(
                        before_value="参与业务优化",
                        general_value=candidate,
                        targeted_value=candidate,
                    ),
                    _documents(current_a="参与业务优化"),
                )

    def test_english_fixed_multipliers_are_normalized(self) -> None:
        for source, candidate in (
            ("revenue increased to 2x", "revenue doubled"),
            ("conversion increased to 3x", "conversion tripled"),
            ("costs reduced 50%", "halved costs"),
            ("growth increased to 2x", "growth grew twofold"),
            ("revenue increased to 4x", "revenue quadrupled"),
            ("revenue increased to 4x", "revenue grew fourfold"),
            ("growth increased to 5x", "growth grew fivefold"),
            ("growth increased to 10x", "growth grew tenfold"),
            ("growth increased to 10x", "growth grew an order of magnitude"),
        ):
            with self.subTest(source=source, candidate=candidate):
                self.assertEqual(
                    [item.identity for item in _numeric_expressions(candidate)],
                    [item.identity for item in _numeric_expressions(source)],
                )
        self.assertNotEqual(
            [item.identity for item in _numeric_expressions("increased revenue by 2x")],
            [item.identity for item in _numeric_expressions("increased revenue to 2x")],
        )

    def test_english_number_words_and_fractions_are_numeric_claims(self) -> None:
        for source, candidate in (
            ("served 10 users", "served ten users"),
            ("grew 30%", "grew thirty percent"),
            ("served 1000000 users", "served one million users"),
            ("reduced costs 50%", "reduced costs by half"),
            ("served 12 clients", "served a dozen clients"),
            ("reduced costs 25%", "reduced costs by a quarter"),
            ("costs reduced by half", "costs reduced to one half"),
            ("reduced costs 50%", "cut cost in half"),
        ):
            with self.subTest(source=source, candidate=candidate):
                self.assertEqual(
                    [item.identity for item in _numeric_expressions(candidate)],
                    [item.identity for item in _numeric_expressions(source)],
                )
        for candidate in (
            "served ten users",
            "grew thirty percent",
            "served one million users",
            "reduced costs by half",
            "grew by a third",
            "handled hundreds of requests",
            "served dozens of users",
            "served several thousand users",
            "served a few hundred users",
            "served countless users",
            "served scores of users",
            "served a couple of users",
            "served a handful of users",
            "grew by orders of magnitude",
            "grew severalfold",
            "growth grew tenfold",
            "growth grew fivefold",
            "growth grew an order of magnitude",
        ):
            with self.subTest(candidate=candidate):
                self.assertBlocked(
                    _change(
                        before_value="supported operations",
                        general_value=candidate,
                        targeted_value=candidate,
                    ),
                    _documents(current_a="supported operations"),
                )

    def test_indeterminate_chinese_quantifiers_allow_exact_visible_source_text(self) -> None:
        for candidate in (
            "效率成倍增长",
            "覆盖数以万计",
            "吞吐量提升2倍",
        ):
            with self.subTest(candidate=candidate):
                self.assertAllowed(
                    _change(
                        before_value="参与业务优化",
                        general_value=candidate,
                        targeted_value=candidate,
                    ),
                    _documents(current_a=candidate, selected_a=candidate),
                )

    def test_indeterminate_claims_bind_metric_or_object_not_action_wording(self) -> None:
        for source, candidate in (
            ("项目效率成倍增长", "工作效率成倍增长"),
            ("处理数以万计请求", "服务数以万计请求"),
            ("覆盖数以万计用户", "服务数以万计用户"),
        ):
            with self.subTest(source=source, candidate=candidate):
                self.assertAllowed(
                    _change(
                        before_value="参与业务优化",
                        general_value=candidate,
                        targeted_value=candidate,
                    ),
                    _documents(current_a=source, selected_a=source),
                )
        for source, candidate in (
            ("效率成倍增长", "营收成倍增长"),
            ("处理数以万计请求", "覆盖数以万计客户"),
        ):
            with self.subTest(source=source, candidate=candidate):
                self.assertBlocked(
                    _change(
                        before_value="参与业务优化",
                        general_value=candidate,
                        targeted_value=candidate,
                    ),
                    _documents(current_a=source, selected_a=source),
                )
        self.assertAllowed(
            _change(
                before_value="参与业务优化",
                general_value="收入成倍增长与效率成倍增长",
                targeted_value="收入成倍增长与效率成倍增长",
            ),
            _documents(
                current_a="收入成倍增长，效率成倍增长",
                selected_a="收入成倍增长，效率成倍增长",
            ),
        )

    def test_quantifier_phrase_boundaries_do_not_match_ordinary_words(self) -> None:
        for candidate in (
            "协调双方团队",
            "推动双向沟通",
            "完成文档翻页交互",
            "节奏减半拍后恢复",
            "持续创造业务成就",
            "识别番茄品种",
            "调整页面腰线",
            "节奏慢一半拍",
            "完成代码破译与问题破题",
            "检查上万向节装配",
        ):
            with self.subTest(candidate=candidate):
                self.assertEqual(_numeric_expressions(candidate), [])
                self.assertEqual(_invalid_chinese_quantities(candidate), [])

    def test_allows_unchanged_react_fact(self) -> None:
        source = "使用 React 开发表单"
        allowed = self.assertAllowed(
            _change(before_value=source, general_value=source, targeted_value=source),
            _documents(current_a=source),
        )
        self.assertEqual(allowed.general_value, source)


    def test_allows_linked_answer_number_with_same_metric_context(self) -> None:
        documents = _documents(
            current_a="参与转化率优化",
            answers={"Q1": {"state": "answered", "value": "转化率提升 30%"}},
        )
        change = _change(
            before_value="参与转化率优化",
            general_value="参与转化率优化，转化率提升 30%",
            targeted_value="参与转化率优化，转化率提升 30%",
            source_refs=[f"/currentResume/experiences/{EXP_A}/star/a", "/userAnswers/Q1/value"],
        )
        self.assertAllowed(change, documents, questions=[_question()])

    def test_no_data_answer_does_not_block_qualitative_rewrite_grounded_elsewhere(self) -> None:
        documents = _documents(
            current_a="参与优化交付流程",
            answers={"Q1": {"state": "no_data", "value": ""}},
        )
        change = _change(
            before_value="参与优化交付流程",
            general_value="参与并优化交付流程",
            targeted_value="参与并优化交付流程",
            source_refs=[f"/currentResume/experiences/{EXP_A}/star/a"],
        )
        self.assertAllowed(change, documents, questions=[_question()])

    def test_non_answered_states_cannot_contribute_malicious_factual_values(self) -> None:
        for state in ("no_data", "unknown", "not_my_work", "skipped"):
            with self.subTest(state=state):
                documents = _documents(
                    current_a="参与转化率优化",
                    answers={
                        "Q1": {
                            "state": state,
                            "value": "转化率提升 30%",
                        }
                    },
                )
                change = _change(
                    before_value="参与转化率优化",
                    general_value="参与转化率优化，转化率提升 30%",
                    targeted_value="参与转化率优化，转化率提升 30%",
                    source_refs=[
                        f"/currentResume/experiences/{EXP_A}/star/a",
                        "/userAnswers/Q1/value",
                    ],
                )
                blocked = self.assertBlocked(
                    change,
                    documents,
                    questions=[_question()],
                )
                self.assertTrue(
                    any("回答" in finding for finding in blocked.safety_findings)
                )

    def test_answer_evidence_requires_mapping_and_nonblank_string_value(self) -> None:
        invalid_answers = (
            {"Q1": {"state": "answered", "value": ""}},
            {"Q1": {"state": "answered", "value": "   "}},
            {"Q1": {"state": "answered", "value": 30}},
            {"Q1": "转化率提升 30%"},
        )
        for answers in invalid_answers:
            with self.subTest(answers=answers):
                documents = _documents(
                    current_a="参与转化率优化",
                    answers=answers,
                )
                change = _change(
                    before_value="参与转化率优化",
                    general_value="参与转化率优化，转化率提升 30%",
                    targeted_value="参与转化率优化，转化率提升 30%",
                    source_refs=[
                        f"/currentResume/experiences/{EXP_A}/star/a",
                        "/userAnswers/Q1/value",
                    ],
                )
                self.assertBlocked(change, documents, questions=[_question()])

    def test_invalid_source_pointer_blocks_rewrite(self) -> None:
        blocked = self.assertBlocked(
            _change(source_refs=[f"/currentResume/experiences/{EXP_A}/star/missing"]),
            _documents(),
        )
        self.assertTrue(any("引用" in finding for finding in blocked.safety_findings))

    def test_selected_source_version_can_restore_same_experience_fact(self) -> None:
        source_fact = "使用 SQL 完成漏斗分析"
        self.assertAllowed(
            _change(
                before_value="参与支付页面改版",
                general_value=source_fact,
                targeted_value=source_fact,
                source_refs=[f"/selectedSourceExperiences/{EXP_A}/star/a"],
            ),
            _documents(selected_a=source_fact),
        )

    def test_unselected_bank_content_is_never_evidence(self) -> None:
        documents = _documents()
        documents["experienceBank"] = {"bank-x": {"star": {"a": "使用 Tableau"}}}
        self.assertBlocked(
            _change(
                general_value="参与支付页面改版并使用 Tableau",
                targeted_value="参与支付页面改版并使用 Tableau",
                source_refs=["/experienceBank/bank-x/star/a"],
            ),
            documents,
        )


class SafetyBoundaryTests(unittest.TestCase):
    def assertBlocked(self, change, documents, *, questions=None):
        changes, _ = _verify(change, documents, questions=questions)
        self.assertEqual(changes[0].safety_status, "blocked")
        return changes[0]

    def assertAllowed(self, change, documents, *, questions=None):
        changes, _ = _verify(change, documents, questions=questions)
        self.assertEqual(changes[0].safety_status, "allowed")
        return changes[0]

    def test_experience_refs_must_stay_with_same_experience(self) -> None:
        self.assertBlocked(
            _change(
                general_value="完成数据平台开发",
                targeted_value="完成数据平台开发",
                source_refs=[f"/currentResume/experiences/{EXP_B}/star/a"],
            ),
            _documents(),
        )
        self.assertBlocked(
            _change(
                general_value="完成数据平台开发",
                targeted_value="完成数据平台开发",
                source_refs=[f"/selectedSourceExperiences/{EXP_B}/star/a"],
            ),
            _documents(),
        )

    def test_answer_ref_must_be_linked_to_same_change_and_module(self) -> None:
        documents = _documents(
            answers={"Q2": {"state": "answered", "value": "转化率提升 30%"}}
        )
        candidate = _change(
            general_value="参与支付页面改版，转化率提升 30%",
            targeted_value="参与支付页面改版，转化率提升 30%",
            source_refs=[f"/currentResume/experiences/{EXP_A}/star/a", "/userAnswers/Q2/value"],
        )
        self.assertBlocked(
            candidate,
            documents,
            questions=[_question(question_id="Q2", module_id=EXP_B)],
        )
        self.assertBlocked(
            candidate,
            documents,
            questions=[_question(question_id="Q2", affects=["OTHER_CHANGE"])],
        )

    def test_fullwidth_numbers_percent_decimals_and_units_are_normalized(self) -> None:
        source = "覆盖 １２ 家客户，处理时长从４分钟降至２．５分钟，转化率提升３０％"
        candidate = "覆盖12家客户，处理时长从 4 分钟降至 2.5 分钟，转化率提升 30%"
        self.assertAllowed(
            _change(before_value="参与优化", general_value=candidate, targeted_value=candidate),
            _documents(current_a=source),
        )

    def test_opposite_numeric_direction_is_not_supported_by_same_metric_value(self) -> None:
        source = "成本增加 30%"
        candidate = "成本降低 30%"
        blocked = self.assertBlocked(
            _change(
                before_value="参与成本优化",
                general_value=candidate,
                targeted_value=candidate,
            ),
            _documents(current_a=source),
        )
        self.assertTrue(any("方向" in finding for finding in blocked.safety_findings))

    def test_common_english_and_chinese_direction_inflections_are_canonical(self) -> None:
        for candidate in (
            "revenue grew 30%",
            "revenue climbed 30%",
            "revenue fell 30%",
            "revenue declined 30%",
            "revenue shrank 30%",
            "营收攀升30%",
            "营收上涨30%",
            "营收下滑30%",
            "营收回落30%",
            "营收缩水30%",
        ):
            with self.subTest(candidate=candidate):
                self.assertBlocked(
                    _change(
                        before_value="revenue 30%",
                        general_value=candidate,
                        targeted_value=candidate,
                    ),
                    _documents(current_a="revenue 30%"),
                )
        for source, candidate in (
            ("revenue grew 30%", "revenue climbed 30%"),
            ("revenue fell 30%", "revenue shrank 30%"),
            ("营收攀升30%", "营收上涨30%"),
            ("营收下滑30%", "营收回落30%"),
        ):
            with self.subTest(source=source, candidate=candidate):
                self.assertEqual(
                    [item.identity for item in _numeric_expressions(candidate)],
                    [item.identity for item in _numeric_expressions(source)],
                )

    def test_numeric_sign_flips_are_blocked_after_nfkc_normalization(self) -> None:
        for source, candidate in (
            ("成本变化 -30%", "成本变化 +30%"),
            ("成本变化 ＋３０％", "成本变化 －３０％"),
        ):
            with self.subTest(source=source, candidate=candidate):
                blocked = self.assertBlocked(
                    _change(
                        before_value="参与成本优化",
                        general_value=candidate,
                        targeted_value=candidate,
                    ),
                    _documents(current_a=source),
                )
                self.assertTrue(
                    any("符号" in finding for finding in blocked.safety_findings)
                )

    def test_explicit_and_implicit_positive_signs_are_equivalent(self) -> None:
        for source, candidate in (
            ("转化率 +30%", "转化率 30%"),
            ("转化率 ＋３０％", "转化率 30%"),
        ):
            with self.subTest(source=source, candidate=candidate):
                self.assertAllowed(
                    _change(
                        before_value="参与转化率优化",
                        general_value=candidate,
                        targeted_value=candidate,
                    ),
                    _documents(current_a=source),
                )

    def test_design_time_reduction_example_is_semantically_equivalent(self) -> None:
        source = "处理时长从 4 分钟降至 2.5 分钟"
        candidate = "处理时长由 4 分钟缩短至 2.5 分钟"
        self.assertAllowed(
            _change(
                before_value="参与处理流程优化",
                general_value=candidate,
                targeted_value=candidate,
            ),
            _documents(current_a=source),
        )

    def test_ordered_time_pair_cannot_reverse_from_and_to_values(self) -> None:
        source = "处理时长从 4 分钟降至 2.5 分钟"
        candidate = "处理时长从 2.5 分钟降至 4 分钟"
        blocked = self.assertBlocked(
            _change(
                before_value=source,
                general_value=candidate,
                targeted_value=candidate,
            ),
            _documents(current_a=source),
        )
        self.assertTrue(
            any(
                "起点" in finding or "顺序" in finding
                for finding in blocked.safety_findings
            )
        )

    def test_target_first_chinese_transition_preserves_semantic_roles(self) -> None:
        source = "处理时长从 4 分钟降至 2.5 分钟"
        for candidate in (
            "处理时长降至 4 分钟，之前为 2.5 分钟",
            "处理时长降至 4 分钟，原为 2.5分钟",
        ):
            with self.subTest(candidate=candidate):
                self.assertBlocked(
                    _change(
                        before_value=source,
                        general_value=candidate,
                        targeted_value=candidate,
                    ),
                    _documents(current_a=source),
                )

        equivalent = "处理时长降至 2.5 分钟，之前为 4 分钟"
        self.assertAllowed(
            _change(
                before_value=source,
                general_value=equivalent,
                targeted_value=equivalent,
            ),
            _documents(current_a=source),
        )

    def test_common_chinese_target_and_origin_markers_preserve_roles(self) -> None:
        source = "处理时长从 4 分钟降至 2.5 分钟"
        for candidate in (
            "处理时长降低到 4 分钟，原先 2.5 分钟",
            "处理时长缩短到 4 分钟，原来 2.5 分钟",
        ):
            with self.subTest(candidate=candidate):
                self.assertBlocked(
                    _change(
                        before_value=source,
                        general_value=candidate,
                        targeted_value=candidate,
                    ),
                    _documents(current_a=source),
                )

        for equivalent in (
            "处理时长降低到 2.5 分钟，原先 4 分钟",
            "处理时长缩短到 2.5 分钟，此前 4 分钟",
        ):
            with self.subTest(equivalent=equivalent):
                self.assertAllowed(
                    _change(
                        before_value=source,
                        general_value=equivalent,
                        targeted_value=equivalent,
                    ),
                    _documents(current_a=source),
                )

    def test_english_from_to_transition_preserves_semantic_roles(self) -> None:
        source = "latency from 4 to 2.5"
        candidate = "latency from 2.5 to 4"
        self.assertBlocked(
            _change(
                before_value=source,
                general_value=candidate,
                targeted_value=candidate,
            ),
            _documents(current_a=source),
        )

    def test_english_target_first_from_to_preserves_roles(self) -> None:
        source = "latency dropped from 4 to 2.5"
        self.assertBlocked(
            _change(
                before_value=source,
                general_value="latency dropped to 4 from 2.5",
                targeted_value="latency dropped to 4 from 2.5",
            ),
            _documents(current_a=source),
        )

    def test_english_target_first_origin_adverbs_preserve_roles(self) -> None:
        source = "latency dropped from 4 to 2.5"
        for marker in ("previously", "originally", "formerly"):
            with self.subTest(marker=marker, direction="equivalent"):
                equivalent = f"latency dropped to 2.5, {marker} 4"
                self.assertAllowed(
                    _change(
                        before_value=source,
                        general_value=equivalent,
                        targeted_value=equivalent,
                    ),
                    _documents(current_a=source),
                )
            with self.subTest(marker=marker, direction="reversed"):
                reversed_candidate = f"latency dropped to 4, {marker} 2.5"
                self.assertBlocked(
                    _change(
                        before_value=source,
                        general_value=reversed_candidate,
                        targeted_value=reversed_candidate,
                    ),
                    _documents(current_a=source),
                )
        equivalent = "latency dropped to 2.5 from 4"
        self.assertAllowed(
            _change(
                before_value=source,
                general_value=equivalent,
                targeted_value=equivalent,
            ),
            _documents(current_a=source),
        )

    def test_negative_sign_and_decrease_word_are_semantically_equivalent(self) -> None:
        for source, candidate in (
            ("成本变化 -30%", "成本下降 30%"),
            ("成本下降 30%", "成本变化 -30%"),
        ):
            with self.subTest(source=source, candidate=candidate):
                self.assertAllowed(
                    _change(
                        before_value="参与成本优化",
                        general_value=candidate,
                        targeted_value=candidate,
                    ),
                    _documents(current_a=source),
                )

    def test_contradictory_explicit_sign_and_direction_fail_closed(self) -> None:
        for contradictory in ("成本增加 -30%", "成本下降 +30%"):
            with self.subTest(contradictory=contradictory):
                blocked = self.assertBlocked(
                    _change(
                        before_value="参与成本优化",
                        general_value=contradictory,
                        targeted_value=contradictory,
                    ),
                    _documents(current_a=contradictory),
                )
                self.assertTrue(
                    any("矛盾" in finding for finding in blocked.safety_findings)
                )

    def test_changed_candidate_cannot_repair_contradictory_before_without_confirmation(self) -> None:
        for before, candidate in (
            ("成本增加 -30%", "成本下降 30%"),
            ("成本下降 +30%", "成本下降 30%"),
        ):
            with self.subTest(before=before):
                blocked = self.assertBlocked(
                    _change(
                        before_value=before,
                        general_value=candidate,
                        targeted_value=candidate,
                    ),
                    _documents(current_a=before),
                )
                self.assertTrue(
                    any(
                        "矛盾" in finding and "确认" in finding
                        for finding in blocked.safety_findings
                    )
                )

    def test_unchanged_contradictory_before_can_remain_unchanged(self) -> None:
        before = "成本增加 -30%"
        self.assertAllowed(
            _change(
                before_value=before,
                general_value=before,
                targeted_value=before,
            ),
            _documents(current_a=before),
        )

    def test_linked_answered_fact_can_resolve_contradictory_before(self) -> None:
        before = "成本增加 -30%"
        candidate = "成本下降 30%"
        documents = _documents(
            current_a=before,
            answers={
                "Q1": {
                    "state": "answered",
                    "value": "实际为成本下降 30%",
                }
            },
        )
        self.assertAllowed(
            _change(
                before_value=before,
                general_value=candidate,
                targeted_value=candidate,
                source_refs=[
                    f"/currentResume/experiences/{EXP_A}/star/a",
                    "/userAnswers/Q1/value",
                ],
            ),
            documents,
            questions=[_question()],
        )

    def test_answer_only_needs_to_resolve_corresponding_contradictory_fact(self) -> None:
        before = "服务 3 家客户，成本增加 -30%"
        candidate = "服务 3 家客户，成本下降 30%"
        documents = _documents(
            current_a=before,
            answers={
                "Q1": {
                    "state": "answered",
                    "value": "实际为成本下降 30%",
                }
            },
        )
        self.assertAllowed(
            _change(
                before_value=before,
                general_value=candidate,
                targeted_value=candidate,
                source_refs=[
                    f"/currentResume/experiences/{EXP_A}/star/a",
                    "/userAnswers/Q1/value",
                ],
            ),
            documents,
            questions=[_question()],
        )

    def test_negated_answer_does_not_resolve_contradictory_fact(self) -> None:
        before = "成本增加 -30%"
        candidate = "成本下降 30%"
        documents = _documents(
            current_a=before,
            answers={
                "Q1": {
                    "state": "answered",
                    "value": "实际并非成本下降 30%",
                }
            },
        )
        self.assertBlocked(
            _change(
                before_value=before,
                general_value=candidate,
                targeted_value=candidate,
                source_refs=[
                    f"/currentResume/experiences/{EXP_A}/star/a",
                    "/userAnswers/Q1/value",
                ],
            ),
            documents,
            questions=[_question()],
        )

    def test_negated_numeric_before_cannot_authorize_positive_claim(self) -> None:
        before = "成本并未下降 30%"
        candidate = "成本下降 30%"
        self.assertBlocked(
            _change(
                before_value=before,
                general_value=candidate,
                targeted_value=candidate,
            ),
            _documents(current_a=before),
        )

    def test_negated_transition_cannot_authorize_positive_transition(self) -> None:
        before = "处理时长并未从 4 分钟降至 2.5 分钟"
        candidate = "处理时长从 4 分钟降至 2.5 分钟"
        self.assertBlocked(
            _change(
                before_value=before,
                general_value=candidate,
                targeted_value=candidate,
            ),
            _documents(current_a=before),
        )

    def test_identical_negated_numeric_text_can_remain_unchanged(self) -> None:
        before = "成本并未下降 30%"
        self.assertAllowed(
            _change(
                before_value=before,
                general_value=before,
                targeted_value=before,
            ),
            _documents(current_a=before),
        )

    def test_english_cut_does_not_match_inside_execution(self) -> None:
        self.assertAllowed(
            _change(
                before_value="Supported users",
                general_value="Delivered to 30 users",
                targeted_value="Delivered to 30 users",
            ),
            _documents(current_a="Execution covered 30 users"),
        )

    def test_same_numeric_value_cannot_switch_business_metric(self) -> None:
        source = "留存率提升 30%"
        candidate = "转化率提升 30%"
        blocked = self.assertBlocked(
            _change(before_value="参与指标优化", general_value=candidate, targeted_value=candidate),
            _documents(current_a=source),
        )
        self.assertTrue(any("指标" in finding for finding in blocked.safety_findings))

    def test_same_numeric_value_and_metric_is_allowed(self) -> None:
        source = "转化率提升 30%"
        self.assertAllowed(
            _change(before_value="参与指标优化", general_value=source, targeted_value=source),
            _documents(current_a=source),
        )

    def test_metric_relabel_is_a_new_numeric_claim(self) -> None:
        before = "完成率 30%"
        candidate = "准确率 30%"
        blocked = self.assertBlocked(
            _change(
                before_value=before,
                general_value=candidate,
                targeted_value=candidate,
            ),
            _documents(current_a=before),
        )
        self.assertTrue(any("指标" in finding for finding in blocked.safety_findings))

    def test_adding_metric_to_same_value_and_unit_is_a_new_claim(self) -> None:
        before = "提升 30%"
        candidate = "完成率提升 30%"
        blocked = self.assertBlocked(
            _change(
                before_value=before,
                general_value=candidate,
                targeted_value=candidate,
            ),
            _documents(current_a=before),
        )
        self.assertTrue(any("指标" in finding for finding in blocked.safety_findings))

    def test_same_value_unit_and_metric_is_not_numerically_new(self) -> None:
        before = "完成率30%"
        candidate = "完成率 30%"
        self.assertAllowed(
            _change(
                before_value=before,
                general_value=candidate,
                targeted_value=candidate,
            ),
            _documents(current_a="没有数字"),
        )

    def test_only_new_numeric_expressions_need_source_evidence(self) -> None:
        before = "完成 3 次迭代"
        self.assertAllowed(
            _change(before_value=before, general_value="按期完成3次迭代", targeted_value="完成 3 次迭代"),
            _documents(current_a="没有数字"),
        )

    def test_both_general_and_targeted_candidates_are_checked(self) -> None:
        before = "参与支付页面改版"
        for general, targeted in (
            ("提升 30%", before),
            (before, "提升 30%"),
        ):
            with self.subTest(general=general, targeted=targeted):
                self.assertBlocked(
                    _change(general_value=general, targeted_value=targeted),
                    _documents(),
                )


    def test_later_affirmative_term_occurrence_after_reset_is_evidence(self) -> None:
        for source in (
            "项目未使用 SQL，但后来使用 SQL 完成分析",
            "项目未使用 SQL 但后来使用 SQL 完成分析",
        ):
            with self.subTest(source=source):
                self.assertAllowed(
                    _change(
                        before_value="参与项目分析",
                        general_value="项目使用 SQL 完成分析",
                        targeted_value="项目使用 SQL 完成分析",
                    ),
                    _documents(current_a=source),
                )


    def test_reported_arbitrary_terms_are_checked_directly_against_sources(self) -> None:
        for source, candidate, term in (
            ("参与表单交互", "参与表单交互", "表单交互"),
            ("使用 kubernetes 部署", "使用 kubernetes 部署", "kubernetes"),
        ):
            with self.subTest(term=term):
                self.assertAllowed(
                    _change(
                        before_value="参与交付",
                        general_value=candidate,
                        targeted_value=candidate,
                        introduced_terms=[term],
                    ),
                    _documents(current_a=source),
                )


    def test_sentence_initial_titlecase_words_are_not_technical_terms(self) -> None:
        self.assertAllowed(
            _change(
                before_value="Built a dashboard",
                general_value="Created a dashboard",
                targeted_value="Created a dashboard",
            ),
            _documents(current_a="Built a dashboard"),
        )

    def test_term_comparison_is_nfkc_and_case_insensitive(self) -> None:
        source = "使用 Power BI 和 APIv2 分析"
        candidate = "使用 power bi 和 apiv2 分析"
        self.assertAllowed(
            _change(before_value="参与分析", general_value=candidate, targeted_value=candidate),
            _documents(current_a=source),
        )

    def test_text_changing_actions_fail_closed_on_non_string_values(self) -> None:
        cases = (
            _change(
                change_id="DICT_BEFORE",
                before_value={"text": "参与支付页面改版"},
                general_value="参与支付页面改版",
                targeted_value="参与支付页面改版",
            ),
            _change(
                change_id="LIST_GENERAL",
                module_type="personal_summary",
                module_id="personal_summary",
                field_path="personal_summary",
                before_value="产品与研发协作经验",
                general_value=["产品与研发协作经验"],
                targeted_value="产品与研发协作经验",
                source_refs=["/currentResume/personal_summary"],
            ),
            _change(
                change_id="INT_TARGETED",
                general_value="参与支付页面改版",
                targeted_value=30,
            ),
        )
        for change in cases:
            with self.subTest(change_id=change.change_id):
                blocked = self.assertBlocked(change, _documents())
                self.assertTrue(
                    any("文本" in finding or "字符串" in finding for finding in blocked.safety_findings)
                )


    def test_ask_user_without_candidates_and_leave_unchanged_are_not_applicable(self) -> None:
        ask = _change(
            change_id="ASK",
            action_kind="ask_user",
            general_value=None,
            targeted_value=None,
            source_refs=[],
            default_selected=True,
        )
        leave = _change(
            change_id="LEAVE",
            action_kind="leave_unchanged",
            general_value=None,
            targeted_value=None,
            source_refs=[],
            default_selected=False,
        )
        unsupported = _change(
            change_id="UNSUPPORTED",
            module_type="personal_summary",
            module_id="current_resume",
            field_path="unsupported",
            action_kind="leave_unchanged",
            before_value=None,
            general_value=None,
            targeted_value=None,
            source_refs=[],
            rationale="不支持的内容保持不变",
            default_selected=False,
        )
        changes, summary = verify_plan_changes(
            plan=OptimizationPlan(changes=[ask, leave, unsupported]),
            source_documents=_documents(),
        )
        self.assertEqual([change.safety_status for change in changes], ["pending"] * 3)
        self.assertEqual([change.default_selected for change in changes], [False] * 3)
        self.assertEqual(summary.pending_change_ids, ["ASK", "LEAVE", "UNSUPPORTED"])
        self.assertEqual(summary.allowed_change_ids, [])
        self.assertEqual(summary.blocked_change_ids, [])

    def test_not_applicable_mutable_actions_still_bind_frozen_before_value(self) -> None:
        action_kinds = ("leave_unchanged", "ask_user", "suggest_from_bank")
        for action_kind in action_kinds:
            with self.subTest(action_kind=action_kind, case="mismatch"):
                documents = _documents(current_a="冻结真实文案")
                documents["__preserveFrozenMismatch__"] = True
                blocked = self.assertBlocked(
                    _change(
                        action_kind=action_kind,
                        before_value="伪造旧文案",
                        general_value=None,
                        targeted_value=None,
                        source_refs=[],
                        default_selected=False,
                    ),
                    documents,
                )
                self.assertIn(
                    "变更原值与冻结的当前简历字段不一致",
                    blocked.safety_findings,
                )

            with self.subTest(action_kind=action_kind, case="missing"):
                documents = _documents(current_a="冻结真实文案")
                del documents["currentResume"]["experiences"][EXP_A]["star"]["a"]
                documents["__preserveFrozenMismatch__"] = True
                blocked = self.assertBlocked(
                    _change(
                        action_kind=action_kind,
                        before_value="伪造旧文案",
                        general_value=None,
                        targeted_value=None,
                        source_refs=[],
                        default_selected=False,
                    ),
                    documents,
                )
                self.assertIn(
                    "无法解析变更对应的冻结当前简历字段",
                    blocked.safety_findings,
                )

            with self.subTest(action_kind=action_kind, case="none_mismatch"):
                documents = _documents()
                documents["currentResume"]["personal_summary"] = None
                blocked = self.assertBlocked(
                    _change(
                        module_type="personal_summary",
                        module_id="current_resume",
                        field_path="personal_summary",
                        action_kind=action_kind,
                        before_value="伪造旧简介",
                        general_value=None,
                        targeted_value=None,
                        source_refs=[],
                        default_selected=False,
                    ),
                    documents,
                )
                self.assertIn(
                    "变更原值与冻结的当前简历字段不一致",
                    blocked.safety_findings,
                )


if __name__ == "__main__":
    unittest.main()
