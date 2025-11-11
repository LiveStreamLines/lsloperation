import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '@env';
import { Camera } from '@core/models/camera.model';
import { Observable, of } from 'rxjs';
import { map, shareReplay, tap } from 'rxjs/operators';

@Injectable({
  providedIn: 'root',
})
export class CameraService {
  private readonly baseUrl = `${environment.apiUrl}/cameras`;

  private cache: Camera[] | null = null;
  private request$?: Observable<Camera[]>;

  constructor(private readonly http: HttpClient) {}

  getAll(forceRefresh = false): Observable<Camera[]> {
    if (this.cache && !forceRefresh) {
      return of(this.cache);
    }

    if (!this.request$ || forceRefresh) {
      this.request$ = this.http.get<Camera[]>(this.baseUrl).pipe(
        tap((cameras) => {
          this.cache = cameras;
        }),
        shareReplay(1),
      );
    }

    return this.request$;
  }

  getByProject(projectId: string): Observable<Camera[]> {
    if (!projectId) {
      return of([]);
    }

    return this.http.get<Camera[]>(`${this.baseUrl}/proj/${projectId}`).pipe(
      tap((cameras) => {
        this.mergeIntoCache(cameras);
      }),
    );
  }

  getById(id: string): Observable<Camera | undefined> {
    return this.getAll().pipe(map((cameras) => cameras.find((camera) => camera._id === id)));
  }

  getByTag(cameraTag: string): Observable<Camera | undefined> {
    return this.getAll().pipe(
      map((cameras) => cameras.find((camera) => camera.camera === cameraTag)),
    );
  }

  clearCache(): void {
    this.cache = null;
    this.request$ = undefined;
  }

  private mergeIntoCache(cameras: Camera[]): void {
    if (!this.cache) {
      this.cache = [...cameras];
      return;
    }

    const byId = new Map(this.cache.map((camera) => [camera._id, camera]));
    cameras.forEach((camera) => byId.set(camera._id, camera));
    this.cache = Array.from(byId.values());
  }
}

