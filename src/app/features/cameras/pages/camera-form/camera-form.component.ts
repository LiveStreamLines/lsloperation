import { CommonModule } from '@angular/common';
import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { of } from 'rxjs';
import { catchError, finalize } from 'rxjs/operators';
import { CameraService } from '@core/services/camera.service';
import { DeveloperService } from '@core/services/developer.service';
import { ProjectService } from '@core/services/project.service';
import { Camera } from '@core/models/camera.model';
import { Developer } from '@core/models/developer.model';
import { Project } from '@core/models/project.model';

interface CameraFormState {
  developer: string;
  project: string;
  camera: string;
  cameraDescription: string;
  cindex: number;
  serverFolder: string;
  lat: string;
  lng: string;
  isActive: boolean;
  country: string;
  server: string;
  isSaving: boolean;
  error: string | null;
}

@Component({
  selector: 'app-camera-form',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './camera-form.component.html',
})
export class CameraFormComponent implements OnInit {
  private readonly cameraService = inject(CameraService);
  private readonly developerService = inject(DeveloperService);
  private readonly projectService = inject(ProjectService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);

  readonly isLoading = signal(true);
  readonly developers = signal<Developer[]>([]);
  readonly projects = signal<Project[]>([]);
  readonly cameraForm = signal<CameraFormState>(this.createEmptyForm());
  readonly isEditMode = signal(false);
  readonly cameraId = signal<string | null>(null);

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

  readonly filteredProjects = computed(() => {
    const developerId = this.cameraForm().developer;
    if (!developerId) {
      return this.sortedProjects();
    }
    return this.sortedProjects().filter((p) => {
      const devId = typeof p.developer === 'string' ? p.developer : p.developer._id;
      return devId === developerId;
    });
  });

  readonly countryOptions = ['UAE', 'Saudi Arabia'];
  readonly serverOptions = ['Lsl Standard Cloud', 'Lsl Secondary Cloud'];

  ngOnInit(): void {
    this.loadDevelopers();

    // Check if we're editing (cameraId in route params) or adding (developerId/projectId in query params)
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const cameraId = params.get('id');
      if (cameraId) {
        this.isEditMode.set(true);
        this.cameraId.set(cameraId);
        this.loadCamera(cameraId);
      }
    });

    // Check query params for pre-filling developer/project when adding
    this.route.queryParams.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((queryParams) => {
      const developerId = queryParams['developerId'];
      const projectId = queryParams['projectId'];

      if (developerId && projectId && !this.isEditMode()) {
        // Pre-fill developer and project for new camera
        this.cameraForm.update((form) => ({
          ...form,
          developer: developerId,
          project: projectId,
        }));
        this.loadProjectsByDeveloper(developerId);
      }
    });
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
        this.isLoading.set(false);
      });
  }

  loadCamera(cameraId: string): void {
    this.isLoading.set(true);
    this.cameraService
      .getById(cameraId)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        catchError((error) => {
          console.error('Failed to load camera', error);
          return of<Camera | undefined>(undefined);
        }),
        finalize(() => this.isLoading.set(false)),
      )
      .subscribe((camera) => {
        if (camera) {
          this.populateForm(camera);
          // Load projects for the camera's developer
          const developerId =
            typeof camera.developer === 'string' ? camera.developer : camera.developer._id;
          if (developerId) {
            this.loadProjectsByDeveloper(developerId);
          }
        }
      });
  }

  loadProjectsByDeveloper(developerId: string): void {
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
        this.projects.set(projects ?? []);
      });
  }

  onDeveloperChange(developerId: string): void {
    this.cameraForm.update((form) => ({
      ...form,
      developer: developerId,
      project: '', // Reset project when developer changes
    }));
    if (developerId) {
      this.loadProjectsByDeveloper(developerId);
    }
  }

  updateFormField(field: keyof CameraFormState, value: any): void {
    this.cameraForm.update((form) => ({
      ...form,
      [field]: value,
      error: null,
    }));
  }

  private createEmptyForm(): CameraFormState {
    return {
      developer: '',
      project: '',
      camera: '',
      cameraDescription: '',
      cindex: 0,
      serverFolder: '',
      lat: '',
      lng: '',
      isActive: true,
      country: '',
      server: '',
      isSaving: false,
      error: null,
    };
  }

  private populateForm(camera: Camera): void {
    const developerId =
      typeof camera.developer === 'string' ? camera.developer : camera.developer._id || '';
    const projectId = typeof camera.project === 'string' ? camera.project : camera.project._id || '';

    this.cameraForm.set({
      developer: developerId,
      project: projectId,
      camera: camera.camera || '',
      cameraDescription: camera.cameraDescription || '',
      cindex: camera.cindex || 0,
      serverFolder: camera.serverFolder || '',
      lat: camera.lat?.toString() || '',
      lng: camera.lng?.toString() || '',
      isActive: camera.isActive ?? true,
      country: camera.country || '',
      server: camera.server || '',
      isSaving: false,
      error: null,
    });
  }

  saveCamera(): void {
    const form = this.cameraForm();
    
    // Validation
    if (!form.developer || !form.project || !form.camera || !form.country || !form.server) {
      this.cameraForm.update((f) => ({
        ...f,
        error: 'Please fill in all required fields.',
      }));
      return;
    }

    this.cameraForm.update((f) => ({ ...f, isSaving: true, error: null }));

    const payload: Partial<Camera> = {
      developer: form.developer,
      project: form.project,
      camera: form.camera.trim(),
      cameraDescription: form.cameraDescription.trim(),
      cindex: form.cindex,
      serverFolder: form.serverFolder.trim(),
      lat: form.lat ? parseFloat(form.lat) : null,
      lng: form.lng ? parseFloat(form.lng) : null,
      isActive: form.isActive,
      country: form.country,
      server: form.server,
    };

    const request = this.isEditMode() && this.cameraId()
      ? this.cameraService.update(this.cameraId()!, payload)
      : this.cameraService.create(payload);

    request
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        catchError((error) => {
          console.error('Failed to save camera', error);
          this.cameraForm.update((f) => ({
            ...f,
            isSaving: false,
            error: 'Failed to save camera. Please try again.',
          }));
          return of<Camera | null>(null);
        }),
      )
      .subscribe((camera) => {
        if (camera) {
          this.router.navigate(['/cameras']);
        }
      });
  }

  cancel(): void {
    this.router.navigate(['/cameras']);
  }
}

