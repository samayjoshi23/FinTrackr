import { Routes } from '@angular/router';
import { authGuard } from '../core/guards/auth.guard';
import { onboardingGuard } from '../core/guards/onboarding.guard';

export const routes: Routes = [
  {
    path: '',
    redirectTo: 'login',
    pathMatch: 'full',
  },
  {
    path: 'login',
    loadComponent: () => import('./../core/auth/login/login').then((m) => m.Login),
  },
  {
    path: 'register',
    loadComponent: () => import('./../core/auth/signup/signup').then((m) => m.Signup),
  },
  {
    path: 'onboarding',
    canActivate: [authGuard, onboardingGuard],
    loadComponent: () => import('./../core/auth/onboarding/onboarding').then((m) => m.Onboarding),
  },
  {
    path: 'user',
    loadComponent: () => import('./../features/features').then((m) => m.Features),
    canActivate: [authGuard],
    children: [
      {
        path: '',
        redirectTo: 'dashboard',
        pathMatch: 'full',
      },
      {
        path: 'dashboard',
        loadComponent: () =>
          import('./../features/home/dashboard/dashboard').then((m) => m.Dashboard),
      },
      {
        path: 'transactions/list',
        loadComponent: () =>
          import('./../features/transactions/pages/transaction-list/transaction-list').then(
            (m) => m.TransactionList,
          ),
      },
      {
        path: 'transactions/add',
        loadComponent: () =>
          import('./../features/transactions/pages/add-transaction/add-transaction').then(
            (m) => m.AddTransaction,
          ),
      },
      {
        path: 'budgets',
        loadComponent: () =>
          import('./../features/budgets/pages/budgets/budgets').then((m) => m.Budgets),
      },
      {
        path: 'budgets/new',
        loadComponent: () =>
          import('./../features/budgets/pages/new-budget/new-budget').then((m) => m.NewBudget),
      },
      {
        path: 'budgets/edit/:id',
        loadComponent: () =>
          import('./../features/budgets/pages/edit-budget/edit-budget').then((m) => m.EditBudget),
      },
      {
        path: 'goals',
        loadComponent: () => import('./../features/goals/pages/goals/goals').then((m) => m.Goals),
      },
      {
        path: 'goals/new',
        loadComponent: () =>
          import('./../features/goals/pages/new-goal/new-goal').then((m) => m.NewGoal),
      },
      {
        path: 'categories',
        loadComponent: () =>
          import('./../features/categories/pages/categories/categories').then((m) => m.Categories),
      },
      {
        path: 'categories/new',
        loadComponent: () =>
          import('./../features/categories/pages/new-category/new-category').then(
            (m) => m.NewCategory,
          ),
      },
      {
        path: 'categories/edit/:id',
        loadComponent: () =>
          import('./../features/categories/pages/edit-category/edit-category').then(
            (m) => m.EditCategory,
          ),
      },
      {
        path: 'recurring',
        loadComponent: () =>
          import('./../features/recurring/pages/recurring/recurring').then((m) => m.Recurring),
      },
      {
        path: 'recurring/view/:id',
        loadComponent: () =>
          import('./../features/recurring/pages/view-recurring/view-recurring').then(
            (m) => m.ViewRecurring,
          ),
      },
      {
        path: 'recurring/edit/:id',
        loadComponent: () =>
          import('./../features/recurring/pages/edit-recurring/edit-recurring').then(
            (m) => m.EditRecurring,
          ),
      },
      {
        path: 'reports',
        loadComponent: () =>
          import('./../features/reports/pages/reports/reports').then((m) => m.Reports),
      },
      {
        path: 'settings/notifications',
        loadComponent: () =>
          import('./../features/notifications/pages/notification-settings/notification-settings').then(
            (m) => m.NotificationSettings,
          ),
      },
      {
        path: 'notifications',
        loadComponent: () =>
          import('./../features/notifications/pages/notification-list/notification-list').then(
            (m) => m.NotificationList,
          ),
      },
      {
        path: 'settings',
        loadComponent: () =>
          import('./../features/settings/pages/global-settings/global-settings').then(
            (m) => m.GlobalSettings,
          ),
        children: [
          {
            path: '',
            pathMatch: 'full',
            loadComponent: () =>
              import('./../features/settings/pages/settings-home/settings-home').then(
                (m) => m.SettingsHome,
              ),
          },
          {
            path: 'accounts/new',
            loadComponent: () =>
              import('./../features/accounts/pages/create-account/create-account').then(
                (m) => m.CreateAccount,
              ),
          },
          {
            path: 'accounts/:id',
            loadComponent: () =>
              import('./../features/settings/pages/account-details/account-details').then(
                (m) => m.AccountDetails,
              ),
          },
          {
            path: 'privacy',
            loadComponent: () =>
              import('./../features/settings/pages/privacy-security/privacy-security').then(
                (m) => m.PrivacySecurity,
              ),
          },
          {
            path: '**',
            loadComponent: () =>
              import('./../core/pages/not-found/not-found').then((m) => m.NotFound),
          },
        ],
      },
      {
        path: '**',
        loadComponent: () =>
          import('./../core/pages/not-found/not-found').then((m) => m.NotFound),
      },
    ],
  },
  {
    path: '**',
    loadComponent: () =>
      import('./../core/pages/not-found/not-found').then((m) => m.NotFound),
  },
];
