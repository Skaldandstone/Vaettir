# Domain-aware workspaces: research and implementation boundaries

Research date: 2026-10-01. Primary public sources only. This is a design input, not proof that a workflow, adapter, legal obligation, platform approval or certification is implemented. Proposed data fields and screens below are Vaettir design inferences from the cited sources. Applicability must be confirmed by the customer's qualified owner for the product, activity, facility and jurisdiction.

## Shared model, specialized workspaces

Keep stable cases, reusable versioned plans and separate run instances. Each run pins its case/plan revisions and tested configuration; a repeat creates new results, never overwrites yesterday's evidence. One project may combine software, firmware, electronics, machinery, food-process controls and laboratory activities. Profile changes must preserve existing records and human edits.

Use composable facets, not one industry dropdown:

| Facet | Examples | Effect on the workflow |
| --- | --- | --- |
| Product/component | SaaS, mobile app, game, embedded controller, machinery, food process | Relevant editor sections and recommended verification activities |
| Subtype | Game genres and online modes; consumer/industrial hardware; food manufacturing/retail/laboratory | Conditional prompts, not mutually exclusive labels |
| Targets | Platform, OS/device, hardware revision, site/line or process | Plan configuration and run identity |
| Execution mode | Manual, unit, integration, system, MIL, SIL, HIL, physical inspection, laboratory | What can be inferred from results and which native adapters fit |
| Evidence purpose | Quality check, monitoring, verification, validation, external certification | Correct terminology, review and evidence expectations |
| Applicability | Jurisdiction, authority, regulation/standard edition, applicability rationale | Candidate obligations requiring owner confirmation; no automatic compliance badge |

Plans should select a bounded configuration matrix. Do not create the entire Cartesian product of platforms, languages, modes, rigs and batches automatically. Show estimated runs and allow named representative configurations. Completed runs retain the prior profile/configuration snapshot when the project is enriched.

## Food safety: the workflow is not merely a software test suite

FDA's published HACCP guidelines distinguish routine control observations from verification and scientific validation; safety hazards are distinct from product quality. Laboratory microbiology may support verification but is not interchangeable with immediate process monitoring. Limits must have a justified scientific basis specific to the process, not AI-invented temperatures or generic pass marks. [FDA HACCP principles and application guidelines](https://www.fda.gov/food/hazard-analysis-critical-control-point-haccp/haccp-principles-application-guidelines)

