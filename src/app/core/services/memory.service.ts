import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '@env';
import {
  Memory,
  MemoryCreateRequest,
  MemoryFindRequest,
  MemoryFindResponse,
  MemoryUpdateRequest,
} from '@core/models/memory.model';
import { Observable } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class MemoryService {
  private readonly baseUrl = `${environment.apiUrl}/memories`;

  constructor(private readonly http: HttpClient) {}

  getAll(): Observable<Memory[]> {
    return this.http.get<Memory[]>(this.baseUrl);
  }

  getById(id: string): Observable<Memory> {
    return this.http.get<Memory>(`${this.baseUrl}/${id}`);
  }

  create(payload: MemoryCreateRequest): Observable<Memory> {
    return this.http.post<Memory>(this.baseUrl, payload);
  }

  update(id: string, payload: MemoryUpdateRequest): Observable<Memory> {
    return this.http.put<Memory>(`${this.baseUrl}/${id}`, payload);
  }

  findByInfo(payload: MemoryFindRequest): Observable<MemoryFindResponse> {
    return this.http.post<MemoryFindResponse>(`${this.baseUrl}/find/`, payload);
  }
}

