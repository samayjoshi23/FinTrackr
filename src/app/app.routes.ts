import { Routes } from '@angular/router';
import { authGuard } from '../core/guards/auth.guard';

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
    canActivate: [authGuard],
    loadComponent: () => import('./../core/auth/onboarding/onboarding').then((m) => m.Onboarding),
  },
  {
    path: 'user',
    loadComponent: () => import('./../features/features').then((m) => m.Features),
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
    ],
  },
  {
    path: '**',
    redirectTo: 'login',
    pathMatch: 'full',
  },
];
