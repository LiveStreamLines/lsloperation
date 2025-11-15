import { CommonModule } from '@angular/common';
import {
  Component,
  DestroyRef,
  OnInit,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { of } from 'rxjs';
import { catchError, finalize } from 'rxjs/operators';
import { MemoryService } from '@core/services/memory.service';
import { DeveloperService } from '@core/services/developer.service';
import { ProjectService } from '@core/services/project.service';
import { CameraService } from '@core/services/camera.service';
import { Memory, MemoryStatus } from '@core/models/memory.model';
import { Developer } from '@core/models/developer.model';
import { Project } from '@core/models/project.model';
import { Camera } from '@core/models/camera.model';
import { AuthStore } from '@core/auth/auth.store';

interface MemoryMetricCard {
  title: string;
  value: string;
  helper: string;
  tone: 'default' | 'positive' | 'warning';
}

interface FilterOption {
  value: string;
  label: string;
}

interface UiMemory {
  id: string;
  developerTag: string;
  developerLabel: string;
  projectTag: string;
  projectLabel: string;
  cameraTag: string;
  cameraLabel: string;
  status: MemoryStatus;
  memoryUsed?: string;
  memoryAvailable?: string;
  memoryAvailableValue: number | null;
  numberOfPictures: number | null;
  shutterCount: number | null;
  startDate?: string;
  endDisplayDate?: string;
  endSource?: 'end' | 'removed' | 'archived';
  endUser?: string;
  dateOfRemoval?: string;
  dateOfReceive?: string;
  removalUser?: string;
  receiveUser?: string;
  raw: Memory;
}

type MemoryRole = 'removal' | 'archiver' | 'viewer' | 'stock' | string;

@Component({
  selector: 'app-memories-overview',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './memories-overview.component.html',
})
export class MemoriesOverviewComponent implements OnInit {
  private readonly memoryService = inject(MemoryService);
  private readonly developerService = inject(DeveloperService);
  private readonly projectService = inject(ProjectService);
  private readonly cameraService = inject(CameraService);
  private readonly authStore = inject(AuthStore);
  private readonly destroyRef = inject(DestroyRef);

  readonly isLoading = signal(true);
  readonly errorMessage = signal<string | null>(null);

  readonly memories = signal<Memory[]>([]);
  readonly developers = signal<Developer[]>([]);
  readonly projects = signal<Project[]>([]);
  readonly cameras = signal<Camera[]>([]);

  readonly selectedDeveloper = signal<string | null>(null);
  readonly selectedProject = signal<string | null>(null);
  readonly selectedCamera = signal<string | null>(null);
  readonly selectedStatus = signal<MemoryStatus | null>(null);
  readonly showLowMemoryOnly = signal(false);

  readonly updatingIds = signal<Set<string>>(new Set());

  private readonly baseStatusOptions: FilterOption[] = [
    { value: 'all', label: 'All statuses' },
    { value: 'active', label: 'Active' },
    { value: 'removed', label: 'Removed' },
    { value: 'archived', label: 'Archived' },
  ];

  readonly memoryRole = computed<MemoryRole | null>(() => {
    const user = this.authStore.user();
    const role =
      (user?.['memoryRole'] as string | undefined) ??
      (user?.['memoryrole'] as string | undefined);
    if (!role || typeof role !== 'string') {
      return null;
    }
    const normalized = role.trim().toLowerCase();
    return normalized.length ? normalized : null;
  });

  readonly userRole = computed(() => this.authStore.user()?.role ?? 'Viewer');
  readonly userName = computed(() => this.authStore.user()?.name ?? 'System');

  readonly showLowMemoryToggle = computed(() => this.selectedStatus() === 'active');

  readonly statusOptions = computed<FilterOption[]>(() => {
    const role = this.memoryRole();
    if (role === 'removal') {
      return this.baseStatusOptions.filter((option) => option.value === 'active');
    }
    if (role === 'archiver') {
      return this.baseStatusOptions.filter((option) => option.value === 'removed');
    }
    return this.baseStatusOptions;
  });

  readonly developerOptions = computed<FilterOption[]>(() =>
    this.developers()
      .map((developer) => ({
        value: developer.developerTag ?? developer._id,
        label: developer.developerName,
      }))
      .filter((option) => typeof option.value === 'string' && option.value.trim().length > 0)
      .sort((a, b) => a.label.localeCompare(b.label)),
  );

  readonly projectOptions = computed<FilterOption[]>(() => {
    const developerTag = this.normalizeTag(this.selectedDeveloper());
    const seen = new Map<string, string>();

    for (const memory of this.normalizedMemories()) {
      if (developerTag && memory.developerTag !== developerTag) {
        continue;
      }
      if (!memory.projectTag) {
        continue;
      }
      if (!seen.has(memory.projectTag)) {
        seen.set(memory.projectTag, memory.projectLabel);
      }
    }

    return Array.from(seen.entries())
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  });

  readonly cameraOptions = computed<FilterOption[]>(() => {
    const developerTag = this.normalizeTag(this.selectedDeveloper());
    const projectTag = this.normalizeTag(this.selectedProject());
    const seen = new Map<string, string>();

    for (const memory of this.normalizedMemories()) {
      if (developerTag && memory.developerTag !== developerTag) {
        continue;
      }
      if (projectTag && memory.projectTag !== projectTag) {
        continue;
      }
      if (!memory.cameraTag) {
        continue;
      }
      if (!seen.has(memory.cameraTag)) {
        seen.set(memory.cameraTag, memory.cameraLabel);
      }
    }

    return Array.from(seen.entries())
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  });

  readonly developerMap = computed(() => {
    const map = new Map<string, Developer>();
    for (const developer of this.developers()) {
      const tag = this.normalizeTag(developer.developerTag) || developer._id;
      if (tag) {
        map.set(tag, developer);
      }
    }
    return map;
  });

  readonly projectMap = computed(() => {
    const map = new Map<string, Project>();
    for (const project of this.projects()) {
      const tag = this.normalizeTag(project.projectTag) || project._id;
      if (tag) {
        map.set(tag, project);
      }
    }
    return map;
  });

  readonly cameraMap = computed(() => {
    const map = new Map<string, Camera>();
    for (const camera of this.cameras()) {
      const tag = this.normalizeTag(camera.camera) || camera._id;
      if (tag) {
        map.set(tag, camera);
      }
    }
    return map;
  });

  readonly normalizedMemories = computed<UiMemory[]>(() =>
    this.memories().map((memory) => this.decorateMemory(memory)),
  );

  readonly filteredMemories = computed<UiMemory[]>(() =>
    this.applyFilters(this.normalizedMemories()),
  );

  readonly metricCards = computed<MemoryMetricCard[]>(() => {
    const list = this.filteredMemories();
    const total = list.length;
    const active = list.filter((item) => item.status === 'active').length;
    const removed = list.filter((item) => item.status === 'removed').length;
    const archived = list.filter((item) => item.status === 'archived').length;
    const low = list.filter((item) => this.isLowMemory(item)).length;

    return [
      {
        title: 'Memories',
        value: total.toString(),
        helper: 'Records matching filters',
        tone: 'default',
      },
      {
        title: 'Active',
        value: active.toString(),
        helper: 'Still on site',
        tone: active > 0 ? 'default' : 'positive',
      },
      {
        title: 'Removed',
        value: removed.toString(),
        helper: 'Awaiting archive',
        tone: removed > 0 ? 'warning' : 'positive',
      },
      {
        title: 'Archived',
        value: archived.toString(),
        helper: 'In storage',
        tone: 'positive',
      },
      {
        title: 'Low storage',
        value: low.toString(),
        helper: '< 10GB available',
        tone: low > 0 ? 'warning' : 'positive',
      },
    ];
  });

  constructor() {
    effect(() => {
      const role = this.memoryRole();
      const status = this.selectedStatus();
      if (role === 'removal' && status !== 'active') {
        this.selectedStatus.set('active');
        this.showLowMemoryOnly.set(false);
        return;
      }
      if (role === 'archiver' && status !== 'removed') {
        this.selectedStatus.set('removed');
        this.showLowMemoryOnly.set(false);
        return;
      }

      if (this.selectedStatus() !== 'active' && this.showLowMemoryOnly()) {
        this.showLowMemoryOnly.set(false);
      }
    });
  }

  ngOnInit(): void {
    this.loadReferenceData();
    this.loadMemories();
  }

  onDeveloperChange(value: string): void {
    this.selectedDeveloper.set(value || null);
    this.selectedProject.set(null);
    this.selectedCamera.set(null);
  }

  onProjectChange(value: string): void {
    this.selectedProject.set(value || null);
    this.selectedCamera.set(null);
  }

  onCameraChange(value: string): void {
    this.selectedCamera.set(value || null);
  }

  onStatusChange(value: string): void {
    if (!value || value === 'all') {
      this.selectedStatus.set(null);
      this.showLowMemoryOnly.set(false);
      return;
    }
    const status = value as MemoryStatus;
    this.selectedStatus.set(status);
    if (status !== 'active') {
      this.showLowMemoryOnly.set(false);
    }
  }

  toggleLowMemoryOnly(value: boolean): void {
    this.showLowMemoryOnly.set(value);
  }

  clearFilters(): void {
    this.selectedDeveloper.set(null);
    this.selectedProject.set(null);
    this.selectedCamera.set(null);

    const role = this.memoryRole();
    if (role === 'removal') {
      this.selectedStatus.set('active');
    } else if (role === 'archiver') {
      this.selectedStatus.set('removed');
    } else {
      this.selectedStatus.set(null);
    }

    this.showLowMemoryOnly.set(false);
  }

  isLowMemory(memory: UiMemory): boolean {
    if (memory.status !== 'active') {
      return false;
    }
    if (memory.memoryAvailableValue === null) {
      return false;
    }
    return memory.memoryAvailableValue < 10;
  }

  statusTone(status: MemoryStatus): 'default' | 'positive' | 'warning' {
    switch (status) {
      case 'archived':
        return 'positive';
      case 'removed':
        return 'warning';
      default:
        return 'default';
    }
  }

  canMarkRemoved(memory: UiMemory): boolean {
    if (memory.status !== 'active') {
      return false;
    }
    const role = this.memoryRole();
    const userRole = this.userRole();
    return role === 'removal' || userRole === 'Super Admin';
  }

  canMarkArchived(memory: UiMemory): boolean {
    if (memory.status !== 'removed') {
      return false;
    }
    const role = this.memoryRole();
    const userRole = this.userRole();
    return role === 'archiver' || userRole === 'Super Admin';
  }

  isUpdating(id: string): boolean {
    return this.updatingIds().has(id);
  }

  updateMemoryStatus(memory: UiMemory, status: MemoryStatus): void {
    if (this.isUpdating(memory.id)) {
      return;
    }

    const payload = this.buildStatusPayload(status);
    this.addUpdating(memory.id);
    this.errorMessage.set(null);

    this.memoryService
      .update(memory.id, { status, ...payload })
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        catchError((error) => {
          console.error('Failed to update memory status', error);
          this.errorMessage.set('Unable to update memory status. Please try again.');
          return of<Memory | null>(null);
        }),
        finalize(() => this.removeUpdating(memory.id)),
      )
      .subscribe((updated) => {
        if (!updated) {
          return;
        }
        this.replaceMemory(updated);
      });
  }

  private loadMemories(): void {
    this.isLoading.set(true);
    this.errorMessage.set(null);

    this.memoryService
      .getAll()
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        catchError((error) => {
          console.error('Failed to load memories', error);
          this.errorMessage.set('Unable to load memories from the backend.');
          return of<Memory[]>([]);
        }),
        finalize(() => this.isLoading.set(false)),
      )
      .subscribe((memories) => {
        this.memories.set(memories ?? []);
      });
  }

  private loadReferenceData(): void {
    this.developerService
      .getAll()
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        catchError((error) => {
          console.error('Failed to load developers', error);
          return of<Developer[]>([]);
        }),
      )
      .subscribe((developers) => {
        const sorted = [...developers].sort((a, b) => a.developerName.localeCompare(b.developerName));
        this.developers.set(sorted);
      });

    this.projectService
      .getAll()
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        catchError((error) => {
          console.error('Failed to load projects', error);
          return of<Project[]>([]);
        }),
      )
      .subscribe((projects) => {
        const sorted = [...projects].sort((a, b) =>
          this.extractProjectName(a).localeCompare(this.extractProjectName(b)),
        );
        this.projects.set(sorted);
      });

    this.cameraService
      .getAll()
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        catchError((error) => {
          console.error('Failed to load cameras', error);
          return of<Camera[]>([]);
        }),
      )
      .subscribe((cameras) => {
        const sorted = [...cameras].sort((a, b) =>
          this.extractCameraLabel(a).localeCompare(this.extractCameraLabel(b)),
        );
        this.cameras.set(sorted);
      });
  }

  private decorateMemory(memory: Memory): UiMemory {
    const developerTag = this.normalizeTag(memory.developer);
    const projectTag = this.normalizeTag(memory.project);
    const cameraTag = this.normalizeTag(memory.camera);

    const developer = developerTag ? this.developerMap().get(developerTag) : undefined;
    const project = projectTag ? this.projectMap().get(projectTag) : undefined;

    const numberOfPictures = this.resolveNumberOfPictures(memory);
    const shutterCount = typeof memory.shuttercount === 'number' ? memory.shuttercount : null;
    const memoryAvailableValue = this.parseMemorySize(memory.memoryAvailable);

    const startDate = memory.createdDate;
    let endDate: string | undefined;
    let endSource: 'end' | 'removed' | 'archived' | undefined;
    let endUser: string | undefined;

    if (memory.endDate) {
      endDate = memory.endDate;
      endSource = 'end';
    } else if (memory.dateOfRemoval) {
      endDate = memory.dateOfRemoval;
      endSource = 'removed';
      endUser = memory.RemovalUser ?? undefined;
    } else if (memory.dateOfReceive) {
      endDate = memory.dateOfReceive;
      endSource = 'archived';
      endUser = memory.RecieveUser ?? undefined;
    }

    return {
      id: memory._id,
      developerTag,
      developerLabel: developer?.developerName ?? memory.developer ?? 'Unknown developer',
      projectTag,
      projectLabel: project ? this.extractProjectName(project) : memory.project ?? 'Unknown project',
      cameraTag,
      cameraLabel: memory.camera ?? 'Unknown camera',
      status: this.normalizeStatus(memory.status),
      memoryUsed: memory.memoryUsed,
      memoryAvailable: memory.memoryAvailable,
      memoryAvailableValue,
      numberOfPictures,
      shutterCount,
      startDate,
      endDisplayDate: endDate,
      endSource,
      endUser,
      dateOfRemoval: memory.dateOfRemoval,
      dateOfReceive: memory.dateOfReceive,
      removalUser: memory.RemovalUser,
      receiveUser: memory.RecieveUser,
      raw: memory,
    };
  }

  private applyFilters(memories: UiMemory[]): UiMemory[] {
    const developer = this.normalizeTag(this.selectedDeveloper());
    const project = this.normalizeTag(this.selectedProject());
    const camera = this.normalizeTag(this.selectedCamera());
    const status = this.selectedStatus();
    const lowOnly = this.showLowMemoryOnly();

    return memories.filter((memory) => {
      if (developer && memory.developerTag !== developer) {
        return false;
      }
      if (project && memory.projectTag !== project) {
        return false;
      }
      if (camera && memory.cameraTag !== camera) {
        return false;
      }
      if (status && memory.status !== status) {
        return false;
      }
      if (lowOnly && !this.isLowMemory(memory)) {
        return false;
      }
      return true;
    });
  }

  private normalizeStatus(status: string | undefined): MemoryStatus {
    const normalized = (status ?? 'active').toString().trim().toLowerCase();
    if (normalized === 'archived') {
      return 'archived';
    }
    if (normalized === 'removed') {
      return 'removed';
    }
    return 'active';
  }

  private normalizeTag(value: string | null | undefined): string {
    if (!value || typeof value !== 'string') {
      return '';
    }
    return value.trim().toLowerCase();
  }

  private resolveNumberOfPictures(memory: Memory): number | null {
    const primary = memory.numberofpics ?? memory.numberOfPics;
    if (typeof primary === 'number' && Number.isFinite(primary)) {
      return primary;
    }
    const alternative = memory['numberofpic'] ?? memory['numberOfPic'];
    if (typeof alternative === 'number' && Number.isFinite(alternative)) {
      return alternative;
    }
    return null;
  }

  private parseMemorySize(value: string | undefined): number | null {
    if (!value) {
      return null;
    }
    const numeric = parseFloat(value.replace(/[^\d.]/g, ''));
    if (Number.isFinite(numeric)) {
      return numeric;
    }
    return null;
  }

  private extractProjectName(project: Project): string {
    if (project.projectName && typeof project.projectName === 'string') {
      return project.projectName;
    }
    if (project.projectTag && typeof project.projectTag === 'string') {
      return project.projectTag;
    }
    if (project._id) {
      return project._id;
    }
    return 'Unknown project';
  }

  private extractCameraLabel(camera: Camera): string {
    if (camera.cameraDescription && typeof camera.cameraDescription === 'string') {
      return camera.cameraDescription;
    }
    if (camera.camera && typeof camera.camera === 'string') {
      return camera.camera;
    }
    if (camera._id) {
      return camera._id;
    }
    return 'Unknown camera';
  }

  private replaceMemory(updated: Memory): void {
    this.memories.update((current) =>
      current.map((item) => (item._id === updated._id ? { ...item, ...updated } : item)),
    );
  }

  private addUpdating(id: string): void {
    this.updatingIds.update((current) => {
      const next = new Set(current);
      next.add(id);
      return next;
    });
  }

  private removeUpdating(id: string): void {
    this.updatingIds.update((current) => {
      const next = new Set(current);
      next.delete(id);
      return next;
    });
  }

  private buildStatusPayload(status: MemoryStatus): Partial<Omit<Memory, 'status'>> {
    const now = new Date().toISOString();
    const actor = this.userName();

    if (status === 'removed') {
      return {
        dateOfRemoval: now,
        RemovalUser: actor,
        dateOfReceive: undefined,
        RecieveUser: undefined,
      };
    }

    if (status === 'archived') {
      return {
        dateOfReceive: now,
        RecieveUser: actor,
      };
    }

    return {};
  }
}
