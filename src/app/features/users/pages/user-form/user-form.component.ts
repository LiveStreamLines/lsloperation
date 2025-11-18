import { CommonModule } from '@angular/common';
import { Component, DestroyRef, OnInit, computed, inject, signal, HostListener } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { of, forkJoin } from 'rxjs';
import { catchError, finalize } from 'rxjs/operators';
import { UserService } from '@core/services/user.service';
import { DeveloperService } from '@core/services/developer.service';
import { ProjectService } from '@core/services/project.service';
import { CameraService } from '@core/services/camera.service';
import { AuthService } from '@core/auth/auth.service';
import { AuthStore } from '@core/auth/auth.store';
import { User } from '@core/models/user.model';
import { Developer } from '@core/models/developer.model';
import { Project } from '@core/models/project.model';
import { Camera } from '@core/models/camera.model';
import { environment } from '@env';

interface UserFormState {
  name: string;
  email: string;
  phone: string;
  role: string;
  image: string | null; // Persisted image path
  imageFile: File | null;
  imagePreview: string | null;
  // Region access (for Admins)
  hasUaeAccess: boolean;
  hasSaudiAccess: boolean;
  // High-level operation permissions
  canManageDevProjCam: boolean;
  hasCameraMonitorAccess: boolean;
  hasInventoryAccess: boolean;
  hasMemoryAccess: boolean;
  accessibleDevelopers: string[];
  accessibleProjects: string[];
  accessibleCameras: string[];
  accessibleServices: string[];
  canAddUser: boolean;
  canGenerateVideoAndPics: boolean;
  // Operation permissions - camera monitor
  canWatchCameraMonitor: boolean;
  canCreateMonitorTask: boolean;
  canHoldMaintenance: boolean;
  canDeletePhoto: boolean;
  canSeeAllTasks: boolean;
  // Operation permissions - inventory
  canAddDeviceType: boolean;
  canAddDeviceStock: boolean;
  canAssignUnassignUser: boolean;
  canAssignUnassignProject: boolean;
  // Operation permissions - memory
  canArchiveMemory: boolean;
  memoryRole: string;
  inventoryRole: string;
  isSaving: boolean;
  error: string | null;
}

const SERVICES = [
  'Time lapse',
  'Live Streaming',
  'Drone Shooting',
  'Site Photography & Videography',
  '360 Photography & Videography',
  'Satellite Imagery',
];

const MEMORY_ROLES = [
  { value: '', viewValue: '-' },
  { value: 'viewer', viewValue: 'Memory Viewer' },
  { value: 'removal', viewValue: 'Memory Removal' },
  { value: 'archiver', viewValue: 'Memory Archiver' },
];

const INVENTORY_ROLES = [
  { value: '', viewValue: '-' },
  { value: 'viewer', viewValue: 'Inventory viewer' },
  { value: 'tech', viewValue: 'Inventory Technician' },
  { value: 'stock', viewValue: 'Inventory Stockeeper' },
];

const ROLES = ['Super Admin', 'Admin'];

