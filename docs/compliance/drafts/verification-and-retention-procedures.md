# Driver and Vehicle Verification and Retention Procedures

> **DRAFT FOR UGANDAN COUNSEL REVIEW — NOT EFFECTIVE.** Version 0.1, 3 October 2026. These are proposed operational safeguards, not an approved statutory checklist. Do not activate a checklist or retention record in D1 until counsel and the responsible authority confirm the applicable requirements.

## 1. Scope and control principle

This procedure covers #6 driver application, #7 staff verification, #8 vehicle listing/photo moderation, and the related data retention and incident controls required before #10 vehicle selection. The workflow must distinguish (a) facts explicitly required by law/regulation, (b) the particular licences/evidence confirmed by counsel or the Competent Authority, and (c) additional Fave risk controls. Staff must not present a proposed Fave control as a legal requirement.

Only designated administrators may review private evidence. No account self-promotion or direct API route can grant reviewer access. Reviewer action and access must be auditable. A driver approval does not replace a regulator-issued licence, vehicle inspection, insurance policy or platform licence.

## 2. Driver application checklist

### Applicant-facing steps

1. Explain each requested field, purpose, mandatory/optional status, legal basis, recipients/reviewer roles, retention period, and consequence of withholding before collecting it.
2. Show the current counsel-approved driver service agreement and privacy notice separately, in the applicant's chosen supported language. Record the exact versions and context. Do not include marketing consent in required acknowledgement.
3. Verify account control using the approved secure activation/phone process. Keep verification secrets out of the application and audit records; store verification time and method only.
4. The first release accepts Ugandan citizen drivers only. Record the applicant's explicit citizenship affirmation and collect the Ugandan National ID number and front/back images. Do not accept foreign-national or refugee driver applications in this release. Counsel and the Competent Authority must confirm the citizen-only eligibility restriction and exact evidence checklist before activation.
5. Collect the registration-rule passport-style photo and driving-licence details where applicable. Explain why the ID image/number is needed and restrict it to reviewer access.
6. Collect only the current counsel-approved driver checklist. Show missing/invalid items before submission. Submitted application begins `pending_verification`; it cannot publish a vehicle or receive a booking until approved and current.
7. Give the applicant a receipt, status, correction request and secure resubmission route. Show the applicant-facing reason/next action but never internal reviewer notes or another person's data.

### Reviewer checks

| Check | Proposed evidence/action | Basis classification | Decision to finalize |
| --- | --- | --- | --- |
| Ugandan National ID and citizen eligibility | Confirm the applicant made the citizen-only affirmation; compare the National ID number and front/back images with the applicant's legal name and photograph. Never copy more fields than the approved checklist requires. | The Regulations list National ID evidence for citizens; Fave's citizen-only restriction is a product choice requiring confirmation. | Counsel/Competent Authority to confirm restriction, acceptable image/copy, validation source and mismatch process. |
| Passport-style photo | Confirm usable current likeness and match to applicant; store privately. | Reg. 18(3)(b) names a passport photo. | Define age/recency/quality and non-discrimination exception route. |
| Driving licence | Confirm number/class/expiry and appropriate class for vehicle where applicable; record check date/result, not unnecessary extra detail. | Reg. 18(3)(b) references the licence number where applicable; Traffic and Road Safety Act licensing provisions apply. | Confirm license class, verification authority/source, expiry refresh cadence. |
| Competent Authority provider/operator permission | Check evidence and status where the driver/provider must be licensed under the Act/regulations. | Traffic and Road Safety Act s. 70A and 2023 Regulations reg. 17(2). | Confirm personal vs platform licence and exact licence document with authority. |
| Phone/account activation | Verify secure control and assign a unique provider ID separate from phone and plate. | Digital Networks Regulations reg. 19. | Confirm secure messaging/activation provider and recovery method. |
| Terms acceptance and applicant consent/legal basis | Verify exact current version, language, date and context; verify separate consents only where used as legal basis. | Regulations 17(3), 18(3)(c); DPPA ss. 7, 13. | Counsel to confirm lawful basis per data purpose; agreement acceptance is not blanket privacy consent. |
| Additional suitability checks | Run only approved checks, with access control and a recorded reason/result. | Reg. 18(2) calls for suitability assessment/due diligence; method/scope requires proportionality and counsel/authority review. | Define legally permitted sources, notice, relevance, adverse decision review and retention. |

**Decision outcomes:** approve only if every active mandatory checklist item is current, verified, and consistent; request correction with a specific applicant-visible action; reject with a reason and review contact; or suspend/temporarily pause under the approved urgent-risk process. Log reviewer ID, timestamp, checklist version, evidence IDs, decision, reason code, and applicant message separately. No undocumented exception.

## 3. Vehicle registration and review checklist

### Driver-supplied facts

