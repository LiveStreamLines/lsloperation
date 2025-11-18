import { CommonModule } from '@angular/common';
import {
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { of } from 'rxjs';
import { catchError, finalize, switchMap } from 'rxjs/operators';
import { FormsModule } from '@angular/forms';
import { InventoryService } from '@core/services/inventory.service';
import {
  InventoryAssignmentPayload,
  InventoryItem,
  InventoryUserAssignmentPayload,
} from '@core/models/inventory.model';
import { DeveloperService } from '@core/services/developer.service';
import { ProjectService } from '@core/services/project.service';
import { CameraService } from '@core/services/camera.service';
import { DeviceTypeService } from '@core/services/device-type.service';
import { UserService } from '@core/services/user.service';
import { Developer } from '@core/models/developer.model';
import { Project } from '@core/models/project.model';
import { Camera } from '@core/models/camera.model';
import { DeviceType } from '@core/models/device-type.model';
import { User } from '@core/models/user.model';
import { AuthStore } from '@core/auth/auth.store';

interface InventoryMetricCard {
  title: string;
  value: string;
  helper: string;
  tone: 'default' | 'positive' | 'warning';
}

interface AssignedUserOption {
  id: string;
  name: string;
  count: number;
}

@Component({
  selector: 'app-inventory-overview',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './inventory-overview.component.html',
})
export class InventoryOverviewComponent implements OnInit {
  private readonly inventoryService = inject(InventoryService);
  private readonly developerService = inject(DeveloperService);
  private readonly projectService = inject(ProjectService);
  private readonly cameraService = inject(CameraService);
  private readonly deviceTypeService = inject(DeviceTypeService);
  private readonly userService = inject(UserService);
  private readonly authStore = inject(AuthStore);
  private readonly destroyRef = inject(DestroyRef);

  readonly items = signal<InventoryItem[]>([]);
  readonly filteredItems = computed(() => this.applyFilters(this.items()));
  readonly filteredItemIds = computed(() => new Set(this.filteredItems().map((item) => item._id)));
  readonly filteredItemsSet = computed(() => {
    const map = new Map<string, InventoryItem>();
    for (const item of this.filteredItems()) {
      map.set(item._id, item);
    }
    return map;
  });
  readonly filteredItemsLazy = computed(() => this.filteredItems());
  readonly isLoading = signal(true);
  readonly errorMessage = signal<string | null>(null);

  readonly deviceTypes = signal<DeviceType[]>([]);
  readonly developers = signal<Developer[]>([]);
  readonly allProjects = signal<Project[]>([]);
  readonly allCameras = signal<Camera[]>([]);
  readonly projects = signal<Project[]>([]);
  readonly cameras = signal<Camera[]>([]);
  readonly admins = signal<User[]>([]);
  readonly alarmedItemIds = computed(() => new Set(this.items().filter((item) => this.isAlarmed(item)).map((item) => item._id)));
  readonly alarmedFilteredItemIds = computed(
    () => new Set(this.filteredItems().filter((item) => this.isAlarmed(item)).map((item) => item._id)),
  );
  readonly assignedUserOptions = computed<AssignedUserOption[]>(() => {
    if (this.selectedStatus() !== 'user_assigned') {
      return [];
    }

    const deviceType = this.selectedDeviceType();
    const developerId = this.selectedDeveloperId();
    const deviceModel = this.selectedDeviceModel();
    const projectId = this.selectedProjectId();
    const cameraId = this.selectedCameraId();
    const status = this.selectedStatus();
    const serialQuery = this.serialQuery();

    const items = this.items().filter(
      (item) =>
        this.appliesDeviceTypeFilter(item, deviceType) &&
        this.appliesDeviceModelFilter(item, deviceModel) &&
        this.appliesDeveloperFilter(item, developerId) &&
        this.appliesProjectFilter(item, projectId) &&
        this.appliesCameraFilter(item, cameraId) &&
        this.appliesStatusFilter(item, status) &&
        this.appliesSerialFilter(item, serialQuery),
    );

    const map = new Map<string, AssignedUserOption>();

    for (const item of items) {
      const assignment = item.currentUserAssignment;
      if (!assignment?.userId) {
        continue;
      }

      const existing = map.get(assignment.userId);
      if (existing) {
        existing.count += 1;
        continue;
      }

      const name = assignment.userName ?? this.adminMap().get(assignment.userId)?.name ?? 'Unknown user';
      map.set(assignment.userId, {
        id: assignment.userId,
        name,
        count: 1,
      });
    }

    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  });

  readonly selectedDeviceType = signal<string | null>(null);
  readonly selectedDeveloperId = signal<string | null>(null);
  readonly selectedProjectId = signal<string | null>(null);
  readonly selectedCameraId = signal<string | null>(null);
  readonly selectedStatus = signal<string | null>(null);
  readonly selectedAdminId = signal<string | null>(null);
  readonly selectedDeviceModel = signal<string | null>(null);
  readonly serialQuery = signal<string>('');
  readonly showAlarmedOnly = signal<boolean>(false);
  readonly editingDeviceTypeId = signal<string | null>(null);
  readonly deletingDeviceTypeId = signal<string | null>(null);

  readonly statusOptions = [
    { value: 'available', label: 'Available' },
    { value: 'assigned', label: 'Assigned' },
    { value: 'user_assigned', label: 'User Assigned' },
    { value: 'retired', label: 'Retired' },
  ];

  readonly currentUser = computed(() => this.authStore.user());
  readonly isSuperAdmin = computed(() => this.currentUser()?.role === 'Super Admin');
  readonly accessibleDevelopers = computed(() => this.currentUser()?.accessibleDevelopers ?? []);
  
  // Permission checks
  readonly canAddDeviceType = computed(
    () => this.isSuperAdmin() || ((this.currentUser() as any)?.canAddDeviceType ?? false),
  );
  readonly canAddDeviceStock = computed(
    () => this.isSuperAdmin() || ((this.currentUser() as any)?.canAddDeviceStock ?? false),
  );
  readonly canAssignUnassignUser = computed(
    () => this.isSuperAdmin() || ((this.currentUser() as any)?.canAssignUnassignUser ?? false),
  );
  readonly canAssignUnassignProject = computed(
    () => this.isSuperAdmin() || ((this.currentUser() as any)?.canAssignUnassignProject ?? false),
  );

  readonly developerMap = computed(() => new Map(this.developers().map((developer) => [developer._id, developer])));
  readonly projectMap = computed(() => new Map(this.allProjects().map((project) => [project._id, project])));
  readonly cameraMap = computed(() => new Map(this.allCameras().map((camera) => [camera._id, camera])));
  readonly adminMap = computed(() => new Map(this.admins().map((admin) => [admin._id, admin])));
  readonly deviceTypeMapByName = computed(() => {
    const map = new Map<string, DeviceType>();
    for (const type of this.deviceTypes()) {
      const name = type.name?.trim().toLowerCase();
      if (name) {
        map.set(name, type);
      }
    }
    return map;
  });
  readonly deviceModelOptions = computed(() => {
    const type = this.selectedDeviceType();
    if (!type) {
      return [];
    }

    const normalized = type.trim().toLowerCase();
    const models = new Set<string>();

    const deviceTypeDefinition = this.deviceTypes().find(
      (definition) => (definition.name ?? '').trim().toLowerCase() === normalized,
    );
    if (deviceTypeDefinition?.models?.length) {
      for (const model of deviceTypeDefinition.models) {
        if (typeof model === 'string' && model.trim().length > 0) {
          models.add(model.trim());
        }
      }
    }

    for (const item of this.items()) {
      const itemType = item.device?.type?.trim().toLowerCase();
      if (itemType !== normalized) {
        continue;
      }
      const model = item.device?.model?.trim();
      if (model) {
        models.add(model);
      }
    }

    return Array.from(models).sort((a, b) => a.localeCompare(b));
  });
  readonly editingDeviceType = computed<DeviceType | null>(() => {
    const id = this.editingDeviceTypeId();
    if (!id) {
      return null;
    }
    return this.deviceTypes().find((type) => type._id === id) ?? null;
  });

  readonly isDeviceTypeModalOpen = signal(false);
  readonly isSavingDeviceType = signal(false);
  readonly deviceTypeError = signal<string | null>(null);
  readonly deviceTypeForm = signal<{ name: string; validityDays: number | string; suggestedModels: string }>({
    name: '',
    validityDays: 365,
    suggestedModels: '',
  });

  readonly assignProjectModalItem = signal<InventoryItem | null>(null);
  readonly assignProjectState = signal<{
    developerId: string;
    projectId: string;
    cameraId: string;
    notes: string;
    error: string | null;
    isSaving: boolean;
  }>({
    developerId: '',
    projectId: '',
    cameraId: '',
    notes: '',
    error: null,
    isSaving: false,
  });

  readonly assignUserModalItem = signal<InventoryItem | null>(null);
  readonly assignUserState = signal<{
    adminId: string;
    notes: string;
    error: string | null;
    isSaving: boolean;
  }>({
    adminId: '',
    notes: '',
    error: null,
    isSaving: false,
  });

  readonly unassignProjectModalItem = signal<InventoryItem | null>(null);
  readonly unassignProjectState = signal<{
    reason: string;
    error: string | null;
    isSaving: boolean;
  }>({
    reason: '',
    error: null,
    isSaving: false,
  });

  readonly unassignUserModalItem = signal<InventoryItem | null>(null);
  readonly unassignUserState = signal<{
    reason: string;
    error: string | null;
    isSaving: boolean;
  }>({
    reason: '',
    error: null,
    isSaving: false,
  });

  readonly viewItemModal = signal<InventoryItem | null>(null);
  readonly editEstimatedAgeState = signal<{
    itemId: string | null;
    estimatedAge: string;
    isSaving: boolean;
    error: string | null;
  }>({
    itemId: null,
    estimatedAge: '',
    isSaving: false,
    error: null,
  });

  readonly createDeviceModalOpen = signal(false);
  readonly createDeviceState = signal<{
    type: string;
    serialNumber: string;
    model: string;
    estimatedAge: string;
    error: string | null;
    isSaving: boolean;
  }>({
    type: '',
    serialNumber: '',
    model: '',
    estimatedAge: '',
    error: null,
    isSaving: false,
  });

  readonly assignProjectProjects = computed(() => {
    const developerId = this.assignProjectState().developerId;
    if (!developerId) {
      return [];
    }
    return this.allProjects().filter(
      (project) => this.extractAssignmentId(project.developer) === developerId,
    );
  });

  readonly assignProjectCameras = computed(() => {
    const projectId = this.assignProjectState().projectId;
    if (!projectId) {
      return [];
    }
    return this.allCameras().filter(
      (camera) => this.extractAssignmentId(camera.project) === projectId,
    );
  });

  readonly metricCards = computed<InventoryMetricCard[]>(() => {
    const list = this.filteredItems();
    const total = list.length;

    const assigned = list.filter((item) => this.normalizeStatus(item.status) === 'assigned').length;
    const userAssigned = list.filter((item) => this.normalizeStatus(item.status) === 'user_assigned').length;
    const available = list.filter((item) => this.normalizeStatus(item.status) === 'available').length;
    const retired = list.filter((item) => {
      const normalized = this.normalizeStatus(item.status);
      return normalized === 'retired' || normalized === 'inactive';
    }).length;
    const alarmed = this.alarmedFilteredItemIds().size;

    return [
      {
        title: 'Inventory items',
        value: total.toString(),
        helper: `${assigned} project • ${userAssigned} user`,
        tone: 'default',
      },
      {
        title: 'Projects',
        value: assigned.toString(),
        helper: 'Assigned to active sites',
        tone: assigned > 0 ? 'default' : 'warning',
      },
      {
        title: 'Technicians',
        value: userAssigned.toString(),
        helper: 'Stock with users',
        tone: userAssigned > 0 ? 'default' : 'warning',
      },
      {
        title: 'Available stock',
        value: available.toString(),
        helper: available > 0 ? 'Ready for deployment' : 'Reorder required',
        tone: available > 0 ? 'positive' : 'warning',
      },
      {
        title: 'Alarmed devices',
        value: alarmed.toString(),
        helper: alarmed > 0 ? 'Validity expiring' : 'All good',
        tone: alarmed > 0 ? 'warning' : 'positive',
      },
      {
        title: 'Retired / inactive',
        value: retired.toString(),
        helper: 'Awaiting disposal or service',
        tone: retired > 0 ? 'warning' : 'positive',
      },
    ];
  });

  readonly typeModelOptions = computed(() => {
    const typeName = this.createDeviceState().type?.trim().toLowerCase();
    if (!typeName) {
      return [];
    }

    const definition = this.deviceTypes().find(
      (type) => (type.name ?? '').trim().toLowerCase() === typeName,
    );

    if (definition?.models?.length) {
      return definition.models.filter((model): model is string => typeof model === 'string' && model.trim().length > 0);
    }

    return [];
  });

  readonly hasTypeModelOptions = computed(() => this.typeModelOptions().length > 0);

  ngOnInit(): void {
    this.loadInventory();
    this.loadDeviceTypes();
    this.loadDevelopers();
    this.loadAllProjects();
    this.loadAllCameras();
    this.loadAdmins();
  }

  statusColor(status: string | undefined): string {
    const normalized = this.normalizeStatus(status);

    if (normalized === 'assigned') {
      return 'bg-indigo-100 text-indigo-700';
    }

    if (normalized === 'available') {
      return 'bg-emerald-100 text-emerald-700';
    }

    if (normalized === 'reserved' || normalized === 'in transit' || normalized === 'user_assigned') {
      return 'bg-amber-100 text-amber-700';
    }

    if (normalized === 'retired' || normalized === 'inactive') {
      return 'bg-rose-100 text-rose-700';
    }

    return 'bg-slate-200 text-slate-700';
  }

  statusLabel(status: string | undefined): string {
    return status ? status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : 'Unknown';
  }

  assignmentSummary(item: InventoryItem): string {
    const assignment = item.currentAssignment;

    if (!assignment) {
      const userAssignment = item.currentUserAssignment;
      if (userAssignment) {
        const adminName = this.adminMap().get(userAssignment.userId || '')?.name ?? userAssignment.userName ?? '—';
        return `Assigned to ${adminName}`;
      }
      return 'Unassigned';
    }

    const developerId = this.extractAssignmentId(assignment.developer);
    const projectId = this.extractAssignmentId(assignment.project);
    const cameraId = this.extractAssignmentId(assignment.camera);

    const developerName = developerId ? this.developerMap().get(developerId)?.developerName : null;
    const projectName = projectId ? this.projectMap().get(projectId)?.projectName : null;
    const cameraName = cameraId ? this.cameraMap().get(cameraId)?.cameraDescription : null;

    const parts = [developerName ?? developerId ?? '—', projectName ?? projectId ?? '—', cameraName ?? cameraId ?? '—'];

    return parts.join(' • ');
  }

  lastMovement(item: InventoryItem): string {
    const timestamps = [
      item.currentAssignment?.assignedDate,
      item.currentUserAssignment?.assignedDate,
      item.createdDate,
    ].filter((value): value is string => !!value);

    if (timestamps.length === 0) {
      return '—';
    }

    const mostRecent = timestamps
      .map((value) => new Date(value))
      .filter((date) => !Number.isNaN(date.getTime()))
      .sort((a, b) => b.getTime() - a.getTime())[0];

    if (!mostRecent) {
      return '—';
    }

    return new Intl.DateTimeFormat('en-GB', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(mostRecent);
  }

  getItemAgeInDays(item: InventoryItem): number | null {
    return this.calculateAgeInDays(item);
  }

  getRemainingValidityDays(item: InventoryItem): number | null {
    const totalValidity = this.resolveValidityDays(item);
    if (totalValidity === null) {
      return null;
    }

    const age = this.calculateAgeInDays(item) ?? 0;
    return totalValidity - age;
  }

  isAlarmed(item: InventoryItem): boolean {
    const remaining = this.getRemainingValidityDays(item);
    return remaining !== null && remaining < 15;
  }

  onDeviceTypeChange(value: string): void {
    this.selectedDeviceType.set(value || null);
    this.selectedDeviceModel.set(null);
  }

  onDeveloperChange(value: string): void {
    const normalized = value || null;
    this.selectedDeveloperId.set(normalized);
    this.selectedProjectId.set(null);
    this.selectedCameraId.set(null);

    if (!normalized) {
      this.projects.set([]);
      this.cameras.set([]);
      return;
    }

    const filtered = this.allProjects().filter((project) => this.extractAssignmentId(project.developer) === normalized);
    this.projects.set(filtered);
    this.cameras.set([]);
  }

  onProjectChange(value: string): void {
    const normalized = value || null;
    this.selectedProjectId.set(normalized);
    this.selectedCameraId.set(null);

    if (!normalized) {
      this.cameras.set([]);
      return;
    }

    const filtered = this.allCameras().filter(
      (camera) => this.extractAssignmentId(camera.project) === normalized,
    );
    this.cameras.set(filtered);
  }

  onCameraChange(value: string): void {
    this.selectedCameraId.set(value || null);
  }

  onStatusChange(value: string): void {
    const normalized = value || null;
    this.selectedStatus.set(normalized);

    if (normalized !== 'user_assigned') {
      this.selectedAdminId.set(null);
    }

    if (normalized !== 'assigned') {
      this.selectedDeveloperId.set(null);
      this.selectedProjectId.set(null);
      this.selectedCameraId.set(null);
      this.projects.set([]);
      this.cameras.set([]);
    }
  }

  toggleAlarmedOnly(): void {
    this.showAlarmedOnly.update((current) => !current);
  }

  onDeviceModelSelect(model: string): void {
    const normalized = model || '';
    this.selectedDeviceModel.update((current) => (current === normalized ? null : normalized));
  }

  onAssignedUserFilterSelect(userId: string): void {
    this.selectedAdminId.update((current) => (current === userId ? null : userId));
  }

  onSerialQueryChange(value: string): void {
    this.serialQuery.set(value.trim());
  }

  openDeviceTypeModal(): void {
    this.deviceTypeError.set(null);
    this.deviceTypeForm.set({
      name: '',
      validityDays: 365,
      suggestedModels: '',
    });
    this.editingDeviceTypeId.set(null);
    this.deletingDeviceTypeId.set(null);
    this.isDeviceTypeModalOpen.set(true);
  }

  closeDeviceTypeModal(): void {
    this.isDeviceTypeModalOpen.set(false);
    this.deviceTypeError.set(null);
    this.editingDeviceTypeId.set(null);
    this.deletingDeviceTypeId.set(null);
    this.deviceTypeForm.set({
      name: '',
      validityDays: 365,
      suggestedModels: '',
    });
  }

  onDeviceTypeNameInput(value: string): void {
    this.deviceTypeForm.update((current) => ({
      ...current,
      name: value,
    }));
  }

  onDeviceTypeValidityInput(value: string): void {
    this.deviceTypeForm.update((current) => ({
      ...current,
      validityDays: value,
    }));
  }

  onDeviceTypeModelsInput(value: string): void {
    this.deviceTypeForm.update((current) => ({
      ...current,
      suggestedModels: value,
    }));
  }

  saveDeviceType(): void {
    const form = this.deviceTypeForm();
    const name = (form.name || '').trim();
    const validityDays = Number(form.validityDays);
    const modelsInput = form.suggestedModels ?? '';
    const models = modelsInput
      .split(/\s*[\n,;]\s*|\s+-\s+/)
      .map((model) => model.trim())
      .filter((model) => model.length > 0);

    if (!name) {
      this.deviceTypeError.set('Please provide a device type name.');
      return;
    }

    if (!Number.isFinite(validityDays) || validityDays <= 0) {
      this.deviceTypeError.set('Validity days must be a positive number.');
      return;
    }

    this.isSavingDeviceType.set(true);
    this.deviceTypeError.set(null);

    const editingId = this.editingDeviceTypeId();

    if (editingId) {
      this.deviceTypeService
        .update(editingId, {
          name,
          validityDays,
          models,
        })
        .pipe(
          takeUntilDestroyed(this.destroyRef),
          catchError((error) => {
            console.error('Failed to update device type', error);
            this.deviceTypeError.set('Unable to update device type. Please try again.');
            return of(null);
          }),
          finalize(() => this.isSavingDeviceType.set(false)),
        )
        .subscribe((updated) => {
          if (!updated) {
            return;
          }
          this.deviceTypes.update((current) =>
            current.map((type) => (type._id === updated._id ? updated : type)),
          );
          this.editingDeviceTypeId.set(null);
          this.deviceTypeForm.set({
            name: '',
            validityDays: 365,
            suggestedModels: '',
          });
          this.loadDeviceTypes();
          this.closeDeviceTypeModal();
        });
      return;
    }

    this.deviceTypeService
      .create({
        name,
        validityDays,
        models,
      })
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        catchError((error) => {
          console.error('Failed to create device type', error);
          this.deviceTypeError.set('Unable to save device type. Please try again.');
          return of(null);
        }),
        finalize(() => this.isSavingDeviceType.set(false)),
      )
      .subscribe((created) => {
        if (!created) {
          return;
        }
        this.deviceTypeForm.set({
          name: '',
          validityDays: 365,
          suggestedModels: '',
        });
        this.deviceTypes.update((current) => [...current, created]);
        this.loadDeviceTypes();
        this.closeDeviceTypeModal();
      });
  }

  startEditDeviceType(type: DeviceType): void {
    if (!type._id) {
      return;
    }
    this.deviceTypeError.set(null);
    this.editingDeviceTypeId.set(type._id);
    this.deviceTypeForm.set({
      name: type.name ?? '',
      validityDays: type.validityDays ?? 365,
      suggestedModels: Array.isArray(type.models) ? type.models.join(', ') : '',
    });
  }

  cancelDeviceTypeEdit(): void {
    this.editingDeviceTypeId.set(null);
    this.deviceTypeError.set(null);
    this.deviceTypeForm.set({
      name: '',
      validityDays: 365,
      suggestedModels: '',
    });
  }

  deleteDeviceType(type: DeviceType): void {
    const id = type._id;
    if (!id) {
      return;
    }

    const confirmed = window.confirm(
      `Delete device type “${type.name ?? 'Unnamed'}”? This action cannot be undone.`,
    );

    if (!confirmed) {
      return;
    }

    this.deviceTypeError.set(null);
    this.deletingDeviceTypeId.set(id);

    this.deviceTypeService
      .delete(id)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        catchError((error) => {
          console.error('Failed to delete device type', error);
          this.deviceTypeError.set('Unable to delete device type. Please try again.');
          return of(null);
        }),
        finalize(() => this.deletingDeviceTypeId.set(null)),
      )
      .subscribe((result) => {
        if (result === null) {
          return;
        }
        this.deviceTypes.update((current) => current.filter((item) => item._id !== id));
        if (this.editingDeviceTypeId() === id) {
          this.cancelDeviceTypeEdit();
        }
        this.loadDeviceTypes();
      });
  }

  openAssignProjectModal(item: InventoryItem): void {
    this.assignProjectModalItem.set(item);
    const assignment = item.currentAssignment;
    const developerId =
      this.extractAssignmentId(assignment?.developer) ?? this.selectedDeveloperId() ?? '';
    const projectId = this.extractAssignmentId(assignment?.project) ?? '';
    const cameraId = this.extractAssignmentId(assignment?.camera) ?? '';

    this.assignProjectState.set({
      developerId,
      projectId,
      cameraId,
      notes: assignment?.notes ?? '',
      error: null,
      isSaving: false,
    });
  }

  closeAssignProjectModal(): void {
    this.assignProjectModalItem.set(null);
  }

  onAssignProjectDeveloperChange(value: string): void {
    this.assignProjectState.update((state) => ({
      ...state,
      developerId: value,
      projectId: '',
      cameraId: '',
    }));
  }

  onAssignProjectProjectChange(value: string): void {
    this.assignProjectState.update((state) => ({
      ...state,
      projectId: value,
      cameraId: '',
    }));
  }

  onAssignProjectCameraChange(value: string): void {
    this.assignProjectState.update((state) => ({
      ...state,
      cameraId: value,
    }));
  }

  onAssignProjectNotesChange(value: string): void {
    this.assignProjectState.update((state) => ({
      ...state,
      notes: value,
    }));
  }

  saveAssignProject(): void {
    const item = this.assignProjectModalItem();
    if (!item) {
      return;
    }

    const state = this.assignProjectState();
    if (!state.developerId) {
      this.assignProjectState.update((current) => ({
        ...current,
        error: 'Developer is required.',
      }));
      return;
    }

    if (!state.projectId) {
      this.assignProjectState.update((current) => ({
        ...current,
        error: 'Project is required.',
      }));
      return;
    }

    if (!state.cameraId) {
      this.assignProjectState.update((current) => ({
        ...current,
        error: 'Camera is required.',
      }));
      return;
    }

    this.assignProjectState.update((current) => ({
      ...current,
      error: null,
      isSaving: true,
    }));

    const userAssignment = item.currentUserAssignment;
    const adminName = userAssignment?.userName
      ?? (userAssignment?.userId ? this.adminMap().get(userAssignment.userId)?.name : undefined)
      ?? 'Technician';
    const installNote = userAssignment
      ? `User ${adminName} installed in project on ${new Intl.DateTimeFormat('en-GB', {
          dateStyle: 'medium',
        }).format(new Date())}.`
      : undefined;

    const userNotes = state.notes.trim();
    const combinedNotes = [userNotes || null, installNote || null]
      .filter((value): value is string => !!value)
      .join('\n');

    const payload: InventoryAssignmentPayload = {
      developer: state.developerId,
      project: state.projectId,
      camera: state.cameraId,
      notes: combinedNotes || undefined,
    };

    const assignment$ = userAssignment
      ? this.inventoryService
          .unassignFromUser(item._id, 'User installed on project assignment')
          .pipe(switchMap(() => this.inventoryService.assignToProject(item._id, payload)))
      : this.inventoryService.assignToProject(item._id, payload);

    assignment$
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        catchError((error) => {
          console.error('Failed to assign device to project', error);
          this.assignProjectState.update((current) => ({
            ...current,
            error: 'Unable to assign device. Please try again.',
            isSaving: false,
          }));
          return of(null);
        }),
      )
      .subscribe((result) => {
        if (!result) {
          return;
        }
        this.closeAssignProjectModal();
        this.loadInventory();
      });
  }

  openAssignUserModal(item: InventoryItem): void {
    const current = item.currentUserAssignment;
    this.assignUserModalItem.set(item);
    this.assignUserState.set({
      adminId: current?.userId ?? '',
      notes: current?.notes ?? '',
      error: null,
      isSaving: false,
    });
  }

  closeAssignUserModal(): void {
    this.assignUserModalItem.set(null);
  }

  onAssignUserAdminChange(value: string): void {
    this.assignUserState.update((state) => ({
      ...state,
      adminId: value,
    }));
  }

  onAssignUserNotesChange(value: string): void {
    this.assignUserState.update((state) => ({
      ...state,
      notes: value,
    }));
  }

  saveAssignUser(): void {
    const item = this.assignUserModalItem();
    if (!item) {
      return;
    }

    const state = this.assignUserState();
    if (!state.adminId) {
      this.assignUserState.update((current) => ({
        ...current,
        error: 'Please select a user.',
      }));
      return;
    }

    this.assignUserState.update((current) => ({
      ...current,
      error: null,
      isSaving: true,
    }));

    const admin = this.adminMap().get(state.adminId);
    const payload: InventoryUserAssignmentPayload = {
      userId: state.adminId,
      userName: admin?.name ?? '',
      notes: state.notes.trim() ? state.notes.trim() : undefined,
    };

    this.inventoryService
      .assignToUser(item._id, payload)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        catchError((error) => {
          console.error('Failed to assign device to user', error);
          this.assignUserState.update((current) => ({
            ...current,
            error: 'Unable to assign device. Please try again.',
            isSaving: false,
          }));
          return of(null);
        }),
      )
      .subscribe((result) => {
        if (!result) {
          return;
        }
        this.closeAssignUserModal();
        this.loadInventory();
      });
  }

  openUnassignProjectModal(item: InventoryItem): void {
    this.unassignProjectModalItem.set(item);
    this.unassignProjectState.set({
      reason: '',
      error: null,
      isSaving: false,
    });
  }

  closeUnassignProjectModal(): void {
    this.unassignProjectModalItem.set(null);
  }

  onUnassignProjectReasonChange(value: string): void {
    this.unassignProjectState.update((state) => ({
      ...state,
      reason: value,
    }));
  }

  saveUnassignProject(): void {
    const item = this.unassignProjectModalItem();
    if (!item) {
      return;
    }

    const state = this.unassignProjectState();
    if (!state.reason.trim()) {
      this.unassignProjectState.update((current) => ({
        ...current,
        error: 'Please provide a reason.',
      }));
      return;
    }

    this.unassignProjectState.update((current) => ({
      ...current,
      error: null,
      isSaving: true,
    }));

    this.inventoryService
      .unassignFromProject(item._id, state.reason.trim())
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        catchError((error) => {
          console.error('Failed to unassign device from project', error);
          this.unassignProjectState.update((current) => ({
            ...current,
            error: 'Unable to unassign device. Please try again.',
            isSaving: false,
          }));
          return of(null);
        }),
      )
      .subscribe((result) => {
        if (!result) {
          return;
        }
        this.closeUnassignProjectModal();
        this.loadInventory();
      });
  }

  openUnassignUserModal(item: InventoryItem): void {
    this.unassignUserModalItem.set(item);
    this.unassignUserState.set({
      reason: '',
      error: null,
      isSaving: false,
    });
  }

  closeUnassignUserModal(): void {
    this.unassignUserModalItem.set(null);
  }

  onUnassignUserReasonChange(value: string): void {
    this.unassignUserState.update((state) => ({
      ...state,
      reason: value,
    }));
  }

  saveUnassignUser(): void {
    const item = this.unassignUserModalItem();
    if (!item) {
      return;
    }

    const state = this.unassignUserState();
    if (!state.reason.trim()) {
      this.unassignUserState.update((current) => ({
        ...current,
        error: 'Please provide a reason.',
      }));
      return;
    }

    this.unassignUserState.update((current) => ({
      ...current,
      error: null,
      isSaving: true,
    }));

    this.inventoryService
      .unassignFromUser(item._id, state.reason.trim())
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        catchError((error) => {
          console.error('Failed to unassign device from user', error);
          this.unassignUserState.update((current) => ({
            ...current,
            error: 'Unable to unassign device. Please try again.',
            isSaving: false,
          }));
          return of(null);
        }),
      )
      .subscribe((result) => {
        if (!result) {
          return;
        }
        this.closeUnassignUserModal();
        this.loadInventory();
      });
  }

  openCreateDeviceModal(): void {
    this.createDeviceState.set({
      type: this.deviceTypes()[0]?.name ?? '',
      serialNumber: '',
      model: '',
      estimatedAge: '',
      error: null,
      isSaving: false,
    });
    this.createDeviceModalOpen.set(true);
  }

  closeCreateDeviceModal(): void {
    this.createDeviceModalOpen.set(false);
  }

  onCreateDeviceTypeChange(value: string): void {
    this.createDeviceState.update((state) => ({
      ...state,
      type: value,
      model: '',
    }));
    const definition = this.deviceTypes().find(
      (type) => (type.name ?? '').trim().toLowerCase() === value.trim().toLowerCase(),
    );
    const primaryModel =
      definition?.models?.length && typeof definition.models[0] === 'string'
        ? definition.models[0]
        : '';
    if (primaryModel) {
      this.createDeviceState.update((state) => ({
        ...state,
        model: primaryModel,
      }));
    }
  }

  onCreateDeviceSerialChange(value: string): void {
    this.createDeviceState.update((state) => ({
      ...state,
      serialNumber: value,
    }));
  }

  onCreateDeviceModelChange(value: string): void {
    this.createDeviceState.update((state) => ({
      ...state,
      model: value,
    }));
  }

  onCreateDeviceModelSelect(value: string): void {
    this.createDeviceState.update((state) => ({
      ...state,
      model: value,
    }));
  }

  onCreateDeviceEstimatedAgeChange(value: string): void {
    this.createDeviceState.update((state) => ({
      ...state,
      estimatedAge: value,
    }));
  }

  saveCreateDevice(): void {
    const state = this.createDeviceState();
    if (!state.type.trim()) {
      this.createDeviceState.update((current) => ({
        ...current,
        error: 'Device type is required.',
      }));
      return;
    }

    if (!state.serialNumber.trim()) {
      this.createDeviceState.update((current) => ({
        ...current,
        error: 'Serial number is required.',
      }));
      return;
    }

    this.createDeviceState.update((current) => ({
      ...current,
      error: null,
      isSaving: true,
    }));

    const estimatedAgeValue = this.toFiniteDayCount(state.estimatedAge);
    
    const payload: Partial<InventoryItem> = {
      device: {
        type: state.type.trim(),
        serialNumber: state.serialNumber.trim(),
        model: state.model.trim() ? state.model.trim() : undefined,
      },
      status: 'available',
      assignmentHistory: [],
      validityDays:
        this.deviceTypes().find((type) => type.name?.toLowerCase() === state.type.trim().toLowerCase())
          ?.validityDays ?? 365,
      ...(estimatedAgeValue !== null && { estimatedAge: estimatedAgeValue }),
    };

    this.inventoryService
      .create(payload)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        catchError((error) => {
          console.error('Failed to create inventory item', error);
          this.createDeviceState.update((current) => ({
            ...current,
            error: 'Unable to create device. Please try again.',
            isSaving: false,
          }));
          return of(null);
        }),
      )
      .subscribe((result) => {
        if (!result) {
          return;
        }
        this.closeCreateDeviceModal();
        this.loadInventory();
      });
  }

  clearFilters(): void {
    this.selectedDeviceType.set(null);
    this.selectedDeviceModel.set(null);
    this.selectedDeveloperId.set(null);
    this.selectedProjectId.set(null);
    this.selectedCameraId.set(null);
    this.selectedStatus.set(null);
    this.selectedAdminId.set(null);
    this.serialQuery.set('');
    this.projects.set([]);
    this.cameras.set([]);
    this.showAlarmedOnly.set(false);
  }

  private loadDeviceTypes(): void {
    this.deviceTypeService
      .getAll()
      .pipe(takeUntilDestroyed(this.destroyRef), catchError(() => of<DeviceType[]>([])))
      .subscribe((types) => {
        this.deviceTypes.set(this.sortDeviceTypes(types));
        this.syncDeviceTypesWithInventory(this.items());
      });
  }

  private loadDevelopers(): void {
    this.developerService
      .getAll()
      .pipe(takeUntilDestroyed(this.destroyRef), catchError(() => of<Developer[]>([])))
      .subscribe((developers) => {
        // Filter developers based on user's accessibleDevelopers
        let filteredDevelopers = developers;
        const user = this.currentUser();
        if (user && !this.isSuperAdmin()) {
          const accessible = this.accessibleDevelopers();
          if (accessible.length > 0 && accessible[0] !== 'all') {
            filteredDevelopers = developers.filter((dev) => accessible.includes(dev._id));
          }
        }
        this.developers.set(this.sortDevelopers(filteredDevelopers));
      });
  }

  private loadAllProjects(): void {
    this.projectService
      .getAll()
      .pipe(takeUntilDestroyed(this.destroyRef), catchError(() => of<Project[]>([])))
      .subscribe((projects) => {
        this.allProjects.set(projects);
      });
  }

  private loadAllCameras(): void {
    this.cameraService
      .getAll()
      .pipe(takeUntilDestroyed(this.destroyRef), catchError(() => of<Camera[]>([])))
      .subscribe((cameras) => {
        this.allCameras.set(cameras);
      });
  }

  private loadAdmins(): void {
    this.userService
      .getAdmins()
      .pipe(takeUntilDestroyed(this.destroyRef), catchError(() => of<User[]>([])))
      .subscribe((admins) => {
        this.admins.set(admins);
      });
  }

  private loadInventory(): void {
    this.inventoryService
      .getAll()
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        catchError((error) => {
          console.error('Failed to load inventory', error);
          this.errorMessage.set('Unable to load inventory. Please try again.');
          return of<InventoryItem[]>([]);
        }),
        finalize(() => this.isLoading.set(false)),
      )
      .subscribe((items) => {
        this.items.set(items);
        this.syncDeviceTypesWithInventory(items);
      });
  }

  private normalizeStatus(status?: string): string {
    return (status ?? '').trim().toLowerCase();
  }

  private appliesDeviceTypeFilter(item: InventoryItem, deviceType: string | null): boolean {
    if (!deviceType) {
      return true;
    }
    return (item.device?.type ?? '').toLowerCase() === deviceType.toLowerCase();
  }

  private appliesDeviceModelFilter(item: InventoryItem, deviceModel: string | null): boolean {
    if (!deviceModel) {
      return true;
    }
    return (item.device?.model ?? '').toLowerCase() === deviceModel.toLowerCase();
  }

  private appliesDeveloperFilter(item: InventoryItem, developerId: string | null): boolean {
    if (!developerId) {
      return true;
    }

    const assignmentDeveloper = item.currentAssignment?.developer;
    const assignmentDeveloperId = this.extractAssignmentId(assignmentDeveloper);

    return assignmentDeveloperId === developerId;
  }

  private appliesProjectFilter(item: InventoryItem, projectId: string | null): boolean {
    if (!projectId) {
      return true;
    }

    const assignmentProject = item.currentAssignment?.project;
    const assignmentProjectId = this.extractAssignmentId(assignmentProject);

    return assignmentProjectId === projectId;
  }

  private appliesCameraFilter(item: InventoryItem, cameraId: string | null): boolean {
    if (!cameraId) {
      return true;
    }

    const assignmentCamera = item.currentAssignment?.camera;
    const assignmentCameraId = this.extractAssignmentId(assignmentCamera);

    return assignmentCameraId === cameraId;
  }

  private appliesStatusFilter(item: InventoryItem, status: string | null): boolean {
    const matchesStatus = !status || this.normalizeStatus(item.status) === status;
    if (!matchesStatus) {
      return false;
    }
    if (this.showAlarmedOnly()) {
      return this.isAlarmed(item);
    }
    return true;
  }

  private appliesAdminFilter(item: InventoryItem, adminId: string | null): boolean {
    if (!adminId) {
      return true;
    }

    const currentUserAssignment = item.currentUserAssignment;
    return (currentUserAssignment?.userId ?? null) === adminId;
  }

  private appliesSerialFilter(item: InventoryItem, query: string): boolean {
    if (!query) {
      return true;
    }

    const serial = item.device?.serialNumber ?? '';
    return serial.toLowerCase().includes(query.toLowerCase());
  }

  private applyFilters(items: InventoryItem[]): InventoryItem[] {
    const deviceType = this.selectedDeviceType();
    const deviceModel = this.selectedDeviceModel();
    const developerId = this.selectedDeveloperId();
    const projectId = this.selectedProjectId();
    const cameraId = this.selectedCameraId();
    const status = this.selectedStatus();
    const adminId = this.selectedAdminId();
    const serialQuery = this.serialQuery();

    return items.filter(
      (item) =>
        this.appliesDeviceTypeFilter(item, deviceType) &&
        this.appliesDeviceModelFilter(item, deviceModel) &&
        this.appliesDeveloperFilter(item, developerId) &&
        this.appliesProjectFilter(item, projectId) &&
        this.appliesCameraFilter(item, cameraId) &&
        this.appliesStatusFilter(item, status) &&
        this.appliesAdminFilter(item, adminId) &&
        this.appliesSerialFilter(item, serialQuery),
    );
  }

  canAssignToProject(item: InventoryItem): boolean {
    return !item.currentAssignment;
  }

  canUnassignFromProject(item: InventoryItem): boolean {
    return !!item.currentAssignment;
  }

  canAssignToUser(item: InventoryItem): boolean {
    return !item.currentUserAssignment;
  }

  canUnassignFromUser(item: InventoryItem): boolean {
    return !!item.currentUserAssignment;
  }

  extractAssignmentId(reference: unknown): string | undefined {
    if (!reference) {
      return undefined;
    }
    if (typeof reference === 'string') {
      return reference;
    }
    if (typeof reference === 'object' && '_id' in reference && typeof reference._id === 'string') {
      return reference._id;
    }
    return undefined;
  }

  private syncDeviceTypesWithInventory(items: InventoryItem[]): void {
    const existingMap = new Map(
      this.deviceTypes()
        .filter((type) => !!type.name)
        .map((type) => [type.name!.toLowerCase(), type]),
    );

    items.forEach((item) => {
      const name = (item.device?.type ?? '').trim();
      if (!name) {
        return;
      }
      const key = name.toLowerCase();
      if (!existingMap.has(key)) {
        existingMap.set(key, {
          _id: `local-${key}`,
          name,
          validityDays: item.validityDays ?? 365,
          isActive: true,
        });
      }
    });

    this.deviceTypes.set(this.sortDeviceTypes(Array.from(existingMap.values())));
  }

  private sortDeviceTypes(types: DeviceType[]): DeviceType[] {
    return [...types].sort((a, b) => {
      const aName = (a.name ?? '').toLowerCase();
      const bName = (b.name ?? '').toLowerCase();
      return aName.localeCompare(bName);
    });
  }

  private sortDevelopers(developers: Developer[]): Developer[] {
    return [...developers].sort((a, b) => {
      const aName = (a.developerName ?? '').toLowerCase();
      const bName = (b.developerName ?? '').toLowerCase();
      return aName.localeCompare(bName);
    });
  }

  private resolveValidityDays(item: InventoryItem): number | null {
    const typeName = item.device?.type?.trim().toLowerCase();
    if (typeName) {
      const deviceType = this.deviceTypeMapByName().get(typeName);
      const fromDeviceType = this.toFiniteDayCount(deviceType?.validityDays);
      if (fromDeviceType !== null) {
        return fromDeviceType;
      }
    }

    const fromItem = this.toFiniteDayCount(item.validityDays);
    if (fromItem !== null) {
      return fromItem;
    }

    return null;
  }

  private calculateAgeInDays(item: InventoryItem): number | null {
    let total = 0;
    let hasRange = false;

    // Add estimated age as initial value if present
    const estimatedAge = this.toFiniteDayCount(item['estimatedAge']);
    if (estimatedAge !== null && estimatedAge > 0) {
      total += estimatedAge;
      hasRange = true;
    }

    const addRange = (start?: string, end?: string) => {
      const duration = this.calculateDurationInDays(start, end);
      if (duration > 0) {
        total += duration;
        hasRange = true;
      }
    };

    const currentAssignment = item.currentAssignment;
    if (currentAssignment?.assignedDate) {
      addRange(currentAssignment.assignedDate, currentAssignment.removedDate);
    }

    for (const assignment of item.assignmentHistory ?? []) {
      addRange(assignment.assignedDate, assignment.removedDate);
    }

    return hasRange ? total : null;
  }

  private calculateDurationInDays(start?: string, end?: string): number {
    const startDate = this.parseDate(start);
    if (!startDate) {
      return 0;
    }

    const endDate = this.parseDate(end) ?? new Date();
    const milliseconds = endDate.getTime() - startDate.getTime();

    if (milliseconds <= 0) {
      return 0;
    }

    return Math.floor(milliseconds / (1000 * 60 * 60 * 24));
  }

  private parseDate(value?: string): Date | null {
    if (!value) {
      return null;
    }

    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private toFiniteDayCount(value: unknown): number | null {
    if (typeof value === 'number') {
      return Number.isFinite(value) ? Math.max(Math.round(value), 0) : null;
    }

    if (typeof value === 'string' && value.trim().length > 0) {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? Math.max(Math.round(parsed), 0) : null;
    }

    return null;
  }

  startEditEstimatedAge(item: InventoryItem): void {
    const currentEstimatedAge = item['estimatedAge'];
    const estimatedAgeString = currentEstimatedAge !== null && currentEstimatedAge !== undefined 
      ? String(currentEstimatedAge) 
      : '';
    
    this.editEstimatedAgeState.set({
      itemId: item._id,
      estimatedAge: estimatedAgeString,
      isSaving: false,
      error: null,
    });
  }

  onEstimatedAgeChange(value: string): void {
    this.editEstimatedAgeState.update((state) => ({
      ...state,
      estimatedAge: value,
      error: null,
    }));
  }

  cancelEditEstimatedAge(): void {
    this.editEstimatedAgeState.set({
      itemId: null,
      estimatedAge: '',
      isSaving: false,
      error: null,
    });
  }

  saveEstimatedAge(): void {
    const state = this.editEstimatedAgeState();
    if (!state.itemId) {
      return;
    }

    const estimatedAgeValue = this.toFiniteDayCount(state.estimatedAge);
    
    this.editEstimatedAgeState.update((current) => ({
      ...current,
      isSaving: true,
      error: null,
    }));

    const payload: Partial<InventoryItem> = {};
    
    if (estimatedAgeValue !== null && estimatedAgeValue > 0) {
      payload['estimatedAge'] = estimatedAgeValue;
    } else {
      // If empty or 0, remove the estimated age field by setting it to null
      payload['estimatedAge'] = null;
    }

    this.inventoryService
      .update(state.itemId, payload)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        catchError((error) => {
          console.error('Failed to update estimated age', error);
          this.editEstimatedAgeState.update((current) => ({
            ...current,
            isSaving: false,
            error: 'Unable to update estimated age. Please try again.',
          }));
          return of<InventoryItem | null>(null);
        }),
      )
      .subscribe((result) => {
        if (!result) {
          return;
        }
        
        const updatedEstimatedAge = result['estimatedAge'] ?? null;
        
        // Update the item in the items array
        this.items.update((items) =>
          items.map((item) => {
            if (item._id === state.itemId) {
              return { ...item, estimatedAge: updatedEstimatedAge };
            }
            return item;
          }),
        );
        
        // Update the view modal if it's the same item, preserving all existing data
        this.viewItemModal.update((item) => {
          if (item && item._id === state.itemId) {
            return { ...item, estimatedAge: updatedEstimatedAge };
          }
          return item;
        });
        
        // Cancel edit state to return to view mode
        this.cancelEditEstimatedAge();
        
        // Reload inventory in the background to ensure consistency
        this.loadInventory();
      });
  }

  isEditingEstimatedAge(itemId: string): boolean {
    return this.editEstimatedAgeState().itemId === itemId;
  }

  getCurrentEstimatedAge(item: InventoryItem): number | null {
    return this.toFiniteDayCount(item['estimatedAge']);
  }
}
