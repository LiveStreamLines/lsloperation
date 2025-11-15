import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '@env';
import {
  Maintenance,
  MaintenanceCreateRequest,
  MaintenanceUpdateRequest,
} from '@core/models/maintenance.model';
import { Observable } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class MaintenanceService {
  private readonly baseUrl = `${environment.apiUrl}/maintenance`;

  constructor(private readonly http: HttpClient) {}

  getAll(): Observable<Maintenance[]> {
    return this.http.get<Maintenance[]>(this.baseUrl);
  }

  getById(id: string): Observable<Maintenance> {
    return this.http.get<Maintenance>(`${this.baseUrl}/${id}`);
  }

  getByCamera(cameraId: string): Observable<Maintenance[]> {
    return this.http.get<Maintenance[]>(`${this.baseUrl}/camera/${cameraId}`);
  }

  create(payload: MaintenanceCreateRequest): Observable<Maintenance> {
    return this.http.post<Maintenance>(this.baseUrl, payload);
  }

  update(id: string, payload: MaintenanceUpdateRequest): Observable<Maintenance> {
    return this.http.put<Maintenance>(`${this.baseUrl}/${id}`, payload);
  }

  delete(id: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/${id}`);
  }

  startTask(id: string, payload: MaintenanceUpdateRequest = {}): Observable<Maintenance> {
    return this.update(id, {
      status: 'in-progress',
      startTime: new Date().toISOString(),
      ...payload,
    });
  }

  completeTask(
    id: string,
    comment: string,
    payload: MaintenanceUpdateRequest = {},
  ): Observable<Maintenance> {
    return this.update(id, {
      status: 'completed',
      completionTime: new Date().toISOString(),
      userComment: comment,
      ...payload,
    });
  }
}

