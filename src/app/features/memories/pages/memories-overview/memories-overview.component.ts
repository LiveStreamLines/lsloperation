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
import { catchError, finalize } from 'rxjs/operators';
import { of } from 'rxjs';
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

interface MemoryFilterOption {
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
  createdDate?: string;
  endDate?: string;
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

  readonly updatingMemoryIds = signal<Set<string>>(new Set());

  readonly showLowMemoryToggle = computed(() => this.selectedStatus() === 'active');

  private readonly baseStatusOptions: MemoryFilterOption[] = [
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

  readonly developerMapByTag = computed(() => {
    const map = new Map<string, Developer>();
    for (const developer of this.developers()) {
      const tag = this.normalizeTag(developer.developerTag);
      if (tag) {
        map.set(tag, developer);
      }
    }
    return map;
  });

  readonly projectMapByTag = computed(() => {
    const map = new Map<string, Project>();
    for (const project of this.projects()) {
      const tag = this.normalizeTag(this.extractProjectTag(project));
      if (tag) {
        map.set(tag, project);
      }
    }
    return map;
  });

  readonly cameraMapByTag = computed(() => {
    const map = new Map<string, Camera>();
    for (const camera of this.cameras()) {
      const tag = this.normalizeTag(camera.camera);
      if (tag) {
        map.set(tag, camera);
      }
    }
    return map;
  });

  readonly normalizedMemories = computed<UiMemory[]>(() =>
    this.memories().map((memory) => this.decorateMemory(memory)),
  );

  readonly developerOptions = computed<MemoryFilterOption[]>(() => {
    const seen = new Map<string, string>();
    for (const memory of this.normalizedMemories()) {
      if (!memory.developerTag) {
        continue;
      }
      if (!seen.has(memory.developerTag)) {
        seen.set(memory.developerTag, memory.developerLabel);
      }
    }
    return Array.from(seen.entries())
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  });

  readonly projectOptions = computed<MemoryFilterOption[]>(() => {
    const selectedDeveloperTag = this.normalizeTag(this.selectedDeveloper());
    const seen = new Map<string, string>();

    for (const memory of this.normalizedMemories()) {
      if (selectedDeveloperTag && memory.developerTag !== selectedDeveloperTag) {
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

  readonly cameraOptions = computed<MemoryFilterOption[]>(() => {
    const selectedDeveloperTag = this.normalizeTag(this.selectedDeveloper());
    const selectedProjectTag = this.normalizeTag(this.selectedProject());
    const seen = new Map<string, string>();

    for (const memory of this.normalizedMemories()) {
      if (selectedDeveloperTag && memory.developerTag !== selectedDeveloperTag) {
        continue;
      }
      if (selectedProjectTag && memory.projectTag !== selectedProjectTag) {
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

  readonly statusOptions = computed<MemoryFilterOption[]>(() => {
    const role = this.memoryRole();
    if (role === 'removal') {
      return this.baseStatusOptions.filter((option) => option.value === 'active');
    }
    if (role === 'archiver') {
      return this.baseStatusOptions.filter((option) => option.value === 'removed');
    }
    return this.baseStatusOptions;
  });

  readonly filteredMemories = computed<UiMemory[]>(() =>
    this.applyFilters(this.normalizedMemories()),
  );

  readonly metricCards = computed<MemoryMetricCard[]>(() => {
    const list = this.filteredMemories();
    const total = list.length;
    const active = list.filter((memory) => memory.status === 'active').length;
    const removed = list.filter((memory) => memory.status === 'removed').length;
    const archived = list.filter((memory) => memory.status === 'archived').length;
    const lowMemory = list.filter((memory) => this.isLowMemory(memory)).length;

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
        value: lowMemory.toString(),
        helper: '< 10GB available',
        tone: lowMemory > 0 ? 'warning' : 'positive',
      },
    ];
  });

  constructor() {
    effect(() => {
      const role = this.memoryRole();
      const currentStatus = this.selectedStatus();
      if (role === 'removal' && currentStatus !== 'active') {
        if (this.showLowMemoryOnly()) {
          this.showLowMemoryOnly.set(false);
        }
        this.selectedStatus.set('active');
        return;
      }
      if (role === 'archiver' && currentStatus !== 'removed') {
        if (this.showLowMemoryOnly()) {
          this.showLowMemoryOnly.set(false);
        }
        this.selectedStatus.set('removed');
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
    this.selectedStatus.set(
      this.memoryRole() === 'removal'
        ? 'active'
        : this.memoryRole() === 'archiver'
          ? 'removed'
          : null,
    );
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
      case 'active':
        return 'default';
      case 'removed':
        return 'warning';
      case 'archived':
        return 'positive';
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

  isUpdating(memoryId: string): boolean {
    return this.updatingMemoryIds().has(memoryId);
  }

  updateMemoryStatus(memory: UiMemory, status: MemoryStatus): void {
    if (this.isUpdating(memory.id)) {
      return;
    }

    const payload = this.buildStatusPayload(status);
    this.errorMessage.set(null);
    this.addUpdating(memory.id);

    this.memoryService
      .update(memory.id, { status, ...payload })
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        catchError((error) => {
          console.error('Failed to update memory status', error);
          this.errorMessage.set('Unable to update memory status. Please try again.');
          return of(null);
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

    const developer = developerTag ? this.developerMapByTag().get(developerTag) : undefined;
    const project = projectTag ? this.projectMapByTag().get(projectTag) : undefined;
    const camera = cameraTag ? this.cameraMapByTag().get(cameraTag) : undefined;

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
      cameraLabel: camera ? this.extractCameraLabel(camera) : memory.camera ?? 'Unknown camera',
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
      createdDate: memory.createdDate,
      endDate: memory.endDate,
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

  private normalizeTag(value: string | null | undefined): string {
    if (!value || typeof value !== 'string') {
      return '';
    }
    return value.trim().toLowerCase();
  }

  private extractProjectTag(project: Project): string | undefined {
    if (typeof project.projectTag === 'string' && project.projectTag.trim().length > 0) {
      return project.projectTag;
    }
    if (typeof project._id === 'string' && project._id.trim().length > 0) {
      return project._id;
    }
    return undefined;
  }

  private extractProjectName(project: Project): string {
    if (typeof project.projectName === 'string' && project.projectName.trim().length > 0) {
      return project.projectName;
    }
    if (typeof project.projectTag === 'string' && project.projectTag.trim().length > 0) {
      return project.projectTag;
    }
    if (typeof project._id === 'string' && project._id.trim().length > 0) {
      return project._id;
    }
    return 'Unknown project';
  }

  private extractCameraLabel(camera: Camera): string {
    if (typeof camera.cameraDescription === 'string' && camera.cameraDescription.length > 0) {
      return camera.cameraDescription;
    }
    return camera.camera ?? 'Unknown camera';
  }

  private normalizeStatus(status: string | undefined): MemoryStatus {
    const normalized = (status ?? 'active').toString().trim().toLowerCase();
    if (normalized === 'removed') {
      return 'removed';
    }
    if (normalized === 'archived') {
      return 'archived';
    }
    return 'active';
  }

  private resolveNumberOfPictures(memory: Memory): number | null {
    const primary = memory.numberofpics ?? memory.numberOfPics;
    if (typeof primary === 'number' && Number.isFinite(primary)) {
      return primary;
    }
    const fallback = memory['numberofpic'] ?? memory['numberOfPic'];
    if (typeof fallback === 'number' && Number.isFinite(fallback)) {
      return fallback;
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

  private addUpdating(id: string): void {
    this.updatingMemoryIds.update((current) => {
      const next = new Set(current);
      next.add(id);
      return next;
    });
  }

  private removeUpdating(id: string): void {
    this.updatingMemoryIds.update((current) => {
      const next = new Set(current);
      next.delete(id);
      return next;
    });
  }

  private replaceMemory(updated: Memory): void {
    this.memories.update((current) =>
      current.map((memory) => (memory._id === updated._id ? { ...memory, ...updated } : memory)),
    );
  }

  private buildStatusPayload(status: MemoryStatus): Partial<Omit<Memory, 'status'>> {
    const now = new Date().toISOString();
    const user = this.userName();

    if (status === 'removed') {
      return {
        dateOfRemoval: now,
        RemovalUser: user,
        dateOfReceive: undefined,
        RecieveUser: undefined,
      };
    }

    if (status === 'archived') {
      return {
        dateOfReceive: now,
        RecieveUser: user,
      };
    }

    return {};
  }
}
