import { Timestamp } from 'firebase-admin/firestore';

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
export type NotificationAction = 'ACCEPT' | 'REJECT' | 'PAY' | 'REMIND';

export interface NotificationActionData {
  amount?: number;
  deepLink?: string;
  actions?: NotificationAction[];
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
}

export interface DeviceDocument {
  token: string;
  platform: 'web' | 'android' | 'ios';
  lastActiveAt: Timestamp;
}

export interface RecurringTransactionDocument {
  uid: string;
  accountId: string;
  description: string;
  amount: number;
  type: string;
  isAutoPay: boolean | null;
  isActive: boolean;
  nextPaymentDate: Timestamp;
}

export interface BudgetDocument {
  id: string;
  ownerId: string;
  accountId: string;
  month: string;
  category: string;
  amount: number;
}

export interface GoalDocument {
  id: string;
  ownerId: string;
  accountId: string;
  name: string;
  targetAmount: number;
  currentAmount: number;
  isCompleted?: boolean;
}
