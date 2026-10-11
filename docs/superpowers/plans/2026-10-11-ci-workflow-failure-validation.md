# CI Workflow Failure Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an operator verify GitHub Actions marks the actual Expo or Worker typecheck job failed, without changing tracked source files.

**Architecture:** Add a manual `workflow_dispatch` choice (`none`, `expo`, or `worker`) to the existing CI workflow. For an explicitly selected job, create a temporary invalid TypeScript file in that runner checkout immediately before the existing typecheck; ordinary pull-request and `main` push runs keep running the unchanged checks. Document how to use the manual validation input.

**Tech Stack:** GitHub Actions workflow YAML, Node.js 22, TypeScript.

---

### Task 1: Add a controlled manual failure path

**Files:**
- Modify: `.github/workflows/ci.yml`

- [x] Add a `workflow_dispatch` choice input named `fail_check`, default `none`, with choices `none`, `expo`, and `worker`.
- [x] Before each existing typecheck, create a uniquely named temporary invalid TypeScript file in that job's workspace when the matching choice is selected, and remove it on exit.
- [x] Keep the regular `pull_request` and `push` triggers, permissions, dependencies, and check commands unchanged.

### Task 2: Document manual validation

**Files:**
- Modify: `README.md`

- [x] Explain how to run `CI` manually with `fail_check=expo` or `fail_check=worker` to observe the corresponding real typecheck fail; explain `none` runs normal checks and temporary files exist only in the GitHub runner checkout.

### Task 3: Validate locally

**Files:**
- Test: `.github/workflows/ci.yml`, `README.md`

- [x] Parse the workflow YAML and inspect that ordinary triggers do not select the injection steps.
- [x] In disposable temporary files, prove root `npx tsc --noEmit` and Worker `npm run typecheck` fail on the same deliberate type error.
- [x] Run the full normal commands: `npx expo lint`, `npx tsc --noEmit`, `cd fave-worker && npm run typecheck`, and `npm test`.
- [x] Confirm the working tree contains no generated failure fixture.
- [ ] Commit the local-main change; run the GitHub `workflow_dispatch` validation only after the current pending push decision is authorized.
