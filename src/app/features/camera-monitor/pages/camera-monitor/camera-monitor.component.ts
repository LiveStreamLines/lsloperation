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
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { combineLatest, of } from 'rxjs';
import { catchError, finalize } from 'rxjs/operators';
import { environment } from '@env';
import {
  Camera,
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
  | 'finished';

type CameraStatusFilter = 'all' | CameraStatus;

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
  assignedUsers: string[];
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
  imports: [CommonModule, FormsModule],
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
    assignedUsers: [],
    isSaving: false,
    error: null,
  });

  readonly projectInfoState = signal<ProjectInfoState | null>(null);
  readonly editCountryModal = signal<EditCountryModalState | null>(null);

  readonly imageLoadState = signal<Record<string, boolean>>({});
  readonly cameraStatusUpdating = signal<Set<string>>(new Set());
  readonly cameraCountryUpdating = signal<Set<string>>(new Set());

  readonly taskTypes = LEGACY_TASK_TYPES;

  readonly cameraStatusOptions: Array<{ value: CameraStatusFilter; label: string }> = [
    { value: 'all', label: 'All statuses' },
    { value: 'online', label: 'Online' },
    { value: 'offline', label: 'Offline' },
    { value: 'offline_hold', label: 'Offline / hold' },
    { value: 'offline_network', label: 'Offline / network' },
    { value: 'maintenance', label: 'Maintenance' },
    { value: 'maintenance_hold', label: 'Maintenance / hold' },
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

  readonly filteredCameras = computed<CameraViewModel[]>(() => {
    const cameras = this.cameraRecords();
    const developerId = this.selectedDeveloperId();
    const projectId = this.selectedProjectId();
    const countryFilter = this.selectedCountry();
    const statusFilter = this.selectedCameraStatus();
    const search = this.searchTerm().trim().toLowerCase();
    const sort = this.sortMode();

    let list = cameras;

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
    if (camera.status === 'online') {
      return 'Updated';
    }
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
        return 'Online';
      case 'offline':
        return 'Offline';
      case 'offline_hold':
        return 'Offline / hold';
      case 'offline_network':
        return 'Offline / network';
      case 'maintenance':
        return 'Maintenance';
      case 'maintenance_hold':
        return 'Maintenance / hold';
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

  openTaskModal(camera: CameraViewModel): void {
    this.taskModalCamera.set(camera);
    this.taskForm.set({
      taskType: '',
      taskDescription: '',
      assignedUsers: [],
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

  onTaskAssignedUsersChange(event: Event): void {
    const target = event.target as HTMLSelectElement | null;
    if (!target) {
      return;
    }

    const assignedUsers = Array.from(target.selectedOptions).map((option) => option.value);

    this.taskForm.update((state) => ({
      ...state,
      assignedUsers,
      error: null,
    }));
  }

  // Multi-select dropdown state for create task assigned users
  readonly isTaskAssignedUsersDropdownOpen = signal(false);

  toggleTaskAssignedUsersDropdown(): void {
    this.isTaskAssignedUsersDropdownOpen.update((v) => !v);
  }

  toggleTaskAssignedUserSelection(userId: string): void {
    const current = this.taskForm().assignedUsers;
    let newSelection: string[];

    if (current.includes(userId)) {
      newSelection = current.filter((id) => id !== userId);
    } else {
      newSelection = [...current, userId];
    }

    this.taskForm.update((state) => ({
      ...state,
      assignedUsers: newSelection,
      error: null,
    }));
  }

  removeTaskAssignedUser(userId: string): void {
    const current = this.taskForm().assignedUsers;
    const newSelection = current.filter((id) => id !== userId);

    this.taskForm.update((state) => ({
      ...state,
      assignedUsers: newSelection,
      error: null,
    }));
  }

  isTaskAssignedUserSelected(userId: string): boolean {
    return this.taskForm().assignedUsers.includes(userId);
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
    if (!form.taskType.trim() || !form.taskDescription.trim() || form.assignedUsers.length === 0) {
      this.taskForm.update((state) => ({
        ...state,
        error: 'Task type, description, and at least one engineer are required.',
      }));
      return;
    }

    const payload: MaintenanceCreateRequest = {
      taskType: form.taskType.trim(),
      taskDescription: form.taskDescription.trim(),
      assignedUsers: [...form.assignedUsers],
      status: 'pending',
      cameraId: camera.id,
      developerId: camera.developerId,
      projectId: camera.projectId,
      dateOfRequest: new Date().toISOString(),
      userComment: '',
    };

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
    this.router.navigate(['/camera-history', camera.id]);
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
        this.developers.set(this.sortByName(developers, (item) => item.developerName));
        this.projects.set(this.sortByName(projects, (item) => item.projectName));
        this.cameraRecords.set(this.buildCameraRecords(cameras, developers, projects, lastPictures));
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

  private buildCameraRecords(
    cameras: Camera[],
    developers: Developer[],
    projects: Project[],
    lastPictures: CameraLastPicture[],
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
      const lastUpdatedAt =
        this.parseLastPhotoTime(lastPicture?.lastPhotoTime) ??
        this.parseLegacyTimestamp(lastPicture?.lastPhoto ?? '');
      const projectStatusNormalized = this.normalizeProjectStatus(project?.status);
      const cameraStatusRaw = this.normalizeCameraStatusRaw(camera.status);
      const cameraStatus = this.deriveCameraStatus(projectStatusNormalized, cameraStatusRaw, lastUpdatedAt);
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
      };
    });
  }

  private parseLastPhotoTime(value?: string): Date | null {
    if (!value) {
      return null;
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private parseLegacyTimestamp(value?: string): Date | null {
    if (!value || value.length < 14) {
      return null;
    }
    const year = Number.parseInt(value.slice(0, 4), 10);
    const month = Number.parseInt(value.slice(4, 6), 10) - 1;
    const day = Number.parseInt(value.slice(6, 8), 10);
    const hour = Number.parseInt(value.slice(8, 10), 10);
    const minute = Number.parseInt(value.slice(10, 12), 10);
    const second = Number.parseInt(value.slice(12, 14), 10);
    const date = new Date(year, month, day, hour, minute, second);
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
        const derivedStatus = this.deriveCameraStatus(
          projectStatusNormalized,
          updatedRaw,
          camera.lastUpdatedAt,
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
        const derivedStatus = this.deriveCameraStatus(
          projectStatusNormalized,
          updatedStatusRaw,
          camera.lastUpdatedAt,
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
  ): CameraStatus {
    switch (cameraStatusRaw) {
      case 'hold':
        return 'offline_hold';
      case 'network':
        return 'offline_network';
      case 'finished':
        return 'finished';
    }

    switch (projectStatus) {
      case 'maintenance_hold':
        return 'maintenance_hold';
      case 'maintenance':
        return 'maintenance';
      default: {
        const minutes = this.minutesSince(lastUpdatedAt);
        if (minutes !== null && minutes < UPDATE_THRESHOLD_MINUTES) {
          return 'online';
        }
        return 'offline';
      }
    }
  }

  private matchesCameraStatus(camera: CameraViewModel, status: CameraStatusFilter): boolean {
    if (status === 'all') {
      return true;
    }
    return camera.status === status;
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
      this.isTaskAssignedUsersDropdownOpen.set(false);
    }
  }
}

