# Milestone M0-17 — Pre-Implementation Technical Design & Governance Closure Record

**Project:** Multi-Tenant AI-Powered QR Review & Customer Feedback SaaS for Indian SMBs (`QR_review`)  
**Repository:** `Sai-KT/QR_review`  
**Workspace:** `/Users/mrugmaythere/work/QRs`  
**Governance Milestone:** **Milestone M0-17 — Master Governance Audit & Pre-Implementation Sign-Off**  
**Governance Stage:** **Stage D (Founder Sign-Off) — COMPLETED**  
**Sign-Off Effective Date:** October 23, 2026  
**Anchored Specification Baseline Commit:** `aafb588fbccf52b2bf7fd6cca01bc42fcfe38b0d` (Branch: `main`)  
**Operational Status:** **PLANNING MODE (Strictly Maintained)**

---

## 1. Executive Summary & Formal Founder Sign-Off Declaration

On October 23, 2026, the founder of `QR_review` formally issued the definitive pre-implementation sign-off:

> *"As founder of QR_review, I explicitly approve the formal sign-off of Milestone M0-17 and declare the M0 pre-implementation planning, governance and technical-design phase complete.*
>
> *I approve the final specification baseline recorded in local Git commit `aafb588fbccf52b2bf7fd6cca01bc42fcfe38b0d`, including founder decisions M0-01 through M0-16 and their mandatory safeguards.*
>
> *This is planning and technical-design sign-off only. It does not certify that the software has been implemented, tested or deployed.*
>
> *I authorize preparation of the M0-17 documentation closure record only.*
>
> *I do not authorize Git commits or pushes, application development, database migrations, deployments, paid services or Milestone M1 implementation. Those require separate explicit authorization."*

This document serves as the permanent, authoritative audit trail certifying the formal closure of **Milestone M0 (Phase 1 — Pre-Implementation Design & Governance)**.

---

## 2. Specification Baseline & Provenance

The approved specification corpus comprises ten canonical documents anchored to local Git commit `aafb588fbccf52b2bf7fd6cca01bc42fcfe38b0d`:

| Document | File Path | Scope & Authority | Baseline Version |
| :--- | :--- | :--- | :--- |
| **Governance** | [AGENTS.md](../AGENTS.md) | Master AI engineering governance, agent modes, execution protocol | v1.1 Hardened |
| **PRD** | [docs/PRD.md](PRD.md) | Canonical product requirements, personas, 28 FRs, 8 NFRs | v1.1 Aligned |
| **Architecture** | [docs/ARCHITECTURE.md](ARCHITECTURE.md) | System boundaries, C4 models, multi-tenancy, Edge Functions | v1.1 Aligned |
| **Database Schema**| [docs/DATABASE_SCHEMA.md](DATABASE_SCHEMA.md) | 12 tables, constraints, RLS policies, hardened RPCs | v1.1 Aligned |
| **API Specification**| [docs/API_SPEC.md](API_SPEC.md) | 23 REST contracts, 8 RPCs, wire schemas, cryptographic tokens | v1.2 Aligned |
| **Security & Privacy**| [docs/SECURITY.md](SECURITY.md) | Threat models, STRIDE matrix, DPDPA compliance, anti-gating | v1.1 Aligned |
| **UI/UX Design** | [docs/UI_UX.md](UI_UX.md) | 33 screens (32 active MVP, 1 deferred), design tokens, WCAG 2.2 AA | v1.1 Aligned |
| **Test Plan** | [docs/TEST_PLAN.md](TEST_PLAN.md) | 196 test cases (all labeled `NOT EXECUTED`), QA release gates | v1.1 Aligned |
| **Roadmap** | [docs/ROADMAP.md](ROADMAP.md) | 10 milestones (M0–M9), 73 tasks, execution boundaries | v1.1 Aligned |
| **Tech Stack** | [docs/TECH_STACK.md](TECH_STACK.md) | Vetted toolchain (React 19, Vite 6, Supabase, Tailwind v4) | v1.1 Aligned |

---

## 3. Register of Approved Pre-Implementation Gates (M0-01 through M0-17)

All seventeen pre-implementation gates are formally resolved and approved:

