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

interface UserFormState {
  name: string;
  email: string;
  phone: string;
  role: string;
  accessibleDevelopers: string[];
  accessibleProjects: string[];
  accessibleCameras: string[];
  accessibleServices: string[];
  canAddUser: boolean;
  canGenerateVideoAndPics: boolean;
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

const ROLES = ['Super Admin', 'Admin', 'User'];

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
      this.isEditMode.set(false);
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
        memoryRole: form.memoryRole || '',
        inventoryRole: form.inventoryRole || '',
      }));
    } else {
      this.userForm.update((form) => ({
        ...form,
        memoryRole: '',
        inventoryRole: '',
      }));
    }
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
      role: 'User',
      accessibleDevelopers: [],
      accessibleProjects: [],
      accessibleCameras: [],
      accessibleServices: ['all'],
      canAddUser: false,
      canGenerateVideoAndPics: true,
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
      accessibleDevelopers: user.accessibleDevelopers || [],
      accessibleProjects: user.accessibleProjects || [],
      accessibleCameras: user.accessibleCameras || [],
      accessibleServices: user.accessibleServices && user.accessibleServices.length > 0
        ? user.accessibleServices
        : ['all'],
      canAddUser: (user as any).canAddUser || false,
      canGenerateVideoAndPics: (user as any).canGenerateVideoAndPics ?? true,
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
    const payload: Partial<User> = {
      name: form.name.trim(),
      email: form.email.trim(),
      phone: form.phone?.trim() || '',
      role: form.role || 'User',
      accessibleDevelopers: form.accessibleDevelopers,
      accessibleProjects: form.accessibleProjects,
      accessibleCameras: form.accessibleCameras,
      accessibleServices: form.accessibleServices,
      canAddUser: form.canAddUser,
      canGenerateVideoAndPics: form.canGenerateVideoAndPics,
      memoryRole: form.memoryRole || undefined,
      inventoryRole: form.inventoryRole || undefined,
      addedUserId: currentUser?.id,
      addedUserName: currentUser?.name,
      status: this.isEditMode() ? undefined : 'New',
    };

    const request = this.isEditMode() && this.userId()
      ? this.userService.update(this.userId()!, payload)
      : this.userService.create(payload);

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

