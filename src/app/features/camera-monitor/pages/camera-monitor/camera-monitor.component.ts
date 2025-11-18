import { CommonModule } from '@angular/common';
import {
  Component,
  DestroyRef,
  OnInit,
  computed,
  effect,
  inject,
  signal,
  HostListener,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { CameraHistoryComponent } from '@features/camera-history/pages/camera-history/camera-history.component';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { combineLatest, forkJoin, of, Observable } from 'rxjs';
import { catchError, finalize, map } from 'rxjs/operators';
import { environment } from '@env';
import {
  Camera,
  CameraHealthResponse,
  CameraLastPicture,
} from '@core/models/camera.model';
import { CameraService } from '@core/services/camera.service';
import { Developer } from '@core/models/developer.model';
import { DeveloperService } from '@core/services/developer.service';
import { Project, ProjectAttachment } from '@core/models/project.model';
import { ProjectService } from '@core/services/project.service';
import { User } from '@core/models/user.model';
import { UserService } from '@core/services/user.service';
import {
  Maintenance,
  MaintenanceCreateRequest,
  MaintenanceStatus,
} from '@core/models/maintenance.model';
import { MaintenanceService } from '@core/services/maintenance.service';
import { AuthStore } from '@core/auth/auth.store';

type CameraStatus =
  | 'online'
  | 'offline'
  | 'offline_hold'
  | 'offline_network'
  | 'maintenance'
  | 'maintenance_hold'
  | 'maintenance_long_time'
  | 'finished';

type CameraStatusFilter = 'all' | CameraStatus | 'maintenance_less_images' | 'maintenance_photo_dirty' | 'device_expired' | 'memory_full';

interface CountryOption {
  value: string;
  label: string;
}

interface CameraViewModel {
  id: string;
  name: string;
  description?: string;
  developerId: string;
  developerName: string;
  developerTag?: string;
  projectId: string;
  projectName: string;
  projectTag?: string;
  projectStatus?: string;
  projectStatusNormalized: string;
  cameraStatusRaw: string;
  serverFolder?: string;
  country?: string;
  lastPhoto?: string;
  lastPhotoTime?: string;
  lastUpdatedAt: Date | null;
  status: CameraStatus;
  camera: Camera;
  // Maintenance-related flags
  maintenanceLowImages?: boolean;
  maintenanceStatusPhotoDirty?: boolean;
  maintenanceStatusLowImages?: boolean;
  lastMaintenanceCompletedAt?: Date | null;
}

interface CameraHierarchyEntry {
  developer: {
    id: string;
    name: string;
    tag?: string;
  };
  projects: Array<{
    id: string;
    name: string;
    tag?: string;
    status?: string;
    cameras: CameraViewModel[];
  }>;
}

interface FilterOption {
  value: string;
  label: string;
}

interface TaskFormState {
  taskType: string;
  taskDescription: string;
  assignedUser: string | null; // Single user - "Assigned to"
  assistants: string[]; // Multiple users - "Assistant"
  attachments: File[]; // File attachments
  isSaving: boolean;
  error: string | null;
}

interface ProjectInfoState {
  project: Project;
  attachments: ProjectAttachment[];
  isLoading: boolean;
  isUploading: boolean;
  error: string | null;
  deleteInProgress: Set<string>;
  developerName: string;
  developerTag: string;
}

interface EditCountryModalState {
  camera: CameraViewModel;
  value: string;
  isSaving: boolean;
  error: string | null;
}

type SortMode = 'developer' | 'server';

const UPDATE_THRESHOLD_MINUTES = 60;
const MAINTENANCE_THRESHOLD_DAYS = 30;
const FILTER_STORAGE_KEY = 'camera-monitor-filters';
const NO_COUNTRY_VALUE = '__no_country__';
const ALLOWED_COUNTRIES = ['Saudi Arabia', 'UAE'] as const;
const LEGACY_TASK_TYPES = [
  'break down',
  'Maintenance',
  'Removal',
  'Installation',
  'Reinstallation',
] as const;

@Component({
  selector: 'app-camera-monitor',
  standalone: true,
  imports: [CommonModule, FormsModule, CameraHistoryComponent],
  templateUrl: './camera-monitor.component.html',
})
export class CameraMonitorComponent implements OnInit {
  private readonly developerService = inject(DeveloperService);
  private readonly projectService = inject(ProjectService);
  private readonly cameraService = inject(CameraService);
  private readonly maintenanceService = inject(MaintenanceService);
  private readonly userService = inject(UserService);
  private readonly authStore = inject(AuthStore);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly Math = Math;

  private readonly backendBase = environment.apiUrl.replace(/\/api\/?$/, '');
  private readonly placeholderImage = `${this.backendBase}/logos/project/image.png`;

  readonly isLoading = signal(true);
  readonly isRefreshing = signal(false);
  readonly errorMessage = signal<string | null>(null);

  readonly developers = signal<Developer[]>([]);
  readonly projects = signal<Project[]>([]);
  readonly users = signal<User[]>([]);
  readonly cameraRecords = signal<CameraViewModel[]>([]);

  // Filtered projects based on selected developer
  readonly filteredProjects = computed(() => {
    const allProjects = this.projects();
    const developerId = this.selectedDeveloperId();
    
    if (!developerId) {
      return allProjects;
    }
    
    return allProjects.filter((project) => {
      const projectDeveloperId = this.extractId(project.developer);
      return projectDeveloperId === developerId;
    });
  });

  readonly selectedDeveloperId = signal<string | null>(null);
  readonly selectedProjectId = signal<string | null>(null);
  readonly selectedCountry = signal<string | null>(null);
  readonly selectedCameraStatus = signal<CameraStatusFilter>('all');
  readonly sortMode = signal<SortMode>('developer');
  readonly searchTerm = signal('');

  readonly currentTime = signal(Date.now());

  readonly toast = signal<{ message: string; tone: 'success' | 'error' } | null>(null);

  readonly taskModalCamera = signal<CameraViewModel | null>(null);
  readonly taskForm = signal<TaskFormState>({
    taskType: '',
    taskDescription: '',
    assignedUser: null,
    assistants: [],
    attachments: [],
    isSaving: false,
    error: null,
  });

  readonly projectInfoState = signal<ProjectInfoState | null>(null);
  readonly editCountryModal = signal<EditCountryModalState | null>(null);
  readonly cameraHistoryModalCameraId = signal<string | null>(null);

  readonly imageLoadState = signal<Record<string, boolean>>({});
  readonly cameraStatusUpdating = signal<Set<string>>(new Set());
  readonly cameraCountryUpdating = signal<Set<string>>(new Set());
  readonly cameraHealthData = signal<Map<string, CameraHealthResponse | null>>(new Map());

  readonly taskTypes = LEGACY_TASK_TYPES;

  readonly cameraStatusOptions: Array<{ value: CameraStatusFilter; label: string }> = [
    { value: 'all', label: 'All statuses' },
    { value: 'online', label: '100% health' },
    { value: 'offline', label: 'Offline' },
    { value: 'offline_hold', label: 'Offline / hold' },
    { value: 'offline_network', label: 'Offline / network' },
    { value: 'maintenance', label: 'Maintenance' },
    { value: 'maintenance_less_images', label: 'Maintenance / less image' },
    // No top-level "Maintenance / photo dirty" option; photo dirty is controlled via Maintenance sub-filters
    { value: 'maintenance_hold', label: 'Maintenance / hold' },
    { value: 'maintenance_long_time', label: 'Maintenance / long time' },
    { value: 'finished', label: 'Finished' },
  ];
  readonly noCountryValue = NO_COUNTRY_VALUE;
  readonly allowedCountries = ALLOWED_COUNTRIES;

  readonly countryOptions = computed<CountryOption[]>(() => {
    const values = new Set<string>();
    let hasUnset = false;
    for (const camera of this.cameraRecords()) {
      const country = (camera.country ?? '').trim();
      if (country.length > 0) {
        values.add(country);
      } else {
        hasUnset = true;
      }
    }
    const options = Array.from(values)
      .sort((a, b) => a.localeCompare(b))
      .map<CountryOption>((value) => ({ value, label: value }));
    if (hasUnset) {
      options.push({ value: NO_COUNTRY_VALUE, label: 'No country' });
    }
    return options;
  });

  readonly isSuperAdmin = computed(() => this.authStore.user()?.role === 'Super Admin');
  readonly currentUserName = computed(() => this.authStore.user()?.name ?? 'System');
  readonly currentUser = computed(() => this.authStore.user());
  
  // Permission checks
  readonly canCreateTask = computed(
    () => this.isSuperAdmin() || ((this.currentUser() as any)?.canCreateMonitorTask ?? false),
  );
  readonly canHoldTask = computed(
    () => this.isSuperAdmin() || ((this.currentUser() as any)?.canHoldMaintenance ?? false),
  );
  readonly canDeletePhoto = computed(
    () => this.isSuperAdmin() || ((this.currentUser() as any)?.canDeletePhoto ?? false),
  );
  readonly accessibleDevelopers = computed(() => this.currentUser()?.accessibleDevelopers ?? []);

  readonly filteredCameras = computed<CameraViewModel[]>(() => {
    const cameras = this.cameraRecords();
    const developerId = this.selectedDeveloperId();
    const projectId = this.selectedProjectId();
    const countryFilter = this.selectedCountry();
    const statusFilter = this.selectedCameraStatus();
    const search = this.searchTerm().trim().toLowerCase();
    const sort = this.sortMode();
    const isSuperAdmin = this.isSuperAdmin();
    const accessible = this.accessibleDevelopers();

    let list = cameras;

    // Filter by accessibleDevelopers if not Super Admin
    if (!isSuperAdmin && accessible.length > 0 && accessible[0] !== 'all') {
      list = list.filter((camera) => accessible.includes(camera.developerId));
    }

    if (developerId) {
      list = list.filter((camera) => camera.developerId === developerId);
    }

    if (projectId) {
      list = list.filter((camera) => camera.projectId === projectId);
    }

    if (countryFilter) {
      if (countryFilter === NO_COUNTRY_VALUE) {
        list = list.filter((camera) => !camera.country || camera.country.trim().length === 0);
      } else {
        const normalizedCountry = countryFilter.toLowerCase();
        list = list.filter(
          (camera) => (camera.country ?? '').trim().toLowerCase() === normalizedCountry,
        );
      }
    }

    if (statusFilter !== 'all') {
      list = list.filter((camera) => this.matchesCameraStatus(camera, statusFilter));
    }

    if (search.length > 0) {
      list = list.filter((camera) => {
        const serverFolder = camera.serverFolder ?? '';
        const fields = [
          camera.name,
          camera.description ?? '',
          camera.developerName,
          camera.developerTag ?? '',
          camera.projectName,
          camera.projectTag ?? '',
          serverFolder,
          camera.country ?? '',
        ];
        return fields.some((field) => field.toLowerCase().includes(search));
      });
    }

    const sorted = [...list];
    if (sort === 'developer') {
      sorted.sort((a, b) => {
        const dev = a.developerName.localeCompare(b.developerName);
        if (dev !== 0) {
          return dev;
        }
        const proj = a.projectName.localeCompare(b.projectName);
        if (proj !== 0) {
          return proj;
        }
        return a.name.localeCompare(b.name);
      });
    } else {
      sorted.sort((a, b) => {
        const serverA = (a.serverFolder ?? '').toLowerCase();
        const serverB = (b.serverFolder ?? '').toLowerCase();
        const serverCompare = serverA.localeCompare(serverB);
        if (serverCompare !== 0) {
          return serverCompare;
        }
        return a.name.localeCompare(b.name);
      });
    }

    return sorted;
  });

  readonly hierarchyEntries = computed<CameraHierarchyEntry[]>(() => {
    const groups = new Map<
      string,
      {
        developer: { id: string; name: string; tag?: string };
        projects: Map<
          string,
          {
            project: { id: string; name: string; tag?: string; status?: string };
            cameras: CameraViewModel[];
          }
        >;
      }
    >();

    for (const camera of this.filteredCameras()) {
      let developerGroup = groups.get(camera.developerId);
      if (!developerGroup) {
        developerGroup = {
          developer: {
            id: camera.developerId,
            name: camera.developerName,
            tag: camera.developerTag,
          },
          projects: new Map(),
        };
        groups.set(camera.developerId, developerGroup);
      }

      let projectGroup = developerGroup.projects.get(camera.projectId);
      if (!projectGroup) {
        projectGroup = {
          project: {
            id: camera.projectId,
            name: camera.projectName,
            tag: camera.projectTag,
            status: camera.projectStatus,
          },
          cameras: [],
        };
        developerGroup.projects.set(camera.projectId, projectGroup);
      }

      projectGroup.cameras.push(camera);
    }

    return Array.from(groups.values())
      .map((group) => ({
        developer: group.developer,
        projects: Array.from(group.projects.values())
          .map((project) => ({
            id: project.project.id,
            name: project.project.name,
            tag: project.project.tag,
            status: project.project.status,
            cameras: project.cameras.slice().sort((a, b) => a.name.localeCompare(b.name)),
          }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      }))
      .sort((a, b) => a.developer.name.localeCompare(b.developer.name));
  });

  readonly metrics = computed(() => {
    const list = this.filteredCameras();
    const total = list.length;
    const updated = list.filter((camera) => camera.status === 'online').length;
    const notUpdated = list.filter((camera) => camera.status === 'offline').length;
    const projects = new Set(list.map((camera) => camera.projectId)).size;
    const developers = new Set(list.map((camera) => camera.developerId)).size;

    return [
      {
        title: 'Cameras',
        value: total.toString(),
        helper: `${developers} developers • ${projects} projects`,
        tone: 'default' as const,
      },
      {
        title: 'Updated (< 1h)',
        value: updated.toString(),
        helper: 'Live feeds',
        tone: updated > 0 ? ('positive' as const) : ('warning' as const),
      },
      {
        title: 'Offline feeds',
        value: notUpdated.toString(),
        helper: 'Require attention',
        tone: notUpdated > 0 ? ('warning' as const) : ('positive' as const),
      },
      {
        title: 'Filters applied',
        value: this.activeFilterCount().toString(),
        helper: 'Filters currently active',
        tone: this.activeFilterCount() > 0 ? ('default' as const) : ('positive' as const),
      },
    ];
  });

  readonly totalCameraCount = computed(() => this.cameraRecords().length);
  readonly filteredCameraCount = computed(() => this.filteredCameras().length);

  readonly activeFilterCount = computed(() => {
    let count = 0;
    if (this.selectedDeveloperId()) count += 1;
    if (this.selectedProjectId()) count += 1;
    if (this.selectedCountry()) count += 1;
    if (this.selectedCameraStatus() !== 'all') count += 1;
    if (this.searchTerm().trim().length > 0) count += 1;
    if (this.sortMode() !== 'developer') count += 1;
    return count;
  });

  constructor() {
    this.restoreFilterState();

    effect(() => {
      const filters = {
        developerId: this.selectedDeveloperId(),
        projectId: this.selectedProjectId(),
        country: this.selectedCountry(),
        status: this.selectedCameraStatus(),
        sortMode: this.sortMode(),
        search: this.searchTerm(),
      };
      try {
        localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(filters));
      } catch {
        // ignore persistence errors (e.g. storage disabled)
      }
    });

    const interval = setInterval(() => {
      this.currentTime.set(Date.now());
    }, 60000);
    this.destroyRef.onDestroy(() => clearInterval(interval));
  }

  ngOnInit(): void {
    this.loadData();
    this.loadUsers();
  }

  onDeveloperSelect(value: string): void {
    this.selectedDeveloperId.set(value || null);
    this.selectedProjectId.set(null);
  }

  onCountrySelect(value: string | null): void {
    this.selectedCountry.set(value);
  }

  onProjectSelect(value: string): void {
    this.selectedProjectId.set(value || null);
  }

  onStatusSelect(value: CameraStatusFilter): void {
    this.selectedCameraStatus.set(value);
  }

  onSortChange(mode: SortMode): void {
    this.sortMode.set(mode);
  }

  onSearch(value: string): void {
    this.searchTerm.set(value);
  }

  openCountryModal(camera: CameraViewModel): void {
    this.editCountryModal.set({
      camera,
      value: this.coerceCountryValue(camera.country ?? ''),
      isSaving: false,
      error: null,
    });
  }

  closeCountryModal(): void {
    this.editCountryModal.set(null);
  }

  setCountryModalValue(value: string): void {
    this.editCountryModal.update((state) =>
      state
        ? {
            ...state,
            value: this.coerceCountryValue(value),
            error: null,
          }
        : state,
    );
  }

  saveCountryModal(): void {
    const modal = this.editCountryModal();
    if (!modal || modal.isSaving) {
      return;
    }

    this.editCountryModal.update((state) => (state ? { ...state, isSaving: true, error: null } : state));

    this.persistCameraCountry(modal.camera, modal.value, (success) => {
      this.editCountryModal.update((state) => (state ? { ...state, isSaving: false } : state));
      if (success) {
        this.editCountryModal.set(null);
      } else {
        this.editCountryModal.update((state) =>
          state
            ? {
                ...state,
                error: 'Unable to update the country. Please try again.',
              }
            : state,
        );
      }
    });
  }

  clearFilters(): void {
    this.selectedDeveloperId.set(null);
    this.selectedProjectId.set(null);
    this.selectedCountry.set(null);
    this.selectedCameraStatus.set('all');
    this.sortMode.set('developer');
    this.searchTerm.set('');
  }

  refresh(): void {
    if (this.isRefreshing()) {
      return;
    }
    this.loadData(true);
  }

  lastUpdateLabel(camera: CameraViewModel): string {
    if (!camera.lastUpdatedAt) {
      return 'No photo available';
    }
    const minutes = this.minutesSince(camera.lastUpdatedAt);
    if (minutes === null) {
      return 'No photo available';
    }
    
    // If camera is recently updated (within threshold), show as "Updated"
    // This applies to both 'online' and 'maintenance' status (maintenance can be due to low image count, not offline)
    if (minutes < UPDATE_THRESHOLD_MINUTES) {
      return 'Updated';
    }
    
    // Camera hasn't updated recently
    const days = Math.floor(minutes / (60 * 24));
    const hours = Math.floor((minutes % (60 * 24)) / 60);
    const mins = Math.floor(minutes % 60);
    const parts: string[] = [];
    if (days > 0) parts.push(`${days} day${days > 1 ? 's' : ''}`);
    if (hours > 0) parts.push(`${hours} hour${hours > 1 ? 's' : ''}`);
    if (mins > 0) parts.push(`${mins} minute${mins > 1 ? 's' : ''}`);
    return parts.length > 0 ? `Not updated (${parts.join(' ')})` : 'Not updated';
  }

  updateStatusClass(camera: CameraViewModel): string {
    switch (camera.status) {
      case 'online':
        return 'bg-emerald-100 text-emerald-700';
      case 'offline':
        return 'bg-amber-100 text-amber-700';
      case 'offline_hold':
      case 'offline_network':
        return 'bg-amber-100 text-amber-700';
      case 'maintenance':
      case 'maintenance_hold':
      case 'maintenance_long_time':
        return 'bg-indigo-100 text-indigo-700';
      case 'finished':
        return 'bg-slate-200 text-slate-700';
      default:
        return 'bg-slate-100 text-slate-500';
    }
  }

  cameraStatusLabel(status: CameraStatus): string {
    switch (status) {
      case 'online':
        return '100% health';
      case 'offline':
        return 'Offline';
      case 'offline_hold':
        return 'Offline';
      case 'offline_network':
        return 'Offline';
      case 'maintenance':
        return 'Maintenance';
      case 'maintenance_hold':
        return 'Maintenance';
      case 'maintenance_long_time':
        return 'Maintenance';
      case 'finished':
        return 'Finished';
    }
  }

  isCameraStatus(camera: CameraViewModel, status: 'hold' | 'network' | 'finished'): boolean {
    return camera.cameraStatusRaw === status;
  }

  isCameraStatusUpdating(cameraId: string): boolean {
    return this.cameraStatusUpdating().has(cameraId);
  }

  isCameraCountryUpdating(cameraId: string): boolean {
    return this.cameraCountryUpdating().has(cameraId);
  }

  toggleCameraStatus(camera: CameraViewModel, status: 'hold' | 'network' | 'finished'): void {
    const nextStatus = camera.cameraStatusRaw === status ? '' : status;
    this.persistCameraStatus(camera, nextStatus);
  }

  clearCameraStatus(camera: CameraViewModel): void {
    if (!camera.cameraStatusRaw) {
      return;
    }
    this.persistCameraStatus(camera, '');
  }

  togglePhotoDirty(camera: CameraViewModel): void {
    const nextValue = !camera.maintenanceStatusPhotoDirty;

    this.cameraService
      .updateMaintenanceStatus(camera.id, { photoDirty: nextValue })
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        catchError((error) => {
          console.error('Failed to update photo dirty status', error);
          this.showToast('Unable to update photo dirty status.', 'error');
          return of<Camera | null>(null);
        }),
      )
      .subscribe((updated) => {
        if (!updated) {
          return;
        }

        const maintenanceStatus = (updated.maintenanceStatus ?? {}) as {
          photoDirty?: boolean;
          lowImages?: boolean;
        };

        this.cameraRecords.update((list) =>
          list.map((item) =>
            item.id === camera.id
              ? (() => {
                  const isPhotoDirty = !!maintenanceStatus.photoDirty;
                  const projectStatusNormalized = this.normalizeProjectStatus(item.projectStatus);
                  const updatedStatusRaw = this.normalizeCameraStatusRaw(
                    item.camera.status as string | undefined,
                  );
                  const health = this.cameraHealthData().get(item.id) ?? null;
                  const derivedStatus = this.deriveCameraStatus(
                    projectStatusNormalized,
                    updatedStatusRaw,
                    item.lastUpdatedAt,
                    health,
                    isPhotoDirty,
                    item.lastMaintenanceCompletedAt ?? null,
                  );
                  return {
                    ...item,
                    cameraStatusRaw: updatedStatusRaw,
                    status: derivedStatus,
                    maintenanceStatusPhotoDirty: isPhotoDirty,
                    camera: { ...item.camera, maintenanceStatus },
                  };
                })()
              : item,
          ),
        );

        this.showToast(
          maintenanceStatus.photoDirty ? 'Marked as photo dirty.' : 'Photo dirty status cleared.',
          'success',
        );
      });
  }

  clearLowImagesStatus(camera: CameraViewModel): void {
    this.cameraService
      .updateMaintenanceStatus(camera.id, { lowImages: false })
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        catchError((error) => {
          console.error('Failed to clear low images maintenance status', error);
          this.showToast('Unable to clear low images status.', 'error');
          return of<Camera | null>(null);
        }),
      )
      .subscribe((updated) => {
        if (!updated) {
          return;
        }

        const maintenanceStatus = (updated.maintenanceStatus ?? {}) as {
          photoDirty?: boolean;
          lowImages?: boolean;
        };

        this.cameraRecords.update((list) =>
          list.map((item) =>
            item.id === camera.id
              ? (() => {
                  const projectStatusNormalized = this.normalizeProjectStatus(item.projectStatus);
                  const updatedStatusRaw = this.normalizeCameraStatusRaw(
                    item.camera.status as string | undefined,
                  );
                  const health = this.cameraHealthData().get(item.id) ?? null;
                  const derivedStatus = this.deriveCameraStatus(
                    projectStatusNormalized,
                    updatedStatusRaw,
                    item.lastUpdatedAt,
                    health,
                    !!maintenanceStatus.photoDirty,
                    item.lastMaintenanceCompletedAt ?? null,
                  );

                  return {
                    ...item,
                    cameraStatusRaw: updatedStatusRaw,
                    status: derivedStatus,
                    maintenanceStatusLowImages: !!maintenanceStatus.lowImages,
                    camera: { ...item.camera, maintenanceStatus },
                  };
                })()
              : item,
          ),
        );

        this.showToast('Low images maintenance status cleared.', 'success');
      });
  }

  openTaskModal(camera: CameraViewModel): void {
    this.taskModalCamera.set(camera);
    this.taskForm.set({
      taskType: '',
      taskDescription: '',
      assignedUser: null,
      assistants: [],
      attachments: [],
      isSaving: false,
      error: null,
    });
  }

  closeTaskModal(): void {
    this.taskModalCamera.set(null);
  }

  updateTaskFormField(field: 'taskType' | 'taskDescription', value: string): void {
    this.taskForm.update((state) => ({
      ...state,
      [field]: value,
      error: null,
    }));
  }

  onTaskAssignedUserChange(userId: string): void {
    this.taskForm.update((state) => ({
      ...state,
      assignedUser: userId || null,
      error: null,
    }));
  }

  // Multi-select dropdown state for assistants
  readonly isTaskAssistantsDropdownOpen = signal(false);

  toggleTaskAssistantsDropdown(): void {
    this.isTaskAssistantsDropdownOpen.update((v) => !v);
  }

  toggleTaskAssistantSelection(userId: string): void {
    const current = this.taskForm().assistants;
    let newSelection: string[];

    if (current.includes(userId)) {
      newSelection = current.filter((id) => id !== userId);
    } else {
      newSelection = [...current, userId];
    }

    this.taskForm.update((state) => ({
      ...state,
      assistants: newSelection,
      error: null,
    }));
  }

  removeTaskAssistant(userId: string): void {
    const current = this.taskForm().assistants;
    const newSelection = current.filter((id) => id !== userId);

    this.taskForm.update((state) => ({
      ...state,
      assistants: newSelection,
      error: null,
    }));
  }

  isTaskAssistantSelected(userId: string): boolean {
    return this.taskForm().assistants.includes(userId);
  }

  getTaskAssignedUserLabel(userId: string): string {
    const user = this.users().find((u) => u._id === userId);
    return user ? `${user.name} (${user.role})` : userId;
  }

  saveTask(): void {
    const camera = this.taskModalCamera();
    if (!camera) {
      return;
    }

    const form = this.taskForm();
    if (!form.taskType.trim() || !form.taskDescription.trim() || !form.assignedUser) {
      this.taskForm.update((state) => ({
        ...state,
        error: 'Task type, description, and assigned engineer are required.',
      }));
      return;
    }

    const currentUser = this.authStore.user();
    // Get user ID - try both 'id' and '_id' fields to handle different data formats
    const userId = currentUser?.id || (currentUser as any)?.['_id'] || (currentUser as any)?._id;
    
    // Build FormData if there are attachments, otherwise use JSON payload
    const hasAttachments = form.attachments && form.attachments.length > 0;
    let payload: MaintenanceCreateRequest | FormData;
    
    if (hasAttachments) {
      const formData = new FormData();
      formData.append('taskType', form.taskType.trim());
      formData.append('taskDescription', form.taskDescription.trim());
      formData.append('assignedUser', form.assignedUser || '');
      if (form.assistants.length > 0) {
        formData.append('assistants', JSON.stringify(form.assistants));
      }
      formData.append('status', 'pending');
      formData.append('cameraId', camera.id);
      formData.append('developerId', camera.developerId);
      formData.append('projectId', camera.projectId);
      formData.append('dateOfRequest', new Date().toISOString());
      formData.append('userComment', '');
      if (userId) {
        formData.append('addedUserId', userId);
      }
      if (currentUser?.name) {
        formData.append('addedUserName', currentUser.name);
      }
      
      // Append attachments
      for (const file of form.attachments) {
        formData.append('attachments', file);
      }
      
      payload = formData;
    } else {
      payload = {
        taskType: form.taskType.trim(),
        taskDescription: form.taskDescription.trim(),
        assignedUser: form.assignedUser,
        assistants: form.assistants.length > 0 ? [...form.assistants] : undefined,
        status: 'pending',
        cameraId: camera.id,
        developerId: camera.developerId,
        projectId: camera.projectId,
        dateOfRequest: new Date().toISOString(),
        userComment: '',
        addedUserId: userId as string | undefined,
        addedUserName: currentUser?.name,
      } as any;
    }

    this.taskForm.update((state) => ({ ...state, isSaving: true, error: null }));

    this.maintenanceService
      .create(payload)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        catchError((error) => {
          console.error('Failed to create maintenance task', error);
          this.taskForm.update((state) => ({
            ...state,
            isSaving: false,
            error: 'Unable to create maintenance task. Please try again.',
          }));
          return of(null);
        }),
      )
      .subscribe((response) => {
        if (!response) {
          return;
        }
        this.showToast('Maintenance task created successfully.', 'success');
        this.closeTaskModal();
      });
  }

  onTaskAttachmentsChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      const files = Array.from(input.files);
      this.taskForm.update((state) => ({
        ...state,
        attachments: [...state.attachments, ...files],
      }));
      // Reset input to allow selecting the same file again
      input.value = '';
    }
  }

  removeTaskAttachment(index: number): void {
    this.taskForm.update((state) => ({
      ...state,
      attachments: state.attachments.filter((_, i) => i !== index),
    }));
  }

  formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  }

  openProjectInfo(projectId: string): void {
    const project = this.projects().find((item) => item._id === projectId);
    if (!project) {
      this.showToast('Project not found.', 'error');
      return;
    }

    const developerId = this.extractId(project.developer as unknown as string | { _id?: string });
    const developer = this.developers().find((item) => item._id === developerId);

    this.projectInfoState.set({
      project,
      attachments: [],
      isLoading: true,
      isUploading: false,
      error: null,
      deleteInProgress: new Set(),
      developerName: developer?.developerName ?? 'Unknown developer',
      developerTag: developer?.developerTag ?? 'No tag',
    });

    this.projectService
      .getAttachments(projectId)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        catchError((error) => {
          console.error('Failed to load project attachments', error);
          this.projectInfoState.update((state) =>
            state
              ? {
                  ...state,
                  isLoading: false,
                  error: 'Unable to load attachments.',
                }
              : state,
          );
          return of<ProjectAttachment[]>([]);
        }),
      )
      .subscribe((attachments) => {
        this.projectInfoState.update((state) =>
          state
            ? {
                ...state,
                isLoading: false,
                attachments,
              }
            : state,
        );
      });
  }

  closeProjectInfo(): void {
    this.projectInfoState.set(null);
  }

  uploadProjectAttachment(event: Event): void {
    const state = this.projectInfoState();
    if (!state) {
      return;
    }
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) {
      return;
    }

    this.projectInfoState.update((current) =>
      current
        ? {
            ...current,
            isUploading: true,
            error: null,
          }
        : current,
    );

    this.projectService
      .uploadAttachment(state.project._id, file)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        catchError((error) => {
          console.error('Failed to upload attachment', error);
          this.projectInfoState.update((current) =>
            current
              ? {
                  ...current,
                  isUploading: false,
                  error: 'Unable to upload attachment.',
                }
              : current,
          );
          return of<ProjectAttachment | null>(null);
        }),
      )
      .subscribe((attachment) => {
        if (!attachment) {
          return;
        }
        this.projectInfoState.update((current) =>
          current
            ? {
                ...current,
                isUploading: false,
                attachments: [...current.attachments, attachment],
              }
            : current,
        );
        this.showToast('Attachment uploaded.', 'success');
      });
  }

  deleteProjectAttachment(attachmentId: string): void {
    const state = this.projectInfoState();
    if (!state) {
      return;
    }

    const nextDeleteSet = new Set(state.deleteInProgress);
    nextDeleteSet.add(attachmentId);
    this.projectInfoState.update((current) =>
      current
        ? {
            ...current,
            deleteInProgress: nextDeleteSet,
            error: null,
          }
        : current,
    );

    this.projectService
      .deleteAttachment(state.project._id, attachmentId)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        catchError((error) => {
          console.error('Failed to delete attachment', error);
          this.projectInfoState.update((current) => {
            if (!current) {
              return current;
            }
            const updatedSet = new Set(current.deleteInProgress);
            updatedSet.delete(attachmentId);
            return {
              ...current,
              deleteInProgress: updatedSet,
              error: 'Unable to delete attachment.',
            };
          });
          return of(null);
        }),
      )
      .subscribe((result) => {
        if (result === null) {
          return;
        }
        this.projectInfoState.update((current) => {
          if (!current) {
            return current;
          }
          const updatedSet = new Set(current.deleteInProgress);
          updatedSet.delete(attachmentId);
          return {
            ...current,
            deleteInProgress: updatedSet,
            attachments: current.attachments.filter((item) => item._id !== attachmentId),
          };
        });
        this.showToast('Attachment deleted.', 'success');
      });
  }

  downloadAttachment(attachment: ProjectAttachment): void {
    const url = this.resolveAssetUrl(attachment.url ?? '');
    if (url) {
      window.open(url, '_blank', 'noopener');
    }
  }

  isAttachmentDeleting(attachmentId: string): boolean {
    const state = this.projectInfoState();
    if (!state) {
      return false;
    }
    return state.deleteInProgress.has(attachmentId);
  }

  openCameraHistory(camera: CameraViewModel): void {
    this.cameraHistoryModalCameraId.set(camera.id);
  }

  closeCameraHistoryModal(): void {
    this.cameraHistoryModalCameraId.set(null);
  }

  openEditCamera(camera: CameraViewModel): void {
    this.router.navigate(['/cameras'], {
      queryParams: { edit: camera.id },
    });
  }

  imageUrl(camera: CameraViewModel): string {
    if (!camera.lastPhoto || !camera.developerTag || !camera.projectTag) {
      return this.placeholderImage;
    }
    const encodedDeveloper = encodeURIComponent(camera.developerTag);
    const encodedProject = encodeURIComponent(camera.projectTag);
    const encodedCamera = encodeURIComponent(camera.name);
    const encodedPhoto = encodeURIComponent(camera.lastPhoto);
    return `${this.backendBase}/media/upload/${encodedDeveloper}/${encodedProject}/${encodedCamera}/large/${encodedPhoto}`;
  }

  onImageLoad(cameraId: string): void {
    this.imageLoadState.update((state) => ({
      ...state,
      [cameraId]: true,
    }));
  }

  isImageLoaded(cameraId: string): boolean {
    return !!this.imageLoadState()[cameraId];
  }

  dismissToast(): void {
    this.toast.set(null);
  }

  private loadData(forceRefresh = false): void {
    if (forceRefresh) {
      this.isRefreshing.set(true);
    } else {
      this.isLoading.set(true);
    }
    this.errorMessage.set(null);

    combineLatest([
      this.developerService
        .getAll({ forceRefresh })
        .pipe(catchError((error) => this.handleLoadError<Developer[]>('developers', error))),
      this.projectService
        .getAll(forceRefresh)
        .pipe(catchError((error) => this.handleLoadError<Project[]>('projects', error))),
      this.cameraService
        .getAll(forceRefresh)
        .pipe(catchError((error) => this.handleLoadError<Camera[]>('cameras', error))),
      this.cameraService
        .getLastPictures()
        .pipe(catchError((error) => this.handleLoadError<CameraLastPicture[]>('camera snapshots', error))),
    ])
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => {
          this.isLoading.set(false);
          this.isRefreshing.set(false);
        }),
      )
      .subscribe(([developers, projects, cameras, lastPictures]) => {
        // Filter developers based on user's accessibleDevelopers
        let filteredDevelopers = developers;
        let filteredCameras = cameras;
        const user = this.currentUser();
        if (user && !this.isSuperAdmin()) {
          const accessible = this.accessibleDevelopers();
          if (accessible.length > 0 && accessible[0] !== 'all') {
            filteredDevelopers = developers.filter((dev) => accessible.includes(dev._id));
            // Filter cameras to only show those from accessible developers
            filteredCameras = cameras.filter((camera) => {
              const developerId = this.extractId(camera.developer);
              return developerId && accessible.includes(developerId);
            });
          }
        }
        this.developers.set(this.sortByName(filteredDevelopers, (item) => item.developerName));
        this.projects.set(this.sortByName(projects, (item) => item.projectName));

        // Build initial camera records and show them immediately (no health/maintenance data yet)
        const initialRecords = this.buildCameraRecords(filteredCameras, filteredDevelopers, projects, lastPictures);
        this.cameraRecords.set(initialRecords);

        // Fetch health data (for all cameras with valid tags) and maintenance summaries in the background
        forkJoin({
          health: this.fetchCameraHealthData(initialRecords),
          maintenance: this.fetchMaintenanceSummaries(cameras),
        })
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe(({ health, maintenance }) => {
            this.cameraHealthData.set(health);
            // Use filtered cameras and developers for the final build
            const user = this.currentUser();
            let finalCameras = cameras;
            let finalDevelopers = developers;
            if (user && !this.isSuperAdmin()) {
              const accessible = this.accessibleDevelopers();
              if (accessible.length > 0 && accessible[0] !== 'all') {
                finalDevelopers = developers.filter((dev) => accessible.includes(dev._id));
                finalCameras = cameras.filter((camera) => {
                  const developerId = this.extractId(camera.developer);
                  return developerId && accessible.includes(developerId);
                });
              }
            }
            this.cameraRecords.set(
              this.buildCameraRecords(
                finalCameras,
                finalDevelopers,
                projects,
                lastPictures,
                health,
                maintenance,
              ),
            );
          });
      });
  }

  private loadUsers(): void {
    this.userService
      .getAdmins()
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        catchError((error) => {
          console.error('Failed to load users', error);
          return of<User[]>([]);
        }),
      )
      .subscribe((users) => {
        this.users.set(users.sort((a, b) => a.name.localeCompare(b.name)));
      });
  }

  private fetchCameraHealthData(
    cameraRecords: CameraViewModel[],
  ): Observable<Map<string, CameraHealthResponse | null>> {
    const healthRequests: Record<string, Observable<CameraHealthResponse | null>> = {};
    
    for (const camera of cameraRecords) {
      if (camera.developerTag && camera.projectTag && camera.name) {
        const key = camera.id;
        healthRequests[key] = this.cameraService.getHealth(
          camera.developerTag,
          camera.projectTag,
          camera.name,
        );
      }
    }
    
    if (Object.keys(healthRequests).length === 0) {
      return of(new Map());
    }
    
    return forkJoin(healthRequests).pipe(
      map((results) => {
        const healthMap = new Map<string, CameraHealthResponse | null>();
        for (const [key, value] of Object.entries(results)) {
          healthMap.set(key, value);
        }
        return healthMap;
      }),
      catchError((error) => {
        console.error('Failed to fetch camera health data', error);
        return of(new Map());
      }),
    );
  }

  private fetchMaintenanceSummaries(
    cameras: Camera[],
  ): Observable<Map<string, Date | null>> {
    const requests: Record<string, Observable<Maintenance[]>> = {};

    for (const camera of cameras) {
      if (camera._id) {
        requests[camera._id] = this.maintenanceService
          .getByCamera(camera._id)
          .pipe(catchError(() => of<Maintenance[]>([])));
      }
    }

    if (Object.keys(requests).length === 0) {
      return of(new Map());
    }

    return forkJoin(requests).pipe(
      map((results) => {
        const mapResult = new Map<string, Date | null>();

        for (const [cameraId, tasks] of Object.entries(results)) {
          const completedTasks = (tasks ?? []).filter(
            (task) => (task.status ?? '').toLowerCase() === 'completed',
          );

          let latest: Date | null = null;
          for (const task of completedTasks) {
            const timestamp =
              task.completionTime || task.startTime || task.dateOfRequest || task.createdDate;
            if (!timestamp) {
              continue;
            }
            const date = new Date(timestamp);
            if (!Number.isNaN(date.getTime())) {
              if (!latest || date.getTime() > latest.getTime()) {
                latest = date;
              }
            }
          }

          mapResult.set(cameraId, latest);
        }

        return mapResult;
      }),
      catchError((error) => {
        console.error('Failed to fetch maintenance summaries', error);
        return of(new Map<string, Date | null>());
      }),
    );
  }

  private buildCameraRecords(
    cameras: Camera[],
    developers: Developer[],
    projects: Project[],
    lastPictures: CameraLastPicture[],
    healthData?: Map<string, CameraHealthResponse | null>,
    maintenanceSummaries?: Map<string, Date | null>,
  ): CameraViewModel[] {
    const developerById = new Map(developers.map((developer) => [developer._id, developer]));
    const projectById = new Map(projects.map((project) => [project._id, project]));

    const lastPictureMap = new Map<string, CameraLastPicture>();
    for (const entry of lastPictures) {
      if (entry.developerId && entry.projectId && entry.cameraName) {
        const key = `${entry.developerId}|${entry.projectId}|${entry.cameraName}`;
        lastPictureMap.set(key, entry);
      }
    }

    return cameras.map((camera) => {
      const developerId = this.extractId(camera.developer);
      const projectId = this.extractId(camera.project);
      const developer = developerById.get(developerId);
      const project = projectById.get(projectId);
      const key = `${developerId}|${projectId}|${camera.camera}`;
      const lastPicture = lastPictureMap.get(key);
      let lastUpdatedAt =
        this.parseLastPhotoTime(lastPicture?.lastPhotoTime) ??
        this.parseLegacyTimestamp(lastPicture?.lastPhoto ?? '');
      
      // Adjust for timezone: if the server sends UTC but we're in UTC+3, 
      // the date pipe will show it as +3 hours. Subtract 3 hours to correct it.
      if (lastUpdatedAt) {
        // Subtract 3 hours (10800000 ms) to correct the timezone offset
        lastUpdatedAt = new Date(lastUpdatedAt.getTime() - 3 * 60 * 60 * 1000);
      }
      const projectStatusNormalized = this.normalizeProjectStatus(project?.status);
      const cameraStatusRaw = this.normalizeCameraStatusRaw(camera.status);
      const health = healthData?.get(camera._id) ?? null;
      const maintenanceLowImages = !!(health && !health.error && health.totalImages < 140);
      const maintenanceStatus = camera.maintenanceStatus as
        | { photoDirty?: boolean; lowImages?: boolean }
        | undefined;
      const maintenanceStatusPhotoDirty = !!maintenanceStatus?.photoDirty;
      const maintenanceStatusLowImages = !!maintenanceStatus?.lowImages;
      const lastMaintenanceCompletedAt = maintenanceSummaries?.get(camera._id) ?? null;
      const cameraStatus = this.deriveCameraStatus(
        projectStatusNormalized,
        cameraStatusRaw,
        lastUpdatedAt,
        health,
        maintenanceStatusPhotoDirty,
        lastMaintenanceCompletedAt,
      );
      const country = (camera.country ?? '').trim();

      return {
        id: camera._id,
        name: camera.camera,
        description: camera.cameraDescription ?? '',
        developerId,
        developerName: developer?.developerName ?? 'Unknown developer',
        developerTag: developer?.developerTag ?? lastPicture?.developerTag,
        projectId,
        projectName: project?.projectName ?? 'Unknown project',
        projectTag: project?.projectTag ?? lastPicture?.projectTag,
        projectStatus: project?.status ?? 'unknown',
        projectStatusNormalized,
        cameraStatusRaw,
        serverFolder: camera.serverFolder ?? lastPicture?.serverfolder ?? '',
        country: country,
        lastPhoto: lastPicture?.lastPhoto,
        lastPhotoTime: lastPicture?.lastPhotoTime,
        lastUpdatedAt,
        status: cameraStatus,
        camera,
        maintenanceLowImages,
        maintenanceStatusPhotoDirty,
        maintenanceStatusLowImages,
        lastMaintenanceCompletedAt,
      };
    });
  }

  private parseLastPhotoTime(value?: string): Date | null {
    if (!value) {
      return null;
    }
    
    const trimmed = value.trim();
    
    // If the string already includes timezone info (Z, +HH:MM, or -HH:MM), parse it directly
    if (trimmed.includes('Z') || trimmed.match(/[+-]\d{2}:?\d{2}$/)) {
      const date = new Date(trimmed);
      return Number.isNaN(date.getTime()) ? null : date;
    }
    
    // If no timezone info, the server likely sends UTC time
    // Parse it as UTC explicitly to avoid timezone conversion issues
    // Try to parse common ISO formats: "2025-11-21T10:00:00" or "2025-11-21 10:00:00"
    const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?$/);
    if (isoMatch) {
      const [, year, month, day, hour, minute, second] = isoMatch;
      // Create date as UTC
      const date = new Date(Date.UTC(
        parseInt(year, 10),
        parseInt(month, 10) - 1,
        parseInt(day, 10),
        parseInt(hour, 10),
        parseInt(minute, 10),
        parseInt(second, 10),
      ));
      return Number.isNaN(date.getTime()) ? null : date;
    }
    
    // Fallback: parse as-is (JavaScript will treat as local time)
    // Then adjust by subtracting timezone offset to convert to UTC
    // This handles cases where the string format doesn't match our regex
    let date = new Date(trimmed);
    if (!Number.isNaN(date.getTime())) {
      // If parsed as local time but should be UTC, adjust by timezone offset
      // getTimezoneOffset() returns minutes, negative for timezones ahead of UTC
      const offsetMs = date.getTimezoneOffset() * 60000;
      date = new Date(date.getTime() - offsetMs);
    }
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private parseLegacyTimestamp(value?: string): Date | null {
    if (!value || value.length < 14) {
      return null;
    }
    // Parse timestamp like "20251121105533" as UTC
    const year = Number.parseInt(value.slice(0, 4), 10);
    const month = Number.parseInt(value.slice(4, 6), 10) - 1;
    const day = Number.parseInt(value.slice(6, 8), 10);
    const hour = Number.parseInt(value.slice(8, 10), 10);
    const minute = Number.parseInt(value.slice(10, 12), 10);
    const second = Number.parseInt(value.slice(12, 14), 10);
    
    // Create date as UTC by using Date.UTC
    const date = new Date(Date.UTC(year, month, day, hour, minute, second));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private minutesSince(date: Date | null): number | null {
    if (!date) {
      return null;
    }
    return (this.currentTime() - date.getTime()) / (1000 * 60);
  }

  private extractId(value: string | { _id?: string }): string {
    if (typeof value === 'string') {
      return value;
    }
    return value?._id ?? '';
  }

  private sortByName<T>(items: T[], selector: (item: T) => string): T[] {
    return [...items].sort((a, b) => selector(a).localeCompare(selector(b)));
  }

  private handleLoadError<T>(label: string, error: unknown) {
    console.error(`Failed to load ${label}`, error);
    this.errorMessage.set(`Unable to load ${label}. Some information might be incomplete.`);
    return of([] as unknown as T);
  }

  private resolveAssetUrl(path: string): string {
    if (!path) {
      return '';
    }
    if (path.startsWith('http://') || path.startsWith('https://')) {
      return path;
    }
    if (path.startsWith('/')) {
      return `${this.backendBase}${path}`;
    }
    return `${this.backendBase}/${path}`;
  }

  private showToast(message: string, tone: 'success' | 'error'): void {
    this.toast.set({ message, tone });
    setTimeout(() => {
      this.toast.set(null);
    }, 3500);
  }

  private restoreFilterState(): void {
    try {
      const stored = localStorage.getItem(FILTER_STORAGE_KEY);
      if (!stored) {
        return;
      }
      const parsed = JSON.parse(stored) as {
        developerId?: string | null;
        projectId?: string | null;
        country?: string | null;
        status?: CameraStatusFilter;
        sortMode?: SortMode;
        search?: string;
      };
      this.selectedDeveloperId.set(parsed.developerId ?? null);
      this.selectedProjectId.set(parsed.projectId ?? null);
      this.selectedCountry.set(parsed.country ?? null);
      this.selectedCameraStatus.set(parsed.status ?? 'all');
      this.sortMode.set(parsed.sortMode ?? 'developer');
      this.searchTerm.set(parsed.search ?? '');
    } catch {
      // ignore malformed storage
    }
  }

  private persistCameraStatus(camera: CameraViewModel, status: string): void {
    if (this.cameraStatusUpdating().has(camera.id)) {
      return;
    }

    this.cameraStatusUpdating.update((set) => new Set(set).add(camera.id));

    this.cameraService
      .updateStatus(camera.id, status)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => {
          this.cameraStatusUpdating.update((set) => {
            const next = new Set(set);
            next.delete(camera.id);
            return next;
          });
        }),
        catchError((error) => {
          console.error('Failed to update camera status', error);
          this.showToast('Unable to update camera status.', 'error');
          return of<Camera | null>(null);
        }),
      )
      .subscribe((updated) => {
        if (!updated) {
          return;
        }

        const updatedRaw = this.normalizeCameraStatusRaw(updated.status);
        const projectStatusNormalized = this.normalizeProjectStatus(camera.projectStatus);
        const health = this.cameraHealthData().get(camera.id) ?? null;
        const derivedStatus = this.deriveCameraStatus(
          projectStatusNormalized,
          updatedRaw,
          camera.lastUpdatedAt,
          health,
          camera.maintenanceStatusPhotoDirty ?? false,
          camera.lastMaintenanceCompletedAt ?? null,
        );

        this.cameraRecords.update((list) =>
          list.map((item) =>
            item.id === camera.id
              ? {
                  ...item,
                  cameraStatusRaw: updatedRaw,
                  status: derivedStatus,
                  camera: { ...item.camera, status: updated.status },
                }
              : item,
          ),
        );

        this.cameraService.clearCache();

        this.showToast('Camera status updated.', 'success');
      });
  }

  private persistCameraCountry(
    camera: CameraViewModel,
    country: string,
    onComplete?: (success: boolean) => void,
  ): void {
    if (this.cameraCountryUpdating().has(camera.id)) {
      return;
    }

    const normalizedCountry = this.coerceCountryValue(country);

    this.cameraCountryUpdating.update((set) => new Set(set).add(camera.id));

    this.cameraService
      .update(camera.id, { country: normalizedCountry })
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => {
          this.cameraCountryUpdating.update((set) => {
            const next = new Set(set);
            next.delete(camera.id);
            return next;
          });
        }),
        catchError((error) => {
          console.error('Failed to update camera country', error);
          this.showToast('Unable to update camera country.', 'error');
          onComplete?.(false);
          return of<Camera | null>(null);
        }),
      )
      .subscribe((updated) => {
        if (!updated) {
          return;
        }

        const updatedCountry = (updated.country ?? '').trim();
        const updatedStatusRaw = this.normalizeCameraStatusRaw(updated.status);
        const projectStatusNormalized = this.normalizeProjectStatus(camera.projectStatus);
        const health = this.cameraHealthData().get(camera.id) ?? null;
        const derivedStatus = this.deriveCameraStatus(
          projectStatusNormalized,
          updatedStatusRaw,
          camera.lastUpdatedAt,
          health,
          camera.maintenanceStatusPhotoDirty ?? false,
          camera.lastMaintenanceCompletedAt ?? null,
        );

        this.cameraRecords.update((list) =>
          list.map((item) =>
            item.id === camera.id
              ? {
                  ...item,
                  country: updatedCountry,
                  cameraStatusRaw: updatedStatusRaw,
                  status: derivedStatus,
                  camera: { ...item.camera, country: updated.country, status: updated.status },
                }
              : item,
          ),
        );

        this.cameraService.clearCache();

        this.showToast('Camera country updated.', 'success');
        onComplete?.(true);
      });
  }

  private normalizeProjectStatus(status: string | undefined): string {
    return (status ?? '').toString().trim().toLowerCase();
  }

  private normalizeCameraStatusRaw(status: string | undefined): string {
    return (status ?? '').toString().trim().toLowerCase();
  }

  private deriveCameraStatus(
    projectStatus: string,
    cameraStatusRaw: string,
    lastUpdatedAt: Date | null,
    health: CameraHealthResponse | null = null,
    hasPhotoDirty = false,
    lastMaintenanceCompletedAt: Date | null = null,
  ): CameraStatus {
    // 1) Finished always wins
    if (cameraStatusRaw === 'finished') {
      return 'finished';
    }

    // 2) Determine if camera is offline based on last update time
    const minutes = this.minutesSince(lastUpdatedAt);
    const isOffline = minutes === null || minutes >= UPDATE_THRESHOLD_MINUTES;

    if (isOffline) {
      // For offline cameras, keep statuses in the offline family
      if (cameraStatusRaw === 'network') {
        return 'offline_network';
      }
      if (cameraStatusRaw === 'hold') {
        return 'offline_hold';
      }
      return 'offline';
    }

    // 3) Camera is online – compute maintenance-related flags
    const hasLowImages = !!(health && health.totalImages < 140 && !health.error);

    let isLongTime = false;
    if (lastMaintenanceCompletedAt) {
      const diffMs = this.currentTime() - lastMaintenanceCompletedAt.getTime();
      const diffDays = diffMs / (1000 * 60 * 60 * 24);
      if (diffDays > MAINTENANCE_THRESHOLD_DAYS) {
        isLongTime = true;
      }
    } else {
      // Never maintained -> long time
      isLongTime = true;
    }

    const projectMaintenance =
      projectStatus === 'maintenance' || projectStatus === 'maintenance_hold';

    const hasAnyMaintenanceReason =
      projectMaintenance || hasLowImages || hasPhotoDirty || isLongTime;

    // 4) If there is no maintenance reason at all → stay Online
    if (!hasAnyMaintenanceReason) {
      return 'online';
    }

    // 5) There is at least one maintenance reason – choose the maintenance status variant
    // Hold from raw status or project forces maintenance_hold
    if (cameraStatusRaw === 'hold' || projectStatus === 'maintenance_hold') {
      return 'maintenance_hold';
    }

    // Long time takes precedence over the base "maintenance" status
    if (isLongTime) {
      return 'maintenance_long_time';
    }

    // Otherwise, generic maintenance (less image, photo dirty, or project maintenance)
    return 'maintenance';
  }

  private matchesCameraStatus(camera: CameraViewModel, status: CameraStatusFilter): boolean {
    if (status === 'all') {
      return true;
    }

    // Offline "all" filter: only shows cameras with status 'offline', not hold/network variants
    if (status === 'offline') {
      return camera.status === 'offline';
    }

    // Maintenance "all" filter: shows all maintenance statuses except 'maintenance_hold'
    if (status === 'maintenance') {
      return (
        camera.status === 'maintenance' ||
        camera.status === 'maintenance_long_time'
      );
    }

    // Virtual filter: maintenance / less image (maintenance, but exclude hold tab)
    if (status === 'maintenance_less_images') {
      const isMaintenanceStatus =
        camera.status === 'maintenance' ||
        camera.status === 'maintenance_long_time';
      const hasLessImages = !!(camera.maintenanceLowImages || camera.maintenanceStatusLowImages);
      return isMaintenanceStatus && hasLessImages;
    }

    // Virtual filter: maintenance / photo dirty (maintenance, but exclude hold tab)
    if (status === 'maintenance_photo_dirty') {
      const isMaintenanceStatus =
        camera.status === 'maintenance' || camera.status === 'maintenance_long_time';
      return isMaintenanceStatus && !!camera.maintenanceStatusPhotoDirty;
    }

    // Virtual filter: device expired (under maintenance)
    if (status === 'device_expired') {
      // Only show cameras that are in maintenance status AND device is expired
      const isMaintenanceStatus =
        camera.status === 'maintenance' || camera.status === 'maintenance_long_time';
      if (!isMaintenanceStatus) {
        return false;
      }
      // Check if device is expired based on installedDate or expiration date
      const cameraData = camera.camera;
      if (cameraData.installedDate) {
        const installedDate = new Date(cameraData.installedDate);
        const now = new Date();
        // Assuming device expires after a certain period (e.g., 5 years)
        // This logic should be adjusted based on actual requirements
        const expirationPeriod = 5 * 365 * 24 * 60 * 60 * 1000; // 5 years in milliseconds
        const expirationDate = new Date(installedDate.getTime() + expirationPeriod);
        return now > expirationDate;
      }
      // Check for explicit expiration date if available
      const expirationDate = (cameraData as any).expirationDate || (cameraData as any).deviceExpirationDate;
      if (expirationDate) {
        return new Date() > new Date(expirationDate);
      }
      return false;
    }

    // Virtual filter: memory full (under maintenance)
    if (status === 'memory_full') {
      // Only show cameras that are in maintenance status AND memory is full
      const isMaintenanceStatus =
        camera.status === 'maintenance' || camera.status === 'maintenance_long_time';
      if (!isMaintenanceStatus) {
        return false;
      }
      // Check if memory is full based on memory data
      // This can be extended to check actual memory data from memory service
      const cameraData = camera.camera;
      const memoryAvailable = (cameraData as any).memoryAvailable;
      if (memoryAvailable) {
        // Parse memory available (could be in format like "5 GB" or "5000 MB")
        const memoryValue = this.parseMemorySize(memoryAvailable);
        // Consider memory full if less than 1 GB available
        return memoryValue < 1;
      }
      // Check if memoryUsed indicates full memory
      const memoryUsed = (cameraData as any).memoryUsed;
      if (memoryUsed) {
        const usedValue = this.parseMemorySize(memoryUsed);
        // If memory used is very high (e.g., > 95%), consider it full
        // This is a placeholder - actual logic should check total memory capacity
        return usedValue > 0 && (cameraData as any).memoryPercentage > 95;
      }
      return false;
    }

    // Exact match for all other statuses
    return camera.status === status;
  }

  private parseMemorySize(memorySize: string): number {
    if (!memorySize || typeof memorySize !== 'string') {
      return 0;
    }
    const normalized = memorySize.trim().toUpperCase();
    const match = normalized.match(/^([\d.]+)\s*(GB|MB|KB|B)?$/);
    if (!match) {
      return 0;
    }
    const value = parseFloat(match[1]);
    const unit = match[2] || 'GB';
    switch (unit) {
      case 'GB':
        return value;
      case 'MB':
        return value / 1024;
      case 'KB':
        return value / (1024 * 1024);
      case 'B':
        return value / (1024 * 1024 * 1024);
      default:
        return value;
    }
  }

  private coerceCountryValue(value: string): string {
    const trimmed = value.trim();
    for (const allowed of ALLOWED_COUNTRIES) {
      if (trimmed.localeCompare(allowed, undefined, { sensitivity: 'base' }) === 0) {
        return allowed;
      }
    }
    return '';
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    if (
      !target.closest('.multi-select-dropdown') &&
      !target.closest('button[type="button"]')
    ) {
      this.isTaskAssistantsDropdownOpen.set(false);
    }
  }
}