@Component({
  selector: 'app-user-form',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './user-form.component.html',
})
export class UserFormComponent implements OnInit {
  private readonly userService = inject(UserService);
  private readonly developerService = inject(DeveloperService);
  private readonly projectService = inject(ProjectService);
  private readonly cameraService = inject(CameraService);
  private readonly authService = inject(AuthService);
  private readonly authStore = inject(AuthStore);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);

  readonly isLoading = signal(true);
  readonly isEditMode = signal(false);
  readonly userId = signal<string | null>(null);
  readonly submitted = signal(false);
  readonly resetEmail = signal('');
  readonly userForm = signal<UserFormState>(this.createEmptyForm());
  readonly assetBaseUrl = environment.apiUrl.replace('/api', '');

  readonly developers = signal<Developer[]>([]);
  readonly projects = signal<Project[]>([]);
  readonly cameras = signal<Camera[]>([]);

  readonly isSuperAdmin = computed(() => {
    const user = this.authStore.user();
    return user?.role === 'Super Admin';
  });

  readonly accessibleDevelopers = computed(() => {
    const user = this.authStore.user();
    return user?.accessibleDevelopers || [];
  });

  readonly accessibleProjects = computed(() => {
    const user = this.authStore.user();
    return user?.accessibleProjects || [];
  });

  readonly accessibleCameras = computed(() => {
    const user = this.authStore.user();
    return user?.accessibleCameras || [];
  });

  readonly hidePermissions = computed(() => {
    return this.userForm().role === 'Super Admin';
  });

  readonly showAdminRoles = computed(() => {
    return this.userForm().role === 'Admin';
  });

  readonly isAllDevSelected = computed(() => {
    return this.userForm().accessibleDevelopers.includes('all');
  });

  readonly isAllProjSelected = computed(() => {
    return this.userForm().accessibleProjects.includes('all');
  });

  readonly isAllCameraSelected = computed(() => {
    return this.userForm().accessibleCameras.includes('all');
  });

  readonly isAllServiceSelected = computed(() => {
    return this.userForm().accessibleServices.includes('all');
  });

  readonly filteredDevelopers = computed(() => {
    const devs = this.developers();
    if (this.isSuperAdmin() || this.accessibleDevelopers()[0] === 'all') {
      return devs.sort((a, b) => {
        const nameA = (a.developerName || '').toLowerCase();
        const nameB = (b.developerName || '').toLowerCase();
        return nameA.localeCompare(nameB);
      });
    }
    return devs
      .filter((d) => this.accessibleDevelopers().includes(d._id))
      .sort((a, b) => {
        const nameA = (a.developerName || '').toLowerCase();
        const nameB = (b.developerName || '').toLowerCase();
        return nameA.localeCompare(nameB);
      });
  });

  readonly filteredProjects = computed(() => {
    return [...new Set(this.projects())].sort((a, b) => {
      const nameA = (a.projectName || '').toLowerCase();
      const nameB = (b.projectName || '').toLowerCase();
      return nameA.localeCompare(nameB);
    });
  });

  readonly filteredCameras = computed(() => {
    return [...new Set(this.cameras())].sort((a, b) => {
      const nameA = (a.camera || a.cameraDescription || '').toLowerCase();
      const nameB = (b.camera || b.cameraDescription || '').toLowerCase();
      return nameA.localeCompare(nameB);
    });
  });

  readonly roles = ROLES;
  readonly services = SERVICES;
  readonly memoryRoles = MEMORY_ROLES;
  readonly inventoryRoles = INVENTORY_ROLES;

  ngOnInit(): void {
    const userId = this.route.snapshot.paramMap.get('id');
    if (userId) {
      this.isEditMode.set(true);
      this.userId.set(userId);
      this.loadUser(userId);
    } else {
      // Create mode – no need to block on loading, show the form immediately
      this.isEditMode.set(false);
      this.isLoading.set(false);
    }

    this.loadDevelopers();

    // Watch for role changes
    // Note: We'll handle this in the template with (ngModelChange)
  }

  loadDevelopers(): void {
    this.developerService
      .getAll({ forceRefresh: true })
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        catchError((error) => {
          console.error('Failed to load developers', error);
          return of<Developer[]>([]);
        }),
      )
      .subscribe((developers) => {
        let filtered = developers;
        if (!this.isSuperAdmin() && this.accessibleDevelopers()[0] !== 'all') {
          filtered = developers.filter((d) => this.accessibleDevelopers().includes(d._id));
        }
        this.developers.set(filtered);

        // Set first developer as default if not editing and not super admin
        if (!this.isEditMode() && !this.isSuperAdmin() && filtered.length > 0) {
          this.updateFormField('accessibleDevelopers', [filtered[0]._id]);
          this.loadProjectsByDevelopers([filtered[0]._id]);
        }
      });
  }

  loadUser(userId: string): void {
    this.isLoading.set(true);
    this.userService
      .getById(userId)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        catchError((error) => {
          console.error('Failed to load user', error);
          return of<User | undefined>(undefined);
        }),
        finalize(() => this.isLoading.set(false)),
      )
      .subscribe((user) => {
        if (user) {
          this.populateForm(user);
          this.loadProjectsByDevelopers(user.accessibleDevelopers || []);
        }
      });
  }

  loadProjectsByDevelopers(developerIds: string[]): void {
    if (developerIds.includes('all')) {
      this.userForm.update((form) => ({
        ...form,
        accessibleProjects: ['all'],
        accessibleCameras: ['all'],
      }));
      this.projects.set([]);
      this.cameras.set([]);
      return;
    }

    this.projects.set([]);
    if (developerIds && developerIds.length > 0) {
      const projectObservables = developerIds.map((developerId) =>
        this.projectService.getByDeveloper(developerId).pipe(
          catchError((error) => {
            console.error('Failed to load projects', error);
            return of<Project[]>([]);
          }),
        ),
      );

      forkJoin(projectObservables)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe((projectArrays) => {
          let allProjects: Project[] = [];
          projectArrays.forEach((projects) => {
            if (this.accessibleProjects()[0] !== 'all' && !this.isSuperAdmin()) {
              allProjects = [
                ...allProjects,
                ...projects.filter((p) => this.accessibleProjects().includes(p._id)),
              ];
            } else {
              allProjects = [...allProjects, ...projects];
            }
          });
          this.projects.set([...new Map(allProjects.map((p) => [p._id, p])).values()]);
        });
    } else {
      this.projects.set([]);
      this.userForm.update((form) => ({
        ...form,
        accessibleProjects: [],
      }));
    }
  }

  loadCamerasByProjects(projectIds: string[]): void {
    if (this.isSuperAdmin() && projectIds.includes('all')) {
      this.userForm.update((form) => ({
        ...form,
        accessibleCameras: ['all'],
      }));
      this.cameras.set([]);
      return;
    }

    this.cameras.set([]);
    if (projectIds && projectIds.length > 0) {
      const cameraObservables = projectIds.map((projectId) =>
        this.cameraService.getByProject(projectId).pipe(
          catchError((error) => {
            console.error('Failed to load cameras', error);
            return of<Camera[]>([]);
          }),
        ),
      );

      forkJoin(cameraObservables)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe((cameraArrays) => {
          let allCameras: Camera[] = [];
          cameraArrays.forEach((cameras) => {
            if (this.accessibleCameras()[0] !== 'all' && !this.isSuperAdmin()) {
              allCameras = [
                ...allCameras,
                ...cameras.filter((c) => this.accessibleCameras().includes(c._id)),
              ];
            } else {
              allCameras = [...allCameras, ...cameras];
            }
          });
          this.cameras.set([...new Map(allCameras.map((c) => [c._id, c])).values()]);
        });
    } else {
      this.cameras.set([]);
      this.userForm.update((form) => ({
        ...form,
        accessibleCameras: [],
      }));
    }
  }

  onRoleChange(role: string): void {
    this.updateFormField('role', role);
    if (role === 'Super Admin') {
      this.userForm.update((form) => ({
        ...form,
        canManageDevProjCam: false,
        hasCameraMonitorAccess: false,
        hasInventoryAccess: false,
        hasMemoryAccess: false,
        hasUaeAccess: false,
        hasSaudiAccess: false,
        accessibleDevelopers: [],
        accessibleProjects: [],
        accessibleCameras: [],
        accessibleServices: ['all'],
        canAddUser: false,
        canGenerateVideoAndPics: false,
        memoryRole: '',
        inventoryRole: '',
      }));
    } else if (role === 'Admin') {
      this.userForm.update((form) => ({
        ...form,
        canManageDevProjCam: form.canManageDevProjCam || false,
        hasCameraMonitorAccess: form.hasCameraMonitorAccess || false,
        hasInventoryAccess: form.hasInventoryAccess || false,
        hasMemoryAccess: form.hasMemoryAccess || false,
        // Reset region access flags when switching to Admin
        hasUaeAccess: false,
        hasSaudiAccess: false,
        memoryRole: form.memoryRole || '',
        inventoryRole: form.inventoryRole || '',
      }));
    } else {
      this.userForm.update((form) => ({
        ...form,
        canManageDevProjCam: false,
        hasCameraMonitorAccess: false,
        hasInventoryAccess: false,
        hasMemoryAccess: false,
        hasUaeAccess: false,
        hasSaudiAccess: false,
        memoryRole: '',
        inventoryRole: '',
      }));
    }
  }

  onRegionAccessChange(region: 'uae' | 'saudi', value: boolean): void {
    this.userForm.update((form) => ({
      ...form,
      hasUaeAccess: region === 'uae' ? value : form.hasUaeAccess,
      hasSaudiAccess: region === 'saudi' ? value : form.hasSaudiAccess,
    }));

    this.applyRegionAccessRules();
  }

  private applyRegionAccessRules(): void {
    const form = this.userForm();
    const devs = this.developers();

    // If neither region is selected, clear region-based selections but keep manual control
    if (!form.hasUaeAccess && !form.hasSaudiAccess) {
      this.userForm.update((f) => ({
        ...f,
        accessibleDevelopers: [],
        accessibleProjects: [],
        accessibleCameras: [],
      }));
      this.projects.set([]);
      this.cameras.set([]);
      return;
    }

    // Collect developers based on region
    let selectedDeveloperIds: string[] = [];

    if (form.hasSaudiAccess) {
      const saudiIds = devs
        .filter((d) => (d.address?.country || '').toLowerCase().includes('saudi'))
        .map((d) => d._id);
      selectedDeveloperIds = [...selectedDeveloperIds, ...saudiIds];
    }

    if (form.hasUaeAccess) {
      // UAE access = developers where there is no country field
      const uaeIds = devs
        .filter((d) => !d.address || !d.address.country)
        .map((d) => d._id);
      selectedDeveloperIds = [...selectedDeveloperIds, ...uaeIds];
    }

    // Ensure uniqueness
    selectedDeveloperIds = Array.from(new Set(selectedDeveloperIds));

    if (form.hasUaeAccess && form.hasSaudiAccess) {
      // Both selected → all developers, projects always all, cameras always all
      this.userForm.update((f) => ({
        ...f,
        accessibleDevelopers: ['all'],
        accessibleProjects: ['all'],
        accessibleCameras: ['all'],
      }));
      this.projects.set([]);
      this.cameras.set([]);
    } else {
      // Only one region selected → region-based developers, but projects and cameras always all
      this.userForm.update((f) => ({
        ...f,
        accessibleDevelopers: selectedDeveloperIds,
        accessibleProjects: ['all'],
        accessibleCameras: ['all'],
      }));
      this.projects.set([]);
      this.cameras.set([]);
    }
  }

  onCameraMonitorAccessChange(value: boolean): void {
    this.userForm.update((form) => ({
      ...form,
      hasCameraMonitorAccess: value,
      ...(value
        ? {}
        : {
            canWatchCameraMonitor: false,
            canCreateMonitorTask: false,
            canHoldMaintenance: false,
            canDeletePhoto: false,
            canSeeAllTasks: false,
          }),
    }));
  }

  onInventoryAccessChange(value: boolean): void {
    this.userForm.update((form) => ({
      ...form,
      hasInventoryAccess: value,
      ...(value
        ? {}
        : {
            canAddDeviceType: false,
            canAddDeviceStock: false,
            canAssignUnassignUser: false,
            canAssignUnassignProject: false,
          }),
    }));
  }

  onMemoryAccessChange(value: boolean): void {
    this.userForm.update((form) => ({
      ...form,
      hasMemoryAccess: value,
      ...(value
        ? {}
        : {
            canArchiveMemory: false,
          }),
    }));
  }

  onDeveloperChange(event: Event): void {
    const select = event.target as HTMLSelectElement;
    const selected = Array.from(select.selectedOptions, (option) => option.value);
    
    if (selected.includes('all')) {
      this.userForm.update((form) => ({
        ...form,
        accessibleDevelopers: ['all'],
        accessibleProjects: ['all'],
        accessibleCameras: ['all'],
      }));
      this.projects.set([]);
      this.cameras.set([]);
    } else {
      this.userForm.update((form) => ({
        ...form,
        accessibleDevelopers: selected,
      }));
      this.loadProjectsByDevelopers(selected);
      this.userForm.update((form) => ({
        ...form,
        accessibleProjects: [],
        accessibleCameras: [],
      }));
      this.cameras.set([]);
    }
  }

  onProjectChange(event: Event): void {
    const select = event.target as HTMLSelectElement;
    const selected = Array.from(select.selectedOptions, (option) => option.value);
    
    if (selected.includes('all')) {
      this.userForm.update((form) => ({
        ...form,
        accessibleProjects: ['all'],
        accessibleCameras: ['all'],
      }));
      this.cameras.set([]);
    } else {
      this.userForm.update((form) => ({
        ...form,
        accessibleProjects: selected,
      }));
      this.loadCamerasByProjects(selected);
      this.userForm.update((form) => ({
        ...form,
        accessibleCameras: [],
      }));
    }
  }

  onCameraChange(event: Event): void {
    const select = event.target as HTMLSelectElement;
    const selected = Array.from(select.selectedOptions, (option) => option.value);
    
    if (selected.includes('all')) {
      this.userForm.update((form) => ({
        ...form,
        accessibleCameras: ['all'],
      }));
    } else {
      this.userForm.update((form) => ({
        ...form,
        accessibleCameras: selected,
      }));
    }
  }

  onServiceChange(event: Event): void {
    const select = event.target as HTMLSelectElement;
    const selected = Array.from(select.selectedOptions, (option) => option.value);
    
    if (selected.includes('all')) {
      this.userForm.update((form) => ({
        ...form,
        accessibleServices: ['all'],
      }));
    } else {
      this.userForm.update((form) => ({
        ...form,
        accessibleServices: selected,
      }));
    }
  }

  updateFormField(field: keyof UserFormState, value: any): void {
    this.userForm.update((form) => ({
      ...form,
      [field]: value,
      error: null,
    }));
  }

  private createEmptyForm(): UserFormState {
    return {
      name: '',
      email: '',
      phone: '',
      role: 'Admin',
      image: null,
      imageFile: null,
      imagePreview: null,
      hasUaeAccess: false,
      hasSaudiAccess: false,
      canManageDevProjCam: false,
      hasCameraMonitorAccess: false,
      hasInventoryAccess: false,
      hasMemoryAccess: false,
      accessibleDevelopers: [],
      accessibleProjects: [],
      accessibleCameras: [],
      accessibleServices: ['all'],
      canAddUser: false,
      canGenerateVideoAndPics: true,
      canWatchCameraMonitor: false,
      canCreateMonitorTask: false,
      canHoldMaintenance: false,
      canDeletePhoto: false,
      canSeeAllTasks: false,
      canAddDeviceType: false,
      canAddDeviceStock: false,
      canAssignUnassignUser: false,
      canAssignUnassignProject: false,
      canArchiveMemory: false,
      memoryRole: '',
      inventoryRole: '',
      isSaving: false,
      error: null,
    };
  }

  private populateForm(user: User): void {
    this.userForm.set({
      name: user.name || '',
      email: user.email || '',
      phone: user.phone || '',
      role: (user.role as string) || 'User',
      image: (user.logo || user.image) || null, // Backend uses 'logo', support both for compatibility
      imageFile: null,
      imagePreview: this.buildImagePreview(user.logo || user.image),
      hasUaeAccess: this.normalizeBoolean((user as any).hasUaeAccess, false),
      hasSaudiAccess: this.normalizeBoolean((user as any).hasSaudiAccess, false),
      canManageDevProjCam: this.normalizeBoolean((user as any).canManageDevProjCam, false),
      hasCameraMonitorAccess: (user as any).hasCameraMonitorAccess !== undefined
        ? this.normalizeBoolean((user as any).hasCameraMonitorAccess, false)
        : !!(
            this.normalizeBoolean((user as any).canWatchCameraMonitor, false) ||
            this.normalizeBoolean((user as any).canCreateMonitorTask, false) ||
            this.normalizeBoolean((user as any).canHoldMaintenance, false) ||
            this.normalizeBoolean((user as any).canDeletePhoto, false) ||
            this.normalizeBoolean((user as any).canSeeAllTasks, false)
          ),
      hasInventoryAccess: (user as any).hasInventoryAccess !== undefined
        ? this.normalizeBoolean((user as any).hasInventoryAccess, false)
        : !!(
            this.normalizeBoolean((user as any).canAddDeviceType, false) ||
            this.normalizeBoolean((user as any).canAddDeviceStock, false) ||
            this.normalizeBoolean((user as any).canAssignUnassignUser, false) ||
            this.normalizeBoolean((user as any).canAssignUnassignProject, false)
          ),
      hasMemoryAccess: (user as any).hasMemoryAccess !== undefined
        ? this.normalizeBoolean((user as any).hasMemoryAccess, false)
        : this.normalizeBoolean((user as any).canArchiveMemory, false),
      accessibleDevelopers: this.normalizeArray(user.accessibleDevelopers),
      accessibleProjects: this.normalizeArray(user.accessibleProjects),
      accessibleCameras: this.normalizeArray(user.accessibleCameras),
      accessibleServices: user.accessibleServices && user.accessibleServices.length > 0
        ? user.accessibleServices
        : ['all'],
      canAddUser: this.normalizeBoolean((user as any).canAddUser, false),
      canGenerateVideoAndPics: this.normalizeBoolean((user as any).canGenerateVideoAndPics, true),
      canWatchCameraMonitor: this.normalizeBoolean((user as any).canWatchCameraMonitor, false),
      canCreateMonitorTask: this.normalizeBoolean((user as any).canCreateMonitorTask, false),
      canHoldMaintenance: this.normalizeBoolean((user as any).canHoldMaintenance, false),
      canDeletePhoto: this.normalizeBoolean((user as any).canDeletePhoto, false),
      canSeeAllTasks: this.normalizeBoolean((user as any).canSeeAllTasks, false),
      canAddDeviceType: this.normalizeBoolean((user as any).canAddDeviceType, false),
      canAddDeviceStock: this.normalizeBoolean((user as any).canAddDeviceStock, false),
      canAssignUnassignUser: this.normalizeBoolean((user as any).canAssignUnassignUser, false),
      canAssignUnassignProject: this.normalizeBoolean((user as any).canAssignUnassignProject, false),
      canArchiveMemory: this.normalizeBoolean((user as any).canArchiveMemory, false),
      memoryRole: (user as any).memoryRole || '',
      inventoryRole: (user as any).inventoryRole || '',
      isSaving: false,
      error: null,
    });
    this.resetEmail.set(user.email || '');
  }

  saveUser(): void {
    const form = this.userForm();
    
    // Validation
    if (!form.name || !form.email) {
      this.userForm.update((f) => ({
        ...f,
        error: 'Please fill in all required fields.',
      }));
      return;
    }

    this.userForm.update((f) => ({ ...f, isSaving: true, error: null }));

    const currentUser = this.authStore.user();
    const formData = this.buildFormData(form, currentUser);

    const request = this.isEditMode() && this.userId()
      ? this.userService.update(this.userId()!, formData)
      : this.userService.create(formData);

    request
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        catchError((error) => {
          console.error('Failed to save user', error);
          let errorMessage = 'Failed to save user. Please try again.';
          if (error?.error?.message === 'Email is already Registered') {
            errorMessage = 'This email is already registered. Please use a different email.';
          }
          this.userForm.update((f) => ({
            ...f,
            isSaving: false,
            error: errorMessage,
          }));
          return of<User | null>(null);
        }),
      )
      .subscribe((user) => {
        if (user) {
          this.submitted.set(true);
          this.userId.set(user._id);
          this.resetEmail.set(form.email);
        }
      });
  }

  onImageSelect(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) {
      return;
    }

    const file = input.files[0];
    const reader = new FileReader();

    reader.onload = () => {
      this.userForm.update((form) => ({
        ...form,
        imageFile: file,
        imagePreview: reader.result as string,
        error: null,
      }));
    };

    reader.readAsDataURL(file);
  }

  clearImage(): void {
    this.userForm.update((form) => ({
      ...form,
      image: null,
      imageFile: null,
      imagePreview: null,
      error: null,
    }));
  }

  private buildImagePreview(image?: string | null): string | null {
    if (!image) {
      return null;
    }
    if (image.startsWith('http://') || image.startsWith('https://') || image.startsWith('data:')) {
      return image;
    }
    const sanitized = image.startsWith('/') ? image.slice(1) : image;
    return `${this.assetBaseUrl}/${sanitized}`;
  }

  private normalizeArray(value: unknown): string[] {
    if (!value) {
      return [];
    }
    if (Array.isArray(value)) {
      return value.filter((item) => typeof item === 'string' && item.trim().length > 0);
    }
    if (typeof value === 'string') {
      try {
        // Try parsing as JSON first
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed)) {
          return parsed.filter((item) => typeof item === 'string' && item.trim().length > 0);
        }
      } catch {
        // If not JSON, try splitting by comma
        return value.split(',').map((item) => item.trim()).filter((item) => item.length > 0);
      }
    }
    return [];
  }

  private normalizeBoolean(value: unknown, defaultValue: boolean = false): boolean {
    if (value === undefined || value === null) {
      return defaultValue;
    }
    if (typeof value === 'boolean') {
      return value;
    }
    if (typeof value === 'string') {
      return value.toLowerCase() === 'true';
    }
    return !!value;
  }

  private buildFormData(form: UserFormState, currentUser: { id?: string; name?: string } | null): FormData {
    const formData = new FormData();

    formData.append('name', form.name.trim());
    formData.append('email', form.email.trim());
    formData.append('phone', form.phone?.trim() || '');
    formData.append('role', form.role || 'User');

    const appendBoolean = (key: string, value: boolean) => formData.append(key, value ? 'true' : 'false');
    const appendString = (key: string, value?: string | null) => formData.append(key, value ?? '');
    const appendArray = (key: string, value: string[]) => {
      // Send arrays as JSON strings (backend expects this format for multer parsing)
      // Multer parses FormData fields as strings, so arrays need to be JSON stringified
      const arrayValue = Array.isArray(value) && value.length > 0 ? value : [];
      formData.append(key, JSON.stringify(arrayValue));
    };

    appendBoolean('hasUaeAccess', form.hasUaeAccess);
    appendBoolean('hasSaudiAccess', form.hasSaudiAccess);
    appendBoolean('canManageDevProjCam', form.canManageDevProjCam);
    appendBoolean('hasCameraMonitorAccess', form.hasCameraMonitorAccess);
    appendBoolean('hasInventoryAccess', form.hasInventoryAccess);
    appendBoolean('hasMemoryAccess', form.hasMemoryAccess);
    appendBoolean('canAddUser', false);
    appendBoolean('canGenerateVideoAndPics', true);
    appendBoolean('canWatchCameraMonitor', form.canWatchCameraMonitor);
    appendBoolean('canCreateMonitorTask', form.canCreateMonitorTask);
    appendBoolean('canHoldMaintenance', form.canHoldMaintenance);
    appendBoolean('canDeletePhoto', form.canDeletePhoto);
    appendBoolean('canSeeAllTasks', form.canSeeAllTasks);
    appendBoolean('canAddDeviceType', form.canAddDeviceType);
    appendBoolean('canAddDeviceStock', form.canAddDeviceStock);
    appendBoolean('canAssignUnassignUser', form.canAssignUnassignUser);
    appendBoolean('canAssignUnassignProject', form.canAssignUnassignProject);
    appendBoolean('canArchiveMemory', form.canArchiveMemory);

    appendArray('accessibleDevelopers', form.accessibleDevelopers);
    appendArray('accessibleProjects', form.accessibleProjects);
    appendArray('accessibleCameras', form.accessibleCameras);
    appendArray('accessibleServices', ['all']);

    appendString('memoryRole', form.memoryRole || undefined);
    appendString('inventoryRole', form.inventoryRole || undefined);

    if (!this.isEditMode()) {
      appendString('status', 'New');
    }
    if (currentUser?.id) {
      appendString('addedUserId', currentUser.id);
    }
    if (currentUser?.name) {
      appendString('addedUserName', currentUser.name);
    }

    if (form.imageFile) {
      formData.append('image', form.imageFile);
    } else if (this.isEditMode() && form.image) {
      formData.append('image', form.image);
    }

    return formData;
  }

  sendResetPasswordLink(): void {
    const userId = this.userId();
    const email = this.resetEmail();
    
    if (!userId || !email) {
      alert('Missing user ID or email address.');
      return;
    }

    this.userService
      .sendResetPasswordLink(userId, email)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        catchError((error) => {
          console.error('Failed to send reset password link', error);
          alert('Failed to send reset password link.');
          return of<void>();
        }),
      )
      .subscribe(() => {
        alert('Reset password link sent successfully.');
        this.router.navigate(['/users']);
      });
  }

  useCurrentPassword(): void {
    this.router.navigate(['/users']);
  }

  cancel(): void {
    this.router.navigate(['/users']);
  }

  // Multi-select dropdown state
  readonly isDeveloperDropdownOpen = signal(false);
  readonly isProjectDropdownOpen = signal(false);
  readonly isCameraDropdownOpen = signal(false);
  readonly isServiceDropdownOpen = signal(false);

  toggleDeveloperDropdown(): void {
    this.isDeveloperDropdownOpen.update((v) => !v);
    this.isProjectDropdownOpen.set(false);
    this.isCameraDropdownOpen.set(false);
    this.isServiceDropdownOpen.set(false);
  }

  toggleProjectDropdown(): void {
    this.isProjectDropdownOpen.update((v) => !v);
    this.isDeveloperDropdownOpen.set(false);
    this.isCameraDropdownOpen.set(false);
    this.isServiceDropdownOpen.set(false);
  }

  toggleCameraDropdown(): void {
    this.isCameraDropdownOpen.update((v) => !v);
    this.isDeveloperDropdownOpen.set(false);
    this.isProjectDropdownOpen.set(false);
    this.isServiceDropdownOpen.set(false);
  }

  toggleServiceDropdown(): void {
    this.isServiceDropdownOpen.update((v) => !v);
    this.isDeveloperDropdownOpen.set(false);
    this.isProjectDropdownOpen.set(false);
    this.isCameraDropdownOpen.set(false);
  }

  toggleDeveloperSelection(value: string): void {
    const current = this.userForm().accessibleDevelopers;
    let newSelection: string[];
    
    if (value === 'all') {
      if (current.includes('all')) {
        newSelection = [];
      } else {
        newSelection = ['all'];
      }
    } else {
      if (current.includes('all')) {
        newSelection = [value];
      } else if (current.includes(value)) {
        newSelection = current.filter((v) => v !== value);
      } else {
        newSelection = [...current, value];
      }
    }
    
    this.onDeveloperChange({ target: { selectedOptions: newSelection.map(v => ({ value: v })) } } as any);
  }

  toggleProjectSelection(value: string): void {
    const current = this.userForm().accessibleProjects;
    let newSelection: string[];
    
    if (value === 'all') {
      if (current.includes('all')) {
        newSelection = [];
      } else {
        newSelection = ['all'];
      }
    } else {
      if (current.includes('all')) {
        newSelection = [value];
      } else if (current.includes(value)) {
        newSelection = current.filter((v) => v !== value);
      } else {
        newSelection = [...current, value];
      }
    }
    
    this.onProjectChange({ target: { selectedOptions: newSelection.map(v => ({ value: v })) } } as any);
  }

  toggleCameraSelection(value: string): void {
    const current = this.userForm().accessibleCameras;
    let newSelection: string[];
    
    if (value === 'all') {
      if (current.includes('all')) {
        newSelection = [];
      } else {
        newSelection = ['all'];
      }
    } else {
      if (current.includes('all')) {
        newSelection = [value];
      } else if (current.includes(value)) {
        newSelection = current.filter((v) => v !== value);
      } else {
        newSelection = [...current, value];
      }
    }
    
    this.onCameraChange({ target: { selectedOptions: newSelection.map(v => ({ value: v })) } } as any);
  }

  toggleServiceSelection(value: string): void {
    const current = this.userForm().accessibleServices;
    let newSelection: string[];
    
    if (value === 'all') {
      if (current.includes('all')) {
        newSelection = [];
      } else {
        newSelection = ['all'];
      }
    } else {
      if (current.includes('all')) {
        newSelection = [value];
      } else if (current.includes(value)) {
        newSelection = current.filter((v) => v !== value);
      } else {
        newSelection = [...current, value];
      }
    }
    
    this.onServiceChange({ target: { selectedOptions: newSelection.map(v => ({ value: v })) } } as any);
  }

  removeDeveloper(value: string): void {
    const current = this.userForm().accessibleDevelopers;
    const newSelection = current.filter((v) => v !== value);
    this.onDeveloperChange({ target: { selectedOptions: newSelection.map(v => ({ value: v })) } } as any);
  }

  removeProject(value: string): void {
    const current = this.userForm().accessibleProjects;
    const newSelection = current.filter((v) => v !== value);
    this.onProjectChange({ target: { selectedOptions: newSelection.map(v => ({ value: v })) } } as any);
  }

  removeCamera(value: string): void {
    const current = this.userForm().accessibleCameras;
    const newSelection = current.filter((v) => v !== value);
    this.onCameraChange({ target: { selectedOptions: newSelection.map(v => ({ value: v })) } } as any);
  }

  removeService(value: string): void {
    const current = this.userForm().accessibleServices;
    const newSelection = current.filter((v) => v !== value);
    this.onServiceChange({ target: { selectedOptions: newSelection.map(v => ({ value: v })) } } as any);
  }

  getDeveloperLabel(id: string): string {
    if (id === 'all') return 'All';
    const dev = this.developers().find((d) => d._id === id);
    return dev?.developerName || id;
  }

  getProjectLabel(id: string): string {
    if (id === 'all') return 'All';
    const proj = this.projects().find((p) => p._id === id);
    return proj?.projectName || id;
  }

  getCameraLabel(id: string): string {
    if (id === 'all') return 'All';
    const cam = this.cameras().find((c) => c._id === id);
    return cam?.camera || cam?.cameraDescription || id;
  }

  isDeveloperSelected(id: string): boolean {
    return this.userForm().accessibleDevelopers.includes(id);
  }

  isProjectSelected(id: string): boolean {
    return this.userForm().accessibleProjects.includes(id);
  }

  isCameraSelected(id: string): boolean {
    return this.userForm().accessibleCameras.includes(id);
  }

  isServiceSelected(id: string): boolean {
    return this.userForm().accessibleServices.includes(id);
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    if (
      !target.closest('.multi-select-dropdown') &&
      !target.closest('button[type="button"]')
    ) {
      this.isDeveloperDropdownOpen.set(false);
      this.isProjectDropdownOpen.set(false);
      this.isCameraDropdownOpen.set(false);
      this.isServiceDropdownOpen.set(false);
    }
  }
}

