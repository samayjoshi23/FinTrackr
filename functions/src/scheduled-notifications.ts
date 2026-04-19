/**
 * scheduledDailyNotifications — daily 09:00 Asia/Kolkata.
 *
 * 1) Active accounts → recurring schedules with nextPaymentDate falling on today (IST):
 *    - Auto-pay: create transaction, adjust balance, recompute monthly report, notify.
 *    - Manual: notify with MARK_PAID action (deep link to add transaction with recurring prefilled).
 * 2) Last day of month (IST): previous-month summary + trend notification per account recipients.
 * 3) Budget warnings / exceeded (per owner, current IST month).
 * 4) Goals achieved (per owner).
 *
 * Idempotency: `users/{uid}/cron-markers/{markerId}` (one marker per recipient where applicable).
 */

import { onSchedule } from 'firebase-functions/v2/scheduler';
import { getFirestore, Timestamp, FieldValue } from 'firebase-admin/firestore';
import { createNotification } from './notification-trigger';
import {
  RecurringTransactionDocument,
  BudgetDocument,
  GoalDocument,
  AccountMember,
} from './types';
import {
  istDateKey,
  istDayBoundsUtc,
  istMonthKey,
  istMonthLongName,
  istPreviousMonthKey,
  isLastDayOfMonthIST,
} from './time-ist';
import { recomputeMonthlyReportForAccount } from './monthly-report-sync';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export const scheduledDailyNotifications = onSchedule(
  {
    schedule: '0 9 * * *',
    timeZone: 'Asia/Kolkata',
    timeoutSeconds: 540,
    memory: '512MiB',
  },
  async () => {
    const db = getFirestore();
    const now = new Date();
    const dateKey = istDateKey(now);
    const { start: istStart, endExclusive: istEnd } = istDayBoundsUtc(dateKey);
    const startTs = Timestamp.fromDate(istStart);
    const endTs = Timestamp.fromDate(istEnd);

    const usersSnap = await db.collection('users').get();
    const userIds = usersSnap.docs.map((d) => d.id);

    await Promise.allSettled(
      userIds.map((uid) => processBudgetsAndGoalsForOwner(db, uid, now, dateKey)),
    );

    const accountsSnap = await db.collection('accounts').get();
    const accounts = accountsSnap.docs.filter((d) => {
      const a = d.data();
      if (a['isActive'] === false) return false;
      return Boolean(a['ownerId']);
    });

    for (const accDoc of accounts) {
      const accountId = accDoc.id;
      const account = accDoc.data();
      const ownerId = String(account['ownerId'] ?? '');
      if (!ownerId) continue;
      const accountName = String(account['name'] ?? 'your account');
      const recipients = getRecipientUserIds(account, ownerId);

      await processRecurringForAccount(
        db,
        accountId,
        accountName,
        ownerId,
        recipients,
        startTs,
        endTs,
        dateKey,
      );

      if (isLastDayOfMonthIST(now)) {
        await processMonthEndForAccount(
          db,
          accountId,
          accountName,
          ownerId,
          recipients,
          dateKey,
        );
      }
    }
  },
);

function normalizeMembers(raw: unknown): AccountMember[] {
  if (!Array.isArray(raw)) return [];
  if (raw.length && typeof raw[0] === 'string') {
    return (raw as string[]).map((memberId) => ({
      memberId,
      memberDisplayName: '',
      isJoined: false,
      isActive: false,
    }));
  }
  return (raw as AccountMember[]).map((m) => ({
    memberId: String(m.memberId ?? ''),
    memberDisplayName: String(m.memberDisplayName ?? ''),
    isJoined: Boolean(m.isJoined),
    isActive: Boolean(m.isActive),
  }));
}

/** Owner + members who have joined and are active. */
function getRecipientUserIds(account: FirebaseFirestore.DocumentData, ownerId: string): string[] {
  const ids = new Set<string>([ownerId]);
  for (const m of normalizeMembers(account['members'])) {
    if (m.memberId && m.isJoined && m.isActive) ids.add(m.memberId);
  }
  return [...ids];
}


async function markerExists(db: FirebaseFirestore.Firestore, userId: string, markerId: string): Promise<boolean> {
  const snap = await db.doc(`users/${userId}/cron-markers/${markerId}`).get();
  return snap.exists;
}

