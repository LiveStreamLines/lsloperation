import { CommonModule } from '@angular/common';
import {
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { EMPTY, forkJoin, of } from 'rxjs';
import { catchError, filter, map, switchMap, tap } from 'rxjs/operators';
import {
  Camera,
  CameraHistoryPreviewResponse,
  CameraHistoryResponse,
  CameraHistoryVideoResponse,
} from '@core/models/camera.model';
import { Developer } from '@core/models/developer.model';
import { Project } from '@core/models/project.model';
import { CameraService } from '@core/services/camera.service';
import { DeveloperService } from '@core/services/developer.service';
import { ProjectService } from '@core/services/project.service';
import { environment } from '@env';
import { Maintenance } from '@core/models/maintenance.model';
import { MaintenanceService } from '@core/services/maintenance.service';
import { InventoryItem } from '@core/models/inventory.model';
import { InventoryService } from '@core/services/inventory.service';
import { User } from '@core/models/user.model';
import { UserService } from '@core/services/user.service';

interface CameraHistoryTags {
  developerTag: string;
  projectTag: string;
  cameraName: string;
}

@Component({
  selector: 'app-camera-history',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './camera-history.component.html',
})
export class CameraHistoryComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private readonly cameraService = inject(CameraService);
  private readonly developerService = inject(DeveloperService);
  private readonly projectService = inject(ProjectService);
  private readonly maintenanceService = inject(MaintenanceService);
  private readonly inventoryService = inject(InventoryService);
  private readonly userService = inject(UserService);
  private readonly mediaBase = environment.apiUrl.replace(/\/api\/?$/, '/');

  readonly isLoading = signal(true);
  readonly isFetchingHistory = signal(false);
  readonly isGeneratingVideo = signal(false);
  readonly errorMessage = signal<string | null>(null);

  readonly camera = signal<Camera | null>(null);
  readonly developer = signal<Developer | null>(null);
  readonly project = signal<Project | null>(null);
  readonly history = signal<CameraHistoryResponse | null>(null);
  readonly preview = signal<CameraHistoryPreviewResponse | null>(null);
  readonly maintenanceTasks = signal<Maintenance[]>([]);
  readonly cameraInventory = signal<InventoryItem[]>([]);
  readonly users = signal<User[]>([]);

  readonly dateStart = signal<string>('');
  readonly dateEnd = signal<string>('');
  readonly appliedDate1 = signal<string>('');
  readonly appliedDate2 = signal<string>('');

  readonly toast = signal<{ message: string; tone: 'success' | 'error' } | null>(null);

  readonly hasHistory = computed(() => {
    const data = this.history();
    return !!data && !data.error;
  });

  readonly hasPreview = computed(() => {
    const data = this.preview();
    return !!data && !data.error && !!data.weeklyImages?.length;
  });

  readonly sortedMaintenanceTasks = computed(() => {
    const tasks = [...this.maintenanceTasks()];
    tasks.sort((a, b) => {
      const aTime = this.maintenanceTimestamp(a)?.getTime() ?? 0;
      const bTime = this.maintenanceTimestamp(b)?.getTime() ?? 0;
      return bTime - aTime;
    });
    return tasks;
  });

  readonly hasMaintenanceHistory = computed(() => this.sortedMaintenanceTasks().length > 0);

  readonly userMap = computed(() => {
    const map = new Map<string, User>();
    for (const user of this.users()) {
      if (user?._id) {
        map.set(user._id, user);
      }
    }
    return map;
  });

  readonly firstPhotoUrl = computed(() => {
    const data = this.history();
    if (!data?.firstPhoto || !data.path) {
      return null;
    }
    return this.buildHistoryImageUrl(data.firstPhoto);
  });

  readonly lastPhotoUrl = computed(() => {
    const data = this.history();
    if (!data?.lastPhoto || !data.path) {
      return null;
    }
    return this.buildHistoryImageUrl(data.lastPhoto);
  });

  ngOnInit(): void {
    this.userService
      .getAll()
      .pipe(takeUntilDestroyed(this.destroyRef), catchError(() => of<User[]>([])))
      .subscribe((users) => this.users.set(users));

    this.route.paramMap
      .pipe(
        map((params) => params.get('cameraId')),
        filter((cameraId): cameraId is string => cameraId !== null && cameraId.length > 0),
        switchMap((cameraId) => this.loadCamera(cameraId)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe();
  }

  buildHistoryImageUrl(filename: string | undefined | null): string | null {
    const data = this.history();
    if (!data?.path || !filename) {
      return null;
    }
    const baseUrl = this.normalizeMediaPath(data.path);
    if (!baseUrl) {
      return null;
    }
    return this.appendFilename(baseUrl, filename);
  }

  buildPreviewImageUrl(filename: string): string | null {
    const data = this.preview();
    if (!data?.path) {
      return null;
    }
    const baseUrl = this.normalizeMediaPath(data.path);
    if (!baseUrl) {
      return null;
    }
    return this.appendFilename(baseUrl, filename);
  }

  loadHistoryForDates(): void {
    const tags = this.getCameraTags();
    if (!tags) {
      this.showToast('Camera location information is missing.', 'error');
      return;
    }

    const date1 = this.toBackendDate(this.dateStart());
    const date2 = this.toBackendDate(this.dateEnd());
    const payload: { date1?: string; date2?: string } = {};
    if (date1) {
      payload.date1 = date1;
    }
    if (date2) {
      payload.date2 = date2;
    }

    this.isFetchingHistory.set(true);
    this.cameraService
      .getHistoryPictures(tags.developerTag, tags.projectTag, tags.cameraName, payload)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          if (response.error) {
            this.showToast(response.error, 'error');
            this.isFetchingHistory.set(false);
            return;
          }

          this.history.set(response);
          const firstDate = this.extractDateFromFilename(response.firstPhoto) || this.dateStart();
          const lastDate = this.extractDateFromFilename(response.lastPhoto) || this.dateEnd();

          this.appliedDate1.set(date1 ? this.fromBackendDate(date1) : firstDate);
          this.appliedDate2.set(date2 ? this.fromBackendDate(date2) : lastDate);

          // Refresh preview in case new dates are chosen
          this.refreshPreview(tags);

          this.isFetchingHistory.set(false);
          this.showToast('Camera history updated.', 'success');
        },
        error: () => {
          this.showToast('Unable to load camera history.', 'error');
          this.isFetchingHistory.set(false);
        },
      });
  }

  generateWeeklyVideo(): void {
    const tags = this.getCameraTags();
    if (!tags) {
      this.showToast('Camera location information is missing.', 'error');
      return;
    }

    this.isGeneratingVideo.set(true);
    this.cameraService
      .generateHistoryVideo(tags.developerTag, tags.projectTag, tags.cameraName)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          if (response.error || !response.videoPath) {
            this.showToast(response.error ?? 'Unable to generate weekly video.', 'error');
            this.isGeneratingVideo.set(false);
            return;
          }

          const videoUrl = this.normalizeMediaPath(response.videoPath);
          if (videoUrl) {
            window.open(videoUrl, '_blank', 'noopener');
          } else {
            this.showToast('Unable to resolve video URL.', 'error');
          }
          this.isGeneratingVideo.set(false);
          this.showToast('Weekly video generated.', 'success');
        },
        error: () => {
          this.showToast('Unable to generate weekly video.', 'error');
          this.isGeneratingVideo.set(false);
        },
      });
  }

  dismissToast(): void {
    this.toast.set(null);
  }

  private loadCamera(cameraId: string) {
    this.isLoading.set(true);
    this.errorMessage.set(null);

    return this.cameraService.getById(cameraId).pipe(
      switchMap((camera) => {
        if (!camera) {
          throw new Error('Camera not found.');
        }

        this.camera.set(camera);

        const developerId = this.extractId(camera.developer);
        const projectId = this.extractId(camera.project);
        const cameraIdRef = camera._id;

        return forkJoin({
          developer: developerId ? this.developerService.getById(developerId) : of(undefined),
          project: projectId ? this.projectService.getById(projectId) : of(undefined),
          inventory: this.inventoryService
            .getByCamera(cameraIdRef, camera.camera)
            .pipe(catchError(() => of<InventoryItem[]>([]))),
        }).pipe(
          switchMap(({ developer, project, inventory }) => {
            this.developer.set(developer ?? null);
            this.project.set(project ?? null);
            this.cameraInventory.set(inventory ?? []);

            const tags = this.resolveTags(camera, developer ?? null, project ?? null);
            if (!tags) {
              throw new Error('Unable to resolve camera location.');
            }

            return forkJoin({
              history: this.cameraService.getHistoryPictures(tags.developerTag, tags.projectTag, tags.cameraName),
              preview: this.cameraService
                .getHistoryPreview(tags.developerTag, tags.projectTag, tags.cameraName)
                .pipe(catchError(() => of<CameraHistoryPreviewResponse | null>(null))),
              maintenance: this.maintenanceService
                .getByCamera(camera._id)
                .pipe(catchError(() => of<Maintenance[]>([]))),
            }).pipe(
              tap(({ history, preview, maintenance }) => {
                if (history.error) {
                  throw new Error(history.error);
                }

                this.history.set(history);
                this.preview.set(preview);
                this.maintenanceTasks.set(maintenance ?? []);

                const firstDate = this.extractDateFromFilename(history.firstPhoto);
                const lastDate = this.extractDateFromFilename(history.lastPhoto);
                this.dateStart.set(firstDate);
                this.dateEnd.set(lastDate);
                this.appliedDate1.set(firstDate);
                this.appliedDate2.set(lastDate);
              }),
              map(() => undefined),
            );
          }),
        );
      }),
      tap({
        next: () => {
          this.isLoading.set(false);
        },
      }),
      catchError((error) => {
        this.isLoading.set(false);
        this.errorMessage.set(error?.message ?? 'Unable to load camera history.');
        return EMPTY;
      }),
    );
  }

  private refreshPreview(tags: CameraHistoryTags): void {
    this.cameraService
      .getHistoryPreview(tags.developerTag, tags.projectTag, tags.cameraName)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        catchError(() => of<CameraHistoryPreviewResponse | null>(null)),
      )
      .subscribe((preview) => {
        this.preview.set(preview);
      });
  }

  private getCameraTags(): CameraHistoryTags | null {
    const camera = this.camera();
    const developer = this.developer();
    const project = this.project();
    if (!camera) {
      return null;
    }

    const tags = this.resolveTags(camera, developer, project);
    return tags;
  }

  private resolveTags(
    camera: Camera,
    developer: Developer | null,
    project: Project | null,
  ): CameraHistoryTags | null {
    const developerTag =
      (typeof camera.developer === 'object' && camera.developer?.developerTag) ||
      developer?.developerTag ||
      null;
    const projectTag =
      (typeof camera.project === 'object' && camera.project?.projectTag) || project?.projectTag || null;

    if (!developerTag || !projectTag) {
      return null;
    }

    return {
      developerTag,
      projectTag,
      cameraName: camera.camera,
    };
  }

  private extractId(reference: string | { _id?: string }): string | null {
    if (typeof reference === 'string') {
      return reference;
    }
    return reference?._id ?? null;
  }

  private extractDateFromFilename(filename: string | undefined): string {
    if (!filename || filename.length < 8) {
      return '';
    }
    const date = filename.slice(0, 8);
    return `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
  }

  private toBackendDate(value: string): string | undefined {
    if (!value) {
      return undefined;
    }
    return value.replace(/-/g, '');
  }

  private fromBackendDate(value: string): string {
    if (value.length !== 8) {
      return value;
    }
    return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
  }

  maintenanceTimestamp(task: Maintenance): Date | null {
    const timestamp = task.completionTime || task.startTime || task.dateOfRequest || task.createdDate;
    if (!timestamp) {
      return null;
    }
    const date = new Date(timestamp);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  formatMaintenanceTimestamp(task: Maintenance): string {
    const date = this.maintenanceTimestamp(task);
    if (!date) {
      return 'Unknown date';
    }
    return `${date.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })} ${date.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
    })}`;
  }

  maintenanceStatusTone(status: string | undefined): string {
    switch ((status ?? '').toLowerCase()) {
      case 'pending':
        return 'bg-amber-100 text-amber-700';
      case 'in-progress':
        return 'bg-sky-100 text-sky-700';
      case 'completed':
        return 'bg-emerald-100 text-emerald-700';
      case 'cancelled':
        return 'bg-rose-100 text-rose-700';
      default:
        return 'bg-slate-100 text-slate-600';
    }
  }

  assignedInventoryLabel(inventory: InventoryItem): string {
    const device = inventory.device ?? ({} as Record<string, unknown>);
    const name = (device['deviceName'] as string | undefined) || (device['model'] as string | undefined) || 'Device';
    const deviceType = device['type'] as string | undefined;
    const typeSuffix = deviceType ? ` (${deviceType})` : '';
    const serial = (device['serialNumber'] as string | undefined) ?? inventory._id;
    return `${name}${typeSuffix} • ${serial}`;
  }

  inventoryDeviceType(inventory: InventoryItem): string {
    const device = inventory.device ?? ({} as Record<string, unknown>);
    const deviceType = device['type'] as string | undefined;
    return deviceType ?? 'Unknown type';
  }

  inventoryDeviceModel(inventory: InventoryItem): string | undefined {
    const device = inventory.device ?? ({} as Record<string, unknown>);
    const model = device['model'] as string | undefined;
    return model ?? undefined;
  }

  inventoryDeviceSerial(inventory: InventoryItem): string {
    const device = inventory.device ?? ({} as Record<string, unknown>);
    const serial = device['serialNumber'] as string | undefined;
    return serial ?? inventory._id;
  }

  formatAssignedUsers(task: Maintenance): string {
    const names: string[] = [];
    const map = this.userMap();
    if (task.assignedUsers?.length) {
      for (const userId of task.assignedUsers) {
        const user = map.get(userId);
        names.push(user?.name ?? userId);
      }
    }

    if (!names.length && task.assignedUser) {
      const user = map.get(task.assignedUser);
      names.push(user?.name ?? task.assignedUser);
    }

    return names.join(', ');
  }

  private normalizeMediaPath(path: string | undefined | null): string | null {
    if (!path) {
      return null;
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

  private appendFilename(baseUrl: string, filename: string): string {
    let normalized = baseUrl.replace(/\/+$/, '/');
    if (!normalized.toLowerCase().endsWith('/thumbs/')) {
      normalized = `${normalized}thumbs/`;
    }
    return `${normalized}${filename}.jpg`;
  }

  private showToast(message: string, tone: 'success' | 'error'): void {
    this.toast.set({ message, tone });
    setTimeout(() => this.toast.set(null), 4000);
  }
}