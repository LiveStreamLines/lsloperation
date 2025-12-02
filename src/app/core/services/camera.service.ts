import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '@env';
import {
  Camera,
  CameraHealthResponse,
  CameraHistoryPreviewResponse,
  CameraHistoryResponse,
  CameraHistoryVideoResponse,
  CameraLastPicture,
  CameraStatusHistory,
} from '@core/models/camera.model';
import { Observable, of } from 'rxjs';
import { catchError, map, shareReplay, tap } from 'rxjs/operators';

@Injectable({
  providedIn: 'root',
})
export class CameraService {
  private readonly baseUrl = `${environment.apiUrl}/cameras`;
  private readonly cameraPicsUrl = `${environment.apiUrl}/camerapics`;
  private readonly getImageUrl = `${environment.apiUrl}/get-image`;
  private readonly mediaBase = environment.apiUrl.replace(/\/api\/?$/, '/');
  private readonly healthBase = environment.apiUrl.replace(/\/api\/?$/, '/');

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

  getByDeveloper(developerId: string): Observable<Camera[]> {
    if (!developerId) {
      return of([]);
    }

    return this.http.get<Camera[]>(`${this.baseUrl}/dev/${developerId}`).pipe(
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

  getLastPictures(): Observable<CameraLastPicture[]> {
    return this.http.get<CameraLastPicture[]>(`${this.baseUrl}/pics/last`);
  }

  create(payload: Partial<Camera> | FormData): Observable<Camera> {
    return this.http.post<Camera>(this.baseUrl, payload).pipe(
      tap(() => {
        this.clearCache();
      }),
    );
  }

  update(cameraId: string, payload: Partial<Camera> | FormData): Observable<Camera> {
    return this.http.put<Camera>(`${this.baseUrl}/${cameraId}`, payload).pipe(
      tap(() => {
        this.clearCache();
      }),
    );
  }

  updateStatus(cameraId: string, status: string): Observable<Camera> {
    return this.update(cameraId, { status });
  }

  getHistoryPictures(
    developerTag: string,
    projectTag: string,
    cameraName: string,
    payload?: { date1?: string; date2?: string },
  ): Observable<CameraHistoryResponse> {
    const url = `${this.cameraPicsUrl}/${encodeURIComponent(developerTag)}/${encodeURIComponent(projectTag)}/${encodeURIComponent(cameraName)}/pictures/`;
    return this.http.post<CameraHistoryResponse>(url, payload ?? {}).pipe(
      map((response) => this.normalizeHistoryResponse(response)),
    );
  }

  getHistoryPreview(
    developerTag: string,
    projectTag: string,
    cameraName: string,
  ): Observable<CameraHistoryPreviewResponse> {
    const url = `${this.cameraPicsUrl}/preview/${encodeURIComponent(developerTag)}/${encodeURIComponent(projectTag)}/${encodeURIComponent(cameraName)}/`;
    return this.http.get<CameraHistoryPreviewResponse>(url).pipe(
      map((response) => this.normalizePreviewResponse(response)),
    );
  }

  generateHistoryVideo(
    developerTag: string,
    projectTag: string,
    cameraName: string,
  ): Observable<CameraHistoryVideoResponse> {
    const url = `${this.cameraPicsUrl}/preview-video/${encodeURIComponent(developerTag)}/${encodeURIComponent(projectTag)}/${encodeURIComponent(cameraName)}/`;
    return this.http.get<CameraHistoryVideoResponse>(url).pipe(
      map((response) => this.normalizeVideoResponse(response)),
    );
  }

  getHealth(
    developerTag: string,
    projectTag: string,
    cameraName: string,
  ): Observable<CameraHealthResponse | null> {
    if (!developerTag || !projectTag || !cameraName) {
      return of({ 
        developerId: developerTag, 
        projectId: projectTag, 
        cameraId: cameraName, 
        totalImages: 0,
        error: 'Missing required parameters' 
      } as CameraHealthResponse);
    }
    const url = `${this.healthBase}health/camera/${encodeURIComponent(developerTag)}/${encodeURIComponent(projectTag)}/${encodeURIComponent(cameraName)}`;
    return this.http.get<CameraHealthResponse>(url).pipe(
      catchError((error) => {
        // Return error response instead of null so the UI can display it
        return of({ 
          developerId: developerTag, 
          projectId: projectTag, 
          cameraId: cameraName, 
          totalImages: 0,
          error: error?.error?.error || error?.message || 'Health data unavailable' 
        } as CameraHealthResponse);
      }),
    );
  }

  deleteHistoryImage(
    developerTag: string,
    projectTag: string,
    cameraName: string,
    imageTimestamp: string,
  ): Observable<{ message?: string; error?: string }> {
    const url = `${this.getImageUrl}/${encodeURIComponent(developerTag)}/${encodeURIComponent(projectTag)}/${encodeURIComponent(cameraName)}/${encodeURIComponent(imageTimestamp)}`;
    return this.http.delete<{ message?: string; error?: string }>(url);
  }

  updateMaintenanceStatus(
    cameraId: string,
    payload: { photoDirty?: boolean; lowImages?: boolean; betterView?: boolean; wrongTime?: boolean },
  ): Observable<Camera> {
    return this.http.put<Camera>(`${this.baseUrl}/${cameraId}/maintenance-status`, payload).pipe(
      tap(() => {
        this.clearCache();
      }),
    );
  }

  getStatusHistory(cameraId?: string): Observable<CameraStatusHistory[]> {
    if (cameraId) {
      return this.http.get<CameraStatusHistory[]>(`${environment.apiUrl}/camera-status-history/${cameraId}`);
    }
    return this.http.get<CameraStatusHistory[]>(`${environment.apiUrl}/camera-status-history`);
  }

  getCurrentStatusFromHistory(cameraId: string): Observable<{
    currentStatus: {
      photoDirty: boolean;
      betterView: boolean;
      lowImages: boolean;
      wrongTime: boolean;
      shutterExpiry: boolean;
      deviceExpiry: boolean;
    };
    statusMetadata: {
      photoDirty: {
        isActive: boolean;
        markedBy: string | null;
        markedAt: string | null;
        markedByEmail: string | null;
        removedBy: string | null;
        removedAt: string | null;
        removedByEmail: string | null;
      } | null;
      betterView: {
        isActive: boolean;
        markedBy: string | null;
        markedAt: string | null;
        markedByEmail: string | null;
        removedBy: string | null;
        removedAt: string | null;
        removedByEmail: string | null;
      } | null;
      lowImages: {
        isActive: boolean;
        markedBy: string | null;
        markedAt: string | null;
        markedByEmail: string | null;
        removedBy: string | null;
        removedAt: string | null;
        removedByEmail: string | null;
      } | null;
      wrongTime: {
        isActive: boolean;
        markedBy: string | null;
        markedAt: string | null;
        markedByEmail: string | null;
        removedBy: string | null;
        removedAt: string | null;
        removedByEmail: string | null;
      } | null;
      shutterExpiry: {
        isActive: boolean;
        markedBy: string | null;
        markedAt: string | null;
        markedByEmail: string | null;
        removedBy: string | null;
        removedAt: string | null;
        removedByEmail: string | null;
      } | null;
      deviceExpiry: {
        isActive: boolean;
        markedBy: string | null;
        markedAt: string | null;
        markedByEmail: string | null;
        removedBy: string | null;
        removedAt: string | null;
        removedByEmail: string | null;
      } | null;
    };
  }> {
    return this.http.get<{
      currentStatus: {
        photoDirty: boolean;
        betterView: boolean;
        lowImages: boolean;
        wrongTime: boolean;
        shutterExpiry: boolean;
        deviceExpiry: boolean;
      };
      statusMetadata: any;
    }>(`${environment.apiUrl}/camera-status-history/${cameraId}/current-status`);
  }

  getMaintenanceCycleStartDate(): Observable<{ cycleStartDate: string | null }> {
    return this.http.get<{ cycleStartDate: string | null }>(`${this.baseUrl}/maintenance-cycle/start-date`);
  }

  deleteInternalAttachment(cameraId: string, attachmentId: string): Observable<Camera> {
    return this.http.delete<Camera>(`${this.baseUrl}/${cameraId}/internal-attachments/${attachmentId}`).pipe(
      tap(() => {
        this.clearCache();
      }),
    );
  }

  uploadInternalAttachment(cameraId: string, file: File): Observable<Camera> {
    const formData = new FormData();
    formData.append('file', file);
    return this.http.post<Camera>(`${this.baseUrl}/${cameraId}/internal-attachments`, formData).pipe(
      tap(() => {
        this.clearCache();
      }),
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

  private normalizeHistoryResponse(response: CameraHistoryResponse): CameraHistoryResponse {
    if (!response || response.error) {
      return response;
    }

    return {
      ...response,
      path: this.normalizeMediaPath(response.path),
    };
  }

  private normalizePreviewResponse(response: CameraHistoryPreviewResponse): CameraHistoryPreviewResponse {
    if (!response || response.error) {
      return response;
    }

    return {
      ...response,
      path: this.normalizeMediaPath(response.path),
    };
  }

  private normalizeVideoResponse(response: CameraHistoryVideoResponse): CameraHistoryVideoResponse {
    if (!response || response.error) {
      return response;
    }

    return {
      ...response,
      videoPath: this.normalizeMediaPath(response.videoPath) ?? response.videoPath,
    };
  }

  private normalizeMediaPath(path: string | undefined | null): string | undefined {
    if (!path) {
      return undefined;
    }

    try {
      const base = new URL(this.mediaBase);
      const resolved = new URL(path, base);

      resolved.protocol = 'https:';

      if (!resolved.pathname.startsWith('/backend/')) {
        resolved.pathname = `/backend${resolved.pathname.startsWith('/') ? resolved.pathname : `/${resolved.pathname}`}`;
      }

      return resolved.toString();
    } catch {
      const sanitized = path.replace(/^https?:/i, 'https:');
      return sanitized.includes('/backend/')
        ? sanitized
        : `${this.mediaBase.replace(/\/?$/, '')}/backend/${sanitized.replace(/^\//, '')}`;
    }
  }
}

