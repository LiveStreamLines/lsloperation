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

interface StatusOptionWithCount {
  value: string | null;
  label: string;
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
  readonly isRefreshing = signal(false);
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
      const isNoSerial = this.isNoSerialDeviceType(item);
      
      if (isNoSerial) {
        // For no-serial devices, check userAssignments array and sum quantities
        const userAssignments = item.userAssignments ?? [];
        for (const userAssignment of userAssignments) {
          if (!userAssignment.userId || (userAssignment.qty || 0) <= 0) {
            continue;
          }

          const qty = userAssignment.qty || 0;
          const existing = map.get(userAssignment.userId);
          if (existing) {
            existing.count += qty;
            continue;
          }

          const name = userAssignment.userName ?? this.adminMap().get(userAssignment.userId)?.name ?? 'Unknown user';
          map.set(userAssignment.userId, {
            id: userAssignment.userId,
            name,
            count: qty,
          });
        }
      } else {
        // For serialized devices, check currentUserAssignment
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
  readonly selectedAgeStatus = signal<'healthy' | 'at_risk' | 'expired' | null>(null);
  readonly serialQuery = signal<string>('');
  readonly showAlarmedOnly = signal<boolean>(false);
  readonly editingDeviceTypeId = signal<string | null>(null);
  readonly deletingDeviceTypeId = signal<string | null>(null);

  readonly statusOptions = [
    { value: null, label: 'All status' },
    { value: 'available', label: 'In Stock' },
    { value: 'assigned', label: 'On Project' },
    { value: 'user_assigned', label: 'With User' },
    { value: 'retired', label: 'Retired' },
  ];

  // Filtered status options based on permissions
  readonly filteredStatusOptions = computed<StatusOptionWithCount[]>(() => {
    const options = this.hasOnlyBasicInventoryAccess()
      ? [{ value: 'user_assigned' as const, label: 'With User' }]
      : this.statusOptions;

    return options.map((option) => ({
      ...option,
      count: this.getStatusFilterCount(option.value),
    }));
  });

  private getStatusFilterCount(status: string | null): number {
    const normalized = status ? this.normalizeStatus(status) : null;

    // Simulate onStatusChange() behavior: only keep contextual filters relevant to that status.
    const developerId = normalized === 'assigned' ? this.selectedDeveloperId() : null;
    const projectId = normalized === 'assigned' ? this.selectedProjectId() : null;
    const cameraId = normalized === 'assigned' ? this.selectedCameraId() : null;
    const adminId = normalized === 'user_assigned' ? this.selectedAdminId() : null;

    const deviceType = this.selectedDeviceType();
    const deviceModel = this.selectedDeviceModel();
    const ageStatus = this.selectedAgeStatus();
    const serialQuery = this.serialQuery();

    let filtered = this.items().filter(
      (item) =>
        this.appliesCountryFilter(item) &&
        this.appliesDeviceTypeFilter(item, deviceType) &&
        this.appliesDeviceModelFilter(item, deviceModel) &&
        this.appliesDeveloperFilter(item, developerId) &&
        this.appliesProjectFilter(item, projectId) &&
        this.appliesCameraFilter(item, cameraId) &&
        this.appliesStatusFilter(item, status) &&
        this.appliesAdminFilter(item, adminId) &&
        this.appliesAgeStatusFilter(item, ageStatus) &&
        this.appliesSerialFilter(item, serialQuery),
    );

    // Respect visibility rules (basic access users see only items assigned to them).
    if (!this.isSuperAdmin() && !this.canSeeAllInventory()) {
      const currentUser = this.currentUser();
      if (!currentUser) {
        return 0;
      }

      const currentUserId = (currentUser as any)?.['_id'] || (currentUser as any)?.id;
      if (!currentUserId) {
        return 0;
      }

      filtered = filtered.filter((item) => {
        // For no-serial devices, check userAssignments array
        if (this.isNoSerialDeviceType(item)) {
          const userAssignments = item.userAssignments ?? [];
          return userAssignments.some((ua) => {
            const uaUserId = String(ua.userId || '').trim();
            const currentId = String(currentUserId).trim();
            return uaUserId === currentId && (ua.qty || 0) > 0;
          });
        }

        // For serialized devices, check currentUserAssignment
        const assignmentUserId = item.currentUserAssignment?.userId;
        if (!assignmentUserId) {
          return false;
        }
        return String(assignmentUserId).trim() === String(currentUserId).trim();
      });
    }

    let total = 0;
    for (const item of filtered) {
      total += this.getItemQuantityForStatus(item, status, adminId);
    }
    return total;
  }

  private getItemQuantityForStatus(item: InventoryItem, status: string | null, adminId: string | null): number {
    const normalized = status ? this.normalizeStatus(status) : null;

    if (this.isNoSerialDeviceType(item)) {
      const inStock = item.inStock ?? 0;
      const assignedToUsersTotal = item.userAssignments?.reduce((sum, a) => sum + (a.qty || 0), 0) ?? 0;
      const assignedToProjects = item.projectAssignments?.reduce((sum, a) => sum + (a.qty || 0), 0) ?? 0;
      const totalFromParts = inStock + assignedToUsersTotal + assignedToProjects;
      const totalQty = totalFromParts > 0 ? totalFromParts : item.quantity ?? 0;

      if (!normalized) {
        return totalQty;
      }

      if (normalized === 'available') {
        return inStock;
      }

      if (normalized === 'user_assigned') {
        if (adminId) {
          const forUser = item.userAssignments?.find((ua) => ua.userId === adminId)?.qty ?? 0;
          return forUser || 0;
        }
        return assignedToUsersTotal;
      }

      if (normalized === 'assigned') {
        return assignedToProjects;
      }

      if (normalized === 'retired') {
        const itemStatus = this.normalizeStatus(item.status);
        return itemStatus === 'retired' || itemStatus === 'inactive' ? totalQty : 0;
      }

      return 0;
    }

    // Serialized devices
    const itemStatus = this.normalizeStatus(item.status);
    const itemQty = this.getItemQuantity(item);

    if (!normalized) {
      return itemQty;
    }

    if (normalized === 'retired') {
      return itemStatus === 'retired' || itemStatus === 'inactive' ? itemQty : 0;
    }

    if (itemStatus !== normalized) {
      return 0;
    }

    if (normalized === 'user_assigned') {
      const assignedQty = item.currentUserAssignment?.quantity;
      if (assignedQty && typeof assignedQty === 'number' && assignedQty > 0) {
        return assignedQty;
      }
    }

    return itemQty;
  }

  readonly ageStatusOptions = [
    { value: null, label: 'All ages' },
    { value: 'healthy', label: 'Healthy' },
    { value: 'at_risk', label: 'At Risk' },
    { value: 'expired', label: 'Expired' },
  ];

  readonly currentUser = computed(() => this.authStore.user());
  readonly currentUserId = computed(() => {
    const user = this.authStore.user();
    if (!user) return null;
    // Get user ID - try both 'id' and '_id' fields to handle different data formats
    return (user.id || (user as any)?.['_id'] || (user as any)?._id) as string | null;
  });
  readonly isSuperAdmin = computed(() => this.currentUser()?.role === 'Super Admin');
  // Treat "Stock keeper" permission as inventory admin (same behavior as Super Admin inside Inventory)
  readonly isInventoryAdmin = computed(() => this.isSuperAdmin() || ((this.currentUser() as any)?.canAssignToUser ?? false));
  readonly accessibleDevelopers = computed(() => this.currentUser()?.accessibleDevelopers ?? []);
  
  // Permission checks
  readonly canAddDeviceType = computed(
    () => this.isInventoryAdmin() || ((this.currentUser() as any)?.canAddDeviceType ?? false),
  );
  readonly canAddDeviceStock = computed(
    () => this.isInventoryAdmin() || ((this.currentUser() as any)?.canAddDeviceStock ?? false),
  );
  readonly hasInventoryAccess = computed(
    () => this.isSuperAdmin() || ((this.currentUser() as any)?.hasInventoryAccess ?? false),
  );
  readonly canSeeAllInventory = computed(
    () => this.isInventoryAdmin() || ((this.currentUser() as any)?.canSeeAllInventory ?? false),
  );
  readonly canAssignToUserPermission = computed(
    () => this.isInventoryAdmin() || ((this.currentUser() as any)?.canAssignToUser ?? false),
  );
  // Check if user has only basic inventory access (no see all permission)
  // Users with just inventory access (without "see all inventory") should only see devices assigned to them
  readonly hasOnlyBasicInventoryAccess = computed(
    () => this.hasInventoryAccess() && !this.canSeeAllInventory(),
  );

  // Filter developers by country
  readonly filteredDevelopers = computed(() => {
    let developers = this.developers();
    const user = this.currentUser();
    
    // Filter by country: Only users with "All" see all developers
    if (user?.country && user.country !== 'All') {
      developers = developers.filter((dev) => {
        // Only show developers where address.country matches user's country
        const devCountry = dev.address?.country || dev['country'];
        return devCountry === user.country;
      });
    } else if (!user?.country) {
      // If user has no country set, don't show any developers
      developers = [];
    }
    // If country is "All", show all developers (no filtering)
    
    return developers;
  });

  readonly sortedDevelopers = computed(() => {
    return [...this.filteredDevelopers()].sort((a, b) => {
      const nameA = (a.developerName || '').toLowerCase();
      const nameB = (b.developerName || '').toLowerCase();
      return nameA.localeCompare(nameB);
    });
  });

  readonly developerMap = computed(() => new Map(this.developers().map((developer) => [developer._id, developer])));
  readonly projectMap = computed(() => new Map(this.allProjects().map((project) => [project._id, project])));
  readonly cameraMap = computed(() => new Map(this.allCameras().map((camera) => [camera._id, camera])));
  
  // Filter admins by current user's country
  readonly filteredAdmins = computed(() => {
    const allAdmins = this.admins();
    const currentUser = this.authStore.user();
    
    if (!currentUser?.country || currentUser.country === 'All') {
      return allAdmins;
    }
    
    // Only show admins from the same country
    return allAdmins.filter((admin) => admin.country === currentUser.country);
  });
  
  readonly adminMap = computed(() => new Map(this.filteredAdmins().map((admin) => [admin._id, admin])));
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
  readonly isSelectedDeviceTypeNoSerial = computed(() => {
    const selectedType = this.createDeviceState().type;
    if (!selectedType) {
      return false;
    }
    const normalized = selectedType.trim().toLowerCase();
    const deviceTypeDefinition = this.deviceTypes().find(
      (definition) => (definition.name ?? '').trim().toLowerCase() === normalized,
    );
    return deviceTypeDefinition?.noSerial ?? false;
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
  readonly deviceTypeForm = signal<{ name: string; validityDays: number | string; suggestedModels: string; noSerial: boolean }>({
    name: '',
    validityDays: 365,
    suggestedModels: '',
    noSerial: false,
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
    quantity: string;
    error: string | null;
    isSaving: boolean;
  }>({
    adminId: '',
    notes: '',
    quantity: '1',
    error: null,
    isSaving: false,
  });

  readonly isAssignUserItemNoSerial = computed(() => {
    const item = this.assignUserModalItem();
    if (!item || !item.device?.type) {
      return false;
    }
    const deviceType = this.deviceTypes().find(
      (type) => (type.name ?? '').trim().toLowerCase() === (item.device?.type ?? '').trim().toLowerCase(),
    );
    return deviceType?.noSerial ?? false;
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
    userId: string;
    quantity: string;
    error: string | null;
    isSaving: boolean;
  }>({
    reason: '',
    userId: '',
    quantity: '1',
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
    itemId: string | null;
    type: string;
    serialNumber: string;
    quantity: string;
    model: string;
    estimatedAge: string;
    country: string;
    error: string | null;
    isSaving: boolean;
  }>({
    itemId: null,
    type: '',
    serialNumber: '',
    quantity: '1',
    model: '',
    estimatedAge: '',
    country: '',
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
    
    let total = 0;
    let assigned = 0;
    let userAssignedTotal = 0;
    let available = 0;
    
    for (const item of list) {
      if (this.isNoSerialDeviceType(item)) {
        // For no-serial devices: use quantity field
        const itemQty = item.quantity ?? 0;
        total += itemQty;
        
        // Projects: sum from projectAssignments
        const assignedToProjects = item.projectAssignments?.reduce((sum, a) => sum + (a.qty || 0), 0) ?? 0;
        assigned += assignedToProjects;
        
        // Technicians: sum from userAssignments
        const assignedToUsers = item.userAssignments?.reduce((sum, a) => sum + (a.qty || 0), 0) ?? 0;
        userAssignedTotal += assignedToUsers;
        
        // In Stock: use inStock field
        const inStock = item.inStock ?? 0;
        available += inStock;
      } else {
        // For serialized devices: use existing logic
        const itemQty = this.getItemQuantity(item);
        total += itemQty;
        
        // Projects: check status
        if (this.normalizeStatus(item.status) === 'assigned') {
          assigned += itemQty;
        }
        
        // Technicians: check currentUserAssignment
        const assignedQty = item.currentUserAssignment?.quantity;
        if (assignedQty && typeof assignedQty === 'number' && assignedQty > 0) {
          userAssignedTotal += assignedQty;
        }
        
        // In Stock: available if status is available and not assigned
        if (this.normalizeStatus(item.status) === 'available' && !item.currentAssignment && !item.currentUserAssignment) {
          available += itemQty;
        }
      }
    }
    
    const retiredItems = list.filter((item) => {
      const normalized = this.normalizeStatus(item.status);
      return normalized === 'retired' || normalized === 'inactive';
    });
    const retired = retiredItems.reduce((sum, item) => sum + this.getItemQuantity(item), 0);
    
    const alarmed = this.alarmedFilteredItemIds().size;

    return [
      {
        title: 'Inventory items',
        value: total.toString(),
        helper: `${assigned} project • ${userAssignedTotal} user`,
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
        value: userAssignedTotal.toString(),
        helper: 'Stock with users',
        tone: userAssignedTotal > 0 ? 'default' : 'warning',
      },
      {
        title: 'In Stock',
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
    // Auto-select "With User" status for users with only basic inventory access
    if (this.hasOnlyBasicInventoryAccess()) {
      this.selectedStatus.set('user_assigned');
    }
    
    this.loadInventory();
    this.loadDeviceTypes();
    this.loadDevelopers();
    this.loadAllProjects();
    this.loadAllCameras();
    this.loadAdmins();
  }

  refresh(): void {
    if (this.isRefreshing() || this.isLoading()) {
      return;
    }

    this.isRefreshing.set(true);
    this.errorMessage.set(null);

    this.loadInventory();
    this.loadDeviceTypes();
    this.loadDevelopers();
    this.loadAllProjects();
    this.loadAllCameras();
    this.loadAdmins();

    // Reset refreshing state after a short delay to allow loading to complete
    setTimeout(() => {
      this.isRefreshing.set(false);
    }, 500);
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

  // Get effective quantity for an item (1 for serialized items, actual quantity for no-serial items)
  getItemQuantity(item: InventoryItem): number {
    if (item.quantity && typeof item.quantity === 'number' && item.quantity > 0) {
      return item.quantity;
    }
    return 1; // Serialized items count as 1
  }

  // Get assigned quantity for display
  getAssignedQuantity(item: InventoryItem): number | null {
    return item.currentUserAssignment?.quantity ?? null;
  }

  // Check if an item is a no-serial device type
  isNoSerialDeviceType(item: InventoryItem): boolean {
    if (!item.device?.type) {
      return false;
    }
    const deviceType = this.deviceTypes().find(
      (type) => (type.name ?? '').trim().toLowerCase() === (item.device?.type ?? '').trim().toLowerCase(),
    );
    return deviceType?.noSerial ?? false;
  }

  // Get status badges for no-serial devices with colors
  getNoSerialStatusBadges(item: InventoryItem): Array<{label: string; qty: number; color: string}> {
    const badges: Array<{label: string; qty: number; color: string}> = [];
    const currentUserId = this.currentUserId();
    const isInventoryAdmin = this.isInventoryAdmin();
    
    // For regular users: only show their assigned quantity
    if (!isInventoryAdmin && currentUserId) {
      const userAssignment = item.userAssignments?.find(ua => ua.userId === currentUserId);
      const userQty = userAssignment?.qty || 0;
      if (userQty > 0) {
        badges.push({ label: 'With user', qty: userQty, color: 'bg-amber-100 text-amber-700' });
      }
      return badges;
    }
    
    // For inventory admins: show all statuses with colors
    // In stock - green
    const inStock = item.inStock ?? 0;
    if (inStock > 0) {
      badges.push({ label: 'In stock', qty: inStock, color: 'bg-emerald-100 text-emerald-700' });
    }
    
    // With user - orange
    const assignedToUsers = item.userAssignments?.reduce((sum, a) => sum + (a.qty || 0), 0) ?? 0;
    if (assignedToUsers > 0) {
      badges.push({ label: 'With user', qty: assignedToUsers, color: 'bg-amber-100 text-amber-700' });
    }
    
    // In project - red
    const assignedToProjects = item.projectAssignments?.reduce((sum, a) => sum + (a.qty || 0), 0) ?? 0;
    if (assignedToProjects > 0) {
      badges.push({ label: 'In project', qty: assignedToProjects, color: 'bg-rose-100 text-rose-700' });
    }
    
    return badges;
  }

  // Get combined status display for no-serial devices (for backward compatibility)
  getNoSerialStatusDisplay(item: InventoryItem): string {
    const badges = this.getNoSerialStatusBadges(item);
    if (badges.length === 0) {
      return 'No stock';
    }
    return badges.map(b => `${b.label} - ${b.qty}`).join(' • ');
  }

  statusLabel(status: string | undefined, item?: InventoryItem): string {
    // For no-serial devices, show combined status
    if (item && this.isNoSerialDeviceType(item)) {
      return this.getNoSerialStatusDisplay(item);
    }
    
    // For serialized devices, use the old logic
    if (!status) {
      return 'Unknown';
    }
    const normalized = this.normalizeStatus(status);
    const statusMap: Record<string, string> = {
      'available': 'In Stock',
      'assigned': 'On Project',
      'user_assigned': 'With User',
      'retired': 'Retired',
      'inactive': 'Inactive',
    };
    return statusMap[normalized] || status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
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

  onAgeStatusChange(value: 'healthy' | 'at_risk' | 'expired' | null | string): void {
    // Type guard to ensure value is one of the valid options
    if (value === 'healthy' || value === 'at_risk' || value === 'expired' || value === null) {
      this.selectedAgeStatus.set(value);
    } else {
      this.selectedAgeStatus.set(null);
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
      noSerial: false,
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
      noSerial: false,
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

  onDeviceTypeNoSerialChange(value: boolean): void {
    this.deviceTypeForm.update((current) => ({
      ...current,
      noSerial: value,
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
    const noSerial = form.noSerial ?? false;

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
          noSerial,
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
            noSerial: false,
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
        noSerial,
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
          noSerial: false,
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
      noSerial: type.noSerial ?? false,
    });
  }

  cancelDeviceTypeEdit(): void {
    this.editingDeviceTypeId.set(null);
    this.deviceTypeError.set(null);
    this.deviceTypeForm.set({
      name: '',
      validityDays: 365,
      suggestedModels: '',
      noSerial: false,
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
    this.assignUserModalItem.set(item);
    const current = item.currentUserAssignment;
    const isNoSerial = this.isNoSerialDeviceType(item);
    const maxAssignable = this.getMaxAssignableQuantity(item);
    const initialQuantity = isNoSerial ? (maxAssignable > 0 ? '1' : '0') : '1';
    this.assignUserState.set({
      adminId: current?.userId ?? '',
      notes: current?.notes ?? '',
      quantity: initialQuantity,
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

  onAssignUserQuantityChange(value: string): void {
    const item = this.assignUserModalItem();
    if (!item || !this.isNoSerialDeviceType(item)) {
      this.assignUserState.update((state) => ({
        ...state,
        quantity: value,
      }));
      return;
    }

    const max = this.getMaxAssignableQuantity(item);
    const raw = parseInt(value, 10);
    const next = Number.isFinite(raw) ? raw : 1;
    const clamped = Math.max(1, Math.min(max, next));

    this.assignUserState.update((state) => ({
      ...state,
      quantity: String(clamped),
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

    const admin = this.adminMap().get(state.adminId);
    const isNoSerial = this.isAssignUserItemNoSerial();
    const payload: InventoryUserAssignmentPayload = {
      userId: state.adminId,
      userName: admin?.name ?? '',
      notes: state.notes.trim() ? state.notes.trim() : undefined,
    };
    if (isNoSerial) {
      const quantity = Number(state.quantity);
      const max = this.getMaxAssignableQuantity(item);

      if (!Number.isFinite(quantity) || quantity <= 0) {
        this.assignUserState.update((current) => ({
          ...current,
          error: 'Quantity must be greater than 0.',
        }));
        return;
      }

      if (quantity > max) {
        this.assignUserState.update((current) => ({
          ...current,
          error: `Cannot assign more than available stock (${max}).`,
        }));
        return;
      }

      payload['quantity'] = Math.floor(quantity);
    }

    this.assignUserState.update((current) => ({
      ...current,
      error: null,
      isSaving: true,
    }));

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
    
    // Initialize quantity for no-serial devices
    let initialQuantity = '1';
    let initialUserId = '';
    if (this.isNoSerialDeviceType(item)) {
      const options = this.getNoSerialReturnUserOptions(item);
      const currentUserId = this.currentUserId();

      if (this.canSelectReturnUser()) {
        const preferred = currentUserId ? options.find((o) => o.id === currentUserId) : undefined;
        const selected = preferred ?? options[0];
        initialUserId = selected?.id ?? '';
        if (selected && selected.qty > 0) {
          initialQuantity = String(selected.qty);
        }
      } else {
        // Basic access: only return from self
        initialUserId = currentUserId ?? '';
        const qty = this.getUserAssignedQuantity(item, initialUserId);
        if (qty > 0) {
          initialQuantity = String(qty);
        }
      }
    }
    
    this.unassignUserState.set({
      reason: '',
      userId: initialUserId,
      quantity: initialQuantity,
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

  onUnassignUserUserChange(value: string): void {
    const item = this.unassignUserModalItem();
    if (!item || !this.isNoSerialDeviceType(item)) {
      return;
    }

    const normalized = value || '';
    const max = this.getUserAssignedQuantity(item, normalized);

    this.unassignUserState.update((state) => {
      const raw = parseInt(state.quantity, 10);
      const next = Number.isFinite(raw) ? raw : 1;
      const clamped = max > 0 ? Math.max(1, Math.min(max, next)) : 1;
      return {
        ...state,
        userId: normalized,
        quantity: String(clamped),
      };
    });
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

    // For no-serial devices, validate quantity
    const isNoSerial = this.isNoSerialDeviceType(item);
    if (isNoSerial) {
      const targetUserId = this.canSelectReturnUser() ? state.userId : this.currentUserId();
      if (!targetUserId) {
        this.unassignUserState.update((current) => ({
          ...current,
          error: 'Please select a user to return from.',
        }));
        return;
      }

      const assignedQty = this.getUserAssignedQuantity(item, targetUserId);
      const requestedQty = parseInt(state.quantity, 10) || 0;

      if (requestedQty <= 0) {
        this.unassignUserState.update((current) => ({
          ...current,
          error: 'Quantity must be greater than 0.',
        }));
        return;
      }

      if (requestedQty > assignedQty) {
        this.unassignUserState.update((current) => ({
          ...current,
          error: `Cannot return more than assigned quantity (${assignedQty}).`,
        }));
        return;
      }
    }

    this.unassignUserState.update((current) => ({
      ...current,
      error: null,
      isSaving: true,
    }));

    // For no-serial devices, pass selected userId and qty
    const targetUserId = isNoSerial ? (this.canSelectReturnUser() ? state.userId : this.currentUserId()) : null;
    const unassignOptions =
      isNoSerial && targetUserId
        ? {
            userId: targetUserId,
            qty: parseInt(state.quantity, 10) || 1,
          }
        : undefined;

    this.inventoryService
      .unassignFromUser(item._id, state.reason.trim(), unassignOptions)
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

  onUnassignUserQuantityChange(value: string): void {
    const item = this.unassignUserModalItem();
    if (!item || !this.isNoSerialDeviceType(item)) {
      this.unassignUserState.update((state) => ({
        ...state,
        quantity: value,
      }));
      return;
    }

    const max = this.getUserAssignedQuantity(item, this.unassignUserState().userId);
    const raw = parseInt(value, 10);
    const next = Number.isFinite(raw) ? raw : 1;
    const clamped = Math.max(1, Math.min(max, next));

    this.unassignUserState.update((state) => ({
      ...state,
      quantity: String(clamped),
    }));
  }

  openCreateDeviceModal(item?: InventoryItem): void {
    if (item) {
      // Edit mode
      const estimatedAge = item['estimatedAge'];
      const estimatedAgeString = estimatedAge !== null && estimatedAge !== undefined 
        ? String(estimatedAge) 
        : '';
      this.createDeviceState.set({
        itemId: item._id,
        type: item.device?.type || '',
        serialNumber: item.device?.serialNumber || '',
        quantity: String(item.quantity ?? '1'),
        model: item.device?.model || '',
        estimatedAge: estimatedAgeString,
        country: (item as any).country || '',
        error: null,
        isSaving: false,
      });
    } else {
      // Create mode - default to user's country
      const userCountry = this.currentUser()?.country || '';
      this.createDeviceState.set({
        itemId: null,
        type: this.deviceTypes()[0]?.name ?? '',
        serialNumber: '',
        quantity: '1',
        model: '',
        estimatedAge: '',
        country: userCountry,
        error: null,
        isSaving: false,
      });
    }
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

  onCreateDeviceQuantityChange(value: string): void {
    this.createDeviceState.update((state) => ({
      ...state,
      quantity: value,
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

  onCreateDeviceCountryChange(value: string): void {
    this.createDeviceState.update((state) => ({
      ...state,
      country: value,
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

    // Check if device type is no-serial
    const isNoSerial = this.isSelectedDeviceTypeNoSerial();

    if (isNoSerial) {
      // Validate quantity for no-serial devices
      const quantity = Number(state.quantity);
      if (!Number.isFinite(quantity) || quantity <= 0) {
        this.createDeviceState.update((current) => ({
          ...current,
          error: 'Quantity must be a positive number.',
        }));
        return;
      }
    } else {
      // Validate serial number for regular devices
      if (!state.serialNumber.trim()) {
        this.createDeviceState.update((current) => ({
          ...current,
          error: 'Serial number is required.',
        }));
        return;
      }
    }

    this.createDeviceState.update((current) => ({
      ...current,
      error: null,
      isSaving: true,
    }));

    const estimatedAgeValue = this.toFiniteDayCount(state.estimatedAge);
    
    const isEditMode = !!state.itemId;
    
    const payload: Partial<InventoryItem> = {
      device: {
        type: state.type.trim(),
        model: state.model.trim() ? state.model.trim() : undefined,
      },
    };

    // Add serialNumber only if not no-serial
    if (!isNoSerial) {
      payload.device!.serialNumber = state.serialNumber.trim();
    }

    // Add quantity for no-serial devices
    if (isNoSerial) {
      payload['quantity'] = Number(state.quantity);
    }
    
    // Include country if provided
    if (state.country.trim()) {
      payload['country'] = state.country.trim();
    }
    
    // Include estimatedAge if it's a valid positive number
    if (estimatedAgeValue !== null && estimatedAgeValue > 0) {
      payload['estimatedAge'] = estimatedAgeValue;
    } else if (estimatedAgeValue === 0 || (estimatedAgeValue === null && state.estimatedAge.trim() === '')) {
      // Explicitly set to null if 0 or empty string
      payload['estimatedAge'] = null;
    }

    // For create mode, add default fields
    if (!isEditMode) {
      payload.status = 'available';
      payload.assignmentHistory = [];
      payload.validityDays =
        this.deviceTypes().find((type) => type.name?.toLowerCase() === state.type.trim().toLowerCase())
          ?.validityDays ?? 365;
    }

    const request = isEditMode
      ? this.inventoryService.update(state.itemId!, payload)
      : this.inventoryService.create(payload);

    request
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        catchError((error) => {
          console.error(`Failed to ${isEditMode ? 'update' : 'create'} inventory item`, error);
          this.createDeviceState.update((current) => ({
            ...current,
            error: `Unable to ${isEditMode ? 'update' : 'create'} device. Please try again.`,
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
    this.selectedAgeStatus.set(null);
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
        this.admins.set(admins.sort((a, b) => a.name.localeCompare(b.name)));
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
        finalize(() => {
          this.isLoading.set(false);
          this.isRefreshing.set(false);
        }),
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
    if (!status) {
      if (this.showAlarmedOnly()) {
        return this.isAlarmed(item);
      }
      return true;
    }

    // For no-serial devices, check actual quantities
    if (this.isNoSerialDeviceType(item)) {
      const normalized = this.normalizeStatus(status);
      
      if (normalized === 'available') {
        // Show if in stock > 0
        const inStock = item.inStock ?? 0;
        return inStock > 0;
      }
      
      if (normalized === 'user_assigned') {
        // Show if assigned to users > 0
        const assignedToUsers = item.userAssignments?.reduce((sum, a) => sum + (a.qty || 0), 0) ?? 0;
        return assignedToUsers > 0;
      }
      
      if (normalized === 'assigned') {
        // Show if assigned to projects > 0
        const assignedToProjects = item.projectAssignments?.reduce((sum, a) => sum + (a.qty || 0), 0) ?? 0;
        return assignedToProjects > 0;
      }
      
      if (normalized === 'retired') {
        const itemStatus = this.normalizeStatus(item.status);
        return itemStatus === 'retired' || itemStatus === 'inactive';
      }
      
      return false;
    }

    // For serialized devices, use the old logic
    const matchesStatus = this.normalizeStatus(item.status) === status;
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

    // For no-serial devices, check userAssignments array
    if (this.isNoSerialDeviceType(item)) {
      const userAssignments = item.userAssignments ?? [];
      return userAssignments.some(ua => ua.userId === adminId && (ua.qty || 0) > 0);
    }

    // For serialized devices, check currentUserAssignment
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

  getDeviceAgeStatus(item: InventoryItem): 'healthy' | 'at_risk' | 'expired' | null {
    const totalValidity = this.resolveValidityDays(item);
    if (totalValidity === null) {
      return null;
    }

    const remaining = this.getRemainingValidityDays(item);
    if (remaining === null) {
      return null;
    }

    // At risk when 90% of validity is used, meaning remaining <= 10% of total
    const atRiskThreshold = totalValidity * 0.1;

    if (remaining <= 0) {
      return 'expired';
    } else if (remaining <= atRiskThreshold) {
      return 'at_risk';
    } else {
      return 'healthy';
    }
  }

  private appliesAgeStatusFilter(item: InventoryItem, ageStatus: 'healthy' | 'at_risk' | 'expired' | null): boolean {
    if (!ageStatus) {
      return true;
    }

    const itemAgeStatus = this.getDeviceAgeStatus(item);
    return itemAgeStatus === ageStatus;
  }

  private appliesCountryFilter(item: InventoryItem): boolean {
    const user = this.authStore.user();
    // Inventory admins see all items regardless of country
    if (this.isInventoryAdmin()) {
      return true;
    }
    
    // If user has no country set, show all items
    if (!user?.country) {
      return true;
    }

    const userCountry = user.country;

    // Check if item is assigned to a camera
    const assignment = item.currentAssignment;
    if (assignment?.camera) {
      // Find the camera to check its country
      const cameraId = typeof assignment.camera === 'object' && assignment.camera !== null
        ? (assignment.camera as any)._id 
        : assignment.camera;
      const camera = this.allCameras().find(c => c._id === cameraId || c.camera === cameraId);
      if (camera && camera['country']) {
        return camera['country'] === userCountry;
      }
    }

    // Check if item has assignedCameraId
    if (item.assignedCameraId) {
      const camera = this.allCameras().find(c => c._id === item.assignedCameraId);
      if (camera && camera['country']) {
        return camera['country'] === userCountry;
      }
    }

    // Check if item is assigned to a developer (for items not yet assigned to cameras)
    if (assignment?.developer) {
      const devId = typeof assignment.developer === 'object' && assignment.developer !== null
        ? (assignment.developer as any)._id 
        : assignment.developer;
      const developer = this.developers().find(d => d._id === devId);
      if (developer) {
        // Check address.country (preferred) or top-level country (fallback for legacy data)
        const devCountry = developer.address?.country || developer['country'];
        if (devCountry) {
          return devCountry === userCountry;
        }
      }
    }

    // If no country information is available, show the item (to avoid hiding everything)
    return true;
  }

  private applyFilters(items: InventoryItem[]): InventoryItem[] {
    const deviceType = this.selectedDeviceType();
    const deviceModel = this.selectedDeviceModel();
    const developerId = this.selectedDeveloperId();
    const projectId = this.selectedProjectId();
    const cameraId = this.selectedCameraId();
    const status = this.selectedStatus();
    const adminId = this.selectedAdminId();
    const ageStatus = this.selectedAgeStatus();
    const serialQuery = this.serialQuery();

    let filtered = items.filter(
      (item) =>
        this.appliesCountryFilter(item) &&
        this.appliesDeviceTypeFilter(item, deviceType) &&
        this.appliesDeviceModelFilter(item, deviceModel) &&
        this.appliesDeveloperFilter(item, developerId) &&
        this.appliesProjectFilter(item, projectId) &&
        this.appliesCameraFilter(item, cameraId) &&
        this.appliesStatusFilter(item, status) &&
        this.appliesAdminFilter(item, adminId) &&
        this.appliesAgeStatusFilter(item, ageStatus) &&
        this.appliesSerialFilter(item, serialQuery),
    );

    // If user is not Super Admin and doesn't have "see all inventory" permission,
    // show only items assigned to them
    if (!this.isSuperAdmin() && !this.canSeeAllInventory()) {
      const currentUser = this.currentUser();
      if (!currentUser) {
        // If no user object, show nothing
        filtered = [];
        return filtered;
      }
      
      // Try both 'id' (from AuthenticatedUser) and '_id' (from backend response)
      const currentUserId = (currentUser as any)?.['_id'] || (currentUser as any)?.id;
      if (currentUserId) {
        filtered = filtered.filter(
          (item) => {
            // For no-serial devices, check userAssignments array
            if (this.isNoSerialDeviceType(item)) {
              const userAssignments = item.userAssignments ?? [];
              return userAssignments.some(ua => {
                const uaUserId = String(ua.userId || '').trim();
                const currentId = String(currentUserId).trim();
                return uaUserId === currentId && (ua.qty || 0) > 0;
              });
            }
            
            // For serialized devices, check currentUserAssignment
            const assignmentUserId = item.currentUserAssignment?.userId;
            if (!assignmentUserId) {
              return false; // No assignment means not assigned to this user
            }
            // Compare both as strings to ensure type matching, and trim whitespace
            return String(assignmentUserId).trim() === String(currentUserId).trim();
          },
        );
      } else {
        // If no user ID, show nothing
        filtered = [];
      }
    }

    return filtered;
  }

  canAssignToProject(item: InventoryItem): boolean {
    return !item.currentAssignment;
  }

  canUnassignFromProject(item: InventoryItem): boolean {
    return !!item.currentAssignment;
  }

  canAssignToUser(item: InventoryItem): boolean {
    // For no-serial devices: check if there's inStock available
    if (this.isNoSerialDeviceType(item)) {
      const inStock = item.inStock ?? 0;
      return inStock > 0;
    }
    // For serialized devices: check if not assigned to user
    return !item.currentUserAssignment;
  }

  canUnassignFromUser(item: InventoryItem): boolean {
    // For no-serial devices: allow if there is any user assignment for privileged users,
    // otherwise only allow unassigning own quantity.
    if (this.isNoSerialDeviceType(item)) {
      if (this.canSelectReturnUser()) {
        return this.getAnyUserAssignedQuantity(item) > 0;
      }

      const currentUserId = this.currentUserId();
      if (!currentUserId) {
        return false;
      }
      const userAssignment = item.userAssignments?.find((ua) => ua.userId === currentUserId);
      return (userAssignment?.qty || 0) > 0;
    }
    // For serialized devices: check if assigned to user
    return !!item.currentUserAssignment;
  }

  // Check if item has inStock available (for no-serial devices)
  hasInStock(item: InventoryItem): boolean {
    if (this.isNoSerialDeviceType(item)) {
      return (item.inStock ?? 0) > 0;
    }
    return false;
  }

  // Check if item has user assignments (for no-serial devices)
  hasUserAssignments(item: InventoryItem): boolean {
    if (this.isNoSerialDeviceType(item)) {
      const currentUserId = this.currentUserId();
      if (!currentUserId) {
        return false;
      }
      const userAssignment = item.userAssignments?.find((ua) => ua.userId === currentUserId);
      return (userAssignment?.qty || 0) > 0;
    }
    return false;
  }

  // Check if item has any user assignments (for no-serial devices)
  hasAnyUserAssignments(item: InventoryItem): boolean {
    if (!this.isNoSerialDeviceType(item)) {
      return false;
    }
    return this.getAnyUserAssignedQuantity(item) > 0;
  }

  private getAnyUserAssignedQuantity(item: InventoryItem): number {
    return item.userAssignments?.reduce((sum, a) => sum + (a.qty || 0), 0) ?? 0;
  }

  canSelectReturnUser(): boolean {
    return this.isSuperAdmin() || this.canSeeAllInventory();
  }

  // Get maximum assignable quantity (inStock for no-serial devices)
  getMaxAssignableQuantity(item: InventoryItem | null | undefined): number {
    if (!item) {
      return 0;
    }
    if (this.isNoSerialDeviceType(item)) {
      return item.inStock ?? 0;
    }
    return item.quantity ?? 0;
  }

  // Get user assigned quantity (for no-serial devices return modal)
  getUserAssignedQuantity(item: InventoryItem | null | undefined, userId?: string | null): number {
    if (!item || !this.isNoSerialDeviceType(item)) {
      return 0;
    }
    const targetUserId = userId || this.currentUserId();
    if (!targetUserId || !item.userAssignments) {
      return 0;
    }
    const userAssignment = item.userAssignments.find((ua) => ua.userId === targetUserId);
    return userAssignment?.qty || 0;
  }

  getNoSerialReturnUserOptions(item: InventoryItem | null | undefined): Array<{ id: string; name: string; qty: number }> {
    if (!item || !this.isNoSerialDeviceType(item)) {
      return [];
    }

    const options =
      item.userAssignments
        ?.filter((ua) => !!ua.userId && (ua.qty || 0) > 0)
        .map((ua) => {
          const id = String(ua.userId);
          const name = ua.userName ?? this.adminMap().get(id)?.name ?? 'Unknown user';
          return { id, name, qty: ua.qty || 0 };
        }) ?? [];

    return options.sort((a, b) => a.name.localeCompare(b.name));
  }

  isUnassigned(item: InventoryItem): boolean {
    return !item.currentAssignment && !item.currentUserAssignment;
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
