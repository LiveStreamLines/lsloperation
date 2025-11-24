import { CommonModule } from '@angular/common';
import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { of } from 'rxjs';
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

type SortColumn = 'name' | 'email' | 'role' | 'status' | 'lastLogin' | 'createdDate';
type SortDirection = 'asc' | 'desc';

@Component({
  selector: 'app-users-overview',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './users-overview.component.html',
})
export class UsersOverviewComponent implements OnInit {
  private readonly userService = inject(UserService);
  private readonly developerService = inject(DeveloperService);
  private readonly projectService = inject(ProjectService);
  private readonly cameraService = inject(CameraService);
  private readonly authService = inject(AuthService);
  private readonly authStore = inject(AuthStore);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly isLoading = signal(true);
  readonly errorMessage = signal<string | null>(null);
  readonly users = signal<User[]>([]);
  readonly developers = signal<Developer[]>([]);
  readonly projects = signal<Project[]>([]);
  readonly cameras = signal<Camera[]>([]);
  readonly selectedDeveloperId = signal<string | null>(null);
  readonly selectedProjectId = signal<string | null>(null);
  readonly selectedCameraId = signal<string | null>(null);
  readonly selectedRole = signal<string>('ALL');
  readonly searchTerm = signal('');
  readonly currentSortColumn = signal<SortColumn>('name');
  readonly currentSortDirection = signal<SortDirection>('asc');
  readonly pageSize = signal(10);
  readonly currentPage = signal(0);

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

  readonly availableRoles = computed(() => {
    const roles = new Set<string>();
    for (const user of this.users()) {
      const role = (user.role || '').trim();
      if (role) {
        roles.add(role);
      }
    }
    return ['ALL', ...Array.from(roles).sort((a, b) => a.localeCompare(b))];
  });

  readonly sortedDevelopers = computed(() => {
    const devs = this.developers();
    if (this.isSuperAdmin() || this.accessibleDevelopers()[0] === 'all') {
      return [{ _id: 'ALL', developerName: 'All Developers' }, ...devs].sort((a, b) => {
        if (a._id === 'ALL') return -1;
        if (b._id === 'ALL') return 1;
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

  readonly filteredUsers = computed(() => {
    let filtered = [...this.users()];
    const currentUser = this.authStore.user();
    const currentUserCountry = currentUser?.country;
    const isSuperAdminUser = this.isSuperAdmin();

    // Show only Super Admins and Admins in the overview
    filtered = filtered.filter((user) => user.role === 'Super Admin' || user.role === 'Admin');

    // Apply country filtering
    if (currentUserCountry === 'All') {
      // If country is "All", show all users (no country filtering)
      // All Super Admins and Admins will be shown regardless of their country
    } else if (currentUserCountry) {
      // Filter by specific country (UAE or Saudi Arabia)
      const userCountry = currentUserCountry.trim();
      filtered = filtered.filter((user) => {
        // Match users with the same country (case-insensitive, handle empty/undefined)
        const userCountryValue = (user.country || '').trim();
        return userCountryValue && userCountryValue.toLowerCase() === userCountry.toLowerCase();
      });
    } else {
      // If user has no country set, don't show any users
      filtered = [];
    }

    // Apply search filter
    const term = this.searchTerm().toLowerCase().trim();
    if (term) {
      filtered = filtered.filter(
        (user) =>
          user.name?.toLowerCase().includes(term) ||
          user.email?.toLowerCase().includes(term) ||
          user.role?.toLowerCase().includes(term),
      );
    }

    // Apply role and access filters
    const developerId = this.selectedDeveloperId();
    const projectId = this.selectedProjectId();
    const cameraId = this.selectedCameraId();
    const selectedRole = this.selectedRole();

    filtered = filtered.filter((user) => {
      const matchesRole = selectedRole === 'ALL' || (user.role || '').trim() === selectedRole;
      
      // For Super Admins, only apply role filter (skip developer/project/camera filters)
      if (isSuperAdminUser) {
        return matchesRole;
      }
      
      // For non-Super Admins, apply all access filters
      const matchesDeveloper =
        !developerId ||
        developerId === 'ALL' ||
        user.accessibleDevelopers?.includes(developerId) ||
        user.accessibleDevelopers?.[0] === 'all';
      const matchesProject =
        !projectId ||
        projectId === 'ALL' ||
        user.accessibleProjects?.includes(projectId) ||
        user.accessibleProjects?.[0] === 'all';
      const matchesCamera =
        !cameraId ||
        cameraId === 'ALL' ||
        user.accessibleCameras?.includes(cameraId) ||
        user.accessibleCameras?.[0] === 'all';

      if (this.accessibleDevelopers()[0] === 'all') {
        return (matchesDeveloper && matchesProject && matchesCamera) && matchesRole;
      }
      return matchesDeveloper && matchesProject && matchesCamera && matchesRole;
    });

    // Apply sorting
    const sortColumn = this.currentSortColumn();
    const sortDirection = this.currentSortDirection();
    filtered.sort((a, b) => {
      let aVal: any;
      let bVal: any;

      switch (sortColumn) {
        case 'name':
          aVal = (a.name || '').toLowerCase();
          bVal = (b.name || '').toLowerCase();
          break;
        case 'email':
          aVal = (a.email || '').toLowerCase();
          bVal = (b.email || '').toLowerCase();
          break;
        case 'role':
          aVal = (a.role || '').toLowerCase();
          bVal = (b.role || '').toLowerCase();
          break;
        case 'status':
          aVal = (a.status || '').toLowerCase();
          bVal = (b.status || '').toLowerCase();
          break;
        case 'lastLogin':
          aVal = a.LastLoginTime ? new Date(a.LastLoginTime).getTime() : 0;
          bVal = b.LastLoginTime ? new Date(b.LastLoginTime).getTime() : 0;
          break;
        case 'createdDate':
          aVal = a.createdDate ? new Date(a.createdDate).getTime() : 0;
          bVal = b.createdDate ? new Date(b.createdDate).getTime() : 0;
          break;
        default:
          return 0;
      }

      const comparison = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
      return sortDirection === 'asc' ? comparison : -comparison;
    });

    return filtered;
  });

  readonly paginatedUsers = computed(() => {
    const filtered = this.filteredUsers();
    const start = this.currentPage() * this.pageSize();
    const end = start + this.pageSize();
    return filtered.slice(start, end);
  });

  readonly totalPages = computed(() => {
    return Math.ceil(this.filteredUsers().length / this.pageSize());
  });

  ngOnInit(): void {
    this.loadUsers();
    this.loadDevelopers();
  }

  loadUsers(): void {
    this.isLoading.set(true);
    this.errorMessage.set(null);

    this.userService
      .getAll(true)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        catchError((error) => {
          console.error('Failed to load users', error);
          this.errorMessage.set('Unable to load users from the backend.');
          return of<User[]>([]);
        }),
        finalize(() => this.isLoading.set(false)),
      )
      .subscribe((users) => {
        this.users.set(users ?? []);
      });
  }

  onRoleChange(role: string): void {
    this.selectedRole.set(role || 'ALL');
    this.currentPage.set(0);
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
        this.developers.set(developers ?? []);
        if (this.sortedDevelopers().length > 0) {
          this.selectedDeveloperId.set(this.sortedDevelopers()[0]._id);
          this.loadProjects();
        }
      });
  }

  loadProjects(): void {
    const developerId = this.selectedDeveloperId();
    if (!developerId || developerId === 'ALL') {
      this.projects.set([]);
      this.cameras.set([]);
      this.selectedProjectId.set(null);
      this.selectedCameraId.set(null);
      return;
    }

    this.projectService
      .getByDeveloper(developerId)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        catchError((error) => {
          console.error('Failed to load projects', error);
          return of<Project[]>([]);
        }),
      )
      .subscribe((projects) => {
        let filteredProjects = projects;
        if (!this.isSuperAdmin() && this.accessibleProjects()[0] !== 'all') {
          filteredProjects = projects.filter((p) => this.accessibleProjects().includes(p._id));
        }
        this.projects.set(filteredProjects);
        if (filteredProjects.length > 0) {
          this.selectedProjectId.set('ALL');
          this.loadCameras();
        } else {
          this.selectedProjectId.set(null);
          this.cameras.set([]);
          this.selectedCameraId.set(null);
        }
      });
  }

  loadCameras(): void {
    const projectId = this.selectedProjectId();
    if (!projectId || projectId === 'ALL') {
      this.cameras.set([]);
      this.selectedCameraId.set(null);
      return;
    }

    this.cameraService
      .getByProject(projectId)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        catchError((error) => {
          console.error('Failed to load cameras', error);
          return of<Camera[]>([]);
        }),
      )
      .subscribe((cameras) => {
        let filteredCameras = cameras;
        if (!this.isSuperAdmin() && this.accessibleCameras()[0] !== 'all') {
          filteredCameras = cameras.filter((c) => this.accessibleCameras().includes(c._id));
        }
        this.cameras.set(filteredCameras);
        if (filteredCameras.length > 0) {
          this.selectedCameraId.set('ALL');
        } else {
          this.selectedCameraId.set(null);
        }
      });
  }