async function setMarker(db: FirebaseFirestore.Firestore, userId: string, markerId: string): Promise<void> {
  await db.doc(`users/${userId}/cron-markers/${markerId}`).set({ createdAt: FieldValue.serverTimestamp() });
}

async function processRecurringForAccount(
  db: FirebaseFirestore.Firestore,
  accountId: string,
  accountName: string,
  ownerId: string,
  recipients: string[],
  startTs: Timestamp,
  endTs: Timestamp,
  dateKey: string,
): Promise<void> {
  const recurringSnap = await db
    .collection('recurring-transactions')
    .where('accountId', '==', accountId)
    .where('isActive', '==', true)
    .where('nextPaymentDate', '>=', startTs)
    .where('nextPaymentDate', '<', endTs)
    .get();

  for (const rdoc of recurringSnap.docs) {
    const rec = rdoc.data() as RecurringTransactionDocument;
    const recurringId = rdoc.id;

    if (rec.isAutoPay) {
      const markerBase = `${dateKey}-AUTOPAY-${recurringId}`;
      if (await markerExists(db, ownerId, markerBase)) continue;
      await setMarker(db, ownerId, markerBase);

      const txRef = db.collection('transactions').doc();
      const amount = Number(rec.amount ?? 0);
      const type = String(rec.type ?? 'expense');
      const day = dateKey;

      await txRef.set({
        accountId,
        amount,
        description: String(rec.description ?? ''),
        category: String(rec.category ?? ''),
        icon: rec.icon ?? null,
        type,
        source: rec.source ?? 'Recurring',
        isRecurring: true,
        recurringFrequency: rec.recurringFrequency ?? null,
        recurringTransactionId: recurringId,
        date: day,
        paidBy: 'Auto-pay',
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });

      const delta = type === 'income' ? amount : -amount;
      await db.doc(`accounts/${accountId}`).update({
        balance: FieldValue.increment(delta),
        updatedAt: FieldValue.serverTimestamp(),
      });

      const monthKey = istMonthKey(new Date(`${day}T12:00:00+05:30`));
      await recomputeMonthlyReportForAccount(accountId, ownerId, monthKey);

      const currency = await getAccountCurrency(db, accountId);
      const amtLabel = formatAmount(amount, currency);
      for (const uid of recipients) {
        await createNotification(uid, {
          type: 'RECURRING_AUTOPAID',
          title: 'Payment processed',
          body: `${amtLabel} was deducted from ${accountName} for ${rec.description || 'a recurring payment'}.`,
          senderId: null,
          receiverId: uid,
          accountId,
          entityType: 'transaction',
          entityId: txRef.id,
          actionData: {
            amount,
            deepLink: `/user/transactions/list`,
            accountName,
          },
          category: 'recurring',
          subtitle: 'Auto-pay',
          source: 'scheduled',
          priority: 'normal',
        });
      }

      const next = computeNextPaymentDate((rec.nextPaymentDate as Timestamp).toDate(), rec.recurringFrequency ?? null);
      await rdoc.ref.update({
        lastPaymentDate: Timestamp.fromDate(new Date(`${day}T12:00:00+05:30`)),
        nextPaymentDate: Timestamp.fromDate(next),
        transactionId: txRef.id,
        updatedAt: FieldValue.serverTimestamp(),
      });
    } else {
      for (const uid of recipients) {
        const markerId = `${dateKey}-REC_DUE-${recurringId}-recv-${uid}`;
        if (await markerExists(db, uid, markerId)) continue;
        await setMarker(db, uid, markerId);

        const currency = await getAccountCurrency(db, accountId);
        const amtLabel = formatAmount(Number(rec.amount ?? 0), currency);
        await createNotification(uid, {
          type: 'RECURRING_DUE',
          title: 'Payment due today',
          body: `${amtLabel} is due today for ${rec.description || 'a recurring payment'} on ${accountName}.`,
          senderId: null,
          receiverId: uid,
          accountId,
          entityType: 'recurring-transaction',
          entityId: recurringId,
          actionData: {
            amount: rec.amount,
            deepLink: `/user/transactions/add?recurringId=${encodeURIComponent(recurringId)}`,
            actions: ['MARK_PAID'],
            recurringId,
            accountName,
          },
          category: 'recurring',
          subtitle: 'Tap Mark paid when you have paid',
          source: 'scheduled',
          priority: 'high',
        });
      }
    }
  }
}