| Gate | Title | Formal Governance Status | Approved Technical Design & Safeguards |
| :--- | :--- | :--- | :--- |
| **M0-01** | Customer Note Retention | **FOUNDER APPROVED** | Option B: 30-day retention of `survey_responses.optional_note` (max 150 chars); daily purge via `pg_cron` (`purged_at`); zero customer final review stored. |
| **M0-02** | Google Destination Check | **FOUNDER APPROVED** | Strict server-side verification of Google review URLs + Place ID match + interactive merchant confirmation test link; anti-gating preserved. |
| **M0-03** | Merchant Logo Upload | **FOUNDER APPROVED** | PNG, JPEG, WebP only; 2 MB limit; server-side magic-bytes verification; SVG strictly prohibited for MVP; QR code exports are 1024×1024 PNG. |
| **M0-04** | Gemini Model Selection | **FOUNDER APPROVED** | Server-side `GEMINI_MODEL` (`gemini-3.5-flash-lite`, fallback `gemini-3.1-flash-lite`); `thinkingLevel: "minimal"`; initial 8000ms timeout target. |
| **M0-05** | Digital QR Distribution | **FOUNDER APPROVED** | Digital-only QR distribution for MVP (preview, 1024×1024 PNG export, copyable `/q/:public_qr_id` link); physical counter standees deferred to Post-MVP. |
| **M0-06** | Database Amendments 1–5 | **FOUNDER APPROVED** | Approved 5 schema design amendments (`quota_reservations.quota_id`, `payload_hash`, `admin_users.is_active`, `admin_audit_logs.actor_user_id/actor_role`, `survey_options.is_active`). |
| **M0-07** | Active Question Replacement| **FOUNDER APPROVED** | Immutable question versioning; deactivated questions soft-retired (`is_active = FALSE`); historical submissions pinned to original text. |
| **M0-08** | Survey Option Activation | **FOUNDER APPROVED** | Soft deactivation via `survey_options.is_active = FALSE`; foreign key integrity preserved; historical analytics unaffected. |
| **M0-09** | Administrative Security | **FOUNDER APPROVED (TECH DESIGN)** | Hardened admin gateway; `admin_users.is_active = TRUE` + verified `aal2` TOTP MFA; server allowlist; `SECURITY DEFINER` with empty `search_path`. |
| **M0-10** | Supabase Key Segregation | **APPROVED (TECH DESIGN)** | Strict separation of client `anon` key vs server-only `service_role` key; zero leak of elevated secrets to client bundles. |
| **M0-11** | Cryptographic Submission Binding | **FOUNDER APPROVED (TECH DESIGN)** | Hybrid HMAC-SHA256 submission token issued upon survey persistence; 10-minute TTL; constant-time verification; generation retrieves facts from DB only; does not prove physical visit. |
| **M0-12** | Quota & Draft Recovery | **FOUNDER APPROVED (TECH DESIGN)** | Design C two-phase reservation (`reserve`/`commit`/`release`) + Option B protected temporary draft storage (1-hour ceiling) + Recovery Authorization A (original valid 10-min submission token). |
| **M0-13** | Audit Log Attribution | **FOUNDER APPROVED (TECH DESIGN)** | Option A+ Conditional Actor Integrity (non-null human UUID for admin/owner; system worker with `actor_role = 'system'` and NULL UUID) + Alternative A immutable target business UUID references. |
| **M0-14** | Automated Quality Gates | **FOUNDER APPROVED (TECH DESIGN)** | Lightweight QA stack (Vitest, RTL, Playwright, Supabase CLI, real DB RLS tests, mock Gemini server, P0/P1 blockers; all tests conceptual/unexecuted). |
| **M0-15** | Backup & Disaster Recovery | **FOUNDER APPROVED (TECH DESIGN)** | Design B (scheduled encrypted logical database dumps via GitHub Actions + separate Storage logo backup drills; founder-controlled keys; 24h RPO / 2h RTO). |
| **M0-16** | Google Policy & Authenticity | **FOUNDER APPROVED (TECH DESIGN)** | Design B (enhanced customer authenticity, strictly <60 words, neutral consent checkbox, universal non-gated Google link, zero Google certification claims, abstention without auto-redirects). |
| **M0-17** | Master Governance Sign-Off | **FOUNDER SIGNED OFF** | Formal closure of Milestone M0 pre-implementation planning, governance, and technical-design phase. |

