import { CommonModule } from '@angular/common';
import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { of } from 'rxjs';
import { catchError, finalize } from 'rxjs/operators';
import { CameraService } from '@core/services/camera.service';
import { DeveloperService } from '@core/services/developer.service';
import { ProjectService } from '@core/services/project.service';
import { Camera } from '@core/models/camera.model';
import { Developer } from '@core/models/developer.model';
import { Project } from '@core/models/project.model';

@Component({
  selector: 'app-cameras-overview',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './cameras-overview.component.html',
})
export class CamerasOverviewComponent implements OnInit {
  private readonly cameraService = inject(CameraService);
  private readonly developerService = inject(DeveloperService);
  private readonly projectService = inject(ProjectService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly isLoading = signal(true);
  readonly errorMessage = signal<string | null>(null);
  readonly cameras = signal<Camera[]>([]);
  readonly developers = signal<Developer[]>([]);
  readonly projects = signal<Project[]>([]);
  readonly selectedDeveloperId = signal<string | null>(null);
  readonly selectedProjectId = signal<string | null>(null);
  readonly searchTerm = signal('');

  readonly sortedDevelopers = computed(() => {
    return [...this.developers()].sort((a, b) => {
      const nameA = (a.developerName || '').toLowerCase();
      const nameB = (b.developerName || '').toLowerCase();
      return nameA.localeCompare(nameB);
    });
  });

  readonly sortedProjects = computed(() => {
    return [...this.projects()].sort((a, b) => {
      const nameA = (a.projectName || '').toLowerCase();
      const nameB = (b.projectName || '').toLowerCase();
      return nameA.localeCompare(nameB);
    });
  });

  readonly filteredCameras = computed(() => {
    const term = this.searchTerm().toLowerCase().trim();
    const cameras = this.cameras();
    
    if (!term) {
      return cameras;
    }

    return cameras.filter((camera) => {
      const cameraName = (camera.camera || '').toLowerCase();
      const country = (camera.country || '').toLowerCase();
      const serverFolder = (camera.serverFolder || '').toLowerCase();
      const developerName = this.getDeveloperName(camera.developer).toLowerCase();
      const projectName = this.getProjectName(camera.project).toLowerCase();

      return (
        cameraName.includes(term) ||
        country.includes(term) ||
        serverFolder.includes(term) ||
        developerName.includes(term) ||
        projectName.includes(term)
      );
    });
  });

  readonly displayedColumns = computed(() => {
    // Show developer and project columns when:
    // 1. "All developers" is selected, OR
    // 2. A developer is selected but no project is selected
    // Hide them only when both developer AND project are selected
    if (this.selectedDeveloperId() && this.selectedProjectId()) {
      return ['name', 'country', 'serverFolder', 'createdDate', 'installedDate', 'status', 'blockUnblock', 'actions', 'download'];
    }
    return ['name', 'developer', 'project', 'country', 'serverFolder', 'createdDate', 'installedDate', 'status', 'blockUnblock', 'actions', 'download'];
  });

  ngOnInit(): void {
    this.loadDevelopers();
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
        // Default to "All Developers"
        this.selectedDeveloperId.set(null);
        this.loadProjects();
      });
  }

  loadProjects(): void {
    if (this.selectedDeveloperId()) {
      // Specific developer selected
      this.projectService
        .getByDeveloper(this.selectedDeveloperId()!)
        .pipe(
          takeUntilDestroyed(this.destroyRef),
          catchError((error) => {
            console.error('Failed to load projects', error);
            return of<Project[]>([]);
          }),
        )
        .subscribe((projects) => {
          this.projects.set(projects ?? []);
          // Load all cameras for this developer when no project is selected
          this.loadCamerasByDeveloper();
        });
    } else {
      // "All Developers" selected - load all projects for display purposes
      this.projectService
        .getAll(true)
        .pipe(
          takeUntilDestroyed(this.destroyRef),
          catchError((error) => {
            console.error('Failed to load projects', error);
            return of<Project[]>([]);
          }),
        )
        .subscribe((projects) => {
          this.projects.set(projects ?? []);
          this.loadAllCameras();
        });
    }
  }

  loadCameras(): void {
    if (!this.selectedProjectId()) {
      // If developer is selected but no project, load all cameras for that developer
      if (this.selectedDeveloperId()) {
        this.loadCamerasByDeveloper();
      } else {
        this.cameras.set([]);
      }
      return;
    }

    this.isLoading.set(true);
    this.errorMessage.set(null);

    this.cameraService
      .getByProject(this.selectedProjectId()!)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        catchError((error) => {
          console.error('Failed to load cameras', error);
          this.errorMessage.set('Unable to load cameras from the backend.');
          return of<Camera[]>([]);
        }),
        finalize(() => this.isLoading.set(false)),
      )
      .subscribe((cameras) => {
        this.cameras.set(cameras ?? []);
      });
  }

  loadCamerasByDeveloper(): void {
    if (!this.selectedDeveloperId()) {
      this.cameras.set([]);
      return;
    }

    this.isLoading.set(true);
    this.errorMessage.set(null);

    this.cameraService
      .getByDeveloper(this.selectedDeveloperId()!)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        catchError((error) => {
          console.error('Failed to load cameras by developer', error);
          this.errorMessage.set('Unable to load cameras from the backend.');
          return of<Camera[]>([]);
        }),
        finalize(() => this.isLoading.set(false)),
      )
      .subscribe((cameras) => {
        this.cameras.set(cameras ?? []);
      });
  }

  loadAllCameras(): void {
    this.isLoading.set(true);
    this.errorMessage.set(null);

    this.cameraService
      .getAll(true)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        catchError((error) => {
          console.error('Failed to load cameras', error);
          this.errorMessage.set('Unable to load cameras from the backend.');
          return of<Camera[]>([]);
        }),
        finalize(() => this.isLoading.set(false)),
      )
      .subscribe((cameras) => {
        this.cameras.set(cameras ?? []);
      });
  }

  onDeveloperChange(developerId: string): void {
    this.selectedDeveloperId.set(developerId || null);
    this.selectedProjectId.set(null);
    this.projects.set([]);
    this.cameras.set([]);
    this.loadProjects();
  }

  onProjectChange(projectId: string): void {
    this.selectedProjectId.set(projectId || null);
    if (this.selectedDeveloperId()) {
      // If project is cleared, load all cameras for developer
      // If project is selected, load cameras for that project
      this.loadCameras();
    }
  }

  onSearchChange(term: string): void {
    this.searchTerm.set(term);
  }

  getDeveloperName(developer: string | { _id?: string; developerName?: string }): string {
    if (typeof developer === 'string') {
      const dev = this.developers().find((d) => d._id === developer);
      return dev?.developerName || 'Unknown Developer';
    }
    return developer.developerName || 'Unknown Developer';
  }

  getProjectName(project: string | { _id?: string; projectName?: string }): string {
    if (typeof project === 'string') {
      const proj = this.projects().find((p) => p._id === project);
      return proj?.projectName || 'Unknown Project';
    }
    return project.projectName || 'Unknown Project';
  }

  formatDate(date: string | undefined): string {
    if (!date) return '—';
    try {
      return new Date(date).toLocaleDateString();
    } catch {
      return '—';
    }
  }

  toggleBlockStatus(camera: Camera): void {
    const currentBlocked = camera.blocked ?? false;
    const newBlocked = !currentBlocked;

    // Optimistically update
    camera.blocked = newBlocked;

    this.cameraService
      .update(camera._id, { blocked: newBlocked })
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        catchError((error) => {
          console.error('Failed to update camera block status', error);
          // Revert on error
          camera.blocked = currentBlocked;
          return of(camera);
        }),
      )
      .subscribe();
  }

  openEditCamera(cameraId: string): void {
    this.router.navigate(['/camera-form', cameraId]);
  }

  openAddCamera(): void {
    const developerId = this.selectedDeveloperId();
    const projectId = this.selectedProjectId();
    
    if (developerId && projectId) {
      this.router.navigate(['/camera-form'], {
        queryParams: { developerId, projectId },
      });
    } else {
      this.router.navigate(['/camera-form']);
    }
  }

  downloadConfig(camera: Camera): void {
    const developer = this.developers().find((dev) => {
      const devId = typeof camera.developer === 'string' ? camera.developer : camera.developer._id;
      return dev._id === devId;
    });
    const project = this.projects().find((proj) => {
      const projId = typeof camera.project === 'string' ? camera.project : camera.project._id;
      return proj._id === projId;
    });

    const configData = [
      {
        server: 'tempcloud',
        folder: '/home/lsl/media/lslcloud1',
        country: camera.country,
        developer: developer?.developerTag,
        project: project?.projectTag,
        camera: camera.camera,
      },
    ];

    const blob = new Blob([JSON.stringify(configData, null, 2)], { type: 'application/json' });
    const url = window.URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = 'configure.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    window.URL.revokeObjectURL(url);
  }

  getStatusBadgeClass(status: string | undefined): string {
    const statusLower = (status || 'pending').toLowerCase();
    switch (statusLower) {
      case 'active':
      case 'online':
        return 'bg-emerald-100 text-emerald-700';
      case 'degraded':
      case 'warning':
        return 'bg-amber-100 text-amber-700';
      case 'offline':
      case 'inactive':
        return 'bg-rose-100 text-rose-700';
      default:
        return 'bg-slate-100 text-slate-700';
    }
  }
}
