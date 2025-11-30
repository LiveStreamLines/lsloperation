import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, map, throwError, tap, of } from 'rxjs';
import { environment } from '@env';
import { AuthStore } from './auth.store';
import { LoginRequest, LoginResponse } from './auth.types';
import { AuthenticatedUser, UserRole } from '@core/models/user-account.model';
import { TokenStorageService } from './token-storage.service';

type LegacyLoginResponse = Partial<LoginResponse> & {
  authh?: string;
  _id?: string;
  [key: string]: unknown;
};

@Injectable({
  providedIn: 'root',
})
export class AuthService {
  private readonly loginEndpoint = `${environment.apiUrl}/operation-auth/login`;
  private readonly logoutEndpoint = `${environment.apiUrl}/operation-auth/logout`;

  constructor(
    private readonly http: HttpClient,
    private readonly authStore: AuthStore,
    private readonly tokenStorage: TokenStorageService,
  ) {
    this.hydrateFromStorage();
  }

  login(payload: LoginRequest): Observable<AuthenticatedUser> {
    this.authStore.setAuthenticating();
    return this.http.post<LegacyLoginResponse>(this.loginEndpoint, payload).pipe(
      map((response) => {
        const token = this.extractToken(response);
        const normalizedUser = this.normalizeUser(response);

        this.persistSession(token, normalizedUser);
        return normalizedUser;
      }),
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

  private extractToken(response: LegacyLoginResponse): string {
    const token = response.token ?? response.authh;

    if (!token || typeof token !== 'string') {
      throw new Error('Login response did not include an auth token.');
    }

    return token;
  }

  private normalizeUser(response: LegacyLoginResponse): AuthenticatedUser {
    const {
      authh,
      token,
      _id,
      accessibleDevelopers,
      accessibleProjects,
      accessibleCameras,
      accessibleServices,
      createdDate,
      createdAt,
      LastLoginTime,
      lastLoginAt,
      name,
      email,
      role,
      ...rest
    } = response;

    const ensureArray = (value: unknown): string[] => {
      if (Array.isArray(value)) {
        return value.filter((item): item is string => typeof item === 'string');
      }

      if (typeof value === 'string' && value.length > 0) {
        return [value];
      }

      return [];
    };

    const normalizedRole = (role as UserRole | undefined) ?? 'Viewer';
    const restRecord = rest as Record<string, unknown>;

    const normalizedAccessibleDevelopers = ensureArray(
      accessibleDevelopers ?? restRecord['accessibleDeveloper'],
    );
    const normalizedAccessibleProjects = ensureArray(
      accessibleProjects ?? restRecord['accessibleProject'],
    );
    const normalizedAccessibleCameras = ensureArray(
      accessibleCameras ?? restRecord['accessibleCamera'],
    );
    const normalizedAccessibleServices = ensureArray(
      accessibleServices ?? restRecord['accessibleService'],
    );

    return {
      id: (_id as string) ?? (restRecord['id'] as string) ?? '',
      name: (name as string) ?? '',
      email: (email as string) ?? '',
      role: normalizedRole,
      accessibleDevelopers: normalizedAccessibleDevelopers,
      accessibleProjects: normalizedAccessibleProjects,
      accessibleCameras: normalizedAccessibleCameras,
      accessibleServices: normalizedAccessibleServices.length
        ? normalizedAccessibleServices
        : undefined,
      createdAt: (createdDate as string) ?? (createdAt as string),
      lastLoginAt: (LastLoginTime as string) ?? (lastLoginAt as string),
      ...restRecord,
    };
  }
}

