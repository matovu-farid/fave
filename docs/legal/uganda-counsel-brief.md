# Fave Uganda MVP — Counsel Brief

**Status:** Draft for qualified Ugandan counsel. This is a product brief and issue checklist, not legal advice, a legal opinion, or launch approval. No counsel review is recorded yet.

**Prepared:** 30 September 2026
**Related issue:** [#14 — Uganda legal, regulatory, privacy, and safety review](https://github.com/matovu-farid/fave/issues/14)
**Research scope:** Public primary and regulator sources listed below; counsel must verify the current consolidated law, amendments, administrative practice, and applicability to Fave before decisions are treated as final.

## 1. Product model to review

Please confirm or correct these working assumptions before advising:

- Fave is a mobile platform connecting customers who need long-distance, potentially multi-day rides with drivers using private cars. The customer browses and selects a vehicle; Fave assigns the driver.
- The first service area is Greater Kampala, with pickup addresses in Kampala, Mukono, or Wakiso. The product will use Google Maps address results to determine which of these named areas contains a pickup. Destinations may be anywhere in Uganda.
- Trips may last up to about seven days. Pricing is intended to account for driving distance and an estimated nightly driver-accommodation cost.
- The initial payment is intended to be a configurable percentage, defaulting to 50%; the remaining balance is due after the trip. Driver assignment and exchange of contact details follow the deposit.
- Drivers may self-register. Fave administrators manually review driver identity before allowing the driver to accept bookings. The planned onboarding information includes a driver’s national ID, name, phone number, driving details, and vehicle information and photographs.
- Fave has not yet recorded whether drivers are employees, contractors, agents, or independent providers; who owns each vehicle; who contracts with the passenger; or whether Fave receives, holds, or pays out customer funds. These facts may change the legal analysis.

## 2. Decisions and written deliverables requested

For each item below, please provide the applicable authority and source, a written conclusion for this exact operating model, required action/evidence, responsible owner, and whether it blocks launch. Separate confirmed legal requirements from prudent risk controls and unresolved questions.

### A. Platform, operator, driver, and vehicle classification

1. Does Fave fall within the “transportation Network Company” definition and the online digital network/platform licensing regime in section 70A of the Traffic and Road Safety Act and the Traffic and Road Safety (Digital Networks) Regulations, 2023? How do the private-car, whole-vehicle, long-distance, and multi-day features affect that conclusion?
2. Which licences or approvals must Fave, each driver, each vehicle owner, and any other party obtain? Confirm whether platform authorisation and a separate operator’s licence are required, which authority issues them, and whether any other taxi/rental/PSV category applies.
3. Confirm the exact vehicle category and seating/weight limits allowed for this service; driver licence class, age, experience, medical or background checks; driver accreditation/badges; and vehicle registration, inspection, roadworthiness, and permit requirements.
4. The Regulations appear to require an online-network licence application to include the product/operations description, a ten-year plan, risk and continuity plans, company or individual identification, TIN and URA tax clearance, and NITA-U electronic-systems licence/software certificate. Confirm which requirements apply to Fave, the correct NITA-U process and scope, fee, timing, renewals, and the evidence to retain.
5. Confirm whether the provider-registration system requirements apply, including suitability checks, a service agreement, vehicle and driver/owner details, photo and national ID, driving-licence details, provider/passenger registration, unique identifiers, regulator access, and restricted platform access.
6. Confirm the required monthly and annual regulator reports, complaint/incident/security metrics, five-year record-retention rule, backup/recovery controls, regulatory liaison appointment, annual compliance certificate, and approved vehicle marking. The current product assumes privately owned cars; can a small identifier satisfy the rule, and must it be visible throughout every trip?

### B. Driver and vehicle onboarding

1. Specify the legally required identity, licence, ownership/authority-to-use, inspection, tax, insurance, and safety documents for each driver and car. Confirm what may be collected before verification and what is the minimum information needed.
2. May Fave manually review national IDs and vehicle photographs? Define permitted access, retention, deletion, audit logging, incident response, and whether Fave may show vehicle photos to customers without exposing identity-document data.
3. Confirm the required frequency and method for rechecking driver, licence, vehicle, inspection, and insurance validity, and how expired or disputed records must affect access to bookings.
4. Define the necessary written provider agreement and identify the actual contractual parties for the customer trip.

### C. Insurance, road safety, and incidents

1. Identify minimum mandatory cover for a private car used for paid passenger transport, and whether ordinary private-use third-party policies exclude this use. Confirm passenger injury/death, driver injury, vehicle damage, theft, medical expenses, roadside assistance, and cross-border exclusions.
2. Decide which party must hold each policy (vehicle owner, driver, Fave, or more than one), what Fave must verify, whether group/contingent cover is advisable or required, and how policy lapse is handled.
3. For trips up to seven days, specify lawful and safe driver-hour limits, rest and overnight requirements, driver substitution, fatigue checks, emergency contacts, journey monitoring, and any constraints on solo driving. Confirm whether a driver can accept consecutive multi-day bookings.
4. Define the response process for crashes, breakdowns, missing persons, assault, harassment, theft, fraud, medical emergencies, and complaints: immediate escalation, emergency services, regulator/police/insurer notifications, evidence preservation, passenger support, owner decisions, and post-incident review.
5. Confirm passenger safeguarding requirements for children, vulnerable travellers, accessibility requests, luggage, and travel with additional passengers. Identify controls the app and operations team must enforce.

### D. Data protection and national-ID handling

1. Determine Fave’s roles under the Data Protection and Privacy Act, 2019 for client, driver, ID, photo, vehicle, location, route, contact, payment, and incident data. Identify any processor/joint-controller roles held by Cloudflare, Google Maps, Google/Apple sign-in, payment providers, messaging vendors, and analytics providers.
2. Confirm PDPO registration categories, registration scope, annual renewal, Data Protection Officer and governance requirements, lawful bases, notices, data-subject rights, processor contracts, security controls, breach reporting, and whether a data-protection impact assessment or other assessment is required.
3. Map the actual storage and access locations for identity documents, trip records, and backups, including service-provider subprocessors. Confirm cross-border transfer requirements and safeguards for each transfer. Do not infer that choosing a particular Cloudflare region alone resolves this question.
4. Reconcile the transport rules’ apparent five-year customer-data retention requirement with privacy minimisation, deletion requests, inactive-account handling, and any shorter retention of raw ID images. Specify which record types must be retained, starting point, access restrictions, and secure disposal date.
5. Approve a plain-language privacy notice and a separate national-ID notice covering purpose, fields collected, access, sharing, retention, security, contact point, and complaint path. Confirm whether identity data may be used only for onboarding and regulatory checks.

### E. Customer contract, fares, deposits, changes, and refunds

1. Identify the consumer-protection, transport, tax, advertising, and contract laws governing online booking of this service. Confirm required business disclosures, price statements, receipts, complaint handling, non-waivable rights, and any regulator approval.
2. Determine who sells/provides the trip and who is responsible to the customer when a driver cancels, the car changes, pickup fails, a trip is delayed or abandoned, an itinerary changes, or the customer disputes service quality.
3. Approve the quote content and validity period: route/distance assumptions, accommodation estimate and who arranges/pays it, other chargeable costs, taxes/fees, inclusions/exclusions, how actual distance and nights reconcile, and when a revised quote needs customer acceptance.
4. Approve the default deposit and balance flow, when funds are captured, how long a booking is held while payment is pending, what confirms trip completion, and how the customer receives a statement/receipt.
5. Set clear cancellation, refund, no-show, late-change, driver/car unavailability, trip-failure, force-majeure, and dispute rules. State when a deposit is refundable and the timing/method of any refund. Ensure app copy does not imply a waiver of statutory rights.
6. Confirm the legally valid method for customer and driver electronic acceptance. Specify which document versions each party accepts, at which point in onboarding/booking, the language(s), what material change requires renewed consent, and what evidence proves the acceptance.

### F. Payments and settlement

1. If Fave collects the deposit and balance, temporarily holds funds, refunds customers, deducts a commission, or pays drivers, does any part of that flow make Fave a payment service provider, payment system operator, agent, or other regulated participant under Uganda’s payment laws?
2. Identify a Uganda-authorised payment provider and permissible funds flow. Confirm safeguarding, settlement timing, reconciliation, chargebacks/disputes, AML/KYC obligations, customer disclosures, payout records, and whether Fave may receive payments before a driver is assigned.
3. Clarify whether drivers are paid gross or net of commission and who is responsible for tax invoices, withholding, refund liability, and payment-provider fees.

### G. Company, tax, and employment

1. Confirm the appropriate registered legal entity and any business, local-government, tourism, or transport-sector licences needed before accepting bookings. Confirm the company’s URSB, URA, TIN, and tax-clearance prerequisites.
2. Determine the VAT, income-tax, withholding, employment/PAYE, advance transport tax, commission, and driver/vehicle-owner tax treatment for the proposed transaction and the accommodation estimate. Confirm which party bears each liability and what records/invoices Fave must issue.
3. Determine whether the actual control, assignment, payment, and service model makes drivers employees, agents, contractors, or providers under transport law; set required contracts, worker protections, social contributions, and insurance accordingly.

### H. Legal documents and consent evidence

Please draft or approve, with version and effective date:

- customer booking and transport terms, pricing/refunds/cancellation disclosures, privacy notice, and incident/contact guidance;
- driver/provider agreement, onboarding and verification notice, vehicle-use/insurance requirements, conduct and safety standards, complaint and incident cooperation terms, and payment/tax terms;
- any required consent, acknowledgement, insurance confirmation, or regulator-facing policy;
- staff access and identity-data handling policy and an incident-response procedure.

Advise how the app must store an immutable acceptance record containing the document identifier/version, party, timestamp, language, action, and booking/onboarding context; how authorised staff can retrieve it; and how corrections, withdrawals, and changed terms are handled. Counsel should supply or approve all liability wording. Do not use wording that says Fave has no safety responsibility, waives statutory rights, or substitutes a customer waiver for operational safeguards.

## 3. Initial source map (screening references; counsel to verify)

| Source | Initial relevance to confirm |
|---|---|
| [Traffic and Road Safety Act, 1998, consolidated as at 2020](https://ulii.org/en/akn/ug/act/1998/15/eng%402020-05-22) | Section 70A covers licensing of online digital platforms for public-service transport and transport providers; the Act defines transport/network and vehicle categories. Counsel should confirm current amendments and classification. |
| [Traffic and Road Safety (Digital Networks) Regulations, 2023 — Ministry of Works and Transport PDF](https://works.go.ug/wp-content/uploads/2026/04/Traffic-and-Road-Safety-Digital-Networks-Regulations-2023.pdf) | Regulations 3–4 concern platform licensing/application; 17–20 provider/passenger registration and due diligence; 21 reporting; 22 backup and at-least-five-year customer-data retention; 23 liaison officer; 25 vehicle marking. Applicability and implementation details require counsel/regulator confirmation. |
| [Data Protection and Privacy Act, 2019 — ULII](https://ulii.org/en/akn/ug/act/2019/9/eng%402023-12-31) and [Data Protection and Privacy Regulations, 2021 — PDPO-hosted copy](https://pdpo.go.ug/media/2022/03/Data_Protection_and_Privacy_Regulations-2021.pdf) | Personal-data rules relevant to driver IDs/photos, passenger and trip/location records, processors, security, retention, and transfers. |
| [PDPO organisation guidance](https://pdpo.go.ug/information-center/organisation) | PDPO describes registration and annual renewal, governance, lawful processing, breach response, and processor-contract obligations; counsel should confirm Fave’s current requirements. |
| [URA transport sector guidance](https://ura.go.ug/en/transport-sector/) | Transport-sector registration and tax processes; counsel/accountant should confirm Fave’s specific business and vehicle tax treatment and current amounts. |
| [Bank of Uganda, Revised National Payment Systems Oversight Framework (2025)](https://bou.or.ug/uploads/Revised_BOU_National_Payment_Systems_Oversight_Framework_2025_698b3e9745.pdf) | BoU describes licensing/oversight of payment service providers and system operators; counsel should classify Fave’s exact funds flow and identify authorised providers. |
| [Insurance Regulatory Authority: motor insurance covers](https://www.ira.go.ug/helpie_faq/what-are-the-different-types-of-motor-insurance-covers/) | Describes third-party, accident/fire/theft, and comprehensive cover; counsel and a licensed insurer should confirm cover needed for paid passenger trips. |
| [Electronic Transactions Act, 2011 — ULII](https://ulii.org/sw/akn/ug/act/2011/8/eng%402023-12-31) and [Electronic Signatures Act, 2011 — ULII](https://ulii.org/en/akn/ug/act/2011/7/eng%402011-03-18) | Relevant to electronic records and customer/provider assent; counsel should approve the in-app acceptance design and evidence. |
| [NITA-U laws and regulations](https://www.nita.go.ug/laws-and-regulations) | Official landing page for electronic transaction/signature and data-protection laws; consult NITA-U directly on the specific system/software certification named by the 2023 transport regulations. |

## 4. Decision log and launch gate

No legal classification, licence determination, contract text, insurance decision, payment structure, or privacy sign-off has been approved as of this draft. Record each counsel response in a decision log with: question ID, conclusion, source, required product/operational control, owner, evidence, decision date, reviewer, and affected issue numbers. Link decisions to the dependent issues, especially #5–#13, #17, and #19–#22.

**Launch gate:** Keep this issue open and the legal gate unresolved until qualified Ugandan counsel has reviewed the actual Fave company and funds-flow facts, approved the required client/driver/privacy documents and consent evidence, and recorded the required licences and operating controls. Product copy or customer waivers must not override unresolved legal obligations.
