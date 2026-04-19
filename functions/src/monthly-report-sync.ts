/**
 * Recomputes and writes `monthlyReports/{docId}` for one account + month from Firestore data.
 * Mirrors the client rollup enough for scheduled autopay / month-end flows.
 */

import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { istDateKey } from './time-ist';

export interface CategoryBreakdownEntry {
  name: string;
  amount: number;
  budget: number | null;
  used: number;
  overspent: boolean;
}

function catKey(id: string): string {
  return id.startsWith('cat_') ? id : `cat_${id}`;
}

function monthLongFromKey(monthKey: string): string {
  const [ys, ms] = monthKey.split('-');
  const y = Number(ys);
  const m = Number(ms);
  if (!y || !m) return '';
  return new Date(y, m - 1, 1).toLocaleString('en-US', { month: 'long' });
}

function stableNameHash(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (Math.imul(31, h) + name.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}

function resolveExpenseCategory(
  categoryName: string,
  byLowerName: Map<string, { uid: string; name: string }>,
): { id: string; displayName: string } {
  const raw = (categoryName ?? '').trim();
  const lower = raw.toLowerCase();
  if (!lower || lower === 'other' || lower === 'uncategorized') {
    return { id: 'other', displayName: raw || 'Other' };
  }
  const cat = byLowerName.get(lower);
  if (cat) return { id: cat.uid, displayName: cat.name };
  return { id: `unmapped_${stableNameHash(lower)}`, displayName: raw };
}

function filterBudgetsForMonth(
  monthKey: string,
  budgets: FirebaseFirestore.DocumentData[],
): FirebaseFirestore.DocumentData[] {
  const longName = monthLongFromKey(monthKey);
  return budgets.filter((b) => {
    const bm = String(b['month'] ?? '').trim();
    if (!bm) return true;
    const bml = bm.toLowerCase();
    return bml === longName.toLowerCase() || bm === monthKey || bm.startsWith(`${monthKey}-`);
  });
}

export async function recomputeMonthlyReportForAccount(
  accountId: string,
  ownerId: string,
  monthKey: string,
): Promise<void> {
  const db = getFirestore();
  const [y, mo] = monthKey.split('-').map(Number);
  const dateStart = `${monthKey}-01`;
  const dateEnd = new Date(y, mo, 0);
  const dateEndStr = `${monthKey}-${String(dateEnd.getDate()).padStart(2, '0')}`;

  const [txSnap, budgetsSnap, catSnap, reportSnap] = await Promise.all([
    db
      .collection('transactions')
      .where('accountId', '==', accountId)
      .where('date', '>=', dateStart)
      .where('date', '<=', dateEndStr)
      .get(),
    db.collection('budgets').where('accountId', '==', accountId).where('ownerId', '==', ownerId).get(),
    db.collection('categories').where('accountId', '==', accountId).where('ownerId', '==', ownerId).get(),
    db
      .collection('monthlyReports')
      .where('accountId', '==', accountId)
      .where('month', '==', monthKey)
      .limit(1)
      .get(),
  ]);

  const categories = catSnap.docs.map((d) => ({
    uid: d.id,
    name: String(d.data()['name'] ?? ''),
  }));
  const byLowerName = new Map<string, { uid: string; name: string }>();
  for (const c of categories) {
    const k = c.name.trim().toLowerCase();
    if (k) byLowerName.set(k, c);
  }

  let totalIncome = 0;
  let totalExpense = 0;
  const expenseByCategory = new Map<string, { amount: number; displayName: string }>();

  for (const d of txSnap.docs) {
    const t = d.data();
    const amt = Number(t['amount'] ?? 0);
    const typ = String(t['type'] ?? 'expense');
    if (typ === 'income') totalIncome += amt;
    else {
      totalExpense += amt;
      const { id, displayName } = resolveExpenseCategory(String(t['category'] ?? ''), byLowerName);
      const prev = expenseByCategory.get(id);
      expenseByCategory.set(id, {
        amount: (prev?.amount ?? 0) + amt,
        displayName: prev ? prev.displayName : displayName,
      });
    }
  }

  const budgets = filterBudgetsForMonth(monthKey, budgetsSnap.docs.map((d) => d.data()));
  const budgetByCategory = new Map<string, number>();
  for (const b of budgets) {
    const limit = Number(b['limit'] ?? b['amount'] ?? 0);
    if (!limit) continue;
    const catId = String(b['categoryId'] ?? '').trim();
    if (catId) {
      budgetByCategory.set(catId, (budgetByCategory.get(catId) ?? 0) + limit);
    } else {
      const catName = String(b['category'] ?? '').trim() || 'Uncategorized';
      const { id } = resolveExpenseCategory(catName, byLowerName);
      budgetByCategory.set(id, (budgetByCategory.get(id) ?? 0) + limit);
    }
  }

  const totalBudget = [...budgetByCategory.values()].reduce((a, b) => a + b, 0);
  const totalBudgetUsed = totalBudget > 0 ? Math.round((totalExpense / totalBudget) * 100) : 0;

  const byId = new Map(categories.map((c) => [c.uid, c]));
  const ids = new Set<string>();
  expenseByCategory.forEach((_, k) => ids.add(k));
  budgetByCategory.forEach((_, k) => ids.add(k));
  categories.forEach((c) => ids.add(c.uid));

  const categoryBreakdown: Record<string, CategoryBreakdownEntry> = {};
  for (const id of ids) {
    const exp = expenseByCategory.get(id);
    const amount = exp?.amount ?? 0;
    const budget = budgetByCategory.has(id) ? budgetByCategory.get(id)! : null;
    const cat = byId.get(id);
    const name = cat?.name ?? exp?.displayName ?? 'Other';
    const used = budget !== null && budget > 0 ? Math.round((amount / budget) * 100) : 0;
    const overspent = budget !== null && budget > 0 && amount > budget;
    categoryBreakdown[catKey(id)] = { name, amount, budget, used, overspent };
  }

  const savings = totalIncome - totalExpense;
  const now = FieldValue.serverTimestamp();
  const day = istDateKey(new Date());

  const payload = {
    month: monthKey,
    accountId,
    totalIncome,
    totalExpense,
    savings,
    totalBudgetUsed,
    categoryBreakdown,
    updatedAt: now,
    date: day,
  };

  if (!reportSnap.empty) {
    const doc = reportSnap.docs[0];
    const existing = doc.data();
    await doc.ref.set(
      {
        ...payload,
        recurrings: existing['recurrings'] ?? { totalIncome: 0, totalExpense: 0, spentOn: [] },
        isFinalized: existing['isFinalized'] ?? false,
        createdAt: existing['createdAt'] ?? now,
      },
      { merge: true },
    );
  } else {
    const ref = db.collection('monthlyReports').doc();
    await ref.set({
      uid: ref.id,
      ...payload,
      recurrings: { totalIncome: 0, totalExpense: 0, spentOn: [] },
      isFinalized: false,
      createdAt: now,
    });
  }
}
