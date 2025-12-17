import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { environment } from '@env';
import { Task, TaskNote } from '@core/models/task.model';
import { Observable } from 'rxjs';

interface TaskQueryOptions {
  status?: 'open' | 'closed';
  assignee?: string;
  assigned?: string;
  type?: string;
}

@Injectable({
  providedIn: 'root',
})
export class TaskService {
  private readonly baseUrl = `${environment.apiUrl}/tasks`;

  constructor(private readonly http: HttpClient) {}

  getAll(options: TaskQueryOptions = {}): Observable<Task[]> {
    let params = new HttpParams();
    if (options.status) params = params.set('status', options.status);
    if (options.assignee) params = params.set('assignee', options.assignee);
    if (options.assigned) params = params.set('assigned', options.assigned);
    if (options.type) params = params.set('type', options.type);

    return this.http.get<Task[]>(this.baseUrl, { params });
  }

  getById(id: string): Observable<Task> {
    return this.http.get<Task>(`${this.baseUrl}/${id}`);
  }

  create(formData: FormData): Observable<Task> {
    return this.http.post<Task>(this.baseUrl, formData);
  }

  update(id: string, formData: FormData): Observable<Task> {
    return this.http.put<Task>(`${this.baseUrl}/${id}`, formData);
  }

  addNote(id: string, content: string, attachments: File[] = []): Observable<Task> {
    const formData = new FormData();
    formData.append('content', content);
    attachments.forEach((file) => {
      formData.append('attachments', file, file.name);
    });
    return this.http.post<Task>(`${this.baseUrl}/${id}/notes`, formData);
  }

  close(id: string): Observable<Task> {
    return this.http.post<Task>(`${this.baseUrl}/${id}/close`, {});
  }

  delete(id: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/${id}`);
  }
}

