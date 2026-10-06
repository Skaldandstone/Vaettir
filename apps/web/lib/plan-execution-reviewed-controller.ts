import { freezeReviewedPlanStart, verifyReviewedPlanStartAck, type OwnedReviewedPlanStart, type ReviewedPlanRunRequest } from "./plan-execution-reviewed-start";
import type { PlanExecutionReadSnapshot, PlanExecutionReadPageWire } from "./plan-execution-reviewed-reader";
import { sameRunStartReadOrigin, type RunStartReadSnapshot } from "./manual-run-start-reviewed-reader";
import type { ReviewedRunStartEnvelope, ReviewedRunStartAck } from "./run-start-reviewed-write";
import { manualStartDefinitivelyRejected } from "./manual-run-start";

export type PlanExecutionFrame = Readonly<{
  active: boolean; open: boolean; legacyBlocked: boolean;
  plan: PlanExecutionReadSnapshot | null; profile: RunStartReadSnapshot | null;
  currentPlan: () => PlanExecutionReadSnapshot | null;
  currentProfile: () => RunStartReadSnapshot | null;
}>;
export type PlanExecutionView = Readonly<{
  readable: boolean; busy: boolean; selectedConfigurationId: string;
  hasReview: boolean; pending: boolean; unknown: boolean; refused: boolean;
  confirmed: boolean; confirmedRunId: string | null;
  canReview: boolean; canSend: boolean; canRetry: boolean;
  canDiscard: boolean; canAnother: boolean; notice: string; epoch: number;
}>;
type Held = Readonly<{ owned: OwnedReviewedPlanStart; plan: PlanExecutionReadSnapshot; profile: RunStartReadSnapshot }>;
type Pending = Readonly<{ held: Held; everAmbiguous: boolean; refused: boolean }>;
const blank = (): PlanExecutionFrame => ({ active: false, open: false, legacyBlocked: false, plan: null, profile: null, currentPlan: () => null, currentProfile: () => null });
/** Mounted local owner only. Native readers control current actions; callbacks
 * are consulted, never serialized or treated as function-identity authority.
 * No historical legacy state enters this controller. */
