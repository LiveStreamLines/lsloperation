import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '@env';
import { DeviceType } from '@core/models/device-type.model';
import { Observable } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class DeviceTypeService {
  private readonly baseUrl = `${environment.apiUrl}/device-types`;

  constructor(private readonly http: HttpClient) {}

  getAll(): Observable<DeviceType[]> {
    return this.http.get<DeviceType[]>(this.baseUrl);
  }

  getById(id: string): Observable<DeviceType> {
    return this.http.get<DeviceType>(`${this.baseUrl}/${id}`);
  }

  create(payload: Partial<DeviceType>): Observable<DeviceType> {
    return this.http.post<DeviceType>(this.baseUrl, payload);
  }

  update(id: string, payload: Partial<DeviceType>): Observable<DeviceType> {
    return this.http.put<DeviceType>(`${this.baseUrl}/${id}`, payload);
  }

  delete(id: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/${id}`);
  }
}