  onDeveloperChange(developerId: string): void {
    this.selectedDeveloperId.set(developerId || null);
    this.selectedProjectId.set(null);
    this.selectedCameraId.set(null);
    this.projects.set([]);
    this.cameras.set([]);
    this.currentPage.set(0);
    this.loadProjects();
  }

  onProjectChange(projectId: string): void {
    this.selectedProjectId.set(projectId || null);
    this.selectedCameraId.set(null);
    this.cameras.set([]);
    this.currentPage.set(0);
    this.loadCameras();
  }

  onCameraChange(cameraId: string): void {
    this.selectedCameraId.set(cameraId || null);
    this.currentPage.set(0);
  }

  onSearchChange(term: string): void {
    this.searchTerm.set(term);
    this.currentPage.set(0);
  }

  sortBy(column: SortColumn): void {
    if (this.currentSortColumn() === column) {
      this.currentSortDirection.set(this.currentSortDirection() === 'asc' ? 'desc' : 'asc');
    } else {
      this.currentSortColumn.set(column);
      this.currentSortDirection.set('asc');
    }
    this.currentPage.set(0);
  }

  onPageChange(page: number): void {
    this.currentPage.set(page);
  }

  onPageSizeChange(size: number): void {
    this.pageSize.set(size);
    this.currentPage.set(0);
  }

  formatDate(date: string | undefined): string {
    if (!date) return 'Never';
    try {
      return new Date(date).toLocaleString();
    } catch {
      return 'Never';
    }
  }

  getStatusBadgeClass(status: string | undefined): string {
    const statusLower = (status || '').toLowerCase();
    switch (statusLower) {
      case 'active':
        return 'bg-emerald-100 text-emerald-700';
      case 'new':
        return 'bg-amber-100 text-amber-700';
      case 'reset password sent':
        return 'bg-blue-100 text-blue-700';
      case 'phone required':
        return 'bg-rose-100 text-rose-700';
      default:
        return 'bg-slate-100 text-slate-700';
    }
  }

  openEditUser(userId: string): void {
    this.router.navigate(['/users/edit', userId]);
  }

  openAddUser(): void {
    this.router.navigate(['/users/add']);
  }

  deleteUser(userId: string): void {
    // TODO: Implement delete functionality
    console.log('Delete user:', userId);
  }

  readonly Math = Math;
}
