import { Injectable, computed, signal } from '@angular/core';
import { AuthState } from './auth.types';
import { AuthenticatedUser } from '@core/models/user-account.model';

const INITIAL_STATE: AuthState = {
  status: 'anonymous',
  user: null,
  token: null,
};

@Injectable({
  providedIn: 'root',
})
export class AuthStore {
  private readonly stateSig = signal<AuthState>(INITIAL_STATE);

  readonly state = computed(() => this.stateSig());
  readonly status = computed(() => this.stateSig().status);
  readonly user = computed(() => this.stateSig().user);
  readonly token = computed(() => this.stateSig().token);
  readonly isAuthenticated = computed(
    () => this.stateSig().status === 'authenticated' && !!this.stateSig().token,
  );

  setAuthenticating(): void {
    const current = this.stateSig();
    this.stateSig.set({
      ...current,
      status: 'authenticating',
    });
  }

  setAuthenticated(token: string, user: AuthenticatedUser): void {
    this.stateSig.set({
      status: 'authenticated',
      token,
      user,
    });
  }

  setAnonymous(): void {
    this.stateSig.set(INITIAL_STATE);
  }
}

