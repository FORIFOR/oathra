export type MissionStatus =
  | "DRAFT" | "REVIEWED" | "APPROVED" | "QUEUED" | "DIALING"
  | "ACTIVE" | "VERIFYING" | "COMPLETED" | "INCOMPLETE"
  | "DECLINED" | "FAILED" | "CANCELLED";

export type Channel = "web" | "ios" | "line" | "slack" | "api" | "mcp";

export type SalesGoal =
  | "introduce_product"
  | "send_material"
  | "schedule_meeting"
  | "follow_up_inquiry";

export interface MissionDraft {
  id: string;
  revision: number;
  status: "DRAFT" | "REVIEWED";
  channel: Channel;
  operatorId: string;
  target: { id: string; displayName: string; phoneE164: string };
  productProfileId: string;
  goals: SalesGoal[];
  allowedClaims: string[];
  forbiddenCommitments: string[];
  permissions: {
    explain: boolean;
    sendMaterial: boolean;
    scheduleMeeting: boolean;
    negotiatePrice: boolean;
    contract: boolean;
    payment: boolean;
  };
  budget: { maxDurationMs: number; maxCostUsd: number; maxAttempts: number };
}

export interface MissionApproval {
  missionId: string;
  revision: number;
  approvedBy: string;
  approvedAt: string;
  expiresAt: string;
  targetPhoneE164: string;
}

export interface StartCallRequest {
  missionId: string;
  revision: number;
  approvalToken: string;
  idempotencyKey: string;
}

export interface SalesResult {
  status: "COMPLETED" | "INCOMPLETE" | "DECLINED" | "FAILED" | "CANCELLED";
  verified: Record<string, unknown>;
  missing: string[];
  evidenceRefs: string[];
  doNotContact: boolean;
}

export interface ChannelCommand {
  channel: Channel;
  actorId: string;
  kind: "draft" | "approve" | "edit" | "cancel" | "handoff";
  missionId?: string;
  missionRevision?: number;
  text?: string;
  signedActionId?: string;
}
