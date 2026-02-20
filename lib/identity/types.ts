/**
 * ERC-8004 Identity and Reputation types
 */

export interface AgentIdentity {
  agentId: number;
  owner: string;
  uri: string;
  registeredAt?: string;
}

export interface ReputationSummary {
  count: number;
  summaryValue: number; // Converted from WAD (18-decimal) format
  summaryValueDecimals: number; // Always 18 for WAD
}

export interface ReputationFeedback {
  client: string;
  clientDisplayName?: string;
  clientBtcAddress?: string;
  index: number;
  value: number;
  valueDecimals: number;
  wadValue: number; // WAD-normalized value (18 decimals)
  tag1: string;
  tag2: string;
  isRevoked: boolean;
}

export interface ReputationFeedbackResponse {
  items: ReputationFeedback[];
  cursor: number | null;
}
