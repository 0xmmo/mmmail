// Type and validation surface for server-side mail rules
// (Gmail filters + Outlook/Graph messageRules). Each provider works in its
// own canonical shape on input/output; a small NormalizedRule view is
// produced on read for cross-provider triage.

export interface NormalizedRule {
  id: string;
  displayName: string;
  enabled: boolean;
  hasError: boolean;
  // Outlook only; absent for Gmail (filters are unordered).
  sequence?: number;
  matches: {
    from?: string[];
    to?: string[];
    subject?: string;
    body?: string;
    hasAttachment?: boolean;
    // Gmail's free-form search query, when present and not represented above.
    query?: string;
  };
  does: {
    move?: string; // human-readable folder/label name
    copy?: string;
    delete?: boolean;
    permanentDelete?: boolean;
    markRead?: boolean;
    addLabels?: string[]; // Gmail
    removeLabels?: string[]; // Gmail
    assignCategories?: string[]; // Outlook
    forward?: string[];
    redirect?: string[];
    forwardAsAttachment?: string[];
    markImportance?: "low" | "normal" | "high";
    stopProcessing?: boolean;
  };
}

export interface RuleEntry<Raw = unknown> {
  id: string;
  normalized: NormalizedRule;
  raw: Raw;
}

// ---------- Gmail Filter (users.settings.filters resource) ----------

export interface GmailFilterCriteria {
  from?: string;
  to?: string;
  subject?: string;
  query?: string;
  negatedQuery?: string;
  hasAttachment?: boolean;
  excludeChats?: boolean;
  size?: number;
  sizeComparison?: "smaller" | "larger" | "unspecified";
}

// Input shape — labels may be given as names; the provider resolves to IDs.
export interface GmailFilterActionInput {
  addLabels?: string[];
  removeLabels?: string[];
  forward?: string;
}

export interface GmailFilterInput {
  criteria: GmailFilterCriteria;
  action: GmailFilterActionInput;
}

// On-the-wire shape returned by the API (and used internally on create POST).
export interface GmailFilterRaw {
  id?: string;
  criteria?: GmailFilterCriteria;
  action?: {
    addLabelIds?: string[];
    removeLabelIds?: string[];
    forward?: string;
  };
}

// ---------- Graph messageRule ----------

export type GraphImportance = "low" | "normal" | "high";
export type GraphSensitivity =
  | "normal"
  | "personal"
  | "private"
  | "confidential";
export type GraphActionFlag =
  | "any"
  | "call"
  | "doNotForward"
  | "followUp"
  | "fyi"
  | "forward"
  | "noResponseNecessary"
  | "read"
  | "reply"
  | "replyToAll"
  | "review";

export interface GraphRecipient {
  emailAddress: { address: string; name?: string };
}

export interface GraphPredicates {
  bodyContains?: string[];
  bodyOrSubjectContains?: string[];
  categories?: string[];
  fromAddresses?: GraphRecipient[];
  hasAttachments?: boolean;
  headerContains?: string[];
  importance?: GraphImportance;
  isApprovalRequest?: boolean;
  isAutomaticForward?: boolean;
  isAutomaticReply?: boolean;
  isEncrypted?: boolean;
  isMeetingRequest?: boolean;
  isMeetingResponse?: boolean;
  isNonDeliveryReport?: boolean;
  isPermissionControlled?: boolean;
  isReadReceipt?: boolean;
  isSigned?: boolean;
  isVoicemail?: boolean;
  messageActionFlag?: GraphActionFlag;
  notSentToMe?: boolean;
  recipientContains?: string[];
  senderContains?: string[];
  sensitivity?: GraphSensitivity;
  sentCcMe?: boolean;
  sentOnlyToMe?: boolean;
  sentToAddresses?: GraphRecipient[];
  sentToMe?: boolean;
  sentToOrCcMe?: boolean;
  subjectContains?: string[];
  withinSizeRange?: { minimumSize: number; maximumSize: number };
}

