## Summary

Refine the resume editor AI polish flow around three related changes:

- change the PC-side single-item polish result from a preview-style card into a result confirmation dialog
- highlight polished content blocks in the resume preview with green emphasis, while temporarily suppressing A4 overflow markers during the reminder phase
- add a batch "one-click polish" entry beside "一键组装", using concurrent polishing for all currently selected experiences and a single final confirmation for the whole batch

This design keeps the existing single-item AI polish API and preview rendering pipeline, and introduces a frontend-managed polish session layer so single-item and batch polish share the same confirmation model.

## Current State

- Single-item floating polish is triggered from the experience list and rendered through `AIPolishToolbar` in `views/ResumeEditor/index.tsx`.
- The current preview state uses `floatingPolishPreview` and shows a preview-style card with the copy "AI 预览已生成" in `components/AIPolishToolbar.tsx`.
- The right-side resume preview already supports overflow guide rendering through `showOverflowGuide` and section-level overflow highlighting in `views/ResumeEditor/components/ResumePreview.tsx`.
- The current "突出重点" mode is driven by backend prompt rules in `backend/app/domain/ai/prompts.py`, but the instructions primarily bias toward adding bold emphasis and do not explicitly allow removing stale or excessive bold markers.
- `ExperienceTab` already hosts the "一键组装" button and is the natural placement for a new batch polish action.
- Toasts are managed centrally through `components/Toast.tsx`, which already supports a single loading toast id being updated in place.

## Goals

- Make single-item polish feel like a pending result to confirm, not a static preview card.
- Give the user a clear visual reminder inside the real resume preview by highlighting the polished experience block.
- Avoid noisy or conflicting signals by hiding A4 overflow markers during the polish reminder phase, then restoring them after confirm or undo.
- Make "突出重点" smarter by allowing the system to remove existing bold emphasis when it is not JD-relevant or exceeds the configured cap.
- Support one-click batch polish for all currently selected experiences with concurrent execution, one loading toast, and one final confirmation dialog for the whole batch.

## Non-Goals

- Do not add a new backend batch polish endpoint in this iteration.
- Do not redesign the mobile polish flow.
- Do not change the meaning of existing STAR field storage or resume assembly persistence.
- Do not auto-save batch polish results without an explicit final confirmation.

## Proposed Design

### 1. Frontend Polish Session Model

Introduce a shared polish session concept in `views/ResumeEditor/index.tsx` so the UI can distinguish:

- idle
- single-item pending confirmation
- batch pending confirmation

The session should track:

- `mode`: single or batch
- `targetIds`: affected experience ids
- `beforeById`: original draft or rendered experience snapshot per item
- `afterById`: polished draft or rendered experience snapshot per item
- `polishMode`: current AI polish mode
- `customPrompt`: optional custom prompt snapshot
- `status`: running, previewing, confirming, or idle
- `failedIds`: optional ids that failed during batch execution

This state replaces the current single-purpose `floatingPolishPreview` shape as the source of truth for preview highlighting, confirmation, and restoration.

### 2. Single-Item Result Dialog

`components/AIPolishToolbar.tsx` should be adjusted so the preview branch no longer frames the result as "AI 预览已生成". Instead it should present a result-confirmation dialog with copy closer to:

- title: `AI 润色结果`
- description: `结果已同步到右侧简历预览，请确认是否保存到当前简历。`

Key behavior changes:

- keep confirm and undo actions
- keep optional detailed content for inspection
- visually read as a pending decision rather than a generated preview artifact

The dialog remains anchored in the current floating toolbar location so layout disruption stays minimal.

### 3. Resume Preview Highlighting

Add an explicit preview highlight input to `ResumePreview`, for example:

- `polishHighlightItemIds?: Set<string>`

The preview already renders each experience item with `data-rf-item-id` and a shared item surface class. The highlight should be applied at the item surface layer for matching experience item keys only.

Recommended highlight treatment:

- subtle green border or ring
- soft green-tinted background wash
- existing hover and drag transitions remain intact

The highlight must be visible in editor preview mode only and should disappear immediately after confirm or undo.

### 4. Temporary Suppression of Overflow Signals

Add a boolean such as:

- `suppressOverflowIndicators?: boolean`

to `ResumePreview`, and wire it from the polish session state.

When a single-item or batch polish result is pending confirmation:

- hide the bottom A4 overflow guide line
- hide the "超出A4纸" marker badges
- keep the underlying overflow measurement logic unchanged

After the user confirms or undoes the polish session:

- restore overflow guide rendering
- restore overflow badges

This ensures the polish reminder is the only dominant signal during review.

### 5. Smarter "突出重点" Bold Decision Rules

Update `STAR_POLISH` and the default polish-mode guidance in `backend/app/domain/ai/prompts.py`.

The default mode should explicitly instruct the model to:

