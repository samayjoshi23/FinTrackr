import { Timestamp } from 'firebase/firestore';

export type NotificationType =
  | 'GROUP_INVITE'
  | 'ACCOUNT_INVITE'
  | 'PAYMENT_SENT'
  | 'PAYMENT_REQUEST'
  | 'PAYMENT_REMINDER'
  | 'SETTLEMENT_DONE'
  | 'RECURRING_DUE'
  | 'RECURRING_AUTOPAID'
  | 'BUDGET_EXCEEDED'
  | 'BUDGET_WARNING'
  | 'GOAL_ACHIEVED';

export type NotificationStatus = 'UNREAD' | 'READ' | 'ACTION_TAKEN';

export type NotificationEntityType = 'transaction' | 'group' | 'account' | 'goal' | null;

export type NotificationAction = 'ACCEPT' | 'REJECT' | 'PAY' | 'REMIND';

export interface NotificationActionData {
  amount?: number;
  deepLink?: string;
  actions?: NotificationAction[];
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

/** Notification category groups for UI and routing. */
export const USER_TO_USER_TYPES: NotificationType[] = [
  'GROUP_INVITE',
  'ACCOUNT_INVITE',
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
];

export const ACTION_NOTIFICATION_TYPES: NotificationType[] = [
  'GROUP_INVITE',
  'ACCOUNT_INVITE',
  'PAYMENT_REQUEST',
  'PAYMENT_REMINDER',
];