export class PlanExecutionReviewedController {
  private frame: PlanExecutionFrame = blank();
  private alive = false;
  private epoch = 0;
  private selected = "";
  private reviewed: Held | null = null;
  private pending: Pending | null = null;
  private known: Readonly<{ held: Held; ack: ReviewedRunStartAck }> | null = null;
  private busy = false;
  private notice = "";
  constructor(private readonly projectId: string, private readonly planId: string, private readonly publish: (view: PlanExecutionView) => void, private readonly uuid = () => crypto.randomUUID()) {}
  attach() { this.alive = true; }
  detach() { this.alive = false; this.frame = blank(); this.epoch++; }
  bind(frame: PlanExecutionFrame) {
    if (this.frame.active !== frame.active || this.frame.open !== frame.open || this.frame.legacyBlocked !== frame.legacyBlocked || this.frame.plan !== frame.plan || this.frame.profile !== frame.profile) this.epoch++;
    this.frame = frame; this.emit();
  }
  private live() { return this.alive && this.frame.active && this.frame.open && !this.frame.legacyBlocked; }
  private page(): PlanExecutionReadPageWire | null {
    try {
      const value = this.frame.plan;
      return this.live() && value?.projection === "PAGE" && value.origin.projectId === this.projectId && value.origin.testPlanId === this.planId && this.frame.currentPlan() === value && "plan" in value.data ? value.data as PlanExecutionReadPageWire : null;
    } catch { return null; }
  }
  private fullProfile(held?: Held | null) {
    try {
      const value = this.frame.profile;
      return this.live() && !!value && this.frame.currentProfile() === value && value.origin.projectId === this.projectId && value.data.canConfigure && value.data.canRecover && (!held || sameRunStartReadOrigin(held.owned.origin, value.origin)) ? value : null;
    } catch { return null; }
  }
  private canCreate() {
    const page = this.page(), profile = this.fullProfile();
    return !!page && page.hasFullEditorAccess && page.interpretation === "EXACT_SUPPORTED" && page.plan.status !== "ARCHIVED" && !!page.template && page.selected.every(item => item.state === "AVAILABLE" && item.metadata?.reviewStatus === "APPROVED" && !item.metadata.archived) && !!profile && profile.projection === "PREVIEW" && "profile" in profile.data && profile.data.profile.kind === "SUPPORTED" && profile.data.canStart === true;
  }
  private exactReview(held: Held) {
    try { return this.canCreate() && this.frame.plan === held.plan && this.frame.profile === held.profile && this.frame.currentPlan() === held.plan && this.frame.currentProfile() === held.profile; } catch { return false; }
  }
  view(): PlanExecutionView {
    const readable = !!this.page(), recovery = !!this.fullProfile(this.pending?.held ?? this.known?.held ?? this.reviewed);
    const occupied = !!this.pending || !!this.known;
    return Object.freeze({ readable, busy: this.busy, selectedConfigurationId: readable ? this.selected : "", hasReview: !!this.reviewed, pending: !!this.pending, unknown: !!this.pending?.everAmbiguous, refused: !!this.pending?.refused && !this.pending.everAmbiguous, confirmed: !!this.known, confirmedRunId: recovery ? this.known?.ack.legacyAck.testRunId ?? null : null, canReview: !this.busy && !occupied && !this.reviewed && this.canCreate() && !!this.selected, canSend: !this.busy && !occupied && !!this.reviewed && this.exactReview(this.reviewed), canRetry: !this.busy && !!this.pending && !this.pending.refused && recovery, canDiscard: !this.busy && !this.known && !!this.reviewed && recovery && (!this.pending || this.pending.refused && !this.pending.everAmbiguous), canAnother: !this.busy && !!this.known && recovery, notice: readable || recovery ? this.notice : "", epoch: this.epoch });
  }
  private emit() { if (this.alive) this.publish(this.view()); }
  select(configurationId: string) {
    const page = this.page();
    if (this.busy || this.reviewed || this.pending || this.known || !page?.template?.configurations.some(item => item.id === configurationId)) return false;
    this.selected = configurationId; this.notice = ""; this.emit(); return true;
  }
  review() {
    if (!this.view().canReview) return false;
    const plan = this.frame.plan!, profile = this.frame.profile!, page = this.page()!, preset = page.template!.configurations.find(item => item.id === this.selected);
    if (!preset || !("profile" in profile.data) || profile.data.profile.kind !== "SUPPORTED") return false;
    try {
      const request: ReviewedPlanRunRequest = { projectId: this.projectId, testCaseIds: [...page.template!.testCaseIds], expectedProfileHash: profile.data.profile.profileHash, executionContext: { ...preset.context }, idempotencyKey: this.uuid(), planReference: { testPlanId: this.planId, expectedTemplateHash: page.templateHash, configurationId: this.selected }, originalOrganizationId: profile.origin.organizationId, expectedClerkActorId: profile.origin.clerkActorId };
      const owned = freezeReviewedPlanStart(request, { intent: "UNSENT", plan, profile, configurationId: this.selected, currentPlan: this.frame.currentPlan, currentProfile: this.frame.currentProfile });
      this.reviewed = Object.freeze({ owned, plan, profile }); this.notice = "Selection and configuration reviewed locally. The server still admits and captures current approved procedures/prerequisites; no record exists yet."; this.emit(); return true;
    } catch { this.notice = "The complete current plan/profile selection could not be reviewed. Nothing was submitted or normalized."; this.emit(); return false; }
  }
  discard() {
    if (!this.view().canDiscard) return false;
    this.reviewed = null; this.pending = null; this.notice = "The explicitly unsent or definitively refused review was discarded. No ambiguous request was changed."; this.emit(); return true;
  }
  another() {
    if (!this.view().canAnother) return false;
    this.known = null; this.reviewed = null; this.pending = null; this.selected = ""; this.notice = "The prior receipt remains in the server record. Choose and review a separate execution deliberately."; this.emit(); return true;
  }
  /** Exact owned pending body only. ACCESS may recover a receipt without a new
   * profile/template review, but never substitutes a fresh cohort or UUID. */
  async submit(transport: (envelope: ReviewedRunStartEnvelope) => Promise<unknown>, onConfirmed?: () => void) {
    const view = this.view(), held = this.pending?.held ?? this.reviewed;
    if (this.busy || !held || !(this.pending ? view.canRetry : view.canSend)) return false;
    const startedEpoch = this.epoch;
    if (!this.pending && !this.exactReview(held) || this.pending && !this.fullProfile(held)) return false;
    const retained: Pending = this.pending ?? Object.freeze({ held, everAmbiguous: false, refused: false });
    this.pending = retained; this.busy = true; this.notice = ""; this.emit();
    const currentFrame = () => this.alive && this.epoch === startedEpoch && this.pending === retained && !!this.fullProfile(held);
    try {
      // No await exists before dispatch and the synchronous latch is already set.
      if (!currentFrame()) return false;
      const raw = await transport(held.owned.envelope), ack = await verifyReviewedPlanStartAck(held.owned, raw);
      if (this.pending !== retained) return false;
      // Consume the exact receipt privately BEFORE any active-frame effects.
      this.pending = null; this.known = Object.freeze({ held, ack });
      if (this.alive && this.epoch === startedEpoch && this.fullProfile(held)) {
        this.notice = "The exact original execution request is confirmed. This is not a passing/readiness or raw-native provenance claim.";
        if (this.page()) try { onConfirmed?.(); } catch { this.notice = "The original execution is confirmed, but the parent refresh failed. Do not send another request."; }
      }
      return true;
    } catch (cause) {
      if (this.pending === retained) {
        const owns = currentFrame(), definitive = owns && manualStartDefinitivelyRejected(cause, retained.everAmbiguous);
        this.pending = Object.freeze({ held, everAmbiguous: retained.everAmbiguous || !definitive, refused: definitive });
        if (owns) this.notice = definitive ? "The current server response refused this request. The original body/key is retained until you explicitly discard the refused review." : "The response is unknown. Keep the exact original body/key; current original FULL ACCESS may retry only that request.";
      }
      return false;
    } finally { this.busy = false; this.emit(); }
  }
}
