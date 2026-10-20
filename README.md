# AI-Powered QR Review & Customer Feedback SaaS

> **Multi-Tenant AI-Powered QR Review & Private Feedback Telemetry for Local Indian SMBs**

---

## Overview

This repository contains the architecture, specifications, and implementation for an AI-powered QR review and customer feedback SaaS designed specifically for local Indian businesses (salons, spas, cafes, and restaurants).

The platform eliminates the "blank textbox" friction on Google Maps by transforming a 30-second, 3-MCQ mobile survey into an authentic, editable review draft using Google Gemini Flash, while providing business owners with private feedback telemetry and vector-rendered printable QR standees.

---

## Key Features

- **Anonymous, Zero-Friction Flow:** No app download, no login, and no phone number required from customers.
- **Strict 3-MCQ Cap:** Customers answer exactly three category-specific single-select MCQs with an optional note ($\le$150 characters).
- **Grounded AI Draft Generation:** Generates a single authentic, editable review draft strictly derived from positive customer selections (with deterministic fallback).
- **Two-Click Handoff:** Copying the draft and redirecting to Google Maps are two explicit, distinct user actions.
- **Strict Anti-Gating Policy:** Direct Google Maps link is accessible to all customers at all times, ensuring full compliance with Google Review policies.
- **Private Feedback Loop:** Constructive and critical feedback is captured privately in the business owner's dashboard.
- **Vector Standee Studio:** Generates print-ready A6 (105x148mm) 300 DPI acrylic QR standee PDFs with custom merchant branding.

---

## Documentation Corpus

Complete engineering specifications are maintained in the [`docs/`](docs/) directory:

| Document | Description |
| :--- | :--- |
| [`AGENTS.md`](AGENTS.md) | Master AI engineering governance, agent operational modes, and verification rules |
| [`docs/PRD.md`](docs/PRD.md) | Product Requirements Document (Personas, 28 Functional Requirements, 8 NFRs) |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | C4 architectural models, multi-tenancy isolation, edge routing |
| [`docs/TECH_STACK.md`](docs/TECH_STACK.md) | Vetted technology choices (React 19, TypeScript, Supabase, Gemini Flash, Vite) |
| [`docs/DATABASE_SCHEMA.md`](docs/DATABASE_SCHEMA.md) | 12 canonical PostgreSQL tables, indexes, constraints, RLS policies, and RPCs |
| [`docs/SECURITY.md`](docs/SECURITY.md) | STRIDE threat model, DPDPA 2023 compliance, prompt injection hardening |
| [`docs/UI_UX.md`](docs/UI_UX.md) | 33 screen specifications (`SCR-01..33`), mobile-first design tokens, UX flows |
| [`docs/API_SPEC.md`](docs/API_SPEC.md) | 23 REST endpoint contracts, 8 RPC signatures, RFC 7807 error envelopes |
| [`docs/TEST_PLAN.md`](docs/TEST_PLAN.md) | Master test plan covering 196 test cases (`TC-*`) across unit, contract, and RLS suites |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | 10 delivery milestones (M0–M9), 73 atomic tasks, pre-implementation gate |

---

## License

Private & Confidential. All rights reserved.
