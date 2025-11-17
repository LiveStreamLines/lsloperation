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

// Guard for camera monitor access - redirects to maintenance if no access
export const cameraMonitorGuard: CanActivateFn = () => {
  const authStore = inject(AuthStore);
  const router = inject(Router);
  const user = authStore.user();

  if (!user) {
    return router.createUrlTree(['/auth/login']);
  }

  // Super Admin has full access to everything
  const isSuperAdmin = user.role === 'Super Admin';
  
  // If user doesn't have camera monitor access and is not Super Admin, redirect to maintenance
  if (!isSuperAdmin && !(user as any).hasCameraMonitorAccess) {
    return router.createUrlTree(['/maintenance']);
  }

  return true;
};