// Input shape: folder may be a path or an ID. Provider resolves paths.
export interface GraphActionsInput {
  assignCategories?: string[];
  copyToFolder?: string;
  delete?: boolean;
  permanentDelete?: boolean;
  forwardAsAttachmentTo?: GraphRecipient[];
  forwardTo?: GraphRecipient[];
  markAsRead?: boolean;
  markImportance?: GraphImportance;
  moveToFolder?: string;
  redirectTo?: GraphRecipient[];
  stopProcessingRules?: boolean;
}

export interface GraphMessageRuleInput {
  displayName: string;
  sequence?: number;
  isEnabled?: boolean;
  conditions?: GraphPredicates;
  exceptions?: GraphPredicates;
  actions: GraphActionsInput;
}

// On-the-wire shape (folder IDs resolved).
export interface GraphMessageRuleRaw {
  id?: string;
  displayName: string;
  sequence: number;
  isEnabled: boolean;
  isReadOnly?: boolean;
  hasError?: boolean;
  conditions?: GraphPredicates;
  exceptions?: GraphPredicates;
  actions: {
    assignCategories?: string[];
    copyToFolder?: string;
    delete?: boolean;
    permanentDelete?: boolean;
    forwardAsAttachmentTo?: GraphRecipient[];
    forwardTo?: GraphRecipient[];
    markAsRead?: boolean;
    markImportance?: GraphImportance;
    moveToFolder?: string;
    redirectTo?: GraphRecipient[];
    stopProcessingRules?: boolean;
  };
}

// ---------- Errors ----------

export class RulesNotSupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RulesNotSupportedError";
  }
}

export class ReauthRequiredError extends Error {
  email: string;
  hint: string;
  constructor(email: string, hint: string) {
    super(`${email}: re-authorization required. ${hint}`);
    this.name = "ReauthRequiredError";
    this.email = email;
    this.hint = hint;
  }
}

// ---------- Input validators ----------
// Hand-rolled rather than pulling in zod for one feature.

export function validateGmailInput(value: unknown): GmailFilterInput {
  if (!value || typeof value !== "object") {
    throw new Error("rule body must be a JSON object");
  }
  const v = value as Record<string, unknown>;
  const criteria = (v.criteria ?? {}) as Record<string, unknown>;
  const action = (v.action ?? {}) as Record<string, unknown>;
  if (criteria && typeof criteria !== "object") {
    throw new Error("criteria must be an object");
  }
  if (action && typeof action !== "object") {
    throw new Error("action must be an object");
  }
  // criteria fields are all primitives or absent — minimal validation.
  for (const k of Object.keys(criteria)) {
    const allowed = [
      "from",
      "to",
      "subject",
      "query",
      "negatedQuery",
      "hasAttachment",
      "excludeChats",
      "size",
      "sizeComparison",
    ];
    if (!allowed.includes(k)) {
      throw new Error(`unknown criteria field: ${k}`);
    }
  }
  for (const k of Object.keys(action)) {
    const allowed = ["addLabels", "removeLabels", "forward"];
    if (!allowed.includes(k)) {
      throw new Error(`unknown action field: ${k}`);
    }
  }
  if (
    !Object.keys(criteria).length &&
    !Object.keys(action).length
  ) {
    throw new Error("rule has neither criteria nor action");
  }
  return {
    criteria: criteria as GmailFilterCriteria,
    action: action as GmailFilterActionInput,
  };
}

export function validateGraphInput(value: unknown): GraphMessageRuleInput {
  if (!value || typeof value !== "object") {
    throw new Error("rule body must be a JSON object");
  }
  const v = value as Record<string, unknown>;
  if (typeof v.displayName !== "string" || !v.displayName.trim()) {
    throw new Error("displayName is required");
  }
  if (!v.actions || typeof v.actions !== "object") {
    throw new Error("actions is required");
  }
  if (v.sequence !== undefined && typeof v.sequence !== "number") {
    throw new Error("sequence must be a number");
  }
  if (v.isEnabled !== undefined && typeof v.isEnabled !== "boolean") {
    throw new Error("isEnabled must be a boolean");
  }
  return v as unknown as GraphMessageRuleInput;
}
