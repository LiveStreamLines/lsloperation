import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '@env';
import { User } from '@core/models/user.model';
import { Observable, of } from 'rxjs';
import { map, shareReplay, tap } from 'rxjs/operators';

@Injectable({
  providedIn: 'root',
})
export class UserService {
  private readonly baseUrl = `${environment.apiUrl}/users`;

  private cache: User[] | null = null;
  private request$?: Observable<User[]>;

  constructor(private readonly http: HttpClient) {}

  getAll(forceRefresh = false): Observable<User[]> {
    if (this.cache && !forceRefresh) {
      return of(this.cache);
    }

    if (!this.request$ || forceRefresh) {
      this.request$ = this.http.get<User[]>(this.baseUrl).pipe(
        tap((users) => {
          this.cache = users;
        }),
        shareReplay(1),
      );
    }

    return this.request$;
  }

  getAdmins(forceRefresh = false): Observable<User[]> {
    return this.getAll(forceRefresh).pipe(
      map((users) =>
        users.filter((user) =>
          ['Super Admin', 'Admin'].includes((user.role || '').toString()),
        ),
      ),
    );
  }

  getById(id: string): Observable<User | undefined> {
    return this.getAll().pipe(map((users) => users.find((user) => user._id === id)));
  }

  create(payload: Partial<User>): Observable<User> {
    return this.http.post<User>(this.baseUrl, payload).pipe(
      tap(() => {
        this.clearCache();
      }),
    );
  }

  update(userId: string, payload: Partial<User>): Observable<User> {
    return this.http.put<User>(`${this.baseUrl}/${userId}`, payload).pipe(
      tap(() => {
        this.clearCache();
      }),
    );
  }

  sendResetPasswordLink(userId: string, email: string): Observable<void> {
    return this.http.post<void>(`${this.baseUrl}/${userId}/reset-password`, { email });
  }

  clearCache(): void {
    this.cache = null;
    this.request$ = undefined;
  }
}

