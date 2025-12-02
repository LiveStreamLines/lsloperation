import { CommonModule } from '@angular/common';
import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Observable, of, forkJoin } from 'rxjs';
import { catchError, finalize, switchMap, map } from 'rxjs/operators';
import { CameraService } from '@core/services/camera.service';
import { DeveloperService } from '@core/services/developer.service';
import { ProjectService } from '@core/services/project.service';
import { Camera, CameraInternalAttachment } from '@core/models/camera.model';
import { Developer } from '@core/models/developer.model';
import { Project } from '@core/models/project.model';
import { environment } from '@env';
import { AuthStore } from '@core/auth/auth.store';

interface CameraFormState {
  developer: string;
  project: string;
  camera: string;
  cameraDescription: string;
  internalDescription: string;
  internalAttachments: File[];
  existingInternalAttachments: CameraInternalAttachment[];
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
  private readonly authStore = inject(AuthStore);
  private readonly destroyRef = inject(DestroyRef);

  readonly isLoading = signal(true);
  readonly developers = signal<Developer[]>([]);
  readonly projects = signal<Project[]>([]);
  readonly cameraForm = signal<CameraFormState>(this.createEmptyForm());
  readonly isEditMode = signal(false);
  readonly cameraId = signal<string | null>(null);

  readonly isSuperAdmin = computed(() => this.authStore.user()?.role === 'Super Admin');

  // Filter developers by country
  readonly filteredDevelopers = computed(() => {
    let developers = this.developers();
    const user = this.authStore.user();
    
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

  onInternalAttachmentsChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) {
      return;
    }
    const files = Array.from(input.files);
    this.cameraForm.update((state) => ({
      ...state,
      internalAttachments: [...state.internalAttachments, ...files],
      error: null,
    }));
    input.value = '';
  }

  removeInternalAttachment(index: number): void {
    this.cameraForm.update((state) => {
      const updated = [...state.internalAttachments];
      updated.splice(index, 1);
      return {
        ...state,
        internalAttachments: updated,
        error: null,
      };
    });
  }

  deleteInternalAttachment(attachmentId: string): void {
    const cameraId = this.cameraId();
    if (!cameraId) {
      return;
    }

    this.cameraForm.update((state) => ({ ...state, isSaving: true, error: null }));

    this.cameraService
      .deleteInternalAttachment(cameraId, attachmentId)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        catchError((error) => {
          console.error('Failed to delete attachment', error);
          this.cameraForm.update((state) => ({
            ...state,
            isSaving: false,
            error: 'Unable to delete attachment. Please try again.',
          }));
          return of<Camera | null>(null);
        }),
      )
      .subscribe((updatedCamera) => {
        if (updatedCamera) {
          this.cameraForm.update((state) => ({
            ...state,
            existingInternalAttachments: updatedCamera.internalAttachments ?? [],
            isSaving: false,
            error: null,
          }));
        }
      });
  }

  getAttachmentUrl(attachment: CameraInternalAttachment): string {
    if (!attachment?.url) {
      return '#';
    }
    if (attachment.url.startsWith('http://') || attachment.url.startsWith('https://')) {
      return attachment.url;
    }
    const sanitized = attachment.url.startsWith('/') ? attachment.url : `/${attachment.url}`;
    const mediaBaseUrl = environment.apiUrl.replace('/api', '');
    return `${mediaBaseUrl}${sanitized}`;
  }

  formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  }

  private createEmptyForm(): CameraFormState {
    return {
      developer: '',
      project: '',
      camera: '',
      cameraDescription: '',
      internalDescription: '',
      internalAttachments: [],
      existingInternalAttachments: [],
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
      internalDescription: camera.internalDescription || '',
      internalAttachments: [],
      existingInternalAttachments: camera.internalAttachments ?? [],
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

    const attachmentsToUpload = [...form.internalAttachments];
    const hasInternalDescription = form.internalDescription.trim().length > 0;

    // Use FormData if there's internal description, otherwise use JSON
    let request: Observable<Camera>;

    if (hasInternalDescription) {
      // Use FormData for internal description
      const formData = new FormData();
      formData.append('developer', form.developer);
      formData.append('project', form.project);
      formData.append('camera', form.camera.trim());
      formData.append('cameraDescription', form.cameraDescription.trim());
      formData.append('internalDescription', form.internalDescription.trim());
      formData.append('cindex', form.cindex.toString());
      formData.append('serverFolder', form.serverFolder.trim());
      formData.append('lat', form.lat || '');
      formData.append('lng', form.lng || '');
      formData.append('isActive', form.isActive.toString());
      formData.append('country', form.country);
      formData.append('server', form.server);

      // Internal attachments are now uploaded separately to S3, not included in FormData

      request = this.isEditMode() && this.cameraId()
        ? this.cameraService.update(this.cameraId()!, formData)
        : this.cameraService.create(formData);
    } else {
      // Use JSON payload
      const payload: Partial<Camera> = {
        developer: form.developer,
        project: form.project,
        camera: form.camera.trim(),
        cameraDescription: form.cameraDescription.trim(),
        internalDescription: form.internalDescription.trim(),
        cindex: form.cindex,
        serverFolder: form.serverFolder.trim(),
        lat: form.lat ? parseFloat(form.lat) : null,
        lng: form.lng ? parseFloat(form.lng) : null,
        isActive: form.isActive,
        country: form.country,
        server: form.server,
      };

      request = this.isEditMode() && this.cameraId()
        ? this.cameraService.update(this.cameraId()!, payload)
        : this.cameraService.create(payload);
    }

    request
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        switchMap((camera) => {
          if (!camera || attachmentsToUpload.length === 0) {
            return of(camera);
          }
          // Upload attachments to S3 separately
          const uploadRequests = attachmentsToUpload.map((file) =>
            this.cameraService.uploadInternalAttachment(camera._id, file).pipe(
              catchError((error) => {
                console.error('Failed to upload attachment', file.name, error);
                return of(camera); // Continue even if one attachment fails
              }),
            ),
          );
          return forkJoin(uploadRequests).pipe(
            switchMap(() => {
              const refreshed = this.cameraService.getById(camera._id);
              return refreshed.pipe(
                map((cam) => cam || camera),
                catchError(() => of(camera)),
              );
            }),
            catchError(() => of(camera)), // Return saved camera even if refresh fails
          );
        }),
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

