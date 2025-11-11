import { inject } from '@angular/core';
import {
  CanActivateFn,
  CanMatchFn,
  Router,
  UrlTree,
} from '@angular/router';
import { AuthStore } from './auth.store';

function evaluateAuth(): boolean | UrlTree {
  const authStore = inject(AuthStore);
  const router = inject(Router);

  if (authStore.isAuthenticated()) {
    return true;
  }

  return router.createUrlTree(['/auth/login']);
}

export const authGuard: CanActivateFn = () => evaluateAuth();

export const authCanMatch: CanMatchFn = () => evaluateAuth();

