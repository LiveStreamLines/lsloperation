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
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { firstValueFrom, forkJoin, of } from 'rxjs';
import { catchError, finalize } from 'rxjs/operators';
import { MaintenanceService } from '@core/services/maintenance.service';
import {
  DEFAULT_MAINTENANCE_STATUS_ORDER,
  LEGACY_TASK_TYPES,
  Maintenance,
  MaintenanceAttachment,
  MaintenanceStatus,
  MaintenanceUpdateRequest,
} from '@core/models/maintenance.model';
import { DeveloperService } from '@core/services/developer.service';
import { ProjectService } from '@core/services/project.service';
import { CameraService } from '@core/services/camera.service';
import { MemoryService } from '@core/services/memory.service';
import { Memory, MemoryUpdateRequest } from '@core/models/memory.model';
import { UserService } from '@core/services/user.service';
import { Developer } from '@core/models/developer.model';
import { Project } from '@core/models/project.model';
import { Camera } from '@core/models/camera.model';
import { User } from '@core/models/user.model';
import { AuthStore } from '@core/auth/auth.store';
import { InventoryService } from '@core/services/inventory.service';
import {
  InventoryAssignmentPayload,
  InventoryItem,
  InventoryUserAssignmentPayload,
} from '@core/models/inventory.model';
import { environment } from '@env';

interface MaintenanceMetricCard {
  title: string;
  value: string;
  helper: string;
  tone: 'default' | 'positive' | 'warning';
}

interface FilterOption {
  value: string;
  label: string;
}

interface AssignedUserInfo {
  id: string;
  name: string;
  role?: string;
  image?: string; // User profile image/avatar URL (legacy/alias)
  logo?: string; // User profile image/avatar path (backend field: logos/user/filename)
}

interface UiMaintenance {
  id: string;
  taskType: string;
  taskDescription: string;
  developerId?: string;
  developerName: string;
  projectId?: string;
  projectName: string;
  cameraId?: string;
  cameraName: string;
  assignedUser?: AssignedUserInfo; // Single user - "Assigned to"
  assistants: AssignedUserInfo[]; // Multiple users - "Assistant"
  assignedBy?: AssignedUserInfo;
  status: MaintenanceStatus;
  dateOfRequest?: string;
  createdDate?: string;
  startTime?: string;
  completionTime?: string;
  userComment?: string;
  attachments?: MaintenanceAttachment[];
  isOverdue: boolean;
  durationMinutes?: number | null;
  raw: Maintenance;
}

interface ReplaceMaterialsEntry {
  item: InventoryItem;
  selected: boolean;
  replacementId: string | null;
  context: 'breakdown' | 'maintenance' | null;
}

interface ReplaceMaterialsState {
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
  reason: string;
  entries: ReplaceMaterialsEntry[];
  replacements: InventoryItem[];
}

interface InstallMaterialsState {
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
  cameraHasInventory: boolean;
  grouped: InstallMaterialsGroup[];
  selections: Map<string, string | null>;
  reason: string;
}

interface InstallMaterialsGroup {
  type: string;
  items: InventoryItem[];
  selected?: InventoryItem;
  selectedModel?: string;
  selectedSerial?: string;
}

interface CompletionInventoryState {
  addSelections: Set<string>;
  removeSelections: Set<string>;
  error: string | null;
}

interface CompletionActionReleaseFlags {
  releaseBreakdown?: boolean;
  releaseMaintenance?: boolean;
  releaseAdd?: boolean;
  releaseRemove?: boolean;
  releaseBreakdownReason?: boolean;
}

interface EditTaskFormState {
  taskType: string;
  taskDescription: string;
  assignedUser: string | null; // Single user - "Assigned to"
  assistants: string[]; // Multiple users - "Assistant"
  status: MaintenanceStatus;
  isSaving: boolean;
  error: string | null;
}

interface CompletionChecklist {
  breakdown: boolean;
  breakdownNone: boolean;
  maintenance: {
    enabled: boolean;
    cleaning: boolean;
    viewAdjustment: boolean;
    materialReplacement: boolean;
    lockChecked: boolean;
    memoryChanging: boolean;
    betterViewSurvey: boolean;
  };
  removal: boolean;
  installation: boolean;
  reinstallation: boolean;
  addItems: boolean;
  removeItems: boolean;
}

interface CompleteTaskFormState {
  comment: string;
  isSaving: boolean;
  error: string | null;
  breakdownReason: string;
  actions: CompletionChecklist;
  selectedFiles: File[];
}

interface CancelTaskFormState {
  reason: string;
  isSaving: boolean;
  error: string | null;
}

type ToastTone = 'success' | 'error';

const OVERDUE_THRESHOLD_HOURS = 48;
const MIN_COMPLETION_COMMENT_LENGTH = 10;

@Component({
  selector: 'app-maintenance-overview',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './maintenance-overview.component.html',
})
export class MaintenanceOverviewComponent implements OnInit {
  private readonly maintenanceService = inject(MaintenanceService);
  private readonly developerService = inject(DeveloperService);
  private readonly projectService = inject(ProjectService);
  private readonly cameraService = inject(CameraService);
  private readonly memoryService = inject(MemoryService);
  private readonly userService = inject(UserService);
  private readonly inventoryService = inject(InventoryService);
  private readonly authStore = inject(AuthStore);
  private readonly destroyRef = inject(DestroyRef);

  readonly Math = Math;

  readonly isLoading = signal(true);
  readonly isRefreshing = signal(false);
  readonly errorMessage = signal<string | null>(null);

  readonly tasks = signal<Maintenance[]>([]);
  readonly developers = signal<Developer[]>([]);
  readonly projects = signal<Project[]>([]);
  readonly cameras = signal<Camera[]>([]);
  readonly memories = signal<Memory[]>([]);
  readonly users = signal<User[]>([]);

  readonly selectedDeveloperId = signal<string | null>(null);
  readonly selectedProjectId = signal<string | null>(null);
  readonly selectedCameraId = signal<string | null>(null);
  readonly selectedUserId = signal<string | null>(null);
  readonly selectedAssignedById = signal<string | null>(null);
  readonly selectedTaskType = signal<string | null>(null);
  readonly selectedStatus = signal<MaintenanceStatus | 'all' | null>('pending');
  readonly selectedTaskAssignment = signal<'all' | 'assigned-to-me' | 'assigned-by-me' | null>('all');

  readonly editTaskModal = signal<UiMaintenance | null>(null);
  readonly editTaskForm = signal<EditTaskFormState>({
    taskType: '',
    taskDescription: '',
    assignedUser: null,
    assistants: [],
    status: 'pending',
    isSaving: false,
    error: null,
  });

  readonly completeTaskModal = signal<UiMaintenance | null>(null);
  readonly completeTaskForm = signal<CompleteTaskFormState>({
    comment: '',
    isSaving: false,
    error: null,
    breakdownReason: '',
    selectedFiles: [],
    actions: {
      breakdown: false,
      breakdownNone: false,
      maintenance: {
        enabled: false,
        cleaning: false,
        viewAdjustment: false,
        materialReplacement: false,
        lockChecked: false,
        memoryChanging: false,
        betterViewSurvey: false,
      },
      removal: false,
      installation: false,
      reinstallation: false,
      addItems: false,
      removeItems: false,
    },
  });

  readonly cancelTaskModal = signal<UiMaintenance | null>(null);
  readonly cancelTaskForm = signal<CancelTaskFormState>({
    reason: '',
    isSaving: false,
    error: null,
  });

  readonly completeMaterialsState = signal<ReplaceMaterialsState>({
    isLoading: false,
    isSaving: false,
    error: null,
    reason: '',
    entries: [],
    replacements: [],
  });

  readonly completeInventoryState = signal<CompletionInventoryState>({
    addSelections: new Set<string>(),
    removeSelections: new Set<string>(),
    error: null,
  });

  readonly installMaterialsModal = signal<UiMaintenance | null>(null);
  readonly installMaterialsState = signal<InstallMaterialsState>(this.createEmptyInstallState());

  private readonly emptyReplaceState: ReplaceMaterialsState = {
    isLoading: false,
    isSaving: false,
    error: null,
    reason: '',
    entries: [],
    replacements: [],
  };

  private createEmptyInstallState(): InstallMaterialsState {
    return {
      isLoading: false,
      isSaving: false,
      error: null,
      cameraHasInventory: false,
      grouped: [],
      selections: new Map<string, string | null>(),
      reason: '',
    };
  }

  private resetCompletionInventoryState(): void {
    this.completeInventoryState.set({
      addSelections: new Set<string>(),
      removeSelections: new Set<string>(),
      error: null,
    });
  }

  private clearAddSelections(): void {
    this.completeInventoryState.update((state) => ({
      ...state,
      addSelections: new Set<string>(),
      error: null,
    }));
  }

  private clearRemoveSelections(): void {
    this.completeInventoryState.update((state) => ({
      ...state,
      removeSelections: new Set<string>(),
      error: null,
    }));
  }

  private removeFromRemoveSelections(itemId: string): void {
    this.completeInventoryState.update((state) => {
      if (!state.removeSelections.has(itemId)) {
        return state;
      }
      const selections = new Set(state.removeSelections);
      selections.delete(itemId);
      return {
        ...state,
        removeSelections: selections,
      };
    });
  }

  private createDefaultCompletionActions(): CompletionChecklist {
    return {
      breakdown: false,
      breakdownNone: false,
      maintenance: {
        enabled: false,
        cleaning: false,
        viewAdjustment: false,
        materialReplacement: false,
        lockChecked: false,
        memoryChanging: false,
        betterViewSurvey: false,
      },
      removal: false,
      installation: false,
      reinstallation: false,
      addItems: false,
      removeItems: false,
    };
  }

  readonly toast = signal<{ message: string; tone: ToastTone } | null>(null);

