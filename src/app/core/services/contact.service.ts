import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { environment } from '@env';
import { Contact } from '@core/models/contact.model';
import { Observable, of } from 'rxjs';
import { map, shareReplay, tap } from 'rxjs/operators';

interface ContactQueryOptions {
  forceRefresh?: boolean;
  developerId?: string;
  projectId?: string;
  cameraId?: string;
}

@Injectable({
  providedIn: 'root',
})
export class ContactService {
  private readonly baseUrl = `${environment.apiUrl}/contacts`;

  private cache: Contact[] | null = null;
  private request$?: Observable<Contact[]>;

  constructor(private readonly http: HttpClient) {}

  getAll(options: ContactQueryOptions = {}): Observable<Contact[]> {
    const { forceRefresh = false, developerId, projectId, cameraId } = options;

    if (this.cache && !forceRefresh && !developerId && !projectId && !cameraId) {
      return of(this.cache);
    }

    let params = new HttpParams();
    if (developerId) {
      params = params.set('developerId', developerId);
    }
    if (projectId) {
      params = params.set('projectId', projectId);
    }
    if (cameraId) {
      params = params.set('cameraId', cameraId);
    }

    if (!this.request$ || forceRefresh || developerId || projectId || cameraId) {
      this.request$ = this.http.get<Contact[]>(this.baseUrl, { params }).pipe(
        tap((contacts) => {
          if (!developerId && !projectId && !cameraId) {
            this.cache = contacts;
          }
        }),
        shareReplay(1),
      );
    }

    return this.request$;
  }

  getById(id: string): Observable<Contact | undefined> {
    return this.http.get<Contact>(`${this.baseUrl}/${id}`).pipe(
      map((contact) => contact),
    );
  }

  create(contact: Partial<Contact>): Observable<Contact> {
    this.clearCache();
    return this.http.post<Contact>(`${this.baseUrl}/`, contact);
  }

  update(id: string, contact: Partial<Contact>): Observable<Contact> {
    this.clearCache();
    return this.http.put<Contact>(`${this.baseUrl}/${id}`, contact);
  }

  delete(id: string): Observable<void> {
    this.clearCache();
    return this.http.delete<void>(`${this.baseUrl}/${id}`);
  }

  clearCache(): void {
    this.cache = null;
    this.request$ = undefined;
  }
}