- make, model, year, body type, seating capacity, passenger and luggage capacity;
- comfort/accessibility and material features represented to clients;
- vehicle registration number and registered owner/authorized user;
- owner authorization/lease/fleet relationship if driver is not registered owner;
- current exterior/interior photos of the exact vehicle; and
- current evidence items from the approved vehicle checklist.

### Staff verification

1. Match vehicle identity/registration to the presented document and current photos; note status and last check date.
2. Confirm any required PSV/vehicle licence, certificate of fitness/roadworthiness/environmental inspection, route/operating permit, insurance use/coverage, and driver-owner authorization only after counsel identifies exactly which apply to Fave's vehicle and trip class.
3. Confirm required Fave/licensee mark, label, beacon or identifier and Competent Authority approval under Digital Networks Regulations reg. 25 before a relevant vehicle is offered. Counsel/authority must determine implementation and timing.
4. Keep registration, ownership, insurance and inspection evidence private. Client APIs return only approved vehicle facts and approved client-facing photos; never return evidence bytes, raw object keys/URLs, private addresses, or driver contact details.
5. Review each public photo for correct vehicle, material mismatch, registration plate, visible identity documents, bystanders, children, home/location metadata or other disclosure. Request a replacement/crop where needed; only explicitly approved photo IDs are publishable. Do not edit evidentiary originals.
6. Approve, request correction or reject with reason; record reviewer and checklist version. Pause client visibility if a mandatory item expires, is withdrawn, or is under investigation.

**Vehicle status gate:** a listing is client-selectable only while its driver is approved, all required driver/vehicle permissions and evidence are current, at least one public photo has been approved if policy requires it, and the requested dates do not overlap a live hold, confirmed trip or driver-declared unavailable range.

## 4. Client booking controls connected to verification

- Show only a registered and eligible provider/vehicle after the provider and vehicle checks pass.
- Do not show client-facing driver identity/contact until the approved assignment stage.
- Before order/deposit, present supplier identity, service characteristics, total price/fees, payment method, cancellation/refund policy, service timing, transaction-record access, and privacy/payment-security notice. Allow full review, correction and withdrawal before placing an order.
- Capture trip details, vehicle, quote and policy versions atomically; revalidate vehicle/quote at confirmation; record deposit via the approved licensed payment path.
- Record assignment-time contact-sharing as a separate, informed choice naming purpose, recipient and timing.
- A quote hold prevents internal double-booking; it does not establish licence/roadworthiness/insurance compliance.

## 5. Privacy, access and audit safeguards

### Evidence handling

- Keep original ID and vehicle evidence in a private, non-public object store. Generate opaque object keys server-side; never use an uploaded filename as a key or publish a bucket URL.
- Enforce MIME allowlist, file signature, byte-size limit, malware scanning where available, and authenticated upload. Validate before persistent storage.
- Encrypt in transit and at rest; protect and rotate keys under documented recovery controls. Restrict decrypt/read permission to a designated reviewer role and a recorded case/reason.
- Return only the document type/status required for the current checklist. No ID value, full document body, or private evidence key in the client catalogue, analytics, crash reports or logs.
- Separate applicant-facing correction text from confidential reviewer notes. Audit viewing/downloading of identity files and every decision without recording sensitive document contents in the audit row.
- Test access removal when a reviewer leaves; review access grants periodically; preserve legally required audit trail separately from evidence content.

### Incident procedure

1. Report suspected compromise immediately to **[incident lead and backup contact]**. Preserve system/access evidence; do not overwrite records or send ID images through ordinary chat/email.
2. Contain unauthorized access, revoke credentials/tokens, isolate affected storage or routes, and involve the processor/security contact.
3. Record incident start/discovery time, affected systems/categories, approximate data subjects/records, likely consequences, containment, and contact person.
4. The controller/incident lead notifies the PDPO immediately after a personal-data breach as required by Data Protection and Privacy Regulations reg. 33, using the prescribed form/content. Follow the Authority's direction on notice to affected data subjects under the Act.
5. Notify transport regulator, police, insurer, payment provider, affected drivers/clients, or public only as required/approved; document who made each determination and when.
6. Track remediation and recurrence prevention. Do not make a blanket statement that encrypted data means no notification is needed; counsel/Authority decides.

## 6. Retention and deletion decision schedule

**No TTL in this table is approved.** The Digital Networks Regulations reg. 22(2) says a licensee shall retain customer data for at least five years from collection. The Data Protection and Privacy Act s. 18 limits retention and requires secure deletion/de-identification at expiry. Counsel must decide what counts as customer data for each record, the start event, permitted exceptions, whether providers are included, and how the two requirements apply. Pending written interpretation, do not activate a period shorter than five years for a category that may be customer data, and do not default to indefinite retention; if a lawful period cannot be configured, keep the affected production workflow closed.

