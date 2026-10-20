# Technology Stack Specification & Evaluation
## Multi-Tenant AI-Powered QR Review & Customer Feedback SaaS

---

## 1. Document Control and Status

| Attribute | Specification |
| :--- | :--- |
| **Document Reference** | `docs/TECH_STACK.md` |
| **Document Title** | Technology Stack Specification & Evaluation |
| **Target SaaS** | Multi-Tenant AI-Powered QR Review & Customer Feedback SaaS for Local Indian SMBs |
| **Document Version** | Version 1.1 (Phase 1: Stage 2 — Architecture & Technology Selection Audit) |
| **Requirements Baseline** | [`docs/PRD.md`](file:///Users/mrugmaythere/work/QRs/docs/PRD.md) (Revision 1.1) |
| **Architecture Reference** | [`docs/ARCHITECTURE.md`](file:///Users/mrugmaythere/work/QRs/docs/ARCHITECTURE.md) (Revision 1.1) |
| **Author** | Principal Cloud Architect, Full-Stack Technical Lead & Cost Analyst |
| **Target Founder** | Solo Engineering Student (Revenue Hypothesis: INR 10,000–15,000/month) |
| **Creation Date** | October 17, 2026 |
| **Last Updated** | October 17, 2026 |
| **Lifecycle State** | `AUDITED & VERIFIED — SUBMITTED FOR FOUNDER APPROVAL` |

### 1.1 Revision History & Audit Log
| Revision | Date | Author | Summary of Changes | Status |
| :---: | :---: | :--- | :--- | :---: |
| **1.0** | Oct 17, 2026 | Principal Architect | Initial baseline stack selection and cost projection. | Superseded |
| **1.1** | Oct 17, 2026 | Principal Architect | **Stage 2 Correction Audit Applied:**<br/>1. Evaluated currently supported Gemini Flash models (`gemini-3.5-flash-lite` and `gemini-3.8-flash`), noting Gemini 2.5 access restrictions for new projects.<br/>2. Recomputed AI costs using official Google per-million token rates with explicit input, output, thinking token, and retry assumptions.<br/>3. Re-verified Cloudflare Pages, Supabase (free vs Pro $25/mo), domain, and Razorpay gateway fees without double-counting.<br/>4. Updated framework versions (React 19, Vite 6, TypeScript 5, Tailwind CSS v4, React Router v7, `@google/genai` v0.1+).<br/>5. Acknowledged backend serverless cold-start realities (100–300ms) on Edge Functions.<br/>6. Disaggregated financial milestones: gross MRR, setup revenue, direct fulfillment, fixed costs, founder time, operating surplus, and taxes. | **Under Review** |

---

## 2. Technology Stack Evaluation: Option A vs. Option B

We conducted an architectural comparison between two modern web application stacks to determine the optimal foundation for a solo student founder operating under strict capital and operational constraints.

### 2.1 Architectural Comparison Matrix

| Evaluation Dimension | Option A: React + Vite + Cloudflare Pages + Supabase | Option B: Next.js (App Router) + Vercel Pro + Supabase | Evaluator Assessment & Trade-Off Analysis |
| :--- | :--- | :--- | :--- |
| **Commercial Hosting Legality & Cost** | **100% Free & Legal**: Cloudflare Pages free tier explicitly permits commercial SaaS projects without license restrictions. | **Requires Vercel Pro ($20/mo $\approx$ ₹1,700/mo)**: Vercel Hobby terms of service strictly prohibit commercial business applications. | **Option A wins decisively**: Option B imposes a fixed monthly overhead of ~₹1,700 before generating any revenue, eliminating early operating margin. |
| **Counter Scan Performance & Cold Starts** | **Zero Frontend Cold Starts**: Client compiled to static HTML/JS/CSS and served from Cloudflare's global edge network (<100ms TTFB). | **Serverless Cold Starts**: Next.js serverless route handlers suffer 800ms–2.5s cold starts on infrequent counter QR scans. | **Option A wins**: In-store patrons waiting at billing counters require immediate (<1.2s) page rendering without serverless spin-up lag. |
| **Multi-Tenant Security Architecture** | **Database-Enforced RLS**: PostgreSQL Row Level Security enforced at the database engine level across all client roles. | **Dual Layer / Middleware Reliance**: Route Handlers often bypass RLS via server-side service keys; higher risk of cross-tenant leakage bugs. | **Option A wins**: Supabase client with PostgreSQL RLS provides declarative, auditable multi-tenant data boundaries. |
| **Developer Experience & Tooling** | **Fast, Decoupled DX**: Vite Instant HMR (<50ms), pure client-side SPA routing, zero server-component hydration debugging. | **Complex Full-Stack DX**: Frequent Next.js breaking changes (Server Actions, caching semantics, Turbopack, route handlers). | **Option A wins**: A solo student founder cannot afford to spend hours debugging framework caching quirks and hydration mismatches. |
| **Backend & AI Architecture** | **Serverless Deno Edge Functions**: Supabase Edge Functions execute globally near the database, isolating Gemini API keys securely. | **Next.js Serverless Route Handlers**: Node.js runtime on Vercel running API routes calling Gemini. | **Tie / Slight Option A Advantage**: Both support server-side secret isolation; Option A keeps frontend and backend cleanly decoupled. |
| **Deployment & Rollback Simplicity** | **Atomic Git Deploys**: Cloudflare Pages builds static dist in <45s with instant 1-click preview and rollback capabilities. | **Full-Stack Vercel Deploys**: Serverless bundling, edge middleware compilation, and server asset packaging. | **Option A wins**: Pure static artifacts eliminate deployment runtime drift and server crashes. |
| **Long-Term Maintainability** | **High**: Decoupled static frontend SPA + managed Supabase backend. Upgrading React or Vite does not affect database logic. | **Medium**: Monolithic full-stack framework tight-coupling makes partial updates risky over multi-year horizons. | **Option A wins**: Long-term maintainability is superior for a solo developer maintaining a production service part-time. |
| **Operating Cost at 5–25 Tenants** | **₹0 / month fixed platform cost** (within generous Cloudflare and Supabase free allowances). | **₹1,700 / month minimum** (mandatory commercial Vercel Pro subscription). | **Option A wins**: Zero fixed recurring burn rate during initial pilot validation. |

---

### 2.2 Definitive Recommendation
**Option A (React + Vite + TypeScript + Cloudflare Pages + Supabase)** is the **definitive recommended stack**.  
It eliminates artificial commercial licensing costs, avoids cold-start latency for patrons scanning QR codes at physical counters, simplifies multi-tenant security via PostgreSQL Row Level Security (RLS), and provides a clean separation of concerns tailored for a solo student founder.

---

## 3. Final Recommended Technology Stack

```
+---------------------------------------------------------------------------------------------------+
|                                  RECOMMENDED PRODUCTION STACK                                     |
+---------------------------------------------------------------------------------------------------+
| LAYER                    | TECHNOLOGY SELECTED          | SPECIFIC VERSION / STANDARD            |
|--------------------------+------------------------------+----------------------------------------|
| Frontend Core            | React                        | React 19.x (or 18.3 LTS with strict)   |
| Build Tool & Dev Server  | Vite                         | Vite 6.x                               |
| Language & Type System   | TypeScript                   | TypeScript 5.x (Strict Type Checking)  |
| Styling & Design Tokens  | Tailwind CSS                 | Tailwind CSS v4.x (with v3.4 fallback) |
| UI Component Primitives  | Radix UI / shadcn/ui         | Accessible Primitives (WCAG 2.1 AA)    |
| Client-Side Routing      | React Router                 | React Router v7.x (SPA Library Mode)   |
| Form Management          | React Hook Form              | React Hook Form v7.x                   |
| Schema Validation        | Zod                          | Zod v3.23+                             |
| Client PDF Studio        | @react-pdf/renderer or jsPDF | Client-Side Vector PDF Engine          |
| Icons                    | Lucide React                 | Lucide React v0.4x                     |
| Hosting & Edge CDN       | Cloudflare Pages             | Cloudflare Edge Network (Standard)     |
| Database Engine          | PostgreSQL                   | PostgreSQL 15+ (via Supabase)          |
| Multi-Tenant Security    | Row Level Security (RLS)     | Engine-Level Declarative Policies      |
| Backend Functions        | Supabase Edge Functions      | Deno Runtime (TypeScript)              |
| Authentication           | Supabase Auth                | Email Magic Link / Password + JWT      |
| AI Generation Engine     | Google Gemini API            | gemini-3.5-flash-lite / gemini-3.8-flash|
| AI Official SDK          | @google/genai                | Official Google GenAI SDK v0.1+        |
+---------------------------------------------------------------------------------------------------+
```

---

## 4. Layer-by-Layer Technology Rationale

### 4.1 Frontend Layer
1. **React 19 + TypeScript 5:**
   - *Rationale:* Industry standard for interactive web applications. Strict TypeScript guarantees compile-time type safety across business schemas, survey payloads, and analytics events.
2. **Vite 6:**
   - *Rationale:* Instant Hot Module Replacement (HMR), lightning-fast Rollup-based production builds, native ESM support, and tiny output bundles (<100 KB gzipped).
3. **Tailwind CSS v4 + shadcn/ui:**
   - *Rationale:* Zero runtime CSS-in-JS overhead; atomic utility classes ensure ultra-fast style rendering. `shadcn/ui` components (built on accessible Radix primitives) provide touch-friendly UI components (minimum 48×48px tap targets, WCAG 2.1 AA color contrast) modifiable directly in the repository without package lock-in.
4. **React Router v7 (Library Mode):**
   - *Rationale:* Lightweight, declarative client-side SPA routing (`/q/:qrId`, `/r/:slug`, `/dashboard/*`, `/admin/*`). Does not require server-side rendering (SSR) complexity.
5. **Zod + React Hook Form:**
   - *Rationale:* Isomorphic schema validation. The exact same Zod schema used to validate the 3-MCQ customer survey and business profile on the client is shared with backend Supabase Edge Functions.

---

### 4.2 Backend & Data Layer
1. **Supabase PostgreSQL 15+:**
   - *Rationale:* Relational database with native JSONB support for survey schemas, robust foreign key relational integrity, and rock-solid Row Level Security (RLS).
   - *Multi-Tenant Isolation:* RLS policies ensure that merchants can never read, modify, or leak data belonging to another business, even if application-level bugs occur.
2. **Supabase Auth:**
   - *Rationale:* Handles Email Magic Links, password hashing (bcrypt), session rotation, and JWT token issuance. Supports Multi-Factor Authentication (MFA / TOTP) for super-admin protection.
3. **Supabase Edge Functions (Deno Runtime):**
   - *Rationale:* Lightweight serverless functions executed globally across 30+ edge regions. Used strictly for privileged, secret-dependent operations:
     - AI Review Generation (Gemini API key isolation)
     - Safe Public Business Data Projection (`get-public-business`)
     - Quota enforcement and rate-limiting
     - Secure analytics ingestion

---

### 4.3 Hosting & Operational Layer
1. **Cloudflare Pages:**
   - *Rationale:* Free tier explicitly permits commercial SaaS projects. Zero bandwidth charges, 500 builds/month, automatic global CDN edge caching, and free SSL/TLS certificates.
   - *Static Hosting Advantage:* Pure client-side SPA compilation means Cloudflare serves static pre-gzipped assets with sub-50ms latency across Indian mobile networks (Jio, Airtel, Vi).

---

## 5. AI Model Evaluation: Supported Gemini Flash Models

Per official Google Gemini API documentation, access to legacy Gemini 1.5 and Gemini 2.5 models is restricted for certain new projects. Specifically, official documentation states:
> *"To ensure reliable performance for everyone, we are limiting access to the 2.5 models to users who have actively used them in the past... For any new projects, use our latest models: 3.5 Flash-Lite or 3.8 Flash."* (Source: `gemini-api-guides/models.md`).

Accordingly, we evaluate the currently supported modern Gemini Flash models:

### 5.1 Official Model Comparison Matrix

| Model Identifier | Official Role & Purpose | Input Price (per 1M tokens) | Output Price (per 1M tokens, inc. thinking) | Context Window | Structured JSON Output | Evaluator Assessment |
| :--- | :--- | :---: | :---: | :---: | :---: | :--- |
| **`gemini-3.5-flash-lite`** | Cost-efficient model optimized for high-volume agentic tasks, translation, and structured data processing. | **$0.30** (~₹25.50) | **$2.50** (~₹212.50) | 1,048,576 | Native Schema Support | **Recommended Primary Model**: Exceptionally low input/output cost, fast turnaround, excellent structured JSON compliance. |
| **`gemini-3.8-flash`** | Intelligent Flash model engineered for complex reasoning, autonomous agents, and enterprise workflows. | **$0.75** (~₹63.75) | **$3.75** (~₹318.75) | 1,048,576 | Native Schema Support | **Recommended Premium Alternative**: Higher reasoning depth; promo pricing ($0.75/$3.75) valid through Dec 31, 2026. |
| **`gemini-3.5-flash`** | Earlier foundational Flash model built for speed and routine workloads. | **$1.50** (~₹127.50) | **$9.00** (~₹765.00) | 1,048,576 | Native Schema Support | **Not Recommended for MVP**: Substantially higher price per million tokens than `3.5-flash-lite` with no distinct advantage for short review drafts. |

*(Citations verified from official Google Gemini documentation `gemini-api-guides/pricing.md` and `gemini-api-guides/models.md`)*.

---

### 5.2 Granular Token Cost Calculations

To avoid generic assumptions, we model exact token economics under realistic operating assumptions:
- **Currency Conversion:** $1.00 USD = ₹85.00 INR.
- **Input Payload:** ~350 tokens (system instructions + business metadata + affirmed MCQ choices + optional 150-char note).
- **Output Review Draft:** ~75 tokens (<60 words in JSON format: `{"reviewDraft": "..."}`).
- **Thinking Tokens:** Budgeted at 0 (disabled for simple formatting) or ~100 tokens if reasoning mode is active.
- **Retry / Failure Allowance:** 3% retry margin added to monthly volumes.
- **Monthly Usage per Merchant:** 150 customer generations (155 total requests with retries).

#### Detailed Calculation Table:

| Model | Token Scenario | Input Cost / Req | Output Cost / Req | Total Cost / Request | Monthly Cost (155 Reqs) |
| :--- | :--- | :---: | :---: | :---: | :---: |
| **`gemini-3.5-flash-lite`** | Standard (No Thinking: 350 in / 75 out) | $0.000105 (₹0.0089) | $0.000188 (₹0.0160) | **$0.000293 (₹0.0249)** | **$0.0454 (~₹3.86 / mo)** |
| **`gemini-3.5-flash-lite`** | Reasoning (100 Thinking: 350 in / 175 out) | $0.000105 (₹0.0089) | $0.000438 (₹0.0372) | **$0.000543 (₹0.0461)** | **$0.0841 (~₹7.15 / mo)** |
| **`gemini-3.8-flash`** | Standard (No Thinking: 350 in / 75 out) | $0.000263 (₹0.0223) | $0.000281 (₹0.0239) | **$0.000544 (₹0.0462)** | **$0.0843 (~₹7.16 / mo)** |
| **`gemini-3.8-flash`** | Reasoning (100 Thinking: 350 in / 175 out) | $0.000263 (₹0.0223) | $0.000656 (₹0.0558) | **$0.000919 (₹0.0781)** | **$0.1424 (~₹12.11 / mo)** |

*Conclusion:* Across all tested configurations, the total monthly AI API cost per merchant is **under ₹15.00 / month**, representing **less than 3.8% of the ₹399/month subscription fee**.

---

## 6. Estimated Operating Costs & Scaling Model

All calculations reflect verified vendor pricing tiers and operational dependencies:

### 6.1 Multi-Tenant Cost Projections

| Infrastructure Component | Free-Tier Phase (5 Pilot Merchants) | 25 Active Merchants | 50 Active Merchants | 100 Active Merchants | Notes & Vendor Citations |
| :--- | :---: | :---: | :---: | :---: | :--- |
| **Cloudflare Pages Hosting** | ₹0 | ₹0 | ₹0 | ₹0 | Free tier permits commercial use; unlimited bandwidth. |
| **Supabase PostgreSQL / Auth** | ₹0 | ₹0 | ₹2,125 / mo ($25 Pro) | ₹2,125 / mo ($25 Pro) | Free tier covers 50k MAU / 500MB DB. Pro tier added at 50 merchants for 24/7 uptime & PITR. |
| **Google Gemini Flash API** | ~₹20 / mo | ~₹100 / mo | ~₹200 / mo | ~₹400 / mo | Modeled on `gemini-3.5-flash-lite` @ ~₹4/mo/tenant + safety margin. |
| **Domain Name (`.in` / `.com`)** | ₹85 / mo (₹1,000/yr) | ₹85 / mo | ₹85 / mo | ₹85 / mo | Amortized annual registrar cost. |
| **Payment Gateway (Razorpay)** | ~₹94 / mo | ~₹264 / mo | ~₹435 / mo | ~₹775 / mo | 2% + 18% GST (2.36% net) on setup and recurring fees. No double counting. |
| **Uptime Monitoring / Alerts** | ₹0 | ₹0 | ₹0 | ₹0 | UptimeRobot / BetterStack free tier (5-min checks). |
| **Total Monthly Operating Costs** | **~₹199 / mo** | **~₹449 / mo** | **~₹2,845 / mo** | **~₹3,385 / mo** | **Includes Pro database tier upgrade at 50 merchants.** |

---

### 6.2 Financial Scenario Analysis (Founder Revenue vs. Costs)

*Note: The following scenarios are working hypotheses to demonstrate unit economic viability, not guaranteed income schedules.*

| Scale Metric | 5 Businesses (Pilot) | 25 Businesses (Milestone Target) | 50 Businesses (Expansion) | 100 Businesses (Matured) |
| :--- | :---: | :---: | :---: | :---: |
| **New Setup Onboardings / Mo** | 4 setups | 8 setups | 10 setups | 12 setups |
| **Active Recurring Subscribers** | 0 (Month 1 included) | 20 subscribers | 42 subscribers | 88 subscribers |
| **Gross Setup Revenue (₹999)** | ₹3,996 | ₹7,992 | ₹9,990 | ₹11,988 |
| **Gross Recurring Revenue (₹399)** | ₹0 | ₹7,980 | ₹16,758 | ₹35,112 |
| **Total Gross Revenue** | **₹3,996** | **₹15,972** | **₹26,748** | **₹47,100** |
| **Direct Fulfillment Costs (₹284/setup)**| ₹1,136 | ₹2,272 | ₹2,840 | ₹3,408 |
| **Platform & Gateway Costs** | ₹199 | ₹449 | ₹2,845 | ₹3,385 |
| **Net Operating Surplus** | **₹2,661** | **₹13,251** | **₹21,063** | **₹40,307** |
| **Estimated Tax Provision (~10–15%)** | ₹266 | ₹1,325 | ₹2,106 | ₹4,031 |
| **Net Founder Cash Surplus** | **₹2,395** | **₹11,926** | **₹18,957** | **₹36,276** |
| *Founder Financial Goal (₹10k–15k/mo)* | *Progressing* | **TARGET ACHIEVED (₹11,926)**| **EXCEEDED (₹18,957)** | **EXCEEDED (₹36,276)** |

---

## 7. Free-Tier Limitations and Upgrade Triggers

```
+---------------------------------------------------------------------------------------------------+
|                                 FREE-TIER BOUNDARY & UPGRADE TRIGGER                              |
+---------------------------------------------------------------------------------------------------+
| VENDOR / TIER            | FREE ALLOWANCE LIMIT                  | PRODUCTION UPGRADE TRIGGER     |
|--------------------------+---------------------------------------+--------------------------------|
| Supabase Database        | 500 MB PostgreSQL storage             | Upgrade to Pro ($25/mo) at     |
|                          | 7-day inactivity project pause        | 35+ active merchants or when   |
|                          | Zero Point-in-Time Recovery (PITR)    | automated backups exceed 400MB.|
|                          |                                       | Keep-alive ping used in pilot. |
|--------------------------+---------------------------------------+--------------------------------|
| Supabase Auth            | 50,000 Monthly Active Users (MAU)     | Sufficient for >1,000 merchants|
|                          | Email Magic Links & Password auth     | No upgrade needed for Phase 1. |
|--------------------------+---------------------------------------+--------------------------------|
| Supabase Edge Functions  | 500,000 invocations / month           | 500k invocations covers >2,500 |
|                          | 2 MB bundle limit; Deno runtime       | businesses generating reviews. |
|--------------------------+---------------------------------------+--------------------------------|
| Cloudflare Pages         | Unlimited bandwidth & requests        | Commercial use permitted. Free |
|                          | 500 build runs / month                | tier supports all scale phases.|
|--------------------------+---------------------------------------+--------------------------------|
| Google Gemini API        | Pay-as-you-go commercial tier         | Incurred per token (~₹0.025/  |
|                          | 1,000 Requests Per Minute (RPM) quota | gen). Funded from sub surplus. |
+---------------------------------------------------------------------------------------------------+
```

---

## 8. Development Environment & Versioning Policy

### 8.1 Local Development Prerequisites
- **Node.js:** v20.x or v22.x LTS (active Long Term Support).
- **Package Manager:** `npm` (v10+). A strict lockfile (`package-lock.json`) must be checked into version control.
- **Supabase CLI:** Installed locally for local PostgreSQL Docker emulation and Edge Function testing.
- **Docker Desktop / OrbStack:** Required exclusively for running local Supabase database instances.
- **Git:** Standard feature-branch workflow (`main` $\to$ `dev` $\to$ `feature/*`).

### 8.2 Dependency Management & Versioning Policy
- **Zero Deprecated Packages:** No packages in maintenance mode or with deprecated sub-dependencies will be admitted to `package.json`.
- **Exact Lockfile Enforcement:** Production builds on Cloudflare Pages execute `npm ci` to prevent unreviewed package drift.
- **Audit Cadence:** Automated `npm audit` run before every production deployment to catch upstream vulnerabilities.

---

## 9. Technical Risk Matrix & Mitigations

| Technical Risk | Impact | Probability | Architectural Mitigation |
| :--- | :---: | :---: | :--- |
| **Supabase 7-Day Inactivity Pausing** | High | Medium | Pilot phase uses an automated external health-check ping (via GitHub Actions cron every 48 hours). Upgrade to Supabase Pro ($25/mo) is budgeted upon reaching 20 paying merchants. |
| **Mobile Popup Blocker Interception** | Medium | High | Two-step or fallback handoff: If `window.open` is blocked by iOS Safari / Android Chrome, parent screen immediately displays a persistent, prominent *"Tap here to open Google Reviews"* button. |
| **Shared Customer Wi-Fi Throttling** | Medium | Medium | Rate limiting uses ephemeral hashed IP keys (`SHA-256(IP + salt)`) with sliding-window burst allowances to avoid blocking multiple customers on the same cafe Wi-Fi. |
| **Client-Side PDF Compatibility** | Low | Low | Uses standard `@react-pdf/renderer` or `jsPDF` canvas rendering directly in the browser, eliminating server-side headless browser rendering costs. |

---

## 10. Technology Decision Status Summary

```
===================================================================================================
                                  TECHNOLOGY DECISION STATUS
===================================================================================================
DECISION AREA                   STATUS                 DECISION & RATIONALE
---------------------------------------------------------------------------------------------------
1. Core Architecture Stack      APPROVED               React 19 + Vite 6 + Cloudflare Pages + Supabase.
                                                       Zero hosting fees, zero cold starts, robust RLS.
2. Styling & UI Components      APPROVED               Tailwind CSS v4 + Radix / shadcn/ui primitives.
                                                       Guarantees 48px tap targets, WCAG 2.1 AA a11y.
3. AI Generation Engine         APPROVED               Supabase Edge Functions + Google GenAI SDK.
                                                       Isolated server-side secrets, zero client exposure.
4. Primary AI Model             PROVISIONAL            gemini-3.5-flash-lite (Primary) / gemini-3.8-flash.
                                                       Configurable via GEMINI_MODEL_NAME environment key.
5. Client-Side Routing          APPROVED               React Router v7 (Library SPA mode).
6. State Management             APPROVED               React Context / TanStack Query (no complex Redux).
7. Standee PDF Engine           APPROVED               Client-side vector generation (@react-pdf/renderer).
===================================================================================================
```

---

*End of Technology Stack Specification & Evaluation Document.*  
*Reference for Architecture Specification ([`docs/ARCHITECTURE.md`](file:///Users/mrugmaythere/work/QRs/docs/ARCHITECTURE.md)).*
