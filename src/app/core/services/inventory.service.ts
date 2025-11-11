import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '@env';
import {
  InventoryAssignmentPayload,
  InventoryItem,
  InventoryUnassignRequest,
  InventoryUserAssignmentPayload,
} from '@core/models/inventory.model';
import { Observable, map } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class InventoryService {
  private readonly baseUrl = `${environment.apiUrl}/inventory`;

  constructor(private readonly http: HttpClient) {}

  getAll(): Observable<InventoryItem[]> {
    return this.http.get<InventoryItem[] | { success: boolean; data: InventoryItem[] }>(
      this.baseUrl,
    ).pipe(
      map((response) => {
        if (Array.isArray(response)) {
          return response;
        }

        if (response?.data && Array.isArray(response.data)) {
          return response.data;
        }

        return [];
      }),
    );
  }

  getById(id: string): Observable<InventoryItem> {
    return this.http.get<InventoryItem>(`${this.baseUrl}/${id}`);
  }

  create(item: Partial<InventoryItem>): Observable<InventoryItem> {
    return this.http.post<InventoryItem>(this.baseUrl, item);
  }

  update(id: string, item: Partial<InventoryItem>): Observable<InventoryItem> {
    return this.http.put<InventoryItem>(`${this.baseUrl}/${id}`, item);
  }

  assignToProject(itemId: string, assignment: InventoryAssignmentPayload): Observable<InventoryItem> {
    return this.http.patch<InventoryItem>(`${this.baseUrl}/assign/${itemId}`, assignment);
  }

  assignToUser(itemId: string, payload: InventoryUserAssignmentPayload): Observable<InventoryItem> {
    return this.http.patch<InventoryItem>(`${this.baseUrl}/assign-user/${itemId}`, payload);
  }

  unassignFromProject(itemId: string, reason: string): Observable<InventoryItem> {
    const payload: InventoryUnassignRequest = { reason };
    return this.http.patch<InventoryItem>(`${this.baseUrl}/unassign/${itemId}`, payload);
  }

  unassignFromUser(itemId: string, reason: string): Observable<InventoryItem> {
    const payload: InventoryUnassignRequest = { reason };
    return this.http.patch<InventoryItem>(`${this.baseUrl}/unassign-user/${itemId}`, payload);
  }

  removeAssignment(itemId: string): Observable<InventoryItem> {
    return this.http.patch<InventoryItem>(`${this.baseUrl}/${itemId}/remove`, {});
  }

  retireItem(itemId: string): Observable<InventoryItem> {
    return this.http.patch<InventoryItem>(`${this.baseUrl}/${itemId}/retire`, {});
  }

  findBySerial(serial: string): Observable<InventoryItem[]> {
    if (!serial) {
      return this.getAll();
    }
    return this.http.get<InventoryItem[] | { success: boolean; data: InventoryItem[] }>(
      `${this.baseUrl}/serial/${encodeURIComponent(serial)}`,
    ).pipe(
      map((response) => {
        if (Array.isArray(response)) {
          return response;
        }
        if (response?.data && Array.isArray(response.data)) {
          return response.data;
        }
        return [];
      }),
    );
  }
}

