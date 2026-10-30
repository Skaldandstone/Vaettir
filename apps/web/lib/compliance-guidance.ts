import { COMPLIANCE_STARTERS } from "./compliance-starters";

export type ControlGuidance = {
  tests: string;
  evidence: string;
  purpose?: string;
};
// Engineering examples, not quoted requirements or an applicability decision.
// These remain UI reference material: never rewrite saved controls or mappings.
const examples: Record<string, Record<string, [string, string, string?]>> = {
  "music-rights-us": {
    "MUS-INVENTORY": [
      "Compare every track in a synthetic release manifest with the rights inventory; flag a missing source, version or intended-use description.",
      "Versioned audio inventory, release manifest, intended platforms, territories, dates and reviewer disposition.",
    ],
    "MUS-OWNERSHIP": [
      "Review a sample track with recording permission but no documented composition basis; verify it remains unresolved until both layers are reviewed.",
      "Composition and recording identifiers, chain-of-title or license documents, and separate dated reviewer decisions.",
    ],
    "MUS-SYNC": [
      "Compare a trailer and an in-game use of the same track against the approved agreement; flag any use outside its recorded scope.",
      "Reviewed audiovisual and recording-use terms, exact media versions, intended uses and any approved exceptions.",
    ],
    "MUS-PERFORMANCE": [
      "Review an event or stream against its documented performance and transmission permissions; flag a missing territory, repertoire or use decision.",
      "Event or transmission plan, applicable composition and recording-rights assessment, license scope and responsible reviewer.",
    ],
    "MUS-DISTRIBUTION": [
      "Check a soundtrack download, sample or cover against documented copying and distribution permissions; flag a new use for review.",
      "Approved distribution scope, sample or arrangement permissions where applicable, versioned artifacts and legal-basis review.",
    ],
    "MUS-TERMS": [
      "Exercise expired, not-yet-effective and out-of-territory synthetic license records; verify the release check flags each mismatch.",
      "License revision, effective and expiry dates, territories, platforms, constraints and the dated release comparison.",
    ],
    "MUS-CREDITS": [
      "Compare rendered credits and usage reports with the agreement; flag missing attribution or an unverified payment obligation.",
      "Agreement clauses, rendered credits, submitted reports and payment evidence when required by the agreement.",
    ],
    "MUS-RELEASE": [
      "Replace a reviewed track with another version and verify release review is reopened; confirm an audio match cannot mark rights cleared.",
      "Final manifest and hashes, reviewed permissions, change history, unresolved exceptions and authorized release decision.",
    ],
  },
  "nist-csf-2": {
    GV: [
      "Exercise risk escalation, exception approval and security decision ownership.",
      "Approved risk register, named owners and a dated review of unresolved exceptions.",
    ],
    ID: [
      "Detect an unregistered asset or dependency and route its risk for review.",
      "Asset inventory, dependency map and vulnerability triage results.",
    ],
    PR: [
      "Deny unauthorized access; verify safe defaults, recovery copies and protected data paths.",
      "Access matrix, configuration checks and backup validation results.",
    ],
    DE: [
      "Inject a harmless suspicious event and verify detection, triage and alert routing.",
      "Detection rule version, event timestamps and analyst disposition.",
    ],
    RS: [
      "Rehearse an incident from escalation through containment and stakeholder updates.",
      "Exercise timeline, response decisions and assigned follow-up actions.",
    ],
    RC: [
      "Restore a representative service and validate integrity before resuming use.",
      "Restore results, recovery time and owner approval to resume operations.",
    ],
  },
  "pci-dss": {
    "1": [
      "Verify allowed cardholder-environment connections and reject an unapproved network path.",
      "Network diagram, rule review and allowed/denied connection results.",
    ],
    "2": [
      "Check a fresh deployment against the approved baseline and detect configuration drift.",
      "Baseline version, drift report and remediation record.",
    ],
    "3": [
      "Check stored account-data locations, masking and retention/deletion behavior using synthetic data.",
      "Data inventory, cryptographic configuration and retention-test results.",
    ],
    "4": [
      "Reject insecure transport and invalid certificates on payment-data paths.",
      "Endpoint inventory and transport/certificate validation results.",
    ],
    "5": [
      "Safely simulate a malware signal and verify protection, alerting and response.",
      "Protection configuration, update status and approved simulation results.",
    ],
    "6": [
      "Verify a vulnerable dependency or insecure change is identified and remediated before release.",
      "Review records, scan findings and remediation verification.",
    ],
    "7": [
      "Verify role-based payment-data access; test denial for an unnecessary role.",
      "Business-need access matrix and positive/negative authorization results.",
    ],
    "8": [
      "Test individual identities, authentication, account removal and session revocation.",
      "Authentication configuration and joiner/mover/leaver test results.",
    ],
    "9": [
      "Exercise visitor handling and restricted access to a facility or media store.",
      "Approved physical-access inspection, visitor review and media-custody records.",
    ],
    "10": [
      "Generate an access event and verify audit capture, protection and review routing.",
      "Redacted event sample, alert test and review acknowledgement.",
    ],
    "11": [
      "Verify the applicable scanning, penetration and change-detection activities occur and findings are retested.",
      "Authorized test scope, results, exceptions and remediation retests.",
    ],
    "12": [
      "Rehearse a security escalation and check staff can find their assigned responsibilities.",
      "Approved policies, training records and incident exercise review.",
    ],
  },
  hipaa: {
    "164.308": [
      "Exercise workforce access removal, incident escalation and contingency recovery with synthetic health data.",
      "Risk analysis, assigned safeguards, workforce review and exercise results.",
    ],
    "164.310": [
      "Inspect authorized facility/workstation access and device or media disposal handling.",
      "Physical inspection, access review and sanitized media-disposal records.",
    ],
    "164.312": [
      "Reject unauthorized health-record access; verify audit capture, integrity and protected transmission.",
      "Role tests, audit samples and integrity/transport validation using synthetic records.",
    ],
    "164.314": [
      "Verify security responsibilities and escalation routes exist for each relevant business-associate arrangement.",
      "Reviewed agreements, responsibility matrix and supplier assurance records.",
    ],
    "164.316": [
      "Check staff can retrieve the approved current procedure and its retained revision history.",
      "Policy approval, revision history, retention settings and review dates.",
    ],
  },
  gdpr: {
    "Art. 5": [
      "Test collection limits, correction, retention expiry and use outside the stated purpose with synthetic records.",
      "Purpose/data inventory, retention policy and dated behavior checks.",
      "Processing must follow the GDPR principles, and the controller must be able to demonstrate accountability.",
    ],
    "Art. 25": [
      "Start a new account and verify privacy-protective sharing, collection and retention defaults; test an unauthorized recipient.",
      "Default settings, design decisions and both allowed/denied disclosure results.",
      "Build proportionate data protection into the design and make necessary processing limits the default.",
    ],
    "Art. 30": [
      "Check a processing-record workflow captures required information and tracks changes or missing fields.",
      "Reviewed processing inventory covering purposes, data, recipients, transfers and retention where required.",
      "Maintain the applicable controller or processor records of processing activities; this is a documentation obligation, not a software certification.",
    ],
    "Art. 32": [
      "Test access restrictions, integrity, recovery and the effectiveness of safeguards under representative failure conditions.",
      "Risk assessment, safeguard configuration and recovery/security test results.",
      "Select and evaluate technical and organizational security measures appropriate to the processing risk.",
    ],
    "Art. 33": [
      "Rehearse breach detection, assessment, escalation and preparation of a notification within the applicable clock.",
      "Awareness timestamp, risk decision, response timeline and notification draft or reason for non-notification.",
      "A controller generally notifies the supervisory authority within 72 hours of awareness unless the risk exception applies; a processor informs the controller without undue delay.",
    ],
    "Art. 35": [
      "Check a proposed high-risk change triggers an impact-assessment review before processing begins.",
      "DPIA screening, assessed risks, mitigation evidence and reviewer decisions.",
      "Assess likely high-risk processing in advance, including necessity, proportionality and safeguards; a test result does not replace the assessment.",
    ],
  },
  iso27001: {
    "A.5": [
      "Rehearse security decision ownership, supplier escalation and continuity exceptions.",
      "Approved governance records, supplier review and risk treatment evidence.",
    ],
    "A.6": [
      "Check onboarding, role changes, departure and security-event reporting responsibilities.",
      "Access lifecycle review, awareness records and reporting exercise results.",
    ],
    "A.7": [
      "Inspect a restricted area and rehearse equipment, media and utility failure handling.",
      "Physical inspection, access review and equipment/media custody records.",
    ],
    "A.8": [
      "Test authorization, secure configuration, monitoring, vulnerability response and restoration.",
      "Control configuration, security test results and remediation verification.",
    ],
  },
  "faa-part-107": {
    "107-PILOT": [
      "Verify the dispatch checklist rejects a pilot without the required qualification or supervision evidence.",
      "Current pilot qualifications, supervision arrangement and pre-operation checklist.",
    ],
    "107-AIRCRAFT": [
      "Compare the selected aircraft, registration and visible marking before dispatch.",
      "Aircraft inventory, registration check and dated marking inspection.",
    ],
    "107-PREFLIGHT": [
      "Exercise the preflight checklist and refusal to proceed after an unsafe condition or failed control link.",
      "Aircraft/payload inspection, control-link check and pilot go/no-go decision.",
    ],
    "107-AIRSPACE": [
      "Check the planned location and altitude against the applicable authorization and refuse an out-of-scope plan.",
      "Flight plan, airspace review and authorization or waiver where applicable.",
    ],
    "107-OPS": [
      "Evaluate representative flight plans against applicable operating limits and approved exceptions.",
      "Operating checklist, conditions, operational category and waiver review.",
    ],
    "107-INCIDENT": [
      "Rehearse event capture, reportability review and escalation to the responsible operator.",
      "Exercise chronology, reportability decision and submission readiness review.",
    ],
  },
  "faa-remote-id": {
    "RID-APPLICABILITY": [
      "Verify the selected operating path matches the aircraft, location and operation.",
      "Applicability decision and Standard Remote ID, module or FRIA operating evidence.",
    ],
    "RID-DOC": [
      "Match the exact aircraft or module model to its FAA-accepted declaration.",
      "Declaration lookup, model/serial match and inspection date.",
    ],
    "RID-BROADCAST": [
      "Observe required message fields for the selected Remote ID path using a suitable receiver.",
      "Receiver capture, field validation and approved test configuration.",
    ],
    "RID-CONTINUITY": [
      "Verify broadcasting during the required operating period and the response to a broadcast failure.",
      "Timed broadcast capture and operator failure-indication results.",
    ],
    "RID-REGISTRATION": [
      "Compare the installed device serial with the aircraft registration record.",
      "Inventory/registration match and review of replacement-device changes.",
    ],
  },
  "nist-manufacturing-profile": {
    "MFG-ID": [
      "Validate the production asset/dependency inventory and assess a representative cyber failure.",
      "Inventory, process dependencies and operational-impact review.",
    ],
    "MFG-PR": [
      "In an approved test environment, reject unauthorized controller access and verify network segmentation.",
      "Access/segmentation results, maintenance permissions and configuration baseline.",
    ],
    "MFG-DE": [
      "Safely simulate an abnormal control-system event and verify detection without disrupting production.",
      "Approved simulation, monitoring output and operator acknowledgement.",
    ],
    "MFG-RS": [
      "Rehearse containment with operations and safety staff before isolating production equipment.",
      "Tabletop decisions, safety constraints and incident communication record.",
    ],
    "MFG-RC": [
      "Restore a test controller/configuration and validate a safe restart sequence.",
      "Known-good configuration, integrity checks and operations restart approval.",
    ],
  },
  "cisa-secure-by-design": {
    "SBD-OWN": [
      "Test secure defaults and prevention of recurring exploit classes without requiring a security add-on.",
      "Default-install results, vulnerability trends and design remediation records.",
    ],
    "SBD-TRANSPARENCY": [
      "Exercise vulnerability intake, advisory preparation and delivery of an actionable fix.",
      "Disclosure process, example advisory and remediation timing review.",
    ],
    "SBD-LEADERSHIP": [
      "Check a material product-security risk reaches an accountable decision maker.",
      "Leadership review, assigned ownership and funded improvement decisions.",
    ],
  },
  "fda-21-cfr-part-11": {
    "11.10(a)": [
      "Verify intended operation and detection of invalid or altered synthetic records.",
      "Approved validation scope, expected/observed results and deviation review.",
    ],
    "11.10(b-c)": [
      "Export complete records, restore retained copies and compare content throughout the required retention period.",
      "Human-readable/electronic copy checks, restore results and retention review.",
    ],
    "11.10(d)": [
      "Deny record access to an unauthorized user and verify timely removal of access.",
      "Role matrix, access checks and account-removal results.",
    ],
    "11.10(e)": [
      "Create, amend and delete synthetic records; verify attributable timestamps and protected prior history.",
      "Audit sequence, clock configuration and tamper/retention test results.",
    ],
    "11.10(f-h)": [
      "Reject an invalid workflow sequence, unauthorized action or inappropriate input source.",
      "Workflow rules and positive/negative authority and input checks.",
    ],
    "11.50-11.70": [
      "Verify signer name, signing time and meaning remain associated with the signed record and its copies.",
      "Synthetic signed-record export, identity checks and signature-linkage verification.",
    ],
  },
  "fda-csa": {
    "CSA-USE": [
      "Verify the documented feature and users match the actual production or quality-system workflow.",
      "Intended-use description, workflow boundary and owner review.",
    ],
    "CSA-RISK": [
      "Analyze representative failures and check that assurance effort follows the assessed risk.",
      "Failure/risk analysis, rationale and approved assurance priorities.",
    ],
    "CSA-METHOD": [
      "Exercise the selected scripted, exploratory or automated assurance activity against its intended objective.",
      "Method rationale, supplier evidence evaluation and execution results.",
    ],
    "CSA-EVIDENCE": [
      "Check the assurance record identifies scope, results, issues and who performed/reviewed it.",
      "Dated assurance record, deviations, conclusions and review decisions.",
    ],
    "CSA-CHANGE": [
      "Introduce a representative change and verify impact assessment and proportionate reassessment.",
      "Change record, risk reassessment, regression results and issue disposition.",
    ],
  },
};