FDA preventive controls for human food generally apply to covered facilities, with exemptions and modified requirements. Seafood, juice and low-acid canned foods have specific regulatory interactions. Retail and food-service operations require the applicable adopted local rules: the FDA Food Code is a model, not automatically the governing rule at every site. [FDA preventive-controls rule overview](https://www.fda.gov/food/food-safety-modernization-act-fsma/fsma-final-rule-preventive-controls-human-food), [FDA FSMA FAQs](https://www.fda.gov/food/food-safety-modernization-act-fsma/frequently-asked-questions-fsma), [FDA Food Code](https://www.fda.gov/food/retail-food-protection/fda-food-code)

For applicable Part 117 records, capture actual observations and values, facility identity, activity date/time, operator attribution and product/lot where appropriate. Records are contemporaneous, legible and preserved as originals/true copies/electronic records. A Vaettir account name or ordinary approval button alone is not a validated electronic-signature mechanism. Part 117's electronic-record exemption from Part 11 is conditional; other applicable rules may still impose Part 11 requirements. [21 CFR 117.305](https://www.ecfr.gov/current/title-21/chapter-I/subchapter-B/part-117/subpart-F/section-117.305)

Applicable verification procedures include instrument calibration/accuracy checks, appropriately scoped product/environmental testing and record review. Sampling procedures may need analyte, method, sample identity and relationship to lots, frequency, laboratory and corrective-action references. Review schedules must be configurable and preserve justification for approved exceptions rather than imposing a universal deadline. [21 CFR 117.165](https://www.ecfr.gov/current/title-21/chapter-I/subchapter-B/part-117/subpart-C/section-117.165)

Retention is rule- and record-specific. Part 117 distinguishes ordinary record retention from equipment/process adequacy evidence retained after discontinued use, and includes retrieval/location requirements. Build policy-backed preservation/export rather than a global automatic expiry date. [21 CFR 117.315](https://www.ecfr.gov/current/title-21/chapter-I/subchapter-B/part-117/subpart-F/section-117.315)

USDA-FSIS-regulated HACCP activity needs its own applicability selection. FSIS validation distinguishes scientific support from demonstrated in-plant operation. Its recordkeeping guidance includes actual control observations, calibration information, deviations/corrective actions, verification results and product identification. Do not silently apply the FDA profile to an FSIS establishment. [FSIS HACCP validation](https://www.fsis.usda.gov/inspection/compliance-guidance/haccp/haccp-validation), [FSIS recordkeeping guidance](https://ask.fsis.usda.gov/article/What-are-inspection-program-personnel-to-look-for-when-verifying-the-regulatory-requirements)

Proposed food workspace:

- Case/procedure: controlled process step, activity purpose, hazard/control reference if applicable, method revision, observation/measurement fields, units, approved acceptance criteria and basis citation, escalation procedure.
- Reusable plan: facility/line scope, control or sampling schedule, role assignment, required instruments and review workflow. The qualified owner configures frequencies and limits.
- Run: facility/line, product/lot, sample IDs, performed/recorded times, operator, instrument/calibration reference, actual values, attachments and method revision. Distinguish `pending laboratory result`, `not performed`, `deviation` and `review needed` from a completed passing observation.
- Deviation: retain the original observation; link correction, corrective action, affected lot and authorized disposition. A passing retest does not erase a failed observation or release a lot automatically.
- Reports: records by lot/control/date, missing observations, unresolved deviations, calibration/review status and source-linked evidence. Label as evidence support, not a declaration that food is safe or compliant.

## HIL and machinery: different evidence boundaries

NI's public HIL architecture describes deterministic real-time processors, I/O, simulation models and communication interfaces for testing embedded controls. That supports separating the real device-under-test from the simulated plant and recording the complete rig configuration. [NI HIL architecture](https://www.ni.com/en/solutions/hardware-in-the-loop-testing.html)

dSPACE's public SDK supports code-based SIL/HIL automation; its workflow demonstration connects requirements, authored cases and execution results. Native imports should preserve those identities rather than converting every assertion into unrelated manually generated cases. Vendor tooling capability is not evidence that Vaettir currently controls that hardware. [dSPACE Test Automation SDK](https://www.dspace.com/en/pub/home/products/sw/test_automation_software/test-automation-sdk.cfm), [dSPACE requirement-to-test workflow](https://www.dspace.com/en/ltd/home/learning-center/recordings/learningconnections/video_lc_testing-requirements.cfm)

For Great Britain work-equipment use, HSE inspection guidance is risk-based: installation/reassembly, deterioration and exceptional circumstances can trigger inspection. Relevant reports must be retained securely and available; frequencies and inspection scope depend on equipment, environment and competent judgment. This is not a universal legal schedule for all countries or all machines. [HSE inspection of work equipment](https://www.hse.gov.uk/work-equipment-machinery/inspection.htm)

ISO's public abstract describes ISO 13849-2 validation through analysis and testing of specified safety-related control functions. Only the public scope was reviewed, not licensed standard clauses. A HIL pass is not proof of an achieved performance level or machine conformity. Store the applicable edition and owner-reviewed assessment; do not encode a draft as the governing edition or claim standards certification. [ISO 13849-2 public scope](https://www.iso.org/standard/53640.html)

Proposed hardware workspace:

- Procedure: requirements/interface/safety-function links, stimulus, expected signal/behavior, timing and measurement criteria, channel/unit definitions, prerequisites and safe setup/stop instructions supplied by the qualified owner.
- Plan: MIL/SIL/HIL/physical mode, DUT variant, rig availability, simulator/model revision, firmware/build, harness/I/O map and instrument requirements. Physical safety and authorization gates remain separate from permission to import a script.
- Run: DUT/asset identity, hardware and firmware revisions, pinned configuration, test script/tool version, calibration evidence, model/sample rate, fault scenario, observed measurements and timestamped artifact references.
- Evidence: separately label simulated outputs, controller-on-rig behavior and physical system measurements. Keep raw trace references and evaluation criteria; do not flatten a waveform to an unexplained pass/fail.
- Reports: requirement/variant coverage, failed or unexecuted scenarios, measurement deviations and configuration differences. Machinery inspection is a recurring asset procedure, not necessarily a software release regression.

## Games: granular platform and execution context

Unity publicly distinguishes Editor Edit-mode, Play-mode and target Player execution. Unreal Gauntlet manages sessions with builds, devices and potentially multiple clients/server processes, rather than substituting for all game-side test frameworks. Import native engine test identities and execution mode; recommend the existing engine tooling rather than defaulting to a mobile UI framework. [Unity test execution](https://docs.unity.com/en-us/engine/6000.3/manual/scripting/test-framework-introduction/running-tests), [Unreal Gauntlet overview](https://dev.epicgames.com/documentation/unreal-engine/gauntlet-automation-framework-overview-in-unreal-engine?lang=en-US)

Valve's compatibility review is platform-specific and separate from a developer's own QA results. Its public process evaluates the target-device experience and publishes external review outcomes. Store the reviewed build and issuer/result evidence; Vaettir cannot award a Steam hardware verification badge. [Steam Deck/Steam Machine compatibility review](https://partner.steamgames.com/doc/steamhardware/compat?l=english)

Microsoft publishes certification stages and distinguishes optional feedback from final certification. Sony and Nintendo expose partner registration/access flows; detailed authorized platform requirements must be supplied under the customer's permitted access. Do not scrape gated documents, invent restricted test lists or imply partner registration/certification. [Xbox certification guide](https://learn.microsoft.com/en-us/gaming/game-publishing/concepts/certification/certification-guide), [PlayStation Partners](https://partners.playstation.net/), [Nintendo developer registration](https://developer.nintendo.com/register)

Android performance guidance emphasizes representative repeatable setups and warns that debug builds distort measurements. Store build configuration, device/OS and test conditions when recommending performance automation; a local editor benchmark is not mobile-device acceptance. [Android performance measurement](https://developer.android.com/topic/performance/measuring-performance)

Proposed progressive game setup:

1. Game characteristics, multi-select: action/FPS, RPG, strategy, simulation, puzzle, sports/racing, narrative, other; single-player, local co-op, online co-op/PvP, persistent/live service; 2D/3D/XR. Genres inform suggestions, not mandatory universal test packs.
2. Target families: PC, console, mobile, browser, XR. Reveal only selected families' fields.
3. Exact targets: Windows/macOS/Linux; PlayStation generations, Xbox generations, Nintendo Switch/Switch 2; Android/iOS; selected XR devices. Allow custom/legacy targets without claiming current publishing support. Keep platform family separate from device model, OS/runtime version, store/channel, input and locale.
4. Repository-backed engine/framework suggestions: discovered Unity/Unreal/custom stack, version and existing tests with citations. User confirmation is required; missing repositories yield `not yet verified`, not a guessed framework.
5. Focused review of the chosen configuration and proposed workflow before saving. Generate no paid test packs without a separate estimate and approval.

Game editors/plans can prioritize scenario/map/save state, deterministic seed, input method, client/server topology, network conditions and performance evidence. Reports group coverage by selected platform/build, not one misleading project-wide readiness percentage.

## First implementation and later acceptance gates

### Implemented first slice (source only)

- Reviewed, versioned project profiles combine offerings, software types, game genres, named PC/console/mobile/browser targets, player modes, hardware types, process purposes and operating regions. Existing projects remain unclassified until an editor saves an explicit choice. Saved context is persistent; unsaved wizard selections survive close/reopen on the same page, not a page reload.
- The project overview opens an in-page chip wizard with conditional screens and focused review. Profile writes require a full editor seat, project/tenant access and a whole-profile comparison hash. Unknown existing context and human edits survive; stale concurrent saves are rejected. Existing records, approvals and source-processing permissions are not rewritten.
- Case editors and reusable plan screens show tailored guidance. Single physical-domain profiles tailor setup, safety, calibration/sampling and acceptance labels; mixed projects retain neutral labels and the individual case's explicit domain. Food procedures currently use the existing `OTHER` case domain; selecting Food safety does not create a new regulated case model.
- Starting a manual run opens a reviewed configuration module. It records platform/build, device/firmware/rig, lot/sample, environment, calibration and protocol references. Each run freezes its profile, ordered case definitions, resolved shared steps, prerequisite graph and step labels; later edits do not rewrite its displayed procedure. Empty legacy run context stays explicitly legacy, not silently reconstructed as historical proof.
- Actor/project-bound run-start UUID receipts make identical retries return the original run. Changed payloads for the same receipt conflict. Separate intentional repetitions use distinct receipts and retain separate records. Selected scope including prerequisites is bounded to 500 cases and the complete definition snapshot to 2 MiB; excessive scope fails explicitly without truncation.
- Automation drafts suggest a supported target only from a case's stored native framework family. Unknown or unlinked cases start with no framework selected. This is linked metadata, not a new repository scan or a claim that a framework is optimal. Paid design/draft processing remains separately approved; this slice uses no provider source or AI calls.

This is a configurable workflow foundation, not complete vertical-market parity. Named configuration matrices saved on plans, automatic recurring schedules, per-step result history, domain-native HIL/laboratory imports, immutable amendments/retention, sample chain of custody, qualified review/signatures and regulatory reports remain follow-on work. Existing case-level result corrections can still update an active run's result; freezing definitions does not make those results immutable. No platform certification, equipment actuation, clinical validation or food-release decision is performed.

First slice should persist versioned composable profile facets, drive conditional wizard screens and editor sections, preview relevant configuration fields for reusable plans/runs, and explain evidence-based framework suggestions. Profile enrichment must be re-entrant and preserve prior runs/manual corrections. Tests should cover mixed domains, dependent choices, identical reruns, inaccessible source evidence and changing profiles after completed runs.

Explicit follow-on scope: actual recurring scheduling and immutable result snapshots; sensor/rig/result adapters; laboratory/sample chain of custody; protected retention/export and justified amendments; qualified-review assignments; standards-specific assessment packs; platform submission integrations; clinical workflows. Clinical research and medical-device testing require separately researched applicability and sensitive-data handling before they become operational offerings.

Do not expose unsupported domain workflows as complete or certified. First-party documentation informs the design; synthetic fixtures establish software behavior only. Physical rigs, laboratories, platform programs, regulator acceptance and customer validation are separate evidence gates.
