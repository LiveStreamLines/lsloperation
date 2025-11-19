import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '@env';
import { Project, ProjectAttachment } from '@core/models/project.model';
import { Observable, of } from 'rxjs';
import { map, shareReplay, tap } from 'rxjs/operators';

@Injectable({
  providedIn: 'root',
})
export class ProjectService {
  private readonly baseUrl = `${environment.apiUrl}/projects`;
  private readonly byDeveloperUrl = `${environment.apiUrl}/projects/dev`;

  private cache: Project[] | null = null;
  private request$?: Observable<Project[]>;

  constructor(private readonly http: HttpClient) {}

  getAll(forceRefresh = false): Observable<Project[]> {
    if (this.cache && !forceRefresh) {
      return of(this.cache);
    }

    if (!this.request$ || forceRefresh) {
      this.request$ = this.http.get<Project[]>(this.baseUrl).pipe(
        tap((projects) => {
          this.cache = projects;
        }),
        shareReplay(1),
      );
    }

    return this.request$;
  }

  getByDeveloper(developerId: string): Observable<Project[]> {
    if (!developerId) {
      return of([]);
    }

    return this.http.get<Project[]>(`${this.byDeveloperUrl}/${developerId}`).pipe(
      tap((projects) => {
        this.mergeIntoCache(projects);
      }),
    );
  }

  getById(id: string): Observable<Project | undefined> {
    return this.getAll().pipe(map((projects) => projects.find((project) => project._id === id)));
  }

  getByTag(projectTag: string): Observable<Project | undefined> {
    return this.getAll().pipe(
      map((projects) => projects.find((project) => project.projectTag === projectTag)),
    );
  }

  clearCache(): void {
    this.cache = null;
    this.request$ = undefined;
  }

  getAttachments(projectId: string): Observable<ProjectAttachment[]> {
    if (!projectId) {
      return of([]);
    }
    return this.http.get<ProjectAttachment[]>(`${this.baseUrl}/${projectId}/attachments`);
  }

  uploadAttachment(projectId: string, file: File): Observable<ProjectAttachment> {
    const formData = new FormData();
    formData.append('file', file);
    return this.http.post<ProjectAttachment>(`${this.baseUrl}/${projectId}/attachments`, formData);
  }

  deleteAttachment(projectId: string, attachmentId: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/${projectId}/attachments/${attachmentId}`);
  }

  deleteInternalAttachment(projectId: string, attachmentId: string): Observable<Project> {
    this.clearCache();
    return this.http.delete<Project>(`${this.baseUrl}/${projectId}/internal-attachments/${attachmentId}`);
  }

  updateStatus(projectId: string, status: string): Observable<Project> {
    this.clearCache();
    return this.http.put<Project>(`${this.baseUrl}/${projectId}`, { status });
  }

  create(formData: FormData): Observable<Project> {
    this.clearCache();
    return this.http.post<Project>(`${this.baseUrl}/`, formData);
  }

  update(id: string, formData: FormData): Observable<Project> {
    this.clearCache();
    return this.http.put<Project>(`${this.baseUrl}/${id}`, formData);
  }

  updateBlockStatus(projectId: string, blocked: boolean): Observable<Project> {
    this.clearCache();
    return this.http.put<Project>(`${this.baseUrl}/${projectId}`, { blocked });
  }

  private mergeIntoCache(projects: Project[]): void {
    if (!this.cache) {
      this.cache = [...projects];
      return;
    }

    const byId = new Map(this.cache.map((project) => [project._id, project]));
    projects.forEach((project) => byId.set(project._id, project));
    this.cache = Array.from(byId.values());
  }
}

