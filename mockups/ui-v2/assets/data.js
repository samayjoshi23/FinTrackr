// FinTrackr UI v2 mockups, sample data for the shared household account "Ghar".
// Amounts mirror the real October 2026 figures seen in the app; descriptions and payers are sample
// values to confirm. Every total on screen is computed from these rows, never typed in.
window.FT = (() => {
  const today = new Date(2026, 9, 23); // 23 Oct 2026

  const people = {
    samay: { name: 'Samay', full: 'Samay Joshi', initial: 'S', tint: 'person-a' },
    ayushi: { name: 'Ayushi', full: 'Ayushi Dongre', initial: 'A', tint: 'person-b' },
  };
  const me = { name: 'Samay Joshi', initials: 'SJ', email: 'samay@fintrackr.app', since: '18 Jul 2026' };
  const accounts = [
    { id: 'personal', name: 'Personal', type: 'Just me', balance: 175505, currency: 'INR' },
    { id: 'ghar', name: 'Ghar', type: 'Shared with Ayushi', balance: 18846.17, currency: 'INR', current: true },
  ];

  // Category → icon + tint family (four families keep the screen under four hues).
  const categories = {
    Bills: { icon: 'bulb', tint: 'home', planned: 40000 },
    Groceries: { icon: 'basket', tint: 'home', planned: 9000 },
    Vegetables: { icon: 'leaf', tint: 'home', planned: 2000 },
    Dairy: { icon: 'cup', tint: 'home', planned: 2000 },
    Food: { icon: 'fork', tint: 'fun', planned: 4500 },
    Entertainment: { icon: 'screen', tint: 'fun', planned: 1000 },
    Travel: { icon: 'plane', tint: 'move', planned: 1500 },
    Income: { icon: 'coin', tint: 'in', planned: 0 },
  };

  const tx = [
    { id: 't13', date: '2026-10-19', desc: 'Auto, Kartik to home', cat: 'Travel', source: 'UPI', by: 'samay', amount: 102, type: 'expense' },
    { id: 't12', date: '2026-10-19', desc: 'BlaBlaCar, Mussoorie to Chandigarh', cat: 'Travel', source: 'UPI', by: 'samay', amount: 1000, type: 'expense' },
    { id: 't11', date: '2026-10-18', desc: 'Kartik restaurant', cat: 'Food', source: 'UPI', by: 'samay', amount: 819, type: 'expense' },
    { id: 't10', date: '2026-10-18', desc: 'Mall Road dinner, Mussoorie', cat: 'Food', source: 'Cash', by: 'ayushi', amount: 1700, type: 'expense' },
    { id: 't09', date: '2026-10-05', desc: 'House rent', cat: 'Bills', source: 'UPI', by: 'samay', amount: 29400, type: 'expense', recurring: true },
    { id: 't08', date: '2026-10-05', desc: 'Anita didi, cook', cat: 'Bills', source: 'UPI', by: 'ayushi', amount: 4000, type: 'expense', recurring: true },
    { id: 't07', date: '2026-10-05', desc: 'Rakhi didi, jhadu', cat: 'Bills', source: 'Cash', by: 'ayushi', amount: 2000, type: 'expense', recurring: true },
    { id: 't06', date: '2026-10-05', desc: 'BMW didi', cat: 'Bills', source: 'Bank', by: 'samay', amount: 1500, type: 'expense', recurring: true },
    { id: 't05', date: '2026-10-03', desc: 'Sabzi mandi', cat: 'Vegetables', source: 'Cash', by: 'ayushi', amount: 928, type: 'expense' },
    { id: 't04', date: '2026-10-02', desc: 'DMart monthly groceries', cat: 'Groceries', source: 'Card', by: 'ayushi', amount: 3180, type: 'expense' },
    { id: 't03', date: '2026-10-01', desc: 'October share, Ayushi', cat: 'Income', source: 'UPI', by: 'ayushi', amount: 30000, type: 'income' },
    { id: 't02', date: '2026-10-01', desc: 'October share, Samay', cat: 'Income', source: 'Bank', by: 'samay', amount: 30000, type: 'income' },
  ];

  // Recurring schedules (existing `recurring` fields only: description, category, amount, type, source,
  // recurringFrequency, nextPaymentDate, lastPaymentDate, isAutoPay, isActive).
  const recurring = [
    { id: 'r1', desc: 'House rent', cat: 'Bills', amount: 29400, type: 'expense', source: 'UPI', freq: 'monthly', due: '2026-11-05', last: '2026-10-05', autopay: false, active: true },
    { id: 'r2', desc: 'Anita didi, cook', cat: 'Bills', amount: 4000, type: 'expense', source: 'UPI', freq: 'monthly', due: '2026-11-05', last: '2026-10-05', autopay: false, active: true },
    { id: 'r3', desc: 'Rakhi didi, jhadu', cat: 'Bills', amount: 2000, type: 'expense', source: 'Cash', freq: 'monthly', due: '2026-11-05', last: '2026-10-05', autopay: false, active: true },
    { id: 'r4', desc: 'BMW didi', cat: 'Bills', amount: 1500, type: 'expense', source: 'Bank', freq: 'monthly', due: '2026-11-05', last: '2026-10-05', autopay: false, active: true },
    { id: 'r5', desc: 'Airtel Wi-Fi', cat: 'Bills', amount: 1178, type: 'expense', source: 'Card', freq: 'monthly', due: '2026-10-25', last: '2026-09-25', autopay: true, active: true },
    // Stalled: active but no next date (seen in the live app) — the screen must say so and offer a fix.
    { id: 'r6', desc: 'Newspaper', cat: 'Bills', amount: 450, type: 'expense', source: 'Cash', freq: 'monthly', due: null, last: '2026-08-06', autopay: false, active: true },
    { id: 'r7', desc: 'Netflix', cat: 'Entertainment', amount: 199, type: 'expense', source: 'Card', freq: 'monthly', due: null, last: '2026-07-14', autopay: true, active: false },
  ];
  // FinTrackr users you can invite (users directory), and a 3-person account for the Paid-by select.
  const directory = [
    { uid: 'u1', name: 'Ayushi Dongre', email: 'ayushi@fintrackr.app', initial: 'A', tint: 'person-b' },
    { uid: 'u2', name: 'Kartik Rao', email: 'kartik.rao@fintrackr.app', initial: 'K', tint: 'person-a' },
    { uid: 'u3', name: 'Ayaan Shah', email: 'ayaan@fintrackr.app', initial: 'A', tint: 'person-a' },
    { uid: 'u4', name: 'Aditi Verma', email: 'aditi.v@fintrackr.app', initial: 'A', tint: 'person-b' },
    { uid: 'u5', name: 'Rohan Mehta', email: 'rohan@fintrackr.app', initial: 'R', tint: 'person-a' },
  ];
  const flatMembers = [
    { key: 'samay', name: 'Samay', sub: 'You', initial: 'S', tint: 'person-me' },
    { key: 'ayushi', name: 'Ayushi', sub: 'ayushi@fintrackr.app', initial: 'A', tint: 'person-b' },
    { key: 'kartik', name: 'Kartik', sub: 'kartik.rao@fintrackr.app', initial: 'K', tint: 'person-a' },
  ];
  const freqLabel = { daily: 'Daily', weekly: 'Weekly', 'bi-weekly': 'Every 2 weeks', monthly: 'Monthly', yearly: 'Yearly' };

  // Notifications (existing `notifications` fields: type, title, body, accountId, status, actionData.actions, createdAt).
  const notifications = [
    { id: 'n1', type: 'ACCOUNT_INVITE', title: 'Kartik invited you to “Flat 3B”', body: 'Shared account · 3 members. You can leave any time.', account: null, at: '2026-10-23T09:10', status: 'UNREAD', actions: ['ACCEPT', 'REJECT'] },
    { id: 'n2', type: 'RECURRING_DUE', title: 'Airtel Wi-Fi is due in 2 days', body: '₹1,178 on 25 Oct. Auto-pay will record it.', account: 'ghar', at: '2026-10-23T08:00', status: 'UNREAD', actions: [] },
    { id: 'n3', type: 'BUDGET_WARNING', title: 'Bills is at 92%', body: '₹3,100 left in Bills for the next 8 days.', account: 'ghar', at: '2026-10-23T07:30', status: 'UNREAD', actions: [] },
    { id: 'n4', type: 'PAYMENT_REMINDER', title: 'Newspaper has no next date', body: 'Payments since 6 Aug were not recorded. Set the next date or mark one paid.', account: 'ghar', at: '2026-10-22T09:00', status: 'READ', actions: ['MARK_PAID'] },
    { id: 'n5', type: 'RECURRING_AUTOPAID', title: 'Payment processed', body: '₹5,000 deducted from Personal for Mutual funds.', account: 'personal', at: '2026-10-04T06:00', status: 'READ', actions: [] },
    { id: 'n6', type: 'MONTH_END_SUMMARY', title: 'Month in review · September 2026', body: 'You saved about 49% of income in September.', account: 'personal', at: '2026-10-01T08:00', status: 'READ', actions: [] },
    { id: 'n7', type: 'ACCOUNT_INVITE_ACCEPTED', title: 'Ayushi joined Ghar', body: 'You can now split and track household spending together.', account: 'ghar', at: '2026-09-28T19:20', status: 'ACTION_TAKEN', actions: [] },
  ];

  const balance = 18846.17;

  // ---------- derived ----------
  const sum = (rows) => rows.reduce((s, r) => s + r.amount, 0);
  const expenses = tx.filter((t) => t.type === 'expense');
  const incomes = tx.filter((t) => t.type === 'income');
  const spent = sum(expenses);
  const shares = Object.keys(people).map((k) => ({ key: k, ...people[k], amount: sum(incomes.filter((t) => t.by === k)) }));
  const pot = sum(incomes);
  const planned = Object.values(categories).reduce((s, c) => s + c.planned, 0);
  const left = planned - spent;
  const monthEnd = new Date(2026, 9, 31);
  const daysLeft = Math.round((monthEnd - today) / 86400000);
  const perDay = Math.floor(left / daysLeft);
  // Even pace: what a steady spend would have used by today (23 of 31 days).
  const pace = Math.round((planned * today.getDate()) / monthEnd.getDate());
  const paceDiff = spent - pace;
  const plan = Object.entries(categories)
    .filter(([, c]) => c.planned > 0)
    .map(([name, c]) => ({ name, ...c, spent: sum(expenses.filter((t) => t.cat === name)) }))
    .sort((a, b) => b.spent / b.planned - a.spent / a.planned);
  const paidBy = Object.keys(people).map((k) => ({ key: k, ...people[k], amount: sum(expenses.filter((t) => t.by === k)) }));
  const dueNext = recurring.filter((r) => r.active && r.due === '2026-11-05');

  // ---------- the facts that must agree ----------
  console.assert(spent === 44629, 'October spend should be ₹44,629', spent);
  console.assert(pot === 60000 && planned === 60000, 'two ₹30,000 shares fund the ₹60,000 plan');
  console.assert(left === 15371, 'left should be ₹15,371', left);
  console.assert(daysLeft === 8, '8 days left after 23 Oct', daysLeft);
  console.assert(pace === 44516 && paceDiff === 113, 'even pace by 23 Oct is ₹44,516', pace);
  console.assert(plan.reduce((s, p) => s + p.spent, 0) === spent, 'categories sum to the total');
  console.assert(paidBy.reduce((s, p) => s + p.amount, 0) === spent, 'payers sum to the total');

  // ---------- formatting (one place, one style) ----------
  const inr = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
  const inr2 = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const money = (v, d = 0) => '₹' + (d ? inr2 : inr).format(v);
  const signed = (t) => (t.type === 'income' ? '+' : '') + money(t.amount);
  const d = (iso) => new Date(iso + 'T00:00:00');
  const dayLabel = (iso) => {
    const diff = Math.round((today - d(iso)) / 86400000);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Yesterday';
    return d(iso).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
  };
  const shortDate = (iso) => d(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  const inDays = (iso) => Math.round((d(iso) - today) / 86400000);
  const longDate = (iso) => d(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  const pct = (a, b) => Math.round((a / b) * 100);
  // Budget usage tone: neutral below 80%, warning from 80% (the same threshold as the server's
  // BUDGET_WARNING notification), negative over plan. Text and bar share it.
  const tone = (s, p) => (s > p ? 'over' : s / p >= 0.8 ? 'warn' : 'ok');

  return {
    today, people, me, accounts, categories, tx, recurring, balance,
    spent, pot, planned, left, daysLeft, perDay, pace, paceDiff, plan, paidBy, shares, dueNext,
    freqLabel, notifications, directory, flatMembers,
    money, signed, dayLabel, shortDate, inDays, pct, tone, sum, longDate,
  };
})();
