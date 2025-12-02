import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '@env';
import { Developer } from '@core/models/developer.model';
import { Observable, of } from 'rxjs';
import { map, shareReplay, tap } from 'rxjs/operators';

interface DeveloperQueryOptions {
  forceRefresh?: boolean;
  filterIds?: string[];
}

@Injectable({
  providedIn: 'root',
})
export class DeveloperService {
  private readonly baseUrl = `${environment.apiUrl}/developers`;

  private cache: Developer[] | null = null;
  private request$?: Observable<Developer[]>;

  constructor(private readonly http: HttpClient) {}

  getAll(options: DeveloperQueryOptions = {}): Observable<Developer[]> {
    const { forceRefresh = false, filterIds } = options;

    if (this.cache && !forceRefresh) {
      return of(this.applyFilter(this.cache, filterIds));
    }

    if (!this.request$ || forceRefresh) {
      this.request$ = this.http.get<Developer[]>(this.baseUrl).pipe(
        tap((developers) => {
          this.cache = developers;
        }),
        shareReplay(1),
      );
    }

    return this.request$.pipe(map((developers) => this.applyFilter(developers, filterIds)));
  }

  getById(id: string): Observable<Developer | undefined> {
    return this.getAll().pipe(map((developers) => developers.find((developer) => developer._id === id)));
  }

  getByTag(tag: string): Observable<Developer | undefined> {
    return this.getAll().pipe(
      map((developers) => developers.find((developer) => developer.developerTag === tag)),
    );
  }

  create(formData: FormData): Observable<Developer> {
    this.clearCache();
    return this.http.post<Developer>(`${this.baseUrl}/`, formData);
  }

  update(id: string, formData: FormData): Observable<Developer> {
    this.clearCache();
    return this.http.put<Developer>(`${this.baseUrl}/${id}`, formData);
  }

  deleteAttachment(developerId: string, attachmentId: string): Observable<Developer> {
    this.clearCache();
    return this.http.delete<Developer>(`${this.baseUrl}/${developerId}/attachments/${attachmentId}`);
  }

  clearCache(): void {
    this.cache = null;
    this.request$ = undefined;
  }

  private applyFilter(developers: Developer[], filterIds?: string[] | null): Developer[] {
    if (!filterIds || filterIds.length === 0 || filterIds.includes('all')) {
      return developers;
    }

    return developers.filter((developer) => filterIds.includes(developer._id));
  }
}

