import { Timestamp } from 'firebase-admin/firestore';

export type NotificationType =
  | 'GROUP_INVITE'
  | 'ACCOUNT_INVITE'
  | 'ACCOUNT_INVITE_ACCEPTED'
  | 'ACCOUNT_INVITE_DECLINED'
  | 'PAYMENT_SENT'
  | 'PAYMENT_REQUEST'
  | 'PAYMENT_REMINDER'
  | 'SETTLEMENT_DONE'
  | 'RECURRING_DUE'
  | 'RECURRING_AUTOPAID'
  | 'BUDGET_EXCEEDED'
  | 'BUDGET_WARNING'
  | 'GOAL_ACHIEVED'
  | 'MONTH_END_SUMMARY';

export type NotificationStatus = 'UNREAD' | 'READ' | 'ACTION_TAKEN';
export type NotificationAction = 'ACCEPT' | 'REJECT' | 'PAY' | 'REMIND' | 'MARK_PAID';

export type NotificationPriority = 'low' | 'normal' | 'high';
export type NotificationSource = 'scheduled' | 'system' | 'social';

export interface NotificationActionData {
  amount?: number;
  deepLink?: string;
  actions?: NotificationAction[];
  /** Extra payload for deep links / callables (string values only for FCM data). */
  recurringId?: string;
  accountName?: string;
  inviterName?: string;
  /** Firestore account document id. */
  accountId?: string;
  /** Firestore group document id — set on GROUP_INVITE and related notifications. */
  groupId?: string;
  groupName?: string;
  /** Trend label for month-end summaries (FCM / client UI). */
  trendLabel?: 'great' | 'good' | 'watch' | 'concerning';
}

export interface NotificationDocument {
  type: NotificationType;
  title: string;
  body: string;
  senderId: string | null;
  receiverId: string;
  accountId: string | null;
  entityType: string | null;
  entityId: string | null;
  actionData: NotificationActionData;
  status: NotificationStatus;
  createdAt: Timestamp;
  readAt: Timestamp | null;
  isPushSent: boolean;
  /** When the inbox should stop highlighting this row (max 7 days from creation). */
  expiresAt: Timestamp | null;
  priority: NotificationPriority;
  source: NotificationSource;
  /** Optional grouping: recurring, budget, account, month_summary */
  category?: string | null;
  /** Short secondary line for rich UIs. */
  subtitle?: string | null;
}

export interface DeviceDocument {
  token: string;
  platform: 'web' | 'android' | 'ios';
  lastActiveAt: Timestamp;
}

export interface RecurringTransactionDocument {
  /** Document id (not Firebase Auth uid). */
  uid: string;
  accountId: string;
  transactionId?: string;
  description: string;
  category: string;
  amount: number;
  type: string;
  isAutoPay: boolean | null;
  isActive: boolean;
  nextPaymentDate: Timestamp;
  recurringFrequency?: string | null;
  icon?: string | null;
  source?: string | null;
}

export interface BudgetDocument {
  id: string;
  ownerId: string;
  accountId: string;
  month: string;
  category: string;
  /** Primary field in app; legacy docs may use `amount`. */
  limit?: number;
  amount?: number;
}

export interface GoalDocument {
  id: string;
  ownerId: string;
  accountId: string;
  name: string;
  /** App field name */
  target?: number;
  targetAmount?: number;
  currentAmount: number;
  isCompleted?: boolean;
}

export interface AccountMember {
  memberId: string;
  memberDisplayName: string;
  isJoined: boolean;
  isActive: boolean;
}