---

## 4. Inviolable Product & Architectural Invariants

Implementation must permanently maintain these non-negotiable core invariants:

1. **Zero Anonymous Friction:** Customer survey requires no login, no phone number, and no app download.
2. **Strict 3-MCQ Cap:** Customer survey contains exactly 3 single-select category-specific MCQs plus an optional note (`survey_responses.optional_note`, ≤150 characters).
3. **Permanent Distributed QR Identity:** The QR code encodes `https://[app-domain]/q/:public_qr_id` where `businesses.public_qr_id` is an immutable, unique, 10-character URL-safe TEXT identifier decoupled from business names, slugs, or Google destinations.
4. **Mobile-First Realities:** Customer viewports target loading under 1.5s on 4G, render cleanly down to 320px width, and adhere to recommended touch targets of 44–48px.
5. **One Grounded AI Draft:** System produces exactly one review draft strictly fewer than 60 words, strictly grounded in the customer's affirmative selections and note. No pre-selected stars, no fabricated claims.
6. **Two-Click Handoff:** Copying the review draft and opening Google Maps are two explicit, distinct user actions. Never attempt automatic review submission.
7. **Strict Anti-Gating Policy:** Direct Google Maps link must be visible and accessible to all customers on every screen, regardless of survey sentiment. Critical feedback must never be blocked.
8. **Customer Choice & No Auto-Redirect (M0-16):** When customer feedback lacks sufficient facts, the system abstains from generating a draft, displays a neutral explanation (*"We cannot generate a reliable draft from the provided information."*), and offers the customer the choice to write their own review or open Google Maps. Under no circumstances does the system force an automatic redirect.
9. **Complete Tenant Isolation:** PostgreSQL RLS with `auth.uid() = owner_id` on all tenant-bearing tables.
10. **Hardened Super-Admin:** Admin console requires active record in `admin_users` (`is_active = true`) AND verified Supabase Auth session with `aal2` (TOTP MFA).

---

## 5. Explicit Governance & Authority Boundaries

The founder's sign-off establishes strict operational boundaries:

* **Scope of Sign-Off:** Milestone M0-17 sign-off applies **strictly to planning, governance, and technical design**.
* **Zero Software Certification:** This sign-off does not certify that application code, database migrations, tests, backups, integrations, or deployment infrastructure have been executed, tested, or deployed.
* **Prohibition of Autonomous Progression:** The system remains in **Planning Mode**. Milestone M1 development is **STRICTLY NOT AUTHORIZED** until a separate, task-specific directive is issued by the founder.
* **Prohibited Agent Actions:**
  - No application code development (`.ts`, `.tsx`, `.js`, etc.)
  - No SQL migration execution or DDL operations
  - No package installations (`npm install`, Deno imports)
  - No Git staging, commits, or pushes
  - No cloud infrastructure provisioning or deployments
  - No paid third-party API invocations

---

## 6. Pre-Implementation Governance Progression Workflow

```
[ Stage A: Founder Technical Decisions (M0-01..16) ]   --> COMPLETED
                        │
                        ▼
[ Stage B: Documentation Alignment (10 Spec Files) ]    --> COMPLETED
                        │
                        ▼
[ Stage C: Independent Read-Only Verification ]         --> COMPLETED (PASS)
                        │
                        ▼
[ Baseline Git Commit: aafb588 (Local Only) ]          --> COMPLETED
                        │
                        ▼
[ Stage D: M0-17 Formal Founder Sign-Off ]             --> COMPLETED (Oct 23, 2026)
                        │
                        ▼
═══════════════════ STRICT GOVERNANCE GATE ═══════════════════
                        │
                        ▼
[ Stage E: Task-Specific M1 Implementation Directive ]  --> PENDING FOUNDER DIRECTIVE
```

---

## 7. Next Authorized Action

The pre-implementation baseline is fully resolved, locked, and documented.

The next operational step requires the founder to issue a **Stage E Task-Specific Directive** defining the implementation boundary for the first development task from [docs/ROADMAP.md](ROADMAP.md), specifically:

* **Task ID:** `M1-T01` — Project Scaffolding, TypeScript Strict Toolchain, and Vite Setup.

*Until such explicit directive is given, the repository remains strictly in Planning Mode.*
