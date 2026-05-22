# pi-voin — Multi-Agent Orchestra

> Protocol for coordinated multi-agent development of pi-voin.

---

## 1. Agent Roles

### Project Manager (PM) — Current Agent (Claude in this session)

**Responsibilities:**
- Own the overall project and maintain `docs/tasks/WORKPLAN.md`
- Spawn Phase Managers for each phase, one at a time (sequential)
- Receive Phase Manager reports, update WORKPLAN checkboxes
- Decide when a phase is truly done vs. needs rework
- After all phases complete, present final deliverable to the human

**Authority:**
- Can send any phase back for rework
- Can modify WORKPLAN tasks based on Phase Manager feedback
- Final gate before human review

---

### Phase Manager (PMgr) — Sub-agent spawned by PM

**One per phase.** Spawned by PM with:
- The phase definition from WORKPLAN.md
- Full context from PRD.md and ARCHITECTURE.md
- Current state of the project files

**Responsibilities:**
- Decompose phase tasks and spawn Workers (can parallelize independent tasks)
- Track Worker progress and collect reports
- Resolve conflicts or dependencies between Workers
- After all Workers report complete, spawn a Phase Tester
- Review Phase Tester report; fix issues or re-spawn Workers as needed
- Report phase completion (or failure) to PM

**Authority:**
- Can modify code files within the phase's scope
- Can request PM to adjust WORKPLAN if tasks are unrealistic
- Final gate for phase quality before PM review

---

### Worker — Sub-agent spawned by Phase Manager

**One per task.** Spawned by Phase Manager with:
- The specific task description from WORKPLAN.md
- Relevant sections of PRD.md and ARCHITECTURE.md
- Current state of relevant source files

