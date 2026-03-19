import { Routes } from '@angular/router';

export const routes: Routes = [
    {
        path: '',
        redirectTo: 'login',
        pathMatch: 'full'
    },
    {
        path: 'login',
        loadComponent: () => import('./../core/auth/login/login').then(m => m.Login)
    },
    {
        path: 'register',
        loadComponent: () => import('./../core/auth/signup/signup').then(m => m.Signup)
    },
    {
        path: '**',
        redirectTo: 'login',
        pathMatch: 'full'
    }
];
