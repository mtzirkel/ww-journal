# Agent Pipeline — Workflow Guide

Two agents, two human gates. Simple enough to understand, structured enough to transfer
to Browning IT and MRO when the time comes.

---

## The Pipeline

```
Anyone creates a rough triage card
        ↓
[TRAVIS] reviews triage, promotes to ready (or hits ✨ Specify)
        ↓
PLANNER picks up the task, reads the codebase, writes a full spec
        ↓
[TRAVIS] reads the spec on the kanban card — approves (creates coder task)
        or kicks back (adds comment, task goes back to planner)
        ↓
CODER picks up the spec, implements on a feature branch, opens a PR, runs tests
        ↓
PLANNER runs verification — Playwright + browser checks against acceptance criteria
        ↓
[TRAVIS] reads the verification report — merges the PR or kicks back to coder
```

Two agents. Two stops where Travis is the gate. Nothing merges without Travis's hand.

---

## Profiles

| Profile  | Does | Hard stops |
|----------|------|-----------|
| planner  | Writes specs, verifies implementations | No code, no prod, no sending as Travis |
| coder    | Implements specs, opens PRs | No main branch, no prod deploy, no test deletion |

Both profiles: never push to production, never send email/messages as Travis, never change app functional direction without approval.

---

## Step by Step — Creating an Issue

Anyone (you from your phone, a future collaborator, or another agent) can create a triage card:

```
hermes kanban --board ww-journal create "Short description of the problem or feature" --triage
```

Or from the dashboard at http://100.82.139.100:9119/kanban — click the + on the Triage column.

Keep the title to one line. Details go in a comment after creation, or let the planner figure them out from context.

---

## Step by Step — Running the Pipeline

### 1. Promote from Triage
In the dashboard: drag the card to Ready, or click the card and change status.
Or CLI: `hermes kanban --board ww-journal assign <task_id> planner`
This simultaneously assigns it to planner and makes it ready for dispatch.

### 2. Planner Runs
The gateway dispatcher picks it up within 60 seconds (or hit "Nudge dispatcher" in the dashboard).
Watch the card move to In Progress. The planner will:
- Read the codebase
- Write a spec with acceptance criteria
- Call kanban_complete with the spec as its summary

The card moves to Done. Read the summary — that's the spec.

### 3. Travis Approves the Spec
Read the planner's summary on the kanban card. If it looks right:

```bash
# Create the coder task, with the planner task as parent
hermes kanban --board ww-journal create "Implement: <same title>" \
  --assignee coder \
  --parent <planner_task_id> \
  --body "Implement the spec in the parent task. See parent summary for full details."
```

The `--parent` flag means the coder task is auto-promoted to ready once the planner task is done (it already is). The coder will see the planner's spec in kanban_show() context automatically.

If the spec needs revision: add a comment on the planner task with what's wrong, set it back to ready, dispatcher re-runs planner.

### 4. Coder Runs
Dispatcher picks up the coder task. Coder will:
- Read the spec from parent context
- Create a feature branch: `task/t_<id>-short-description`
- Implement, run tests
- Push branch, open a PR on GitHub
- Call kanban_complete with what was done

Watch the PR appear at github.com/mtzirkel/ww-journal/pulls

### 5. Create a Verification Task
After the coder completes, create a verification task for the planner:

```bash
hermes kanban --board ww-journal create "Verify: <same title>" \
  --assignee planner \
  --parent <coder_task_id> \
  --body "VERIFICATION MODE: Run Playwright and browser checks against the acceptance criteria in the grandparent planner task. Check the PR diff for scope violations. Report PASS/FAIL/CONDITIONAL PASS with evidence per criterion."
```

### 6. Planner Verifies
Planner runs browser checks against the dev server, checks the diff, reports verdict.
Read the verification summary on the card.

### 7. Travis Merges (or Kicks Back)
PASS: Go to GitHub, review the PR diff, merge.
FAIL: Add a comment on the coder task with what failed, reassign to coder, set to ready. Coder picks it up again with the failure context.

---

## Watching Things Run

Dashboard (works from iPhone on Tailscale): http://100.82.139.100:9119/kanban

The In Progress column shows which agent is actively working and their last heartbeat note. If a card is stuck in In Progress with no recent heartbeat, check the logs:

```bash
hermes kanban --board ww-journal log <task_id>
```

---

## Current Board State

| Task | Assignee | Status | Notes |
|------|----------|--------|-------|
| Remove dead FlowTimeline.svelte | coder | ready | Simple delete, clear scope |
| Fix pre-commit hook type conflict | coder | ready | Known Playwright/svelte-check conflict |
| Dashboard chart click-to-navigate | coder | ready | Add click handler to Observable Plot dots |
| Build Rivers list page | planner | ready | Planner writes spec first |
| Map clustering and filters | planner | ready | Planner writes spec + UX decisions |
| Individual river detail page | unassigned | todo | Blocked on rivers list |
| Trips page polish | unassigned | triage | Needs scoping |
| PWA sync conflict resolution | unassigned | triage | Needs scoping |
| Settings page improvements | unassigned | triage | Needs scoping |

---

## Hard Stops (Both Profiles)

These are encoded in each profile's SOUL.md and are non-negotiable:

- No production deploys (no bin/deploy, no SSH to badger)
- No pushing to main/master directly — PRs only
- No sending as Travis — drafts only
- No database schema changes unless explicitly in spec
- No modifying test files to make tests pass
- No changes outside stated scope without a task comment

---

## Transferring to Other Projects

To apply this pattern to a new project (Browning IT, MRO):

1. Create a new kanban board: `hermes kanban boards create <project-name>`
2. Clone the profiles with project-specific SOUL.md edits:
   `hermes profile create planner-browning --clone --clone-from planner`
   Then update the project context section in SOUL.md.
3. Update kanban.worktree_root in the coder profile config to point at the new project.
4. Add a reviewer profile when stakes are higher (auth code, real user data, institutional systems).

The pipeline shape stays the same. Only the project context changes.
