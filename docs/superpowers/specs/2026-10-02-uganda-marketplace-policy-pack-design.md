# Uganda Marketplace Policy Pack Design

> **Status: Draft pack produced from the approved scope; awaiting product and Ugandan counsel review.** The policy documents remain drafts and are not effective. This is a product/document design, not a legal opinion, filing, or determination that Fidexa LLC holds the required licences.

## Goal

Prepare the policy and operations documents needed to evaluate and safely configure Fave driver onboarding, admin verification, vehicle listings, and client trip requests in Uganda. The documents will distinguish legal requirements supported by primary sources from proposed Fave policy and unresolved legal or business decisions.

## Context and confirmed sources

The current implementation reads approved, versioned driver/client terms, privacy notices, checklists, and retention rules from D1. It intentionally blocks driver applications, approvals, vehicle publishing, and bookings when those records are missing. The existing retention configuration accepts any positive `retention_days` value and scheduled jobs purge expired driver and vehicle evidence; it does not enforce a five-year minimum. This must remain a counsel decision before any retention policy is activated. This pack supplies reviewable draft content; it does not publish records to D1 or activate those workflows.

The research baseline includes these primary sources (reviewed 2–3 October 2026):

- [Traffic and Road Safety Act, 1998](https://ulii.org/en/akn/ug/act/1998/15/eng%402020-05-22), including section 70A as inserted by the [2020 amendment](https://ulii.org/en/akn/ug/act/2020/6/eng%402020-05-22), which addresses licensing for online digital networks and people carrying passengers or goods for reward through them.
- [Traffic and Road Safety (Digital Networks) Regulations, 2023](https://works.go.ug/wp-content/uploads/2026/04/Traffic-and-Road-Safety-Digital-Networks-Regulations-2023.pdf). Regulations 3–8 and 17–25 address platform licensing and compliance, transport-provider agreements, due diligence and registration, driver/owner identity and driving-licence details, vehicle details, accepted terms, access controls, provider identifiers, reporting, system backups and vehicle marking. Regulation 17(2) refers to registration with the licensee and licensing with the Competent Authority; the exact driver/platform licensing obligations must be confirmed for Fave’s structure.
- [Data Protection and Privacy Act, 2019 (Chapter 97, consolidated to 31 December 2023)](https://ulii.org/en/akn/ug/act/2019/9/eng%402023-12-31) and the [Data Protection and Privacy Regulations, 2021](https://pdpo.go.ug/media/2022/03/Data_Protection_and_Privacy_Regulations-2021.pdf). The Act covers purpose limitation, data minimization, transparency, consent and legal bases, retention, data-subject rights, security, registration and transfers outside Uganda.
- [Electronic Transactions Act, 2011 (Chapter 99, consolidated to 31 December 2023)](https://ulii.org/en/akn/ug/act/2011/8/eng%402023-12-31), including section 23’s online supplier disclosures and opportunity for the consumer to review, correct mistakes and withdraw before placing an order. Section 23(7)(j) excludes specified-date transport services from the section 23(3) 14-day remedy for failure to meet sections 23(1)–(2); section 24 contains a separate cancellation provision. Counsel must determine how these provisions and any other rights apply to the specific trip/deposit model; the draft must not promise or exclude statutory rights without that advice.
- The [National Payment Systems Act, 2020 (Chapter 59)](https://ulii.org/en/akn/ug/act/2020/15/eng%402023-12-31) and [National Payment Systems Regulations, 2021](https://ulii.org/en/akn/ug/act/si/2021/18/eng%402021-03-05) for payment-provider licensing questions; the [Motor Vehicle Insurance (Third Party Risks) Act](https://ulii.org/en/akn/ug/act/statute/1988/11/eng%402000-12-31), [Insurance Act, 2017](https://ulii.org/en/akn/ug/act/2017/6/eng%402023-12-31), and Traffic and Road Safety Act s. 33 for vehicle cover questions; and the [Value Added Tax Act](https://ulii.org/en/akn/ug/act/statute/1996/8/eng%402023-12-31), [Income Tax Act](https://ulii.org/en/akn/ug/act/1997/11/eng%402024-12-23), and [Income Tax (Amendment) Act, 2025](https://ulii.org/en/akn/ug/act/2025/13/eng%402025-07-04) for payment/tax review. The VAT consolidation page warns that outstanding amendments are not applied.
- [NIST SP 800-122](https://csrc.nist.gov/pubs/sp/800/122/final) as a nonbinding security-design reference for risk-based safeguards for personal information. It is not Ugandan law.

An important legal question concerns retention: regulation 22(2) of the Digital Networks Regulations says a licensee shall retain customer data for at least five years from collection. The Data Protection Act limits retention to a lawful purpose or period required/authorized by law and requires secure deletion or de-identification at expiry. Counsel must determine how the five-year rule applies to each category of ID evidence, extracted ID fields, vehicle documents/photos, booking records, and inactive or rejected applications, and reconcile backups and legal holds. Until resolved, the pack will not approve shorter deletion windows for records potentially within that rule.

## Approaches considered

1. **Research memo only.** Lowest drafting effort, but leaves app-required terms and operating checklists unavailable.
2. **Complete counsel-review pack (recommended).** Covers the legal research, user-facing policies, internal checklists, retention decisions, and the open decisions needed to move the app gates forward.
3. **Driver onboarding documents only.** Unblocks only part of #6 and #7 and leaves #8 and #10 without booking, vehicle, or client policies.

## Proposed documents

1. `docs/compliance/uganda-marketplace-research-and-decisions.md`
   - Primary-source register with provision-level links and access date.
   - Requirements mapped to #6, #7, #8, and #10, including electronic-transactions disclosures and booking flow.
   - Separate tables for confirmed text, product implications, assumptions, and questions for counsel/Ministry confirmation.
2. `docs/compliance/drafts/driver-terms-and-privacy-notice.md`
   - Proposed Fidexa LLC identity, service description, driver relationship, application and eligibility process, account status, identity evidence, data uses/sharing, rights/contact path, and version/acceptance fields.
   - Bracketed fields for legal entity particulars, licensing status, fees/commission, insurance, support contacts, and any other unresolved business/legal terms.
3. `docs/compliance/drafts/client-terms-and-privacy-notice.md`
   - Client registration, trip request and vehicle selection, quote/booking lifecycle, payment, cancellation/refund, safety/contact sharing, data handling, and dispute/contact terms.
   - Unsettled fare, deposit, payment-provider, operator/contracting-party, and cancellation choices remain explicit placeholders.
4. `docs/compliance/drafts/verification-and-retention-procedures.md`
   - Proposed driver and vehicle evidence checklists, admin review steps, rejection/resubmission controls, safe photo publication, unique provider identifier, and audit requirements.
   - A record-category retention matrix which states the legal basis and minimum/maximum proposed period, deletion method, and hold exceptions only where supported; unresolved periods stay marked for counsel decision.

All draft documents start with a conspicuous **DRAFT FOR UGANDAN COUNSEL REVIEW — NOT EFFECTIVE** notice. They have not been written to the policy registry, are not approved, and are not described as counsel-approved. No personal identification number examples or real data are included.

## Application to the four issues

- **#6 Driver registration:** define the notices, driver agreement, required fields/evidence, acknowledgement capture, and applicant-facing process, subject to counsel validation of identity and data handling.
- **#7 Admin verification:** define evidence review and decision checklist, role separation, decision reasons, applicant communication, and audit trail. This remains distinct from the full operations console in #17.
- **#8 Vehicle listings:** define registration details, ownership/authorization evidence, photo review/publication, availability declarations, and unresolved regulatory vehicle-marking requirements.
- **#10 Client trip request:** define client terms and privacy notice, quote/booking disclosures, contact-sharing consent, cancellation/refund and payment placeholders, and the point at which a booking becomes binding.

The documents support these issues but do not satisfy unrelated prerequisites such as implementing a phone verification provider (#22), client profile/consent storage (#21), production payment processing, or obtaining regulatory approvals.

## Drafting and review rules

- Prefer Ugandan statutes and official Ministry, NITA-U, and PDPO material. Link to each provision and record source version/date. Use secondary sources only to locate primary sources or identify questions.
- Label legal propositions as source-backed summaries, not legal advice. Avoid treating a general guideline as a legal duty.
- Separate required collection from optional product data and explain why each field is needed.
- Minimize exposure of national ID numbers and document images; propose access controls and audit without putting document contents into logs.
- Do not invent prices, commissions, deposits, refund rights, insurance coverage, licence status, retention periods, or company registration particulars.
- After drafting, perform a citation check and consistency review against `fave-worker/src/marketplace-policies.ts`, the current schema, and the onboarding/booking code. Do not change application code or seed policy records as part of this document task.

## Review boundary

The pack is ready for product/counsel review when every source-backed statement links to a primary source, each unresolved issue has a named decision owner (Fidexa LLC, Ugandan counsel, or the competent authority), and no draft silently converts a proposed safeguard into an asserted legal requirement. Counsel must confirm current law, entity particulars, licensing/classification, payment and contracting structure, privacy roles and cross-border processing, retention interpretation, transport and insurance duties, and final enforceability before publication or activation.