  readonly completionCommentMin = MIN_COMPLETION_COMMENT_LENGTH;

  readonly currentUserId = computed(() => {
    const user = this.authStore.user();
    if (!user) return null;
    // Get user ID - try both 'id' and '_id' fields to handle different data formats
    return (user.id || (user as any)?.['_id'] || (user as any)?._id) as string | null;
  });
  readonly currentUserName = computed(() => this.authStore.user()?.name ?? 'System');
  readonly isSuperAdmin = computed(() => this.authStore.user()?.role === 'Super Admin');
  readonly canSeeAllTasks = computed(() => {
    const user = this.authStore.user();
    return this.isSuperAdmin() || (user as any)?.canSeeAllTasks === true;
  });
  readonly canCreateTask = computed(
    () => this.isSuperAdmin() || ((this.authStore.user() as any)?.canCreateMonitorTask ?? false),
  );

  private readonly baseStatusOptions: FilterOption[] = [
    { value: 'all', label: 'All statuses' },
    ...DEFAULT_MAINTENANCE_STATUS_ORDER.map((status) => ({
      value: status,
      label:
        status === 'in-progress'
          ? 'In progress'
          : status.charAt(0).toUpperCase() + status.slice(1).replace(/-/g, ' '),
    })),
  ];

  readonly statusOptions = computed<FilterOption[]>(() => {
    // All users (including non-super admin without canSeeAllTasks) can see all status filter pills
    // The task filtering logic will handle showing only their own tasks for users without permission
    return this.baseStatusOptions;
  });

  readonly taskTypeOptions = computed<FilterOption[]>(() => {
    const dynamicTypes = new Set<string>();
    for (const task of this.tasks()) {
      if (typeof task.taskType === 'string' && task.taskType.trim()) {
        dynamicTypes.add(task.taskType.trim());
      }
    }
    for (const legacy of LEGACY_TASK_TYPES) {
      if (legacy.trim()) {
        dynamicTypes.add(legacy.trim());
      }
    }
    return Array.from(dynamicTypes.values())
      .sort((a, b) => a.localeCompare(b))
      .map((type) => ({ value: type, label: type }));
  });

  readonly developerOptions = computed<FilterOption[]>(() =>
    [...this.developers()]
      .sort((a, b) => a.developerName.localeCompare(b.developerName))
      .map((developer) => ({ value: developer._id, label: developer.developerName })),
  );

  readonly projectOptions = computed<FilterOption[]>(() => {
    const developerId = this.selectedDeveloperId();
    return this.projects()
      .filter((project) => !developerId || this.extractId(project.developer) === developerId)
      .sort((a, b) => this.extractProjectName(a).localeCompare(this.extractProjectName(b)))
      .map((project) => ({
        value: project._id,
        label: this.extractProjectName(project),
      }));
  });

  readonly cameraOptions = computed<FilterOption[]>(() => {
    const projectId = this.selectedProjectId();
    return this.cameras()
      .filter((camera) => !projectId || this.extractId(camera.project) === projectId)
      .sort((a, b) => this.extractCameraLabel(a).localeCompare(this.extractCameraLabel(b)))
      .map((camera) => ({
        value: camera._id,
        label: this.extractCameraLabel(camera),
      }));
  });

  readonly assignedUserOptions = computed<FilterOption[]>(() =>
    [...this.users()]
      .filter((user) => user.role === 'Admin' || user.role === 'Super Admin')
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((user) => ({
        value: user._id,
        label: `${user.name}${user.role ? ` (${user.role})` : ''}`,
      })),
  );

  readonly assignedByOptions = computed<FilterOption[]>(() => {
    const tasks = this.normalizedTasks();
    const assignedByUserIds = new Set<string>();
    
    tasks.forEach((task) => {
      if (task.assignedBy?.id) {
        assignedByUserIds.add(task.assignedBy.id);
      }
    });

    return [...this.users()]
      .filter((user) => assignedByUserIds.has(user._id))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((user) => ({
        value: user._id,
        label: `${user.name}${user.role ? ` (${user.role})` : ''}`,
      }));
  });

  readonly developerMap = computed(() => new Map(this.developers().map((dev) => [dev._id, dev])));
  readonly projectMap = computed(() => new Map(this.projects().map((proj) => [proj._id, proj])));
  readonly cameraMap = computed(() => new Map(this.cameras().map((cam) => [cam._id, cam])));
  readonly userMap = computed(() => new Map(this.users().map((user) => [user._id, user])));

  readonly normalizedTasks = computed<UiMaintenance[]>(() => {
    const tasks = this.tasks();
    return tasks.map((task) => this.decorateTask(task));
  });

  readonly filteredTasks = computed<UiMaintenance[]>(() => {
    const developerId = this.selectedDeveloperId();
    const projectId = this.selectedProjectId();
    const cameraId = this.selectedCameraId();
    const userId = this.selectedUserId();
    const assignedById = this.selectedAssignedById();
    const taskType = this.selectedTaskType();
    const status = this.selectedStatus();
    const taskAssignment = this.selectedTaskAssignment();
    const isSuperAdmin = this.isSuperAdmin();
    const currentUserId = this.currentUserId();
    const hasSeeAllTasksPermission = this.canSeeAllTasks();

    return this.normalizedTasks()
      .filter((task) => {
        if (developerId && task.developerId !== developerId) {
          return false;
        }
        if (projectId && task.projectId !== projectId) {
          return false;
        }
        if (cameraId && task.cameraId !== cameraId) {
          return false;
        }
        if (taskType && task.taskType !== taskType) {
          return false;
        }
        if (assignedById && task.assignedBy?.id !== assignedById) {
          return false;
        }

        // Check if task is assigned to current user (check assignedUser or assistants)
        const isAssignedToMe = currentUserId && (
          (task.assignedUser && String(task.assignedUser.id) === String(currentUserId)) ||
          task.assistants.some((user) => {
            const userId = user.id;
            return userId && String(userId) === String(currentUserId);
          })
        );

        // Check if task was created by current user
        const rawTask = task.raw;
        const createdBy = (rawTask as any).addedUserId || 
                         (rawTask as any).createdBy || 
                         (rawTask as any).createdById ||
                         (rawTask as any).addedBy;
        const isAssignedByMe = currentUserId && createdBy && String(createdBy) === String(currentUserId);

        // Super Admin or users with "See all tasks" permission: see all tasks
        if (isSuperAdmin || hasSeeAllTasksPermission) {
          if (userId) {
            // Check if user is assigned to or is an assistant
            return (task.assignedUser && task.assignedUser.id === userId) ||
                   task.assistants.some((user) => user.id === userId);
          }
          
          // Apply task assignment filter
          if (taskAssignment === 'assigned-to-me' && !isAssignedToMe) {
            return false;
          }
          if (taskAssignment === 'assigned-by-me' && !isAssignedByMe) {
            return false;
          }
          
          // Apply status filter (only if status is not 'all')
          if (status && status !== 'all' && task.status !== status) {
            return false;
          }
          return true; // See all tasks
        }

        // Users without "See all tasks" permission: only show tasks assigned to them OR tasks they created
        if (!currentUserId) {
          return false; // If no currentUserId, don't show any tasks
        }
        
        // Task must be either assigned to user OR created by user
        const isVisible = isAssignedToMe || isAssignedByMe;
        
        if (!isVisible) {
          return false; // Hide tasks that are not assigned to or created by the user
        }
        
        // Apply task assignment filter to further narrow down
        if (taskAssignment === 'assigned-to-me' && !isAssignedToMe) {
          return false;
        }
        if (taskAssignment === 'assigned-by-me' && !isAssignedByMe) {
          return false;
        }
        
        // Apply status filter to all visible tasks (both assigned and created)
        // Only skip filter if status is 'all' or not set
        if (status && status !== 'all' && task.status !== status) {
          return false;
        }
        
        return true;
      })
      .sort((a, b) => this.compareDatesDesc(this.getLastStatusTime(a), this.getLastStatusTime(b)));
  });

  readonly metricCards = computed<MaintenanceMetricCard[]>(() => {
    const tasks = this.filteredTasks();
    const total = tasks.length;
    const pending = tasks.filter((task) => task.status === 'pending').length;
    const inProgress = tasks.filter((task) => task.status === 'in-progress').length;
    const completed = tasks.filter((task) => task.status === 'completed').length;
    const overdue = tasks.filter((task) => task.isOverdue && task.status !== 'completed').length;
    const myTasks = tasks.filter((task) =>
      (task.assignedUser && task.assignedUser.id === this.currentUserId()) ||
      task.assistants.some((user) => user.id === this.currentUserId()),
    ).length;

    return [
      {
        title: 'Open workload',
        value: (pending + inProgress).toString(),
        helper: `${pending} pending · ${inProgress} in progress`,
        tone: pending + inProgress > 0 ? 'default' : 'positive',
      },
      {
        title: 'Completed tasks',
        value: completed.toString(),
        helper: 'All time',
        tone: completed > 0 ? 'positive' : 'default',
      },
      {
        title: 'Overdue',
        value: overdue.toString(),
        helper: '> 48h without completion',
        tone: overdue > 0 ? 'warning' : 'positive',
      },
      {
        title: 'My assignments',
        value: myTasks.toString(),
        helper: 'Tasks assigned to you',
        tone: myTasks > 0 ? 'default' : 'positive',
      },
      {
        title: 'Filtered total',
        value: total.toString(),
        helper: 'Matches current filters',
        tone: 'default',
      },
    ];
  });

  constructor() {
    effect(() => {
      if (!this.isSuperAdmin()) {
        const currentUserId = this.currentUserId();
        if (currentUserId && this.selectedUserId() !== currentUserId) {
          this.selectedUserId.set(currentUserId);
        }

        const status = this.selectedStatus();
        if (status && status !== 'pending' && status !== 'in-progress') {
          this.selectedStatus.set('pending');
        }
      }
    });
  }