async function processMonthEndForAccount(
  db: FirebaseFirestore.Firestore,
  accountId: string,
  accountName: string,
  ownerId: string,
  recipients: string[],
  dateKey: string,
): Promise<void> {
  const prevMonth = istPreviousMonthKey(new Date(`${dateKey}T12:00:00+05:30`));
  const markerBase = `${dateKey}-MONTH_END-${accountId}`;
  if (await markerExists(db, ownerId, markerBase)) return;
  await setMarker(db, ownerId, markerBase);

  await recomputeMonthlyReportForAccount(accountId, ownerId, prevMonth);

  const reportSnap = await db
    .collection('monthlyReports')
    .where('accountId', '==', accountId)
    .where('month', '==', prevMonth)
    .limit(1)
    .get();

  let savings = 0;
  let expense = 0;
  let income = 0;
  if (!reportSnap.empty) {
    const r = reportSnap.docs[0].data();
    savings = Number(r['savings'] ?? 0);
    expense = Number(r['totalExpense'] ?? 0);
    income = Number(r['totalIncome'] ?? 0);
  }

  const { title, body, trendLabel } = buildMonthEndCopy(savings, expense, income, prevMonth);

  for (const uid of recipients) {
    await createNotification(uid, {
      type: 'MONTH_END_SUMMARY',
      title,
      body,
      senderId: null,
      receiverId: uid,
      accountId,
      entityType: 'account',
      entityId: accountId,
      actionData: {
        deepLink: `/user/reports`,
        trendLabel,
        accountName,
      },
      category: 'month_summary',
      subtitle: `${prevMonth} · ${accountName}`,
      source: 'scheduled',
      priority: 'normal',
    });
  }
}

function buildMonthEndCopy(
  savings: number,
  expense: number,
  income: number,
  prevMonth: string,
): { title: string; body: string; trendLabel: 'great' | 'good' | 'watch' | 'concerning' } {
  const label = prevMonth;
  let trendLabel: 'great' | 'good' | 'watch' | 'concerning' = 'good';
  let title = `Month in review · ${label}`;
  let body = '';

  if (income <= 0 && expense <= 0) {
    trendLabel = 'watch';
    body = `No income or spending was recorded for ${label}. Add transactions to see trends next month.`;
  } else if (savings >= income * 0.2 && income > 0) {
    trendLabel = 'great';
    body = `Great job — you saved about ${Math.round((savings / income) * 100)}% of income in ${label}. Keep the momentum!`;
  } else if (savings > 0) {
    trendLabel = 'good';
    body = `You ended ${label} in the green with savings on track. Review reports to fine-tune categories.`;
  } else if (savings > -income * 0.1) {
    trendLabel = 'watch';
    body = `Spending edged past income in ${label}. A quick budget check can help next month.`;
  } else {
    trendLabel = 'concerning';
    body = `Expenses were higher than income in ${label}. Consider adjusting budgets or recurring bills.`;
  }

  return { title, body, trendLabel };
}

async function processBudgetsAndGoalsForOwner(
  db: FirebaseFirestore.Firestore,
  userId: string,
  today: Date,
  dateKey: string,
): Promise<void> {
  await Promise.allSettled([checkBudgets(db, userId, today, dateKey), checkGoals(db, userId, dateKey)]);
}

