import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, map, throwError, tap, of } from 'rxjs';
import { environment } from '@env';
import { AuthStore } from './auth.store';
import { LoginRequest, LoginResponse } from './auth.types';
import { AuthenticatedUser } from '@core/models/user-account.model';
import { TokenStorageService } from './token-storage.service';

@Injectable({
  providedIn: 'root',
})
export class AuthService {
  private readonly loginEndpoint = `${environment.apiUrl}/auth/login`;
  private readonly logoutEndpoint = `${environment.apiUrl}/auth/logout`;

  constructor(
    private readonly http: HttpClient,
    private readonly authStore: AuthStore,
    private readonly tokenStorage: TokenStorageService,
  ) {
    this.hydrateFromStorage();
  }

  login(payload: LoginRequest): Observable<AuthenticatedUser> {
    this.authStore.setAuthenticating();
    return this.http.post<LoginResponse>(this.loginEndpoint, payload).pipe(
      tap(({ token, user }) => {
        this.persistSession(token, user);
      }),
      map(({ user }) => user),
      catchError((error) => {
        this.authStore.setAnonymous();
        return throwError(() => error);
      }),
    );
  }

  logout(): Observable<void> {
    const token = this.tokenStorage.getToken();
    this.clearSession();

    if (!token) {
      return of(void 0);
    }

    return this.http
      .post<void>(
        this.logoutEndpoint,
        {},
      )
      .pipe(
        catchError(() => of(void 0)),
      );
  }

  getToken(): string | null {
    return this.authStore.token();
  }

  private hydrateFromStorage(): void {
    const token = this.tokenStorage.getToken();
    const user = this.tokenStorage.getUser<AuthenticatedUser>();

    if (token && user) {
      this.authStore.setAuthenticated(token, user);
    }
  }

  private persistSession(token: string, user: AuthenticatedUser): void {
    this.tokenStorage.saveToken(token);
    this.tokenStorage.saveUser(user);
    this.authStore.setAuthenticated(token, user);
  }

  private clearSession(): void {
    this.tokenStorage.clear();
    this.authStore.setAnonymous();
  }
}