  ngOnInit(): void {
    this.loadReferenceData();
    this.loadMaintenance();
  }

  onDeveloperChange(value: string): void {
    this.selectedDeveloperId.set(value || null);
    this.selectedProjectId.set(null);
    this.selectedCameraId.set(null);
  }

  onProjectChange(value: string): void {
    this.selectedProjectId.set(value || null);
    this.selectedCameraId.set(null);
  }

  onCameraChange(value: string): void {
    this.selectedCameraId.set(value || null);
  }

  onAssignedUserChange(value: string): void {
    this.selectedUserId.set(value || null);
  }

  onAssignedByChange(value: string): void {
    this.selectedAssignedById.set(value || null);
  }

  onTaskTypeChange(value: string): void {
    this.selectedTaskType.set(value || null);
  }

  onStatusChange(value: string): void {
    if (!value || value === 'all') {
      this.selectedStatus.set(null);
      return;
    }
    this.selectedStatus.set(value as MaintenanceStatus);
  }

  onTaskAssignmentChange(value: 'all' | 'assigned-to-me' | 'assigned-by-me'): void {
    this.selectedTaskAssignment.set(value);
  }

  clearFilters(): void {
    this.selectedDeveloperId.set(null);
    this.selectedProjectId.set(null);
    this.selectedCameraId.set(null);
    this.selectedUserId.set(null);
    this.selectedAssignedById.set(null);
    this.selectedTaskType.set(null);
    this.selectedTaskAssignment.set('all');

    if (this.isSuperAdmin()) {
      this.selectedUserId.set(null);
      this.selectedStatus.set(null);
    } else {
      this.selectedUserId.set(this.currentUserId());
      this.selectedStatus.set('pending');
    }
  }

