import { Timestamp } from 'firebase/firestore';

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

export type NotificationEntityType =
  | 'transaction'
  | 'group'
  | 'account'
  | 'goal'
  | 'budget'
  | 'recurring-transaction'
  | null;

export type NotificationAction = 'ACCEPT' | 'REJECT' | 'PAY' | 'REMIND' | 'MARK_PAID';

export type NotificationPriority = 'low' | 'normal' | 'high';
export type NotificationSource = 'scheduled' | 'system' | 'social';

export interface NotificationActionData {
  amount?: number;
  deepLink?: string;
  actions?: NotificationAction[];
  recurringId?: string;
  accountName?: string;
  inviterName?: string;
  accountId?: string;
  trendLabel?: 'great' | 'good' | 'watch' | 'concerning';
}

/** Client-side shape (with doc id, JS Dates). */
export interface AppNotification {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  senderId: string | null;
  receiverId: string;
  accountId: string | null;
  entityType: NotificationEntityType;
  entityId: string | null;
  actionData: NotificationActionData | null;
  status: NotificationStatus;
  createdAt: Date | null;
  readAt: Date | null;
  isPushSent: boolean;
  expiresAt: Date | null;
  priority: NotificationPriority;
  source: NotificationSource;
  category: string | null;
  subtitle: string | null;
  _pendingSync?: boolean;
}

/** Firestore document shape (Timestamps). */
export interface AppNotificationDocument {
  type: NotificationType;
  title: string;
  body: string;
  senderId: string | null;
  receiverId: string;
  accountId: string | null;
  entityType: NotificationEntityType;
  entityId: string | null;
  actionData: NotificationActionData | null;
  status: NotificationStatus;
  createdAt: Timestamp | null;
  readAt: Timestamp | null;
  isPushSent: boolean;
  expiresAt?: Timestamp | null;
  priority?: NotificationPriority;
  source?: NotificationSource;
  category?: string | null;
  subtitle?: string | null;
}

export interface NotificationCreateInput {
  type: NotificationType;
  title: string;
  body: string;
  senderId?: string | null;
  receiverId: string;
  accountId?: string | null;
  entityType?: NotificationEntityType;
  entityId?: string | null;
  actionData?: NotificationActionData;
}

export const USER_TO_USER_TYPES: NotificationType[] = [
  'GROUP_INVITE',
  'ACCOUNT_INVITE',
  'ACCOUNT_INVITE_ACCEPTED',
  'ACCOUNT_INVITE_DECLINED',
  'PAYMENT_SENT',
  'PAYMENT_REQUEST',
  'PAYMENT_REMINDER',
  'SETTLEMENT_DONE',
];

export const SYSTEM_TYPES: NotificationType[] = [
  'RECURRING_DUE',
  'RECURRING_AUTOPAID',
  'BUDGET_EXCEEDED',
  'BUDGET_WARNING',
  'GOAL_ACHIEVED',
  'MONTH_END_SUMMARY',
];

/** Types that may show Accept / Decline / Pay / Mark paid buttons when `actionData.actions` is set. */
export const ACTION_NOTIFICATION_TYPES: NotificationType[] = [
  'GROUP_INVITE',
  'ACCOUNT_INVITE',
  'PAYMENT_REQUEST',
  'PAYMENT_REMINDER',
  'RECURRING_DUE',
];