async function checkBudgets(
  db: FirebaseFirestore.Firestore,
  userId: string,
  today: Date,
  dateKey: string,
): Promise<void> {
  const monthKey = istMonthKey(today);
  const monthLong = istMonthLongName(today);

  const budgetsSnap = await db.collection('budgets').where('ownerId', '==', userId).get();

  for (const bdoc of budgetsSnap.docs) {
    const budget = bdoc.data() as BudgetDocument;
    const bm = String(budget.month ?? '').trim();
    if (bm && bm !== monthKey && bm.toLowerCase() !== monthLong.toLowerCase()) continue;

    const limit = Number(budget.limit ?? budget.amount ?? 0);
    if (!limit || limit <= 0) continue;

    const spent = await sumTransactionsForBudget(db, budget.accountId, budget.category, monthKey);
    const usageRatio = spent / limit;

    let notifType: 'BUDGET_WARNING' | 'BUDGET_EXCEEDED' | null = null;
    let markerSuffix = '';

    if (usageRatio >= 1.0) {
      notifType = 'BUDGET_EXCEEDED';
      markerSuffix = 'exceeded';
    } else if (usageRatio >= 0.8) {
      notifType = 'BUDGET_WARNING';
      markerSuffix = 'warning';
    }

    if (!notifType) continue;

    const markerId = `${dateKey}-${markerSuffix}-${bdoc.id}`;
    if (await markerExists(db, userId, markerId)) continue;
    await setMarker(db, userId, markerId);

    const percent = Math.round(usageRatio * 100);
    const isExceeded = notifType === 'BUDGET_EXCEEDED';
    const currency = await getAccountCurrency(db, budget.accountId);

    await createNotification(userId, {
      type: notifType,
      title: isExceeded ? `Budget exceeded: ${budget.category}` : `Budget warning: ${budget.category}`,
      body: isExceeded
        ? `You have spent ${formatAmount(spent, currency)} — ${percent - 100}% over your ${formatAmount(limit, currency)} ${budget.category} budget.`
        : `You have used ${percent}% of your ${formatAmount(limit, currency)} ${budget.category} budget.`,
      senderId: null,
      receiverId: userId,
      accountId: budget.accountId,
      entityType: 'budget',
      entityId: bdoc.id,
      actionData: {
        amount: spent,
        deepLink: `/user/budgets`,
      },
      category: 'budget',
      source: 'scheduled',
      priority: isExceeded ? 'high' : 'normal',
    });
  }
}

async function sumTransactionsForBudget(
  db: FirebaseFirestore.Firestore,
  accountId: string,
  category: string,
  month: string,
): Promise<number> {
  const [year, mon] = month.split('-').map(Number);
  const dateStart = `${month}-01`;
  const dateEnd = new Date(year, mon, 0);
  const dateEndStr = `${month}-${String(dateEnd.getDate()).padStart(2, '0')}`;

  const snap = await db
    .collection('transactions')
    .where('accountId', '==', accountId)
    .where('category', '==', category)
    .where('type', '==', 'expense')
    .where('date', '>=', dateStart)
    .where('date', '<=', dateEndStr)
    .get();

  return snap.docs.reduce((sum, d) => sum + Number((d.data() as { amount?: number }).amount ?? 0), 0);
}

async function checkGoals(db: FirebaseFirestore.Firestore, userId: string, dateKey: string): Promise<void> {
  const goalsSnap = await db.collection('goals').where('ownerId', '==', userId).get();

  for (const gdoc of goalsSnap.docs) {
    const goal = gdoc.data() as GoalDocument;
    const target = Number(goal.target ?? goal.targetAmount ?? 0);
    if (!target || goal.currentAmount < target) continue;
    if (goal.isCompleted) continue;

    const markerId = `${dateKey}-GOAL_ACHIEVED-${gdoc.id}`;
    if (await markerExists(db, userId, markerId)) continue;
    await setMarker(db, userId, markerId);

    const currency = goal.accountId ? await getAccountCurrency(db, goal.accountId) : 'INR';

    await createNotification(userId, {
      type: 'GOAL_ACHIEVED',
      title: 'Goal achieved!',
      body: `You've reached your goal "${goal.name}" of ${formatAmount(target, currency)}. Congratulations!`,
      senderId: null,
      receiverId: userId,
      accountId: goal.accountId ?? null,
      entityType: 'goal',
      entityId: gdoc.id,
      actionData: {
        amount: target,
        deepLink: `/user/goals`,
      },
      category: 'goal',
      source: 'scheduled',
      priority: 'normal',
    });

    await gdoc.ref.update({ isCompleted: true });
  }
}

async function getAccountCurrency(db: FirebaseFirestore.Firestore, accountId: string): Promise<string> {
  const snap = await db.doc(`accounts/${accountId}`).get();
  const c = snap.data()?.['currency'];
  return typeof c === 'string' && c ? c : 'INR';
}

function formatAmount(amount: number, currency = 'INR'): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

function computeNextPaymentDate(prev: Date, frequency: string | null): Date {
  const f = (frequency ?? 'monthly').toLowerCase();
  const d = new Date(prev.getTime());
  if (f.includes('week')) {
    d.setDate(d.getDate() + 7);
    return d;
  }
  if (f.includes('year') || f.includes('annual')) {
    d.setFullYear(d.getFullYear() + 1);
    return d;
  }
  d.setMonth(d.getMonth() + 1);
  return d;
}