- only adjust emphasis markers when mode is `default`
- preserve original wording and facts
- allow removing existing `**bold**` markers
- allow keeping some existing bold markers
- allow adding new bold markers only when they are more JD-relevant
- obey highlight caps strictly

Recommended ranking order for emphasis decisions:

1. phrases directly aligned to JD requirements or keywords
2. quantified outcomes or scope evidence
3. core actions or ownership signals
4. enabling methods, tools, or collaboration signals

Recommended caps:

- S/T/R: at most 2 bold phrases per sentence
- A: at most 1 bold phrase per bullet
- overall: at most 5 distinct bold phrases across the whole experience

If the text already contains bold phrases that are weakly related to the JD or exceed the cap, the model should actively remove them.

### 6. Batch One-Click Polish Entry

Add a new button in `views/ResumeEditor/components/ExperienceTab.tsx` immediately to the left of the existing `一键组装` button.

Suggested label:

- idle: `一键润色`
- running: `润色中…`

Availability rules:

- enabled only when at least one experience is currently selected
- blocked while a floating polish session is already running or awaiting confirmation
- blocked if JD context is empty

The button should use the same polish mode dialog pattern as single-item polish, rather than silently applying results.

### 7. Batch Execution and Toast Policy

Batch execution should run in `views/ResumeEditor/index.tsx` using concurrent calls to the existing `aiService.polishExperienceStream`.

Execution model:

- collect all selected work and project experiences
- build one payload per experience
- run requests concurrently with `Promise.allSettled`
- collect successful results and failed ids separately

Toast policy:

- create one loading toast before dispatch: `正在批量润色中……`
- do not create per-item toasts
- after completion, update the same toast with a summary

Examples:

- all success: `批量润色完成，请确认是否保存`
- partial failure: `已完成 7 条，3 条失败，请确认可用结果`
- all failed: `批量润色失败，请稍后重试`

### 8. Batch Final Confirmation

The batch flow should not open per-item confirmations.

After all concurrent requests settle:

- apply all successful polished results into the preview-only session state
- highlight all affected preview items in green
- open one shared confirmation dialog summarizing the batch result

The final confirmation dialog should support:

- confirm all successful results
- undo all successful results
- summary count of successes and failures

Failed items are excluded from confirm/undo persistence because they were never preview-applied.

### 9. Persistence Semantics

Single-item confirm keeps the current behavior:

- persist the polished result to the current resume assembly
- clear highlight and pending session state

Batch confirm should persist all successful results in one user-facing action. The exact persistence implementation can still iterate item by item internally if needed, but the UI should behave as one commit step.

Batch undo should:

- restore every preview-mutated item to its original version
- clear all highlight state
- restore overflow indicators

## Data Flow

### Single-Item Polish

1. user clicks polish on one experience
2. frontend calls `polishExperienceStream`
3. successful result updates preview-session state only
4. preview highlights the affected item and hides overflow markers
5. user confirms or undoes
6. confirm persists to resume; undo restores original preview state

### Batch Polish

1. user clicks `一键润色`
2. frontend validates JD and selected experience set
3. frontend shows one loading toast
4. frontend dispatches concurrent single-item polish requests
5. frontend collects success and failure results
6. frontend applies successful results to preview-session state only
7. preview highlights all successful items and hides overflow markers
8. user confirms all or undoes all
9. frontend restores normal overflow indicators after completion

## Error Handling

- If JD is empty, block single-item and batch polish with the existing validation pattern.
- If a batch contains both successes and failures, preserve successful preview results and show aggregate counts.
- If all batch items fail, do not enter preview state.
- If final batch confirm persistence partially fails, keep the session open and show an error toast so the user can retry or undo.
- If a target experience disappears during an active session, clear that item from the session and continue with remaining valid items where safe.

## Testing and Verification

Verify at minimum:

- single-item polish opens result confirmation UI instead of preview-copy UI
- single-item preview highlights only the affected experience block
- overflow guide and overflow badges disappear while confirmation is pending and return after confirm or undo
- default polish mode can remove stale or excessive existing bold markers
- batch button appears to the left of `一键组装`
- batch polish emits exactly one loading toast during processing
- batch polish uses one final confirmation for all successful items
- partial batch failure still allows confirming successful items
- batch undo restores all preview-mutated items and overflow indicators

## Scope Boundaries

This design does not:

- introduce a server-side batch polish API
- change resume preview pagination logic
- change the existing AI assistant advanced mode flow
- persist polish results before the user confirms

## Open Implementation Notes

- Reuse the current `AIPolishToolbar` shell where practical to minimize UI churn, but move its preview branch toward a dialog language and batch-aware summary copy.
- Prefer adding small, explicit props to `ResumePreview` instead of overloading `showOverflowGuide`.
- Keep batch orchestration in `ResumeEditor/index.tsx` so `ExperienceTab` stays presentational.
- If internal session types become too broad, extract them into `types/resume.ts` once the implementation stabilizes.
