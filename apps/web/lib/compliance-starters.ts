export type ComplianceStarter = {
  key: string;
  name: string;
  version: string;
  category:
    | "Security & privacy"
    | "Aviation & drones"
    | "Manufacturing"
    | "Life sciences";
  summary: string;
  sourceUrl: string;
  controls: { code: string; title: string; description: string }[];
};

export const COMPLIANCE_STARTERS: ComplianceStarter[] = [
  {
    key: "nist-csf-2",
    name: "NIST Cybersecurity Framework",
    version: "2.0",
    category: "Security & privacy",
    summary:
      "Six-function cybersecurity risk starter, suitable for building a broad security coverage map.",
    sourceUrl: "https://www.nist.gov/cyberframework",
    controls: [
      {
        code: "GV",
        title: "Govern",
        description:
          "Establish, communicate, and monitor cybersecurity risk strategy, policy, roles, and oversight.",
      },
      {
        code: "ID",
        title: "Identify",
        description:
          "Understand assets, suppliers, vulnerabilities, and cybersecurity risks.",
      },
      {
        code: "PR",
        title: "Protect",
        description:
          "Apply safeguards for identity, data, platforms, awareness, and resilience.",
      },
      {
        code: "DE",
        title: "Detect",
        description:
          "Find and analyze anomalies, indicators, and adverse events.",
      },
      {
        code: "RS",
        title: "Respond",
        description:
          "Manage, communicate, analyze, mitigate, and report detected incidents.",
      },
      {
        code: "RC",
        title: "Recover",
        description:
          "Restore operations, communicate recovery, and incorporate lessons learned.",
      },
    ],
  },
  {
    key: "pci-dss",
    name: "PCI DSS",
    version: "4.0.1",
    category: "Security & privacy",
    summary:
      "The twelve top-level PCI DSS requirements for payment-card security coverage planning.",
    sourceUrl: "https://www.pcisecuritystandards.org/standards/pci-dss/",
    controls: [
      {
        code: "1",
        title: "Network security controls",
        description:
          "Install and maintain controls that protect cardholder data environments.",
      },
      {
        code: "2",
        title: "Secure configurations",
        description: "Apply secure configurations to all system components.",
      },
      {
        code: "3",
        title: "Protect stored account data",
        description:
          "Protect stored payment account data throughout its lifecycle.",
      },
      {
        code: "4",
        title: "Protect data in transit",
        description:
          "Use strong cryptography when transmitting cardholder data over open networks.",
      },
      {
        code: "5",
        title: "Protect against malicious software",
        description: "Protect systems and networks from malware.",
      },
      {
        code: "6",
        title: "Develop secure systems and software",
        description:
          "Maintain secure development and vulnerability-management practices.",
      },
      {
        code: "7",
        title: "Restrict access by business need",
        description: "Limit access to system components and cardholder data.",
      },
      {
        code: "8",
        title: "Identify users and authenticate access",
        description: "Use unique identities and strong authentication.",
      },
      {
        code: "9",
        title: "Restrict physical access",
        description: "Protect physical access to cardholder data.",
      },
      {
        code: "10",
        title: "Log and monitor access",
        description:
          "Record and monitor access to systems and cardholder data.",
      },
      {
        code: "11",
        title: "Test security regularly",
        description:
          "Regularly test systems, networks, and security processes.",
      },
      {
        code: "12",
        title: "Support security with policy",
        description:
          "Maintain organizational policies and programs for information security.",
      },
    ],
  },
  {
    key: "hipaa",
    name: "HIPAA Security Rule",
    version: "45 CFR Part 164",
    category: "Life sciences",
    summary:
      "Security Rule safeguard groups for systems that handle electronic protected health information.",
    sourceUrl:
      "https://www.hhs.gov/hipaa/for-professionals/security/index.html",
    controls: [
      {
        code: "164.308",
        title: "Administrative safeguards",
        description:
          "Risk analysis, workforce security, incident procedures, contingency planning, and evaluation.",
      },
      {
        code: "164.310",
        title: "Physical safeguards",
        description:
          "Facility access, workstation use and security, and device or media controls.",
      },
      {
        code: "164.312",
        title: "Technical safeguards",
        description:
          "Access, audit, integrity, authentication, and transmission protections.",
      },
      {
        code: "164.314",
        title: "Organizational requirements",
        description:
          "Business associate and group health plan security arrangements.",
      },
      {
        code: "164.316",
        title: "Policies and documentation",
        description:
          "Maintain required security policies, procedures, and documentation.",
      },
    ],
  },
  {
    key: "gdpr",
    name: "GDPR engineering starter",
    version: "Selected articles",
    category: "Security & privacy",
    summary:
      "Selected GDPR obligations that commonly need product and engineering evidence. Not a complete legal checklist.",
    sourceUrl: "https://eur-lex.europa.eu/eli/reg/2016/679/oj",
    controls: [
      {
        code: "Art. 5",
        title: "Data-processing principles",
        description:
          "Test lawfulness, purpose limitation, minimization, accuracy, retention, and security behaviors.",
      },
      {
        code: "Art. 25",
        title: "Data protection by design and default",
        description:
          "Verify privacy-protective defaults and implementation safeguards.",
      },
      {
        code: "Art. 30",
        title: "Records of processing",
        description:
          "Maintain evidence supporting records of processing activities.",
      },
      {
        code: "Art. 32",
        title: "Security of processing",
        description:
          "Test appropriate technical and organizational security measures.",
      },
      {
        code: "Art. 33",
        title: "Breach notification readiness",
        description:
          "Exercise detection, assessment, escalation, and notification workflows.",
      },
      {
        code: "Art. 35",
        title: "Impact assessment readiness",
        description:
          "Support risk and impact assessments for high-risk processing.",
      },
    ],
  },
  {
    key: "iso27001",
    name: "ISO/IEC 27001 readiness",
    version: "2022 themes",
    category: "Security & privacy",
    summary:
      "Annex A theme-level planning prompts. Use a licensed copy of the standard for formal certification work.",
    sourceUrl: "https://www.iso.org/standard/27001",
    controls: [
      {
        code: "A.5",
        title: "Organizational controls",
        description:
          "Plan evidence for security governance, asset management, suppliers, incidents, continuity, and compliance.",
      },
      {
        code: "A.6",
        title: "People controls",
        description:
          "Plan evidence for screening, responsibilities, awareness, remote work, and event reporting.",
      },
      {
        code: "A.7",
        title: "Physical controls",
        description:
          "Plan evidence for physical perimeters, access, monitoring, equipment, media, and utilities.",
      },
      {
        code: "A.8",
        title: "Technological controls",
        description:
          "Plan evidence for identity, access, endpoints, cryptography, operations, networks, development, and monitoring.",
      },
    ],
  },
  {
    key: "faa-part-107",
    name: "FAA small UAS operations",
    version: "14 CFR Part 107 starter",
    category: "Aviation & drones",
    summary:
      "Operational evidence prompts for US commercial and government small-drone operations. Not an airworthiness certification checklist.",
    sourceUrl:
      "https://www.faa.gov/newsroom/small-unmanned-aircraft-systems-uas-regulations-part-107",
    controls: [
      {
        code: "107-PILOT",
        title: "Remote pilot qualification",
        description:
          "Verify the responsible operator holds the required certificate or is directly supervised.",
      },
      {
        code: "107-AIRCRAFT",
        title: "Registration and marking",
        description:
          "Verify each operated aircraft is registered and marked as required.",
      },
      {
        code: "107-PREFLIGHT",
        title: "Preflight condition and control link",
        description:
          "Record aircraft condition, control-link checks, payload security, and flight readiness.",
      },
      {
        code: "107-AIRSPACE",
        title: "Airspace authorization",
        description:
          "Verify the planned location, altitude, and controlled-airspace authorization before operation.",
      },
      {
        code: "107-OPS",
        title: "Operating limitations",
        description:
          "Verify visual-line-of-sight, people/vehicle, lighting, weather, speed, and altitude constraints.",
      },
      {
        code: "107-INCIDENT",
        title: "Incident reporting readiness",
        description:
          "Exercise capture and timely reporting of qualifying injury or property-damage events.",
      },
    ],
  },
  {
    key: "faa-remote-id",
    name: "FAA drone Remote ID",
    version: "14 CFR Part 89 starter",
    category: "Aviation & drones",
    summary:
      "Product and operational verification prompts for Standard Remote ID aircraft or broadcast modules.",
    sourceUrl: "https://www.faa.gov/uas/getting_started/remote_id",
    controls: [
      {
        code: "RID-APPLICABILITY",
        title: "Applicability and operating path",
        description:
          "Determine whether Standard Remote ID, a broadcast module, or an authorized FRIA path applies.",
      },
      {
        code: "RID-DOC",
        title: "Accepted Declaration of Compliance",
        description:
          "Verify the aircraft or module appears in the FAA-accepted Declaration of Compliance system.",
      },
      {
        code: "RID-BROADCAST",
        title: "Required broadcast elements",
        description:
          "Verify identification, position, altitude, velocity, time, and applicable control/takeoff location data.",
      },
      {
        code: "RID-CONTINUITY",
        title: "Broadcast continuity",
        description:
          "Verify Remote ID operates from takeoff through shutdown and failures are surfaced to the operator.",
      },
      {
        code: "RID-REGISTRATION",
        title: "Device registration linkage",
        description:
          "Verify the correct Remote ID serial number is associated with the registered aircraft inventory.",
      },
    ],
  },
  {
    key: "nist-manufacturing-profile",
    name: "NIST manufacturing cybersecurity profile",
    version: "NISTIR 8183",
    category: "Manufacturing",
    summary:
      "Risk-based cybersecurity coverage for manufacturing systems, ICS, PLC, DCS, and supporting operations.",
    sourceUrl:
      "https://www.nist.gov/publications/cybersecurity-framework-manufacturing-profile-0",
    controls: [
      {
        code: "MFG-ID",
        title: "Identify manufacturing cyber risk",
        description:
          "Inventory assets, dependencies, suppliers, vulnerabilities, and operational consequences.",
      },
      {
        code: "MFG-PR",
        title: "Protect production systems",
        description:
          "Verify identity, access, segmentation, data, maintenance, and resilience safeguards.",
      },
      {
        code: "MFG-DE",
        title: "Detect abnormal production behavior",
        description:
          "Test monitoring and analysis across control systems, networks, equipment, and safety boundaries.",
      },
      {
        code: "MFG-RS",
        title: "Respond without unsafe disruption",
        description:
          "Exercise containment, communications, analysis, and mitigation with production-safety constraints.",
      },
      {
        code: "MFG-RC",
        title: "Recover manufacturing operations",
        description:
          "Verify restoration, safe restart, integrity checks, communication, and lessons learned.",
      },
    ],
  },
  {
    key: "cisa-secure-by-design",
    name: "CISA Secure by Design",
    version: "Product principles starter",
    category: "Manufacturing",
    summary:
      "Product-security evidence organized around CISA's supplier-focused Secure by Design principles. This is CISA, not a guessed interpretation of CISPA.",
    sourceUrl: "https://www.cisa.gov/securebydesign",
    controls: [
      {
        code: "SBD-OWN",
        title: "Own customer security outcomes",
        description:
          "Show how product design prevents common classes of customer harm and secure defaults require no added purchase.",
      },
      {
        code: "SBD-TRANSPARENCY",
        title: "Radical transparency and accountability",
        description:
          "Measure vulnerabilities, publish actionable advisories, and demonstrate remediation learning.",
      },
      {
        code: "SBD-LEADERSHIP",
        title: "Executive ownership",
        description:
          "Maintain leadership accountability, incentives, and resourcing for product security.",
      },
    ],
  },
  {
    key: "fda-21-cfr-part-11",
    name: "FDA electronic records and signatures",
    version: "21 CFR Part 11 starter",
    category: "Life sciences",
    summary:
      "Validation evidence prompts for electronic records and signatures used in FDA-regulated activities.",
    sourceUrl:
      "https://www.ecfr.gov/current/title-21/chapter-I/subchapter-A/part-11",
    controls: [
      {
        code: "11.10(a)",
        title: "System validation",
        description:
          "Demonstrate accuracy, reliability, consistent intended performance, and detection of invalid or altered records.",
      },
      {
        code: "11.10(b-c)",
        title: "Copies, protection, and retention",
        description:
          "Produce complete human-readable/electronic copies and protect records throughout the retention period.",
      },
      {
        code: "11.10(d)",
        title: "Access limitation",
        description:
          "Verify system access is limited to authorized individuals.",
      },
      {
        code: "11.10(e)",
        title: "Secure audit trails",
        description:
          "Verify time-stamped audit trails record create, modify, and delete actions without obscuring prior information.",
      },
      {
        code: "11.10(f-h)",
        title: "Operational, authority, and device checks",
        description:
          "Verify sequencing, permissions, and source/input validity where appropriate.",
      },
      {
        code: "11.50-11.70",
        title: "Signature manifestation and linkage",
        description:
          "Verify signatures show required identity/date/meaning and remain linked to their records.",
      },
    ],
  },
  {
    key: "fda-csa",
    name: "FDA computer software assurance",
    version: "February 2026 guidance starter",
    category: "Life sciences",
    summary:
      "Risk-based assurance for software used in medical-device production and quality management systems.",
    sourceUrl:
      "https://www.fda.gov/regulatory-information/search-fda-guidance-documents/computer-software-assurance-production-and-quality-management-system-software",
    controls: [
      {
        code: "CSA-USE",
        title: "Intended use",
        description:
          "Document the software feature, process, users, data, and intended production or quality-system use.",
      },
      {
        code: "CSA-RISK",
        title: "Risk-based analysis",
        description:
          "Assess foreseeable failures and their impact on product quality, safety, data integrity, and process control.",
      },
      {
        code: "CSA-METHOD",
        title: "Appropriate assurance activity",
        description:
          "Select scripted, unscripted, automated, or supplier evidence in proportion to risk.",
      },
      {
        code: "CSA-EVIDENCE",
        title: "Objective evidence",
        description:
          "Retain sufficient records of scope, method, results, issues, conclusions, and performer/reviewer identity.",
      },
      {
        code: "CSA-CHANGE",
        title: "Change and issue control",
        description:
          "Reassess intended use and risk after changes, deviations, failures, or supplier updates.",
      },
    ],
  },
];