  refresh(): void {
    if (this.isRefreshing()) {
      return;
    }
    this.isRefreshing.set(true);
    this.maintenanceService
      .getAll()
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        catchError((error) => {
          console.error('Failed to refresh maintenance tasks', error);
          this.showToast('Unable to refresh maintenance tasks.', 'error');
          return of<Maintenance[]>([]);
        }),
        finalize(() => this.isRefreshing.set(false)),
      )
      .subscribe((tasks) => {
        if (tasks.length) {
          this.tasks.set(tasks);
        }
      });
  }

  isTaskAssignedToCurrentUser(task: UiMaintenance): boolean {
    const currentUserId = this.currentUserId();
    if (!currentUserId) return false;
    
    // Check if task is assigned to current user (check assignedUser or assistants)
    return (
      (task.assignedUser && String(task.assignedUser.id) === String(currentUserId)) ||
      task.assistants.some((user) => {
        const userId = user.id;
        return userId && String(userId) === String(currentUserId);
      })
    );
  }

  startTask(task: UiMaintenance): void {
    if (!task.raw._id || task.status !== 'pending') {
      return;
    }

    // Only Super Admins can start tasks not assigned to them
    // Normal users (even with canSeeAllTasks permission) can only start tasks assigned to them
    if (!this.isSuperAdmin() && !this.isTaskAssignedToCurrentUser(task)) {
      return;
    }

    this.updateTask(task.raw._id, {
      status: 'in-progress',
      startTime: task.raw.startTime ?? new Date().toISOString(),
      completionTime: undefined,
    });
  }

  openCompleteTaskModal(task: UiMaintenance): void {
    if (!task.raw._id || task.status !== 'in-progress') {
      return;
    }

    // Only Super Admins can complete tasks not assigned to them
    // Normal users (even with canSeeAllTasks permission) can only complete tasks assigned to them
    if (!this.isSuperAdmin() && !this.isTaskAssignedToCurrentUser(task)) {
      return;
    }

    this.completeTaskModal.set(task);
    this.completeTaskForm.set({
      comment: '',
      isSaving: false,
      error: null,
      breakdownReason: '',
      selectedFiles: [],
      actions: this.createDefaultCompletionActions(),
    });

    this.loadMaterialsForCompletion(task);
    this.resetCompletionInventoryState();
  }

  closeCompleteTaskModal(): void {
    this.completeTaskModal.set(null);
    this.completeMaterialsState.set({ ...this.emptyReplaceState });
    this.resetCompletionInventoryState();
  }

  openCancelTaskModal(task: UiMaintenance): void {
    if (!task.raw._id || task.status === 'completed' || task.status === 'cancelled') {
      return;
    }

    // Only Super Admins can cancel tasks not assigned to them
    // Normal users can only cancel tasks assigned to them
    if (!this.isSuperAdmin() && !this.isTaskAssignedToCurrentUser(task)) {
      return;
    }

    this.cancelTaskModal.set(task);
    this.cancelTaskForm.set({
      reason: '',
      isSaving: false,
      error: null,
    });
  }

  closeCancelTaskModal(): void {
    this.cancelTaskModal.set(null);
  }

  onCancelReasonChange(value: string): void {
    this.cancelTaskForm.update((state) => ({
      ...state,
      reason: value,
      error: null,
    }));
  }

  async saveCancelTask(): Promise<void> {
    const task = this.cancelTaskModal();
    if (!task?.raw._id) {
      return;
    }

    const form = this.cancelTaskForm();
    const reason = form.reason.trim();
    if (reason.length < 10) {
      this.cancelTaskForm.update((state) => ({
        ...state,
        error: 'Please provide a cancellation reason (minimum 10 characters).',
      }));
      return;
    }

    this.cancelTaskForm.update((state) => ({ ...state, isSaving: true, error: null }));

    try {
      const payload: MaintenanceUpdateRequest = {
        status: 'cancelled',
        userComment: reason,
      };

      const updated = await firstValueFrom(
        this.maintenanceService.update(task.raw._id, payload).pipe(
          catchError((error) => {
            console.error('Failed to cancel task', error);
            this.cancelTaskForm.update((state) => ({
              ...state,
              isSaving: false,
              error: 'Unable to cancel task. Please try again.',
            }));
            return of(null);
          }),
        ),
      );

      if (updated) {
        this.patchTask(updated);
        this.showToast('Task cancelled successfully.', 'success');
        this.closeCancelTaskModal();
      }
    } catch (error) {
      console.error('Error cancelling task', error);
      this.cancelTaskForm.update((state) => ({
        ...state,
        isSaving: false,
        error: 'An error occurred while cancelling the task.',
      }));
    }
  }

  async saveCompleteTask(): Promise<void> {
    const task = this.completeTaskModal();
    if (!task?.raw._id) {
      return;
    }

    const form = this.completeTaskForm();
    const comment = form.comment.trim();
    if (comment.length < MIN_COMPLETION_COMMENT_LENGTH) {
      this.completeTaskForm.update((state) => ({
        ...state,
        error: `Please provide at least ${MIN_COMPLETION_COMMENT_LENGTH} characters.`,
      }));
      return;
    }

    const materialsState = this.completeMaterialsState();
    const selectedEntries = materialsState.entries.filter((entry) => entry.selected);
    const reason = materialsState.reason.trim();
    const breakdownReasonText = form.breakdownReason.trim();
    const inventoryState = this.completeInventoryState();
    const wantsAddItems =
      form.actions.addItems || form.actions.installation || form.actions.reinstallation;
    const addItemIds = wantsAddItems ? Array.from(inventoryState.addSelections.values()) : [];
    const wantsRemoval = form.actions.removeItems || form.actions.removal;
    const removeItemIds = form.actions.removal
      ? materialsState.entries.map((entry) => entry.item._id)
      : Array.from(inventoryState.removeSelections.values());
    const entryMap = new Map(materialsState.entries.map((entry) => [entry.item._id, entry]));
    const replacementMap = new Map(materialsState.replacements.map((item) => [item._id, item]));
    const currentUserId = this.currentUserId();
    const currentUserName = this.currentUserName();

    if (form.actions.breakdown && form.actions.breakdownNone && breakdownReasonText.length < 5) {
      this.completeTaskForm.update((state) => ({
        ...state,
        error: 'Provide a breakdown reason (minimum 5 characters).',
      }));
      return;
    }

    if (selectedEntries.length && reason.length < 5) {
      this.completeMaterialsState.update((state) => ({
        ...state,
        error: 'Provide a brief reason for the swap (minimum 5 characters).',
      }));
      return;
    }

    this.completeInventoryState.update((state) => ({
      ...state,
      error: null,
    }));

    if (wantsAddItems && addItemIds.length === 0) {
      this.completeInventoryState.update((state) => ({
        ...state,
        error: 'Select at least one item to add to the camera.',
      }));
      return;
    }

    if (form.actions.removeItems && !form.actions.removal && removeItemIds.length === 0) {
      this.completeInventoryState.update((state) => ({
        ...state,
        error: 'Select at least one camera item to remove.',
      }));
      return;
    }

    this.completeTaskForm.update((state) => ({ ...state, isSaving: true, error: null }));
    this.completeMaterialsState.update((state) => ({ ...state, error: null }));

    let finalComment = this.buildCompletionComment(comment, form.actions);
    if (form.actions.breakdown && form.actions.breakdownNone) {
      finalComment = this.appendInventoryNote(
        finalComment,
        `Breakdown (no replacement): ${breakdownReasonText}`,
      );
    }

    try {
      if (selectedEntries.length) {
        const summary = await this.applyMaterialReplacements(task, selectedEntries, reason);
        finalComment = this.appendMaterialComment(finalComment, reason, summary);
      }

      const removalSummaries: string[] = [];
      const removalSet = new Set(removeItemIds);
      if (wantsRemoval && removeItemIds.length) {
        const removalTimestamp = new Date().toISOString();
        const removalReason = `Removed during maintenance task ${task.id} at ${removalTimestamp}`;
        for (const itemId of removeItemIds) {
          const entry = entryMap.get(itemId);
          if (!entry) {
            continue;
          }

          await firstValueFrom(this.inventoryService.unassignFromProject(itemId, removalReason));

          if (entry.item.currentUserAssignment?.userId) {
            await firstValueFrom(this.inventoryService.unassignFromUser(itemId, removalReason));
          }

          if (currentUserId) {
            const payload: InventoryUserAssignmentPayload = {
              userId: currentUserId,
              userName: currentUserName,
              notes: `Removed during maintenance task ${task.id}`,
            };
            await firstValueFrom(this.inventoryService.assignToUser(itemId, payload));
          }

          removalSummaries.push(this.inventoryShortLabel(entry.item));
        }

        if (removalSummaries.length) {
          finalComment = this.appendInventoryNote(
            finalComment,
            `Items removed to technician: ${removalSummaries.join('; ')}`,
          );
          this.completeMaterialsState.update((state) => ({
            ...state,
            entries: state.entries.filter((entry) => !removalSet.has(entry.item._id)),
          }));
        }
      }

      const addSummaries: string[] = [];
      const addSet = new Set(addItemIds);
      if (wantsAddItems && addItemIds.length && task.developerId && task.projectId && task.cameraId) {
        const addNotes = `Installed during maintenance task ${task.id}`;
        for (const itemId of addItemIds) {
          const item = replacementMap.get(itemId);
          if (!item) {
            continue;
          }

          if (item.currentUserAssignment?.userId) {
            await firstValueFrom(this.inventoryService.unassignFromUser(itemId, addNotes));
          }

          await firstValueFrom(
            this.inventoryService.assignToProject(itemId, {
              developer: task.developerId,
              project: task.projectId,
              camera: task.cameraId,
              notes: addNotes,
            }),
          );

          addSummaries.push(this.inventoryShortLabel(item));
        }

        if (addSummaries.length) {
          finalComment = this.appendInventoryNote(
            finalComment,
            `Items added to camera: ${addSummaries.join('; ')}`,
          );
          this.completeMaterialsState.update((state) => ({
            ...state,
            replacements: state.replacements.filter((item) => !addSet.has(item._id)),
          }));
        }
      }

      if (form.actions.removal) {
        this.completeMaterialsState.set({ ...this.emptyReplaceState });
      }

      // If memory was changed during this task, mark the assigned memory as removed (like memories module)
      if (form.actions.maintenance.memoryChanging) {
        const memory = this.getCurrentTaskMemory();
        if (memory?._id) {
          const now = new Date().toISOString();
          const actor = this.currentUserName();
          const payload: MemoryUpdateRequest = {
            status: 'removed',
            dateOfRemoval: now,
            RemovalUser: actor,
            dateOfReceive: undefined,
            RecieveUser: undefined,
          };

          try {
            await firstValueFrom(
              this.memoryService.update(memory._id, payload).pipe(
                takeUntilDestroyed(this.destroyRef),
                catchError((error) => {
                  console.error('Failed to update memory status during task completion', error);
                  this.showToast('Task completed, but memory status could not be updated.', 'error');
                  return of<Memory | null>(null);
                }),
              ),
            );
          } catch {
            // Error already handled in catchError above
          }
        }
      }

      // Handle file uploads if any files are selected
      const selectedFiles = form.selectedFiles || [];
      let updated: Maintenance | null = null;

      if (selectedFiles.length > 0) {
        // Use FormData for file uploads
        const formData = new FormData();
        formData.append('status', 'completed');
        formData.append('completionTime', new Date().toISOString());
        formData.append('userComment', finalComment);

        // Append files
        for (const file of selectedFiles) {
          formData.append('attachments', file);
        }

        updated = await firstValueFrom(
          this.maintenanceService.completeTaskWithFiles(task.raw._id, formData).pipe(
            takeUntilDestroyed(this.destroyRef),
            catchError((error) => {
              console.error('Failed to complete maintenance task with files', error);
              return of<Maintenance | null>(null);
            }),
          ),
        );
      } else {
        // Use regular JSON payload when no files
        updated = await firstValueFrom(
          this.maintenanceService.completeTask(task.raw._id, finalComment).pipe(
            takeUntilDestroyed(this.destroyRef),
            catchError((error) => {
              console.error('Failed to complete maintenance task', error);
              return of<Maintenance | null>(null);
            }),
          ),
        );
      }

      if (!updated) {
        throw new Error('Task completion failed.');
      }

      this.patchTask(updated);
      this.showToast('Task marked as completed.', 'success');
      this.closeCompleteTaskModal();
    } catch (error) {
      console.error('Failed to complete maintenance task', error);
      this.completeTaskForm.update((state) => ({
        ...state,
        error: 'Unable to complete the task. Please try again.',
      }));
    } finally {
      this.completeTaskForm.update((state) => ({ ...state, isSaving: false }));
      this.resetCompletionInventoryState();
    }
  }

  private loadMaterialsForCompletion(task: UiMaintenance): void {
    if (!task.cameraId) {
      this.completeMaterialsState.set({ ...this.emptyReplaceState });
      return;
    }

    this.completeMaterialsState.set({
      isLoading: true,
      isSaving: false,
      error: null,
      reason: '',
      entries: [],
      replacements: [],
    });

    forkJoin({
      assigned: this.inventoryService.getByCamera(task.cameraId, task.cameraName).pipe(catchError(() => of<InventoryItem[]>([]))),
      all: this.inventoryService.getAll().pipe(catchError(() => of<InventoryItem[]>([]))),
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ assigned, all }) => {
          const entries: ReplaceMaterialsEntry[] = assigned.map((item) => ({
            item,
            selected: false,
            replacementId: null,
            context: null,
          }));

          const replacements = all.filter((item) => this.isInventoryHeldByCurrentUser(item));

          this.completeMaterialsState.set({
            isLoading: false,
            isSaving: false,
            error: null,
            reason: '',
            entries,
            replacements,
          });
          this.resetCompletionInventoryState();
        },
        error: () => {
          this.completeMaterialsState.set({
            isLoading: false,
            isSaving: false,
            error: 'Unable to load inventory information.',
            reason: '',
            entries: [],
            replacements: [],
          });
          this.resetCompletionInventoryState();
        },
      });
  }

  toggleCompleteMaterialEntry(itemId: string, selected: boolean, context: 'breakdown' | 'maintenance'): void {
    this.completeMaterialsState.update((state) => ({
      ...state,
      entries: state.entries.map((entry) => {
        if (entry.item._id !== itemId) {
          return entry;
        }

        if (selected) {
          return {
            ...entry,
            selected: true,
            context,
          };
        }

        return {
          ...entry,
          selected: false,
          replacementId: null,
          context: null,
        };
      }),
      error: null,
    }));

    if (selected) {
      this.removeFromRemoveSelections(itemId);
    }
  }

  setCompleteReplacementSelection(
    itemId: string,
    replacementId: string,
    context: 'breakdown' | 'maintenance',
  ): void {
    const normalized = replacementId ? replacementId : null;
    this.completeMaterialsState.update((state) => ({
      ...state,
      entries: state.entries.map((entry) =>
        entry.item._id === itemId && entry.context === context ? { ...entry, replacementId: normalized } : entry,
      ),
    }));
  }

  setCompleteReplaceReason(reason: string): void {
    this.completeMaterialsState.update((state) => ({
      ...state,
      reason,
    }));
  }

  toggleCompletionAction(
    action:
      | 'breakdown'
      | 'maintenance'
      | 'removal'
      | 'installation'
      | 'reinstallation'
      | 'addItems'
      | 'removeItems',
    value: boolean,
  ): void {
    this.setCompletionActions((current) => {
      const next: CompletionChecklist = {
        ...current,
        maintenance: { ...current.maintenance },
      };

      const isHighPriority = action === 'removal' || action === 'installation' || action === 'reinstallation';
      const isStandard =
        action === 'breakdown' ||
        action === 'maintenance' ||
        action === 'addItems' ||
        action === 'removeItems';

      const currentHighPriorityActive = current.removal || current.installation || current.reinstallation;
      const currentStandardActive =
        current.breakdown || current.maintenance.enabled || current.addItems || current.removeItems;

      if (value) {
        if (isStandard && currentHighPriorityActive) {
          return { next: current };
        }
        if (isHighPriority && currentStandardActive) {
          return { next: current };
        }
      }

      switch (action) {
        case 'breakdown':
          next.breakdown = value;
          if (!value) {
            next.breakdownNone = false;
          }
          break;
        case 'maintenance':
          next.maintenance.enabled = value;
          if (!value) {
            next.maintenance.cleaning = false;
            next.maintenance.viewAdjustment = false;
            next.maintenance.materialReplacement = false;
            next.maintenance.betterViewSurvey = false;
            next.maintenance.lockChecked = false;
          }
          break;
        case 'removal':
          next.removal = value;
          if (value) {
            next.breakdown = false;
            next.breakdownNone = false;
            next.maintenance = {
              enabled: false,
              cleaning: false,
              viewAdjustment: false,
              materialReplacement: false,
              lockChecked: false,
              memoryChanging: false,
              betterViewSurvey: false,
            };
            next.addItems = false;
            next.removeItems = false;
            next.installation = false;
            next.reinstallation = false;
          }
          break;
        case 'installation':
          next.installation = value;
          if (value) {
            next.breakdown = false;
            next.breakdownNone = false;
            next.maintenance = {
              enabled: false,
              cleaning: false,
              viewAdjustment: false,
              materialReplacement: false,
              lockChecked: false,
              memoryChanging: false,
              betterViewSurvey: false,
            };
            next.addItems = false;
            next.removeItems = false;
            next.removal = false;
            next.reinstallation = false;
          }
          break;
        case 'reinstallation':
          next.reinstallation = value;
          if (value) {
            next.breakdown = false;
            next.breakdownNone = false;
            next.maintenance = {
              enabled: false,
              cleaning: false,
              viewAdjustment: false,
              materialReplacement: false,
              lockChecked: false,
              memoryChanging: false,
              betterViewSurvey: false,
            };
            next.addItems = false;
            next.removeItems = false;
            next.removal = false;
            next.installation = false;
          }
          break;
        case 'addItems':
          next.addItems = value;
          if (value) {
            next.removal = false;
            next.installation = false;
            next.reinstallation = false;
          }
          break;
        case 'removeItems':
          next.removeItems = value;
          if (value) {
            next.removal = false;
            next.installation = false;
            next.reinstallation = false;
          }
          break;
      }

      const releaseBreakdown = current.breakdown && !next.breakdown;
      const releaseMaintenance =
        current.maintenance.materialReplacement && (!next.maintenance.enabled || !next.maintenance.materialReplacement);
      const releaseAdd = current.addItems && !next.addItems;
      const releaseRemove = current.removeItems && !next.removeItems;
      const releaseBreakdownReason = !next.breakdown || next.breakdownNone !== current.breakdownNone;

      return {
        next,
        releaseBreakdown,
        releaseMaintenance,
        releaseAdd,
        releaseRemove,
        releaseBreakdownReason,
      };
    });
  }

  toggleMaintenanceOption(
    option: 'cleaning' | 'viewAdjustment' | 'materialReplacement' | 'lockChecked' | 'memoryChanging' | 'betterViewSurvey',
    value: boolean,
  ): void {
    this.setCompletionActions((current) => {
      if (!current.maintenance.enabled) {
        return { next: current };
      }
      const next: CompletionChecklist = {
        ...current,
        maintenance: { ...current.maintenance },
      };
      next.maintenance[option] = value;

      if (option === 'memoryChanging' && value) {
        const task = this.completeTaskModal();
        const cameraId = task?.cameraId;
        if (cameraId) {
          const hasMemory = this.memories().some((memory) => {
            const memCamera = (memory.camera || '').toString().trim().toLowerCase();
            const cameraTag =
              this.cameras().find((cam) => cam._id === cameraId)?.camera?.toString().trim().toLowerCase() ?? '';
            return memCamera && cameraTag && memCamera === cameraTag;
          });
          if (!hasMemory) {
            window.alert('This camera has no assigned memory.');
          }
        } else {
          window.alert('Camera information is missing for this task.');
        }
      }

      return {
        next,
        releaseBreakdown: false,
        releaseMaintenance: option === 'materialReplacement' && !value,
        releaseAdd: false,
        releaseRemove: false,
      };
    });
  }

  getCurrentTaskMemory(): Memory | null {
    const task = this.completeTaskModal();
    const cameraId = task?.cameraId;
    if (!cameraId) {
      return null;
    }

    const camera = this.cameras().find((cam) => cam._id === cameraId);
    const cameraTag = camera?.camera?.toString().trim().toLowerCase() ?? '';
    if (!cameraTag) {
      return null;
    }

    const memory = this.memories().find((mem) => {
      const memCamera = (mem.camera || '').toString().trim().toLowerCase();
      return memCamera === cameraTag;
    });

    return memory ?? null;
  }

  toggleBreakdownNone(value: boolean): void {
    this.setCompletionActions((current) => {
      if (!current.breakdown) {
        return { next: current };
      }
      const next: CompletionChecklist = { ...current, breakdownNone: value };
      return {
        next,
        releaseBreakdown: false,
        releaseMaintenance: false,
        releaseAdd: false,
        releaseRemove: false,
        releaseBreakdownReason: !value,
      };
    });
    if (value) {
      this.releaseMaterialContext('breakdown');
    }
  }

  availableCompleteReplacementOptions(entry: ReplaceMaterialsEntry): InventoryItem[] {
    const type = this.inventoryDeviceType(entry.item);
    return this.completeMaterialsState()
      .replacements.filter(
        (candidate) =>
          this.inventoryDeviceType(candidate) === type && this.isInventoryHeldByCurrentUser(candidate),
      )
      .filter((candidate) => candidate._id !== entry.item._id);
  }

  entryVisibleInContext(entry: ReplaceMaterialsEntry, context: 'breakdown' | 'maintenance'): boolean {
    return entry.context === null || entry.context === context;
  }

  hasAvailableMaterialEntries(context: 'breakdown' | 'maintenance'): boolean {
    const entries = this.completeMaterialsState().entries;
    for (const entry of entries) {
      if (!this.entryVisibleInContext(entry, context)) {
        continue;
      }
      if (this.availableCompleteReplacementOptions(entry).length > 0) {
        return true;
      }
    }
    return false;
  }

  availableAddItems(): InventoryItem[] {
    return this.completeMaterialsState().replacements.filter((item) => this.isInventoryHeldByCurrentUser(item));
  }

  hasAvailableAddItems(): boolean {
    return this.availableAddItems().length > 0;
  }

  isAddItemSelected(itemId: string): boolean {
    return this.completeInventoryState().addSelections.has(itemId);
  }

  toggleAddItemSelection(itemId: string, selected: boolean): void {
    this.completeInventoryState.update((state) => {
      const selections = new Set(state.addSelections);
      if (selected) {
        selections.add(itemId);
      } else {
        selections.delete(itemId);
      }
      return {
        ...state,
        addSelections: selections,
        error: null,
      };
    });
  }

  removableEntries(): ReplaceMaterialsEntry[] {
    return this.completeMaterialsState().entries.filter((entry) => !entry.selected);
  }

  hasRemovableEntries(): boolean {
    return this.removableEntries().length > 0;
  }

  isRemoveItemSelected(itemId: string): boolean {
    return this.completeInventoryState().removeSelections.has(itemId);
  }

  toggleRemoveItemSelection(itemId: string, selected: boolean): void {
    this.completeInventoryState.update((state) => {
      const selections = new Set(state.removeSelections);
      if (selected) {
        selections.add(itemId);
      } else {
        selections.delete(itemId);
      }
      return {
        ...state,
        removeSelections: selections,
        error: null,
      };
    });
  }

  shouldDisableStandardActions(): boolean {
    const actions = this.completeTaskForm().actions;
    return actions.removal || actions.installation || actions.reinstallation;
  }

  shouldDisableHighPriorityActions(): boolean {
    const actions = this.completeTaskForm().actions;
    return actions.breakdown || actions.maintenance.enabled || actions.addItems || actions.removeItems;
  }

  onBreakdownReasonChange(value: string): void {
    this.completeTaskForm.update((state) => ({
      ...state,
      breakdownReason: value,
    }));
  }

  private buildCompletionComment(baseComment: string, actions: CompletionChecklist): string {
    const lines: string[] = [];
    const trimmedComment = baseComment.trim();
    if (trimmedComment.length > 0) {
      lines.push(trimmedComment);
    }

    const actionLines = this.describeCompletionActions(actions);
    if (actionLines.length > 0) {
      if (lines.length > 0) {
        lines.push('');
      }
      lines.push('Completed checklist:');
      for (const line of actionLines) {
        lines.push(`- ${line}`);
      }
    }

    return lines.join('\n');
  }

  private describeCompletionActions(actions: CompletionChecklist): string[] {
    const items: string[] = [];

    if (actions.breakdown) {
      items.push('Breakdown resolved');
    }

    if (actions.maintenance.enabled) {
      const maintenanceDetails: string[] = [];
      if (actions.maintenance.cleaning) {
        maintenanceDetails.push('cleaning');
      }
      if (actions.maintenance.viewAdjustment) {
        maintenanceDetails.push('view adjustment');
      }
      if (actions.maintenance.materialReplacement) {
        maintenanceDetails.push('material replacement');
      }
      if (actions.maintenance.betterViewSurvey) {
        maintenanceDetails.push('better view survey');
      }

      if (maintenanceDetails.length > 0) {
        items.push(`Maintenance (${maintenanceDetails.join(', ')})`);
      } else {
        items.push('Maintenance');
      }
    }

    if (actions.removal) {
      items.push('Removal completed');
    }

    if (actions.installation) {
      items.push('Installation completed');
    }

    if (actions.reinstallation) {
      items.push('Reinstallation completed');
    }

    if (actions.addItems) {
      items.push('Added materials from personal stock');
    }

    if (actions.removeItems) {
      items.push('Removed materials to personal stock');
    }

    return items;
  }

  openInstallMaterialsModal(task: UiMaintenance): void {
    if (!task.cameraId) {
      this.showToast('Camera is not linked to this task.', 'error');
      return;
    }

    this.installMaterialsModal.set(task);
    this.installMaterialsState.set({ ...this.createEmptyInstallState(), isLoading: true });

    forkJoin({
      assigned: this.inventoryService.getByCamera(task.cameraId, task.cameraName).pipe(catchError(() => of<InventoryItem[]>([]))),
      all: this.inventoryService.getAll().pipe(catchError(() => of<InventoryItem[]>([]))),
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ assigned, all }) => {
          const hasInventory = assigned.length > 0;
          const unassigned = all.filter((item) => this.isInventoryUnassigned(item));
          const grouped = this.groupInventoryByType(unassigned);

          const errorMessage = hasInventory
            ? 'This camera already has materials assigned. Use the replacement workflow instead.'
            : grouped.length === 0
              ? 'No unassigned materials are currently available.'
              : null;

          this.installMaterialsState.set({
            isLoading: false,
            isSaving: false,
            error: errorMessage,
            cameraHasInventory: hasInventory,
            grouped,
            selections: new Map<string, string | null>(),
            reason: '',
          });
        },
        error: () => {
          this.installMaterialsState.set({
            isLoading: false,
            isSaving: false,
            error: 'Unable to load inventory information.',
            cameraHasInventory: false,
            grouped: [],
            selections: new Map<string, string | null>(),
            reason: '',
          });
        },
      });
  }

  closeInstallMaterialsModal(): void {
    this.installMaterialsModal.set(null);
    this.installMaterialsState.set(this.createEmptyInstallState());
  }

  isInstallSelectionDisabled(): boolean {
    return this.installMaterialsState().cameraHasInventory || this.installMaterialsState().isSaving;
  }

  isDeviceTypeSelected(deviceType: string): boolean {
    return this.installMaterialsState().selections.has(deviceType);
  }

  toggleDeviceTypeSelection(deviceType: string, selected: boolean): void {
    this.installMaterialsState.update((state) => {
      if (state.cameraHasInventory) {
        return state;
      }
      const nextSelections = new Map(state.selections);
      if (selected) {
        if (!nextSelections.has(deviceType)) {
          nextSelections.set(deviceType, null);
        }
      } else {
        nextSelections.delete(deviceType);
      }
      return this.projectInstallSelections({ ...state, selections: nextSelections, error: null });
    });
  }

  selectedDeviceTypeOption(deviceType: string): string | null {
    return this.installMaterialsState().selections.get(deviceType) ?? null;
  }

  setDeviceTypeSelection(deviceType: string, inventoryId: string): void {
    this.installMaterialsState.update((state) => {
      const nextSelections = new Map(state.selections);
      if (!nextSelections.has(deviceType)) {
        return state;
      }
      const normalized = inventoryId ? inventoryId : null;
      nextSelections.set(deviceType, normalized);
      return this.projectInstallSelections({ ...state, selections: nextSelections });
    });
  }

  setInstallReason(reason: string): void {
    this.installMaterialsState.update((state) =>
      this.projectInstallSelections({
      ...state,
      reason,
      }),
    );
  }

  async saveInstallMaterials(): Promise<void> {
    const task = this.installMaterialsModal();
    if (!task?.cameraId || !task.developerId || !task.projectId || !task.raw._id) {
      this.installMaterialsState.update((state) => ({
        ...state,
        error: 'Camera, developer, or project details are missing for this task.',
      }));
      return;
    }

    const state = this.installMaterialsState();
    if (state.cameraHasInventory) {
      this.installMaterialsState.update((s) => ({
        ...s,
        error: 'This camera already has materials assigned. Use the replacement workflow instead.',
      }));
      return;
    }

    const selections = Array.from(state.selections.entries()).filter(([_, value]) => !!value);
    if (selections.length === 0) {
      this.installMaterialsState.update((s) => ({
        ...s,
        error: 'Select at least one material to install.',
      }));
      return;
    }

    const reason = state.reason.trim();
    this.installMaterialsState.update((s) => ({ ...s, isSaving: true, error: null }));

    try {
      const selectedItems = state.grouped
        .flatMap((group) => group.items)
        .filter((item) => Array.from(state.selections.values()).includes(item._id));
      const baseNotes = `Installed during maintenance task ${task.id}`;
      const notes = reason ? `${baseNotes}: ${reason}` : baseNotes;

      for (const [, itemId] of selections) {
        if (!itemId) {
          continue;
        }
        await firstValueFrom(
          this.inventoryService
            .assignToProject(itemId, {
              developer: task.developerId,
              project: task.projectId,
              camera: task.cameraId,
              notes,
            })
            .pipe(takeUntilDestroyed(this.destroyRef)),
        );
      }

      const summary = selectedItems.map((item) => this.inventoryShortLabel(item)).join('; ');
      const updatedComment = this.appendInstallComment(task.raw.userComment, summary, reason);

      const updatedTask = await firstValueFrom(
        this.maintenanceService
          .update(task.raw._id, { userComment: updatedComment })
          .pipe(takeUntilDestroyed(this.destroyRef)),
      );

      if (updatedTask) {
        this.patchTask(updatedTask);
      }

      this.showToast('Materials installed on the camera.', 'success');
      this.closeInstallMaterialsModal();
    } catch (error) {
      console.error('Failed to install materials', error);
      this.installMaterialsState.update((s) => ({
        ...s,
        isSaving: false,
        error: 'Unable to install materials. Please try again.',
      }));
    }
  }

  private projectInstallSelections(state: InstallMaterialsState): InstallMaterialsState {
    const grouped = state.grouped.map((group) => {
      const selectionId = state.selections.get(group.type) ?? null;
      const selectedItem = selectionId ? group.items.find((item) => item._id === selectionId) : undefined;
      return {
        ...group,
        selected: selectedItem,
        selectedModel: selectedItem ? this.inventoryDeviceModel(selectedItem) : undefined,
        selectedSerial: selectedItem ? this.inventoryDeviceSerial(selectedItem) : undefined,
      };
    });
    return { ...state, grouped };
  }

  private groupInventoryByType(items: InventoryItem[]): InstallMaterialsGroup[] {
    const byType = new Map<string, InventoryItem[]>();
    for (const item of items) {
      const type = this.inventoryDeviceType(item);
      const list = byType.get(type) ?? [];
      list.push(item);
      byType.set(type, list);
    }

    return Array.from(byType.entries())
      .map(([type, list]) => ({
        type,
        items: list.sort((a, b) => this.inventoryShortLabel(a).localeCompare(this.inventoryShortLabel(b))),
      }))
      .sort((a, b) => a.type.localeCompare(b.type));
  }

  private async applyMaterialReplacements(
    task: UiMaintenance,
    entries: ReplaceMaterialsEntry[],
    reason: string,
  ): Promise<string> {
    const summaryParts: string[] = [];
    const currentUserId = this.currentUserId();
    const currentUserName = this.currentUserName();

    for (const entry of entries) {
      await firstValueFrom(this.inventoryService.unassignFromProject(entry.item._id, reason));

      if (entry.item.currentUserAssignment?.userId) {
        await firstValueFrom(this.inventoryService.unassignFromUser(entry.item._id, reason));
      }

      const assignedToNote =
        currentUserId && currentUserName
          ? ` (assigned to ${currentUserName})`
          : currentUserId
            ? ' (assigned to technician)'
            : '';

      if (currentUserId) {
        const payload: InventoryUserAssignmentPayload = {
          userId: currentUserId,
          userName: currentUserName,
          notes: `Holding after replacement for maintenance task ${task.id}: ${reason}`,
        };
        await firstValueFrom(this.inventoryService.assignToUser(entry.item._id, payload));
      }

      if (entry.replacementId && task.developerId && task.projectId && task.cameraId) {
        const replacement = this.completeMaterialsState()
          .replacements.find((candidate) => candidate._id === entry.replacementId);

        if (replacement?.currentUserAssignment?.userId) {
          await firstValueFrom(this.inventoryService.unassignFromUser(entry.replacementId, reason));
        }

        const payload: InventoryAssignmentPayload = {
          developer: task.developerId,
          project: task.projectId,
          camera: task.cameraId,
          notes: `Replacement during maintenance task ${task.id}: ${reason}`,
        };
        await firstValueFrom(this.inventoryService.assignToProject(entry.replacementId, payload));

        this.completeMaterialsState.update((state) => ({
          ...state,
          replacements: state.replacements.filter((item) => item._id !== entry.replacementId),
        }));

        summaryParts.push(
          `${this.inventoryDeviceSerial(entry.item)} → ${
            replacement ? this.inventoryDeviceSerial(replacement) : entry.replacementId
          }${assignedToNote}`,
        );
      } else {
        summaryParts.push(`${this.inventoryDeviceSerial(entry.item)} removed${assignedToNote}`);
      }
    }

    return summaryParts.join('; ');
  }
  openEditTaskModal(task: UiMaintenance): void {
    if (!this.isSuperAdmin()) {
      return;
    }

    this.editTaskModal.set(task);
    this.editTaskForm.set({
      taskType: task.taskType,
      taskDescription: task.taskDescription,
      assignedUser: task.assignedUser?.id || null,
      assistants: task.assistants.map((user) => user.id),
      status: task.status,
      isSaving: false,
      error: null,
    });
  }

  closeEditTaskModal(): void {
    this.editTaskModal.set(null);
  }


  setEditTaskStatus(value: string): void {
    this.editTaskForm.update((state) => ({
      ...state,
      status: (value as MaintenanceStatus) ?? state.status,
    }));
  }

  saveEditTask(): void {
    const task = this.editTaskModal();
    if (!task?.raw._id) {
      return;
    }

    const form = this.editTaskForm();
    if (!form.taskType.trim() || !form.taskDescription.trim() || !form.assignedUser) {
      this.editTaskForm.update((state) => ({
        ...state,
        error: 'Task type, description, and assigned user are required.',
      }));
      return;
    }

    const payload: MaintenanceUpdateRequest = {
      taskType: form.taskType.trim(),
      taskDescription: form.taskDescription.trim(),
      assignedUser: form.assignedUser,
      assistants: form.assistants.length > 0 ? [...form.assistants] : undefined,
      status: form.status,
    };

    if (form.status === 'pending') {
      payload['startTime'] = undefined;
      payload['completionTime'] = undefined;
      payload['userComment'] = '';
    } else if (form.status === 'in-progress' && !task.raw.startTime) {
      payload['startTime'] = new Date().toISOString();
      payload['completionTime'] = undefined;
    } else if (form.status === 'completed' && !task.raw.completionTime) {
      payload['completionTime'] = new Date().toISOString();
    }

    this.editTaskForm.update((state) => ({ ...state, isSaving: true, error: null }));

    this.maintenanceService
      .update(task.raw._id, payload)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        catchError((error) => {
          console.error('Failed to update maintenance task', error);
          this.editTaskForm.update((state) => ({
            ...state,
            isSaving: false,
            error: 'Unable to update the maintenance task. Please try again.',
          }));
          return of<Maintenance | null>(null);
        }),
      )
      .subscribe((updated) => {
        if (!updated) {
          return;
        }
        this.patchTask(updated);
        this.showToast('Maintenance task updated.', 'success');
        this.closeEditTaskModal();
      });
  }

  dismissToast(): void {
    this.toast.set(null);
  }

  onEditTaskFieldChange(field: 'taskType' | 'taskDescription', value: string): void {
    this.editTaskForm.update((state) => ({
      ...state,
      [field]: value,
      error: null,
    }));
  }

  onCompleteTaskCommentChange(value: string): void {
    this.completeTaskForm.update((state) => ({
      ...state,
      comment: value,
      error: null,
    }));
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) {
      return;
    }

    const files = Array.from(input.files);
    const maxFileSize = 10 * 1024 * 1024; // 10MB
    const maxFiles = 10;

    // Check total file count
    const currentFiles = this.completeTaskForm().selectedFiles;
    if (currentFiles.length + files.length > maxFiles) {
      this.completeTaskForm.update((state) => ({
        ...state,
        error: `Maximum ${maxFiles} files allowed. You have ${currentFiles.length} files selected.`,
      }));
      return;
    }

    // Validate file sizes
    const oversizedFiles = files.filter((file) => file.size > maxFileSize);
    if (oversizedFiles.length > 0) {
      this.completeTaskForm.update((state) => ({
        ...state,
        error: `Some files exceed the 10MB limit: ${oversizedFiles.map((f) => f.name).join(', ')}`,
      }));
      return;
    }

    // Add valid files
    this.completeTaskForm.update((state) => ({
      ...state,
      selectedFiles: [...state.selectedFiles, ...files],
      error: null,
    }));

    // Reset input to allow selecting the same file again
    input.value = '';
  }

  removeSelectedFile(file: File): void {
    this.completeTaskForm.update((state) => ({
      ...state,
      selectedFiles: state.selectedFiles.filter(
        (f) => !(f.name === file.name && f.size === file.size && f.lastModified === file.lastModified),
      ),
    }));
  }

  inventoryDeviceType(item: InventoryItem): string {
    const device = item.device ?? ({} as Record<string, unknown>);
    const deviceType = device['type'] as string | undefined;
    return deviceType ?? 'Unknown type';
  }

  inventoryDeviceModel(item: InventoryItem): string | undefined {
    const device = item.device ?? ({} as Record<string, unknown>);
    return device['model'] as string | undefined;
  }

  inventoryDeviceSerial(item: InventoryItem): string {
    const device = item.device ?? ({} as Record<string, unknown>);
    return (device['serialNumber'] as string | undefined) ?? item._id;
  }

  inventoryShortLabel(item: InventoryItem): string {
    const type = this.inventoryDeviceType(item);
    const model = this.inventoryDeviceModel(item);
    const serial = this.inventoryDeviceSerial(item);
    return `${type}${model ? ` ${model}` : ''} • ${serial}`;
  }

  private isInventoryUnassigned(item: InventoryItem): boolean {
    const status = this.normalizeInventoryStatus(item.status);
    if (status === 'assigned') {
      return false;
    }
    if (status === 'user_assigned') {
      return false;
    }
    if (status === 'retired' || status === 'inactive') {
      return false;
    }
    if (status === 'available' || status === 'reserved' || status === 'in transit') {
      return true;
    }

    if (item.assignedCameraId) {
      return false;
    }

    const assignment = item.currentAssignment;
    if (assignment) {
      const cameraValue = assignment.camera;
      const removedDate = (assignment as Record<string, unknown>)['removedDate'] as string | undefined;
      const assignmentStatus = (assignment as Record<string, unknown>)['status'] as string | undefined;

      const isActiveStatus =
        assignmentStatus && ['active', 'assigned', 'in-progress'].includes(assignmentStatus.toLowerCase());
      const hasCameraReference = typeof cameraValue === 'string' && cameraValue.trim().length > 0;

      if (hasCameraReference && !removedDate && isActiveStatus) {
        return false;
      }

      if (hasCameraReference && !removedDate && !assignmentStatus) {
        return false;
      }
    }

    return true;
  }

  private normalizeInventoryStatus(status?: string): string {
    return (status ?? '').trim().toLowerCase();
  }

  private isInventoryHeldByCurrentUser(item: InventoryItem): boolean {
    const currentUserId = this.currentUserId();
    if (!currentUserId) {
      return false;
    }
    return (item.currentUserAssignment?.userId ?? null) === currentUserId;
  }

  private setCompletionActions(
    updater: (
      current: CompletionChecklist,
    ) => CompletionActionReleaseFlags & { next: CompletionChecklist },
  ): void {
    const currentState = this.completeTaskForm();
    const result = updater(currentState.actions);
    const nextActions = result.next;

    this.completeTaskForm.update((state) => ({
      ...state,
      actions: nextActions,
      breakdownReason:
        nextActions.breakdown && !result.releaseBreakdownReason ? state.breakdownReason : '',
      error: null,
    }));

    if (result.releaseBreakdown) {
      this.releaseMaterialContext('breakdown');
    }
    if (result.releaseMaintenance) {
      this.releaseMaterialContext('maintenance');
    }
    if (result.releaseAdd) {
      this.clearAddSelections();
    }
    if (result.releaseRemove) {
      this.clearRemoveSelections();
    }

    this.completeInventoryState.update((state) => ({
      ...state,
      error: null,
    }));

    this.syncMaterialReplacementState(nextActions);
  }

  private isMaterialReplacementEnabled(actions: CompletionChecklist): boolean {
    return actions.breakdown || (actions.maintenance.enabled && actions.maintenance.materialReplacement);
  }

  private syncMaterialReplacementState(actions: CompletionChecklist): void {
    if (this.isMaterialReplacementEnabled(actions)) {
      return;
    }
    this.completeMaterialsState.update((state) => ({
      ...state,
      entries: state.entries.map((entry) => ({
        ...entry,
        selected: false,
        replacementId: null,
        context: null,
      })),
      reason: '',
      error: null,
    }));
  }

  private releaseMaterialContext(target: 'breakdown' | 'maintenance'): void {
    const releasedIds: string[] = [];
    this.completeMaterialsState.update((state) => ({
      ...state,
      entries: state.entries.map((entry) => {
        if (entry.context === target) {
          releasedIds.push(entry.item._id);
          return { ...entry, selected: false, replacementId: null, context: null };
        }
        return entry;
      }),
    }));

    if (releasedIds.length > 0) {
      this.completeInventoryState.update((state) => {
        if (state.removeSelections.size === 0) {
          return state;
        }
        const selections = new Set(state.removeSelections);
        let mutated = false;
        for (const id of releasedIds) {
          if (selections.delete(id)) {
            mutated = true;
          }
        }
        if (!mutated) {
          return state;
        }
        return {
          ...state,
          removeSelections: selections,
        };
      });
    }
  }

  private appendMaterialComment(existing: string | undefined, reason: string, summary: string): string {
    const lines: string[] = [];
    if (existing?.trim()) {
      lines.push(existing.trim());
    }

    const timestamp = new Date().toISOString();
    lines.push(`Materials replaced on ${timestamp}: ${summary}`);
    lines.push(`Reason: ${reason}`);

    return lines.join('\n\n');
  }

  private appendInstallComment(existing: string | undefined, summary: string, reason: string): string {
    const lines: string[] = [];
    if (existing?.trim()) {
      lines.push(existing.trim());
    }

    const timestamp = new Date().toISOString();
    lines.push(`Materials installed on ${timestamp}: ${summary}`);
    if (reason.trim()) {
      lines.push(`Reason: ${reason.trim()}`);
    }

    return lines.join('\n\n');
  }

  private appendInventoryNote(existing: string, note: string): string {
    if (!note.trim()) {
      return existing;
    }
    const trimmed = existing.trim();
    if (trimmed.length === 0) {
      return note;
    }
    return `${trimmed}\n\n${note}`;
  }

  private loadMaintenance(): void {
    this.isLoading.set(true);
    this.errorMessage.set(null);

    this.maintenanceService
      .getAll()
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        catchError((error) => {
          console.error('Failed to load maintenance tasks', error);
          this.errorMessage.set('Unable to load maintenance tasks from the backend.');
          return of<Maintenance[]>([]);
        }),
        finalize(() => this.isLoading.set(false)),
      )
      .subscribe((tasks) => {
        this.tasks.set(tasks ?? []);
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

    this.memoryService
      .getAll()
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        catchError((error) => {
          console.error('Failed to load memories', error);
          return of<Memory[]>([]);
        }),
      )
      .subscribe((memories) => {
        this.memories.set(memories ?? []);
      });

    this.userService
      .getAll()
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        catchError((error) => {
          console.error('Failed to load users', error);
          return of<User[]>([]);
        }),
      )
      .subscribe((users) => {
        // Store all users for looking up creators, but filter admins for the assigned user dropdown
        const allUsers = users.sort((a, b) => a.name.localeCompare(b.name));
        this.users.set(allUsers);
      });
  }

  private decorateTask(task: Maintenance): UiMaintenance {
    const developer = task.developerId ? this.developerMap().get(task.developerId) : undefined;
    const project = task.projectId ? this.projectMap().get(task.projectId) : undefined;
    const camera = task.cameraId ? this.cameraMap().get(task.cameraId) : undefined;

    // Extract assigned user (single) - "Assigned to"
    // Priority: task.assignedUser > first item in assignedUsers (for backward compatibility)
    const assignedUserId = task.assignedUser || (Array.isArray(task.assignedUsers) && task.assignedUsers.length > 0 ? task.assignedUsers[0] : null);
    const assignedUserObj = assignedUserId ? this.userMap().get(String(assignedUserId)) : undefined;
    const assignedUserInfo: AssignedUserInfo | undefined = assignedUserObj ? {
      id: assignedUserObj._id,
      name: assignedUserObj.name,
      role: assignedUserObj.role,
      image: this.getUserImageUrl(assignedUserObj),
      logo: assignedUserObj.logo,
    } : undefined;

    // Extract assistants (multiple) - "Assistant"
    // Priority: task.assistants > rest of assignedUsers (for backward compatibility)
    let assistantIds: string[] = [];
    if (task.assistants && Array.isArray(task.assistants)) {
      assistantIds = task.assistants;
    } else if (Array.isArray(task.assignedUsers) && task.assignedUsers.length > 1) {
      // For backward compatibility: if assignedUser exists, assistants are the rest
      assistantIds = task.assignedUsers.slice(1);
    } else if (Array.isArray(task.assignedUsers) && !task.assignedUser) {
      // If no assignedUser but assignedUsers exists, all are assistants (legacy)
      assistantIds = task.assignedUsers;
    }
    
    const assistants = assistantIds.reduce<AssignedUserInfo[]>((list, id) => {
      const user = this.userMap().get(String(id));
      if (!user) {
        return list;
      }
      list.push({
        id: user._id,
        name: user.name,
        role: user.role,
        image: this.getUserImageUrl(user),
        logo: user.logo,
      });
      return list;
    }, []);

    // Extract creator/assigned by information
    const createdBy = (task as any).addedUserId || 
                     (task as any).createdBy || 
                     (task as any).createdById ||
                     (task as any).addedBy;
    const assignedBy = createdBy ? this.userMap().get(String(createdBy)) : undefined;
    const assignedByInfo: AssignedUserInfo | undefined = assignedBy ? {
      id: assignedBy._id,
      name: assignedBy.name,
      role: assignedBy.role,
      image: this.getUserImageUrl(assignedBy),
      logo: assignedBy.logo,
    } : undefined;

    const dateOfRequest = task.dateOfRequest ?? task.createdDate;
    const isOverdue = this.computeOverdue(task.status, dateOfRequest, task.completionTime);
    const durationMinutes = this.computeDuration(task.startTime, task.completionTime);

    return {
      id: task._id,
      taskType: task.taskType ?? 'Unknown task',
      taskDescription: task.taskDescription ?? '',
      developerId: task.developerId,
      developerName: developer?.developerName ?? 'Unknown developer',
      projectId: task.projectId,
      projectName: project ? this.extractProjectName(project) : 'Unknown project',
      cameraId: task.cameraId,
      cameraName: camera ? this.extractCameraLabel(camera) : 'Unknown camera',
      assignedUser: assignedUserInfo,
      assistants,
      assignedBy: assignedByInfo,
      status: this.normalizeStatus(task.status),
      dateOfRequest,
      createdDate: task.createdDate,
      startTime: task.startTime,
      completionTime: task.completionTime,
      userComment: task.userComment,
      attachments: task.attachments,
      isOverdue,
      durationMinutes,
      raw: task,
    };
  }

  private normalizeAssignedUsers(task: Maintenance): string[] {
    const assignedUsers: string[] = Array.isArray(task.assignedUsers) ? [...task.assignedUsers] : [];
    if (typeof task.assignedUser === 'string' && task.assignedUser.trim()) {
      if (!assignedUsers.includes(task.assignedUser)) {
        assignedUsers.push(task.assignedUser);
      }
    }
    return assignedUsers.filter((id) => typeof id === 'string' && id.trim());
  }

  private computeOverdue(
    status: MaintenanceStatus | undefined,
    dateOfRequest?: string,
    completionTime?: string,
  ): boolean {
    if (!dateOfRequest || status === 'completed' || status === 'cancelled') {
      return false;
    }

    const requestTime = Date.parse(dateOfRequest);
    if (Number.isNaN(requestTime)) {
      return false;
    }

    const endTime = completionTime ? Date.parse(completionTime) : Date.now();
    if (Number.isNaN(endTime)) {
      return false;
    }

    const diffHours = (endTime - requestTime) / (1000 * 60 * 60);
    return diffHours > OVERDUE_THRESHOLD_HOURS;
  }

  private computeDuration(start?: string, end?: string): number | null {
    if (!start || !end) {
      return null;
    }
    const startTime = Date.parse(start);
    const endTime = Date.parse(end);
    if (Number.isNaN(startTime) || Number.isNaN(endTime)) {
      return null;
    }
    return Math.max(0, Math.round((endTime - startTime) / (1000 * 60)));
  }

  private normalizeStatus(status: string | undefined): MaintenanceStatus {
    const normalized = (status ?? 'pending').toLowerCase().trim() as MaintenanceStatus;
    if (DEFAULT_MAINTENANCE_STATUS_ORDER.includes(normalized)) {
      return normalized;
    }
    return 'pending';
  }

  private updateTask(id: string, payload: MaintenanceUpdateRequest): void {
    this.maintenanceService
      .update(id, payload)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        catchError((error) => {
          console.error('Failed to update maintenance task', error);
          this.showToast('Failed to update the maintenance task.', 'error');
          return of<Maintenance | null>(null);
        }),
      )
      .subscribe((updated) => {
        if (!updated) {
          return;
        }
        this.patchTask(updated);
        const status = payload['status'];
        if (status === 'in-progress') {
          this.showToast('Task marked as in progress.', 'success');
        } else if (status === 'completed') {
          this.showToast('Task completed.', 'success');
        } else {
          this.showToast('Task updated.', 'success');
        }
      });
  }

  private patchTask(updated: Maintenance): void {
    this.tasks.update((current) => {
      const index = current.findIndex((task) => task._id === updated._id);
      if (index === -1) {
        return [updated, ...current];
      }
      const next = [...current];
      next[index] = { ...next[index], ...updated };
      return next;
    });
  }

  private extractId(value: unknown): string | undefined {
    if (typeof value === 'string') {
      return value;
    }
    if (value && typeof value === 'object' && '_id' in value && typeof value['_id'] === 'string') {
      return value['_id'];
    }
    return undefined;
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

  private getUserImageUrl(user: User): string | undefined {
    // Backend stores image in 'logo' field (path like 'logos/user/filename')
    // Support both 'logo' and 'image' for compatibility
    const imagePath = user.logo || user.image;
    if (!imagePath) {
      return undefined;
    }
    // If it's already a full URL, return as-is
    if (imagePath.startsWith('http://') || imagePath.startsWith('https://') || imagePath.startsWith('data:')) {
      return imagePath;
    }
    // Build full URL from logo path (e.g., 'logos/user/filename.jpg')
    const sanitized = imagePath.startsWith('/') ? imagePath.slice(1) : imagePath;
    const mediaBaseUrl = environment.apiUrl.replace('/api', '');
    return `${mediaBaseUrl}/${sanitized}`;
  }

  getAttachmentUrl(attachment: MaintenanceAttachment): string {
    // Build full URL from attachment path
    const url = attachment.url.startsWith('/') ? attachment.url.slice(1) : attachment.url;
    const mediaBaseUrl = environment.apiUrl.replace('/api', '');
    return `${mediaBaseUrl}/${url}`;
  }

  formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  }

  getAssignmentAttachments(attachments: MaintenanceAttachment[] | undefined): MaintenanceAttachment[] {
    if (!attachments || attachments.length === 0) {
      return [];
    }
    // Return attachments with context 'assignment' or no context (for backward compatibility)
    return attachments.filter(
      (att) => !att.context || att.context === 'assignment',
    );
  }

  getCompletionAttachments(attachments: MaintenanceAttachment[] | undefined): MaintenanceAttachment[] {
    if (!attachments || attachments.length === 0) {
      return [];
    }
    // Return attachments with context 'completion'
    return attachments.filter((att) => att.context === 'completion');
  }

  private getLastStatusTime(task: UiMaintenance): string | undefined {
    // Return the most recent time based on the task's current status
    switch (task.status) {
      case 'completed':
        // For completed tasks, use completion time
        return task.completionTime;
      case 'cancelled':
        // For cancelled tasks, use completion time (when it was cancelled) or fallback to dateOfRequest
        return task.completionTime || task.dateOfRequest || task.createdDate;
      case 'in-progress':
        // For in-progress tasks, use start time
        return task.startTime || task.dateOfRequest || task.createdDate;
      case 'pending':
      default:
        // For pending tasks, use date of request or creation date
        return task.dateOfRequest || task.createdDate;
    }
  }

  private compareDatesDesc(a?: string, b?: string): number {
    const aTime = a ? Date.parse(a) : 0;
    const bTime = b ? Date.parse(b) : 0;
    return bTime - aTime;
  }

  private showToast(message: string, tone: ToastTone): void {
    this.toast.set({ message, tone });
  }

  // Multi-select dropdown state for assigned users
  readonly isEditAssistantsDropdownOpen = signal(false);

  onEditAssignedUserChange(userId: string): void {
    this.editTaskForm.update((state) => ({
      ...state,
      assignedUser: userId || null,
      error: null,
    }));
  }

  toggleEditAssistantsDropdown(): void {
    this.isEditAssistantsDropdownOpen.update((v) => !v);
  }

  toggleEditAssistantSelection(userId: string): void {
    const current = this.editTaskForm().assistants;
    let newSelection: string[];

    if (current.includes(userId)) {
      newSelection = current.filter((id) => id !== userId);
    } else {
      newSelection = [...current, userId];
    }

    this.editTaskForm.update((state) => ({
      ...state,
      assistants: newSelection,
      error: null,
    }));
  }

  removeEditAssistant(userId: string): void {
    const current = this.editTaskForm().assistants;
    const newSelection = current.filter((id) => id !== userId);

    this.editTaskForm.update((state) => ({
      ...state,
      assistants: newSelection,
      error: null,
    }));
  }

  isEditAssistantSelected(userId: string): boolean {
    return this.editTaskForm().assistants.includes(userId);
  }

  getAssignedUserLabel(userId: string): string {
    const option = this.assignedUserOptions().find((opt) => opt.value === userId);
    return option?.label || userId;
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    if (
      !target.closest('.multi-select-dropdown') &&
      !target.closest('button[type="button"]')
    ) {
      this.isEditAssistantsDropdownOpen.set(false);
    }
  }
}