**Responsibilities:**
- Implement the task: write code, create files, edit existing files
- Test the implementation (unit-level: does this task's code work?)
- Report results to Phase Manager:
  - **Complete**: Task done, tests pass, files listed
  - **Blocked**: Dependency missing, need clarification, tool unavailable
  - **Failed**: Implementation attempted but couldn't meet acceptance criteria

**Authority:**
- Can create/edit files within the task's scope
- Can run commands to test code
- Cannot modify tasks outside its scope

---

### Phase Tester — Sub-agent spawned by Phase Manager

**One per phase.** Spawned after all Workers report complete.

**Responsibilities:**
- Review all code produced by Workers in the phase
- Run integration tests: do the phase components work together?
- Verify acceptance criteria from WORKPLAN.md
- Check for: bugs, edge cases, error handling, code quality
- Report to Phase Manager:
  - **Pass**: Phase meets all acceptance criteria
  - **Fail with issues**: List specific problems, which Worker's task needs rework
  - **Block**: Critical issue preventing further phases

**Authority:**
- Read-only access to code (no modifications)
- Can run any test commands
- Can flag issues back to specific Workers for rework

---

## 2. Orchestration Flow

```
PM (this agent)
  │
  ├─ Spawn PMgr-0 (Phase 0: Foundation)
  │    │
  │    ├─ Spawn Worker-T0.1 → scaffolding → report
  │    ├─ Spawn Worker-T0.2 → server fix → report
  │    └─ Spawn Worker-T0.3 → sox check → report
  │    │
  │    ├─ [All Workers done]
  │    ├─ Spawn Tester-0 → integration test → report
  │    │
  │    └─ PMgr-0 reports to PM: Phase 0 ✓ (or ↻ rework)
  │
  ├─ Spawn PMgr-1 (Phase 1: Core Audio Pipeline)
  │    │
  │    ├─ Spawn Worker-T1.1 → audio recorder → report
  │    ├─ Spawn Worker-T1.2 → level monitor → report
  │    └─ Spawn Worker-T1.3 → transcriber → report
  │    │
  │    ├─ [All Workers done]
  │    ├─ Spawn Tester-1 → pipeline test → report
  │    │
  │    └─ PMgr-1 reports to PM: Phase 1 ✓ (or ↻ rework)
  │
  ├─ ... (Phases 2, 3, 4 sequentially)
  │
  └─ All phases done → PM reports to Human for final testing
```

### Execution Model

- **Phases run sequentially** — each phase depends on prior phases
- **Workers within a phase can run in parallel** if independent
- **Phase Tester runs after all Workers complete**
- **Rework loop**: If Tester finds issues, PMgr re-spawns specific Workers, then re-runs Tester

### Dependency Rules

| Phase | Depends On | Parallel Workers? |
|-------|-----------|-------------------|
| Phase 0: Foundation | None | T0.2 and T0.3 independent; T0.1 first |
| Phase 1: Audio Pipeline | Phase 0 | T1.1, T1.2, T1.3 independent |
| Phase 2: TUI Widget | Phase 0 | Single task group |
| Phase 3: Push-to-Talk | Phase 1 + Phase 2 | T3.1, T3.2 independent; T3.3 last |
| Phase 4: Polish | Phase 3 | T4.1-T4.4 independent |
| Phase 5: Testing & Docs | Phase 4 | T5.1 first; T5.2, T5.3 after |

---

## 3. Communication Protocol

### Worker → Phase Manager Report Format

```markdown
## Worker Report: T1.1 — Audio Recorder

**Status**: Complete | Blocked | Failed

**Files created/modified**:
- `extension/src/audio-recorder.ts` (created)

**Acceptance criteria met**:
- [x] startRecording() spawns sox, returns handle + path
- [x] stopRecording() kills process, returns path
- [x] cleanup() deletes temp file

**Test results**:
- Recorded 3s audio → sox process created, WAV file valid
- stopRecording() killed process cleanly
- cleanup() removed temp file

**Notes / Warnings**:
- sox output includes stderr noise; suppressed with 2>/dev/null

**Blockers**: None
```

### Phase Tester → Phase Manager Report Format

```markdown
## Phase Tester Report: Phase 1 — Core Audio Pipeline

**Verdict**: Pass | Fail

**Acceptance criteria verification**:
- [x] Script: record 5s → transcribe → print text
- [ ] Level monitor: RMS mapping needs calibration (too sensitive)

**Issues found**:
1. [T1.2] Volume level spikes to 10 with silence — RMS threshold too low
   → Assign back to Worker-T1.2 for calibration

**Integration notes**:
- All three modules (recorder, monitor, transcriber) work together
- Temp file cleanup verified after full pipeline run
```

### Phase Manager → PM Report Format

```markdown
## Phase 1 — Core Audio Pipeline — COMPLETE

All 3 tasks complete. Tester passed on 2nd iteration.
WORKPLAN checkboxes updated: T1.1 ✓ T1.2 ✓ T1.3 ✓

Ready for Phase 2.
```

---

## 4. Spawn Context Templates

When spawning a sub-agent, the PM or PMgr provides a prompt with:

### Worker Spawn Prompt

```
You are a Worker for pi-voin, {task_id}: {task_name}.

## Your Task
{task description from WORKPLAN.md}

## Requirements Context
{relevant sections from PRD.md}

## Design Context
{relevant sections from ARCHITECTURE.md}

## Current Project State
{list of existing files and their contents, or "starting from scratch"}

## Your Job
1. Implement the task by creating/editing files in /Users/eins/pi-projects/pi-voin/
2. Test your code (run commands, verify it works)
3. Report back using the Worker Report Format

## Constraints
- Only modify files within your task scope
- Do not modify other Workers' files
- If blocked, report immediately with reason
```

### Phase Manager Spawn Prompt

```
You are a Phase Manager for pi-voin, {phase_name}.

## Your Phase
{phase definition from WORKPLAN.md, including all tasks}

## Full Context
- PRD: {docs/requirements/PRD.md}
- Architecture: {docs/design/ARCHITECTURE.md}
- Orchestra: {docs/orchestra.md}

## Current Project State
{full file tree and relevant file contents}

## Your Job
1. Review tasks. Spawn Workers for independent tasks (can parallelize).
2. Collect Worker reports. Resolve any conflicts.
3. When all Workers complete, spawn a Phase Tester.
4. Review Tester report. If issues, re-spawn specific Workers.
5. Report phase completion to PM.

## Rules
- Workers are your sub-agents. Give each one clear task context.
- Phase Tester is a separate sub-agent (fresh perspective, no implementation bias).
- You can modify code to fix small issues, but major rework goes back to Workers.
- Report using the Phase Manager Report Format.
```

### Phase Tester Spawn Prompt

```
You are a Phase Tester for pi-voin, {phase_name}.

## Phase Acceptance Criteria
{acceptance criteria from WORKPLAN.md}

## Tasks in This Phase
{list of all tasks and what they were supposed to deliver}

## Current Code
{full current state of relevant files}

## Your Job
1. Review all code produced in this phase.
2. Run integration tests — do the components work together?
3. Check: bugs, edge cases, error handling, code quality.
4. Verify each acceptance criterion from WORKPLAN.md.
5. Report using the Phase Tester Report Format.

## Rules
- Read-only: do not modify any code files.
- Run actual commands to test (not just code review).
- Be strict: if acceptance criteria aren't met, say Fail.
- Be specific: list exact issues with file paths and line references.
```

---

## 5. State Tracking

The PM maintains the project state in `docs/tasks/WORKPLAN.md` by updating checkboxes:

```
### T1.1 — Audio recorder module
- [x] startRecording() spawns sox, returns handle + path
- [x] stopRecording() kills process, returns path
- [x] cleanup() deletes temp file
```

Phase status is tracked at the top of WORKPLAN.md:

```
## Phase Status
| Phase | Status |
|-------|--------|
| Phase 0: Foundation | ✅ Complete |
| Phase 1: Audio Pipeline | 🔄 In Progress |
| Phase 2: TUI Widget | ⏳ Pending |
| Phase 3: Push-to-Talk | ⏳ Pending |
| Phase 4: Polish | ⏳ Pending |
| Phase 5: Testing & Docs | ⏳ Pending |
```

Status values: `⏳ Pending` | `🔄 In Progress` | `🔴 Rework` | `✅ Complete`

---

## 6. Execution Plan

The PM (me, in this session) will execute phases sequentially:

1. **PM spawns PMgr-0** → Phase 0: Foundation (scaffolding, server fix, sox check)
2. **PM spawns PMgr-1** → Phase 1: Core Audio Pipeline (recorder, monitor, transcriber)
3. **PM spawns PMgr-2** → Phase 2: TUI Widget (widget renderer, registration)
4. **PM spawns PMgr-3** → Phase 3: Push-to-Talk (key listener, state machine, integration)
5. **PM spawns PMgr-4** → Phase 4: Polish (volume tuning, edge cases, injection refinement)
6. **PM spawns PMgr-5** → Phase 5: Testing & Docs (manual tests, README, final review)
7. **PM reports to Human** → Final manual testing

Each phase spawns its Workers and Tester as sub-agents. The PM coordinates the sequence, updates WORKPLAN, and handles any cross-phase issues.

---

## 7. Escalation Rules

| Situation | Action |
|-----------|--------|
| Worker blocked on missing dependency | PMgr re-orders tasks or provides context |
| Worker blocked on external tool (e.g., sox not installed) | PMgr escalates to PM → PM asks Human |
| Tester finds fundamental design flaw | PMgr escalates to PM → PM may update ARCHITECTURE.md |
| Phase fails after 2 rework attempts | PM escalates to Human for direction |
| Scope creep detected | PM escalates to Human — no silent scope changes |