| Record category | Minimum/proposed period | Start event | Deletion or hold rule | Counsel question |
| --- | --- | --- | --- | --- |
| Driver application profile and account linkage | **Undetermined; five-year minimum potentially applies** | Collection of each field or account record creation, as counsel decides | Delete/de-identify at approved expiry; retain separately only records with documented legal hold/basis. | Does the reg. 22(2) customer-data floor cover prospective, rejected, inactive and active transport providers? |
| Ugandan National ID images and number | **Undetermined; five-year minimum potentially applies** | Image/number collection event | Delete object and encrypted fields together at approved expiry; test replicas/backups; keep only permitted audit metadata. | Are identity files/derived fields “customer data”; may evidence be segregated/deleted earlier if a verified identity result is retained? |
| Driver licence and provider licence/activation records | **Undetermined; five-year minimum potentially applies** | Each collection/check event | Keep validity history only for approved period; erase expired evidence at lawful expiry. | Required retention for regulatory monitoring, active eligibility and complaints? |
| Vehicle registration, owner permission, insurance and inspection evidence | **Undetermined; five-year minimum potentially applies** | Each upload/verification event | Remove superseded originals at expiry after preserving any required transaction/audit record. | Which vehicle records count as customer data, and what evidence must be held after trips? |
| Public approved vehicle photos | **Undetermined** | Upload, approval or publication event as counsel decides | Remove when vehicle is delisted or permission ends, subject to any documented legal/claim hold and necessary record. | Are public images covered by five-year rule? Do images identify individuals/locations? |
| Client profile, verified phone and consent records | **Undetermined; five-year minimum likely relevant** | Each collection/verification/consent event | Preserve immutable policy/consent proof as required; delete live contact where no longer needed at approved expiry. | How long to keep phone and contact-sharing evidence; account closure effects? |
| Pickup/drop-off coordinates, itinerary, quote and booking records | **Undetermined; five-year minimum potentially applies** | Collection/booking event | Limit access and delete/de-identify at approved expiry; restrict legal holds to identified matters. | Which points start retention; whether location precision can be reduced after trip? |
| Payment, refund, fee, invoice, tax and settlement records | **Undetermined; tax/payment records may have independent periods** | Transaction/financial record creation | Keep only statutory/accounting/PSP-required fields and period; segregate credentials (never store raw secrets). | Applicable tax, payment-system, AML and accounting retention, and merchant/PSP obligations? |
| Review decisions, audit events, complaints, safety/incident and breach records | **Undetermined** | Decision/event occurrence | Maintain a minimal non-content audit trail for the separately approved period; legal holds require owner/reason/review date. | What regulatory, limitation, employment/consumer or claims period applies? |
| Backups and disaster-recovery copies | Same approved category schedule; no separate indefinite copy | Backup creation | Expiry must propagate to backups within a documented cycle; prevent restoration from resurrecting expired data. | Exact backup deletion cycle and recovery/hold behavior. |

## 7. Checklist approval and publication flow

1. Counsel maps each checklist row to statutory provision, licence condition or explicitly labeled risk control; names acceptable proof and an authorized verification method.
2. Fidexa LLC approves the operational procedure, reviewer roles, applicant messages, support/appeal route, and staffing/incident responsibilities.
3. Competent Authority/insurer/PSP confirmation is obtained where the law or activity classification is unresolved.
4. Privacy lead completes category/field basis, notice, recipients, transfer and approved retention matrix, and PDPO registration/DPO actions.
5. Version and approve each document/checklist/retention record with approver, approval date, language, scope, effective date and hash. Publish only approved effective versions to D1. Keep prior versions immutable for acceptance/audit.
6. Test that an absent, expired, mismatched or unapproved prerequisite blocks application approval, vehicle publication and booking in both the UI and API. Verify the app displays next action without exposing private reviewer data.

## 8. Relevant sources

- [Traffic and Road Safety Act, 1998](https://ulii.org/en/akn/ug/act/1998/15/eng%402020-05-22), [2020 amendment](https://ulii.org/en/akn/ug/act/2020/6/eng%402020-05-22), and [Digital Networks Regulations, 2023](https://works.go.ug/wp-content/uploads/2026/04/Traffic-and-Road-Safety-Digital-Networks-Regulations-2023.pdf).
- [Data Protection and Privacy Act, 2019](https://ulii.org/en/akn/ug/act/2019/9/eng%402023-12-31) and [Data Protection and Privacy Regulations, 2021](https://pdpo.go.ug/media/2022/03/Data_Protection_and_Privacy_Regulations-2021.pdf).
- [Electronic Transactions Act, 2011](https://ulii.org/en/akn/ug/act/2011/8/eng%402023-12-31), [National Payment Systems Act, 2020](https://ulii.org/en/akn/ug/act/2020/15/eng%402023-12-31), and [National Payment Systems Regulations, 2021](https://ulii.org/en/akn/ug/act/si/2021/18/eng%402021-03-05).
- [PDPO official registration/organization guidance](https://www.pdpo.go.ug/information-center/organisation) and [NIST SP 800-122](https://csrc.nist.gov/pubs/sp/800/122/final) (nonbinding security reference).