const review: Record<string, string> = {
  "music-rights-us":
    "A qualified rights reviewer must determine the applicable rights, jurisdictions and contractual scope for each use. Composition, recording, synchronization and performance permissions can differ. Public-domain or exception claims also require review. Software checks and content recognition do not grant rights or establish legal clearance.",
  "nist-csf-2":
    "Tailor the profile and risk outcomes with security and business owners. The CSF is an outcomes framework, not a certification checklist.",
  "pci-dss":
    "Confirm payment-data scope, applicable subrequirements, assessment method and required frequencies with the responsible PCI assessor. These twelve headings are not the full standard.",
  hipaa:
    "Confirm covered-entity/business-associate scope and safeguards with privacy and security owners. Policies, agreements and physical safeguards need human review; software checks alone do not establish HIPAA compliance.",
  gdpr: "Confirm applicability, legal basis, individual rights, transfers and exceptions with the privacy owner. These six selected articles do not cover the whole GDPR.",
  iso27001:
    "Use the licensed 2022 standard, risk assessment and Statement of Applicability. These Annex A themes do not replace individual controls or an independent certification assessment.",
  "faa-part-107":
    "The responsible pilot must verify current rules, operational category, authorizations and waivers for the actual flight. A software check does not authorize an operation.",
  "faa-remote-id":
    "Confirm the actual aircraft/module path and current FAA requirements. Receiver tests do not replace an accepted declaration, registration or an authorized operating location.",
  "nist-manufacturing-profile":
    "This NISTIR 8183 profile uses the earlier five-function CSF structure. Tailor it to the plant with operations and safety owners; use approved non-production exercises.",
  "cisa-secure-by-design":
    "These are voluntary product-security principles. Leadership accountability, customer outcomes and public disclosure practices require organizational evidence.",
  "fda-21-cfr-part-11":
    "Confirm Part 11 applicability and the underlying predicate-rule record obligations with quality/regulatory owners. This starter covers selected closed-system and signature topics, not every provision.",
  "fda-csa":
    "Apply the February 2026 guidance to the assessed intended use and risk with the quality owner. Assurance examples do not replace regulatory applicability or release approval.",
};

export function frameworkGuidance(key: string) {
  const starter = COMPLIANCE_STARTERS.find((s) => s.key === key);
  return starter
    ? { ...starter, review: review[key]!, reviewedAt: key === "music-rights-us" ? "2026-10-30" : "2026-10-20" }
    : null;
}

export function controlGuidance(
  key: string,
  code: string,
  title: string,
): ControlGuidance | null {
  const starter = COMPLIANCE_STARTERS.find((s) => s.key === key);
  // Do not present curated examples as an interpretation of a custom/reworded control.
  if (!starter?.controls.some((c) => c.code === code && c.title === title))
    return null;
  const entry = examples[key]?.[code];
  return entry
    ? {
        tests: entry[0],
        evidence: entry[1],
        ...(entry[2] ? { purpose: entry[2] } : {}),
      }
    : null;
}
