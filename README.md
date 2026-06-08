# 🏫 AI-Assisted School Expense Tracker with Vernacular Capabilities

A mobile-first web app that helps school administrators and trustees log, track, and audit expenses — with AI that reads bills in Hindi, Gujarati, English, and handwritten formats.

Built ground-up as a 0→1 product by a PM, for a real organisation with a real problem.

---

## The Problem

Schools — especially trust-run and government-aided institutions — manage significant operational and infrastructure budgets with minimal digital infrastructure. Expenses are tracked in physical registers, bills arrive in regional languages, and there is no audit trail when disputes arise.

Existing tools (Tally, SAP, Excel) are either too complex for non-finance staff or require a desktop setup. Nothing is built for a site supervisor logging a contractor payment from their phone, or a trustee photographing a handwritten Gujarati bill at a vendor's shop.

---

## What I Built

An AI-powered progressive web app where any authorised team member can log expenses in seconds — by typing manually or photographing a bill in any language. All entries sync to a shared Google Sheet in real time, with a full audit trail.

### Key Features

**📸 Vernacular Bill Scanning**
Upload a photo of any bill — printed or handwritten, in Hindi, Gujarati, or English. Claude AI reads the text, extracts amount, vendor, date, and category, and pre-fills the entry form. Designed specifically for the messy, multilingual reality of Indian field operations.

**📔 Physical Register Import**
Photograph a page from a paper expense register. AI reads all entries on that page and presents them as editable rows for bulk review and import — bridging the gap between offline records and digital systems.

**🧾 Custom Receipt Format Recognition**
AI prompt tuned to recognise organisation-specific receipt formats — reads fixed fields accurately without any template configuration by the user.

**👥 Multi-user with PIN Auth**
Named logins with 4-digit PINs. Session remembered per device. Admin panel to add/remove members and reset PINs — all synced to the shared sheet.

**🔍 Duplicate Detection**
Flags entries with matching vendor + date + amount before saving. Requires a reason to override. Accepted duplicates are marked with a warning visible to admin — protecting against both accidental and intentional duplication.

**📋 Immutable Audit Trail**
No deletes. Entries can only be cancelled or edited — both require a typed reason and create a timestamped history. Built for organisations that need to answer to trustees, auditors, or government bodies.

**📊 Real-time Google Sheet Sync**
Every entry writes to a shared sheet instantly — with unique serial numbers, category, vendor, payment mode, bill reference, Drive link, and who logged it. Accessible to all stakeholders without needing to open the app.

**🔎 Smart Filtering with Live Totals**
Filter by vendor, category, and date range. Summary total updates live with the active filter — useful for monthly reviews or category-wise budget tracking.

---

## Product Decisions Worth Noting

**Vernacular-first, not vernacular-added**
Most expense tools treat regional language support as an afterthought. Here, Hindi/Gujarati/handwritten bill reading is a core feature — not a setting. The AI prompt is designed specifically for this context, with explicit instructions for numeral conversion and low-confidence flagging.

**Bill-first entry flow**
The default state is "I have a bill" — not "I'll type everything manually." This reduces errors and builds a culture of bill-based accountability, which matters in audit-heavy environments.

**No delete policy**
Explicitly decided with stakeholders. Any organisation accountable to trustees or government bodies needs an immutable record. Cancellation with reason is the only allowed action — this constraint was a product decision, not a technical limitation.

**Structured descriptions over free text**
Category → Item → Qty → Unit dropdowns instead of a text field. Every row in the sheet is consistent, comparable, and filterable. Prevents the "TMT rod 8mm feb24 from rajesh bhai" problem that makes Excel records useless for analysis.

**Cloudflare Worker proxy layer**
Browser security (CORS) prevents direct API calls from a hosted frontend. Rather than moving to a backend server, used three lightweight Cloudflare Workers as proxies — keeping infrastructure minimal, free, and maintainable without engineering support.

**No OAuth for Drive**
Team members are on personal Gmail accounts. Google OAuth adds significant friction for non-technical users. Solved Drive upload using a service account — one-time setup, invisible to end users.

**Single confirm for AI-filled fields**
Early version required confirming each AI-extracted field individually. User feedback showed this was too much friction. Replaced with a single "Confirm All" CTA — maintaining the verification step without the fatigue.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React (JSX), hosted on Netlify |
| AI | Anthropic Claude API (claude-haiku-4-5) |
| Database | Google Sheets via Apps Script |
| API Proxy | Cloudflare Workers (3 workers) |
| Auth | PIN-based session auth |
| File Storage | Google Drive via service account |
| Version Control | GitHub (private) |

---

## Architecture

```
Mobile Browser (Netlify)
        │
        ├── Cloudflare Worker: anthropic-proxy
        │         └── Anthropic Claude API
        │               (bill scanning, auto-categorisation, diary import)
        │
        ├── Cloudflare Worker: sheets-proxy  
        │         └── Google Apps Script → Google Sheet
        │               (read all entries, write new entries, config sync)
        │
        └── Cloudflare Worker: drive-proxy
                  └── Google Drive API
                        (bill photo upload, shareable link generation)
```

---

## What This Demonstrates as a PM

- **0→1 product ownership** — identified a real problem, defined scope, made tradeoffs, shipped to real users
- **Technical depth without engineering dependency** — architected and built a multi-service integration independently
- **User-centred iteration** — multiple feedback rounds with actual users led to real changes (confirm flow, diary import card design, mandatory field validation)
- **Constraint-driven design** — every major decision (no deletes, structured fields, bill-first flow) came from understanding the organisation's operational and compliance needs
- **Vernacular UX thinking** — designed for users who operate in Hindi/Gujarati, use physical bills, and log expenses from a construction site

---

## Status

Live and in active use. Iterating based on real usage feedback from a 5-person team managing school construction expenses.

---

*Built by Dhwani Shah · Senior Product Manager*  
*[LinkedIn](https://www.linkedin.com/in/dhwani-shah-b20a8a55/)*

Add README
