import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { of } from 'rxjs';
import { catchError, finalize } from 'rxjs/operators';
import { ProjectService } from '@core/services/project.service';
import { DeveloperService } from '@core/services/developer.service';
import { Project, ProjectInternalAttachment } from '@core/models/project.model';
import { Developer } from '@core/models/developer.model';
import { environment } from '@env';

interface ProjectFormState {
  projectName: string;
  projectTag: string;
  description: string;
  developerId: string;
  index: string;
  lat: string;
  lng: string;
  isActive: boolean;
  status: string;
  internalDescription: string;
  internalAttachments: File[];
  existingInternalAttachments: ProjectInternalAttachment[];
  logoFile: File | null;
  logoPreview: string | null;
  isSaving: boolean;
  error: string | null;
}

@Component({
  selector: 'app-projects-overview',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './projects-overview.component.html',
})
export class ProjectsOverviewComponent implements OnInit {
  private readonly projectService = inject(ProjectService);
  private readonly developerService = inject(DeveloperService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly cdr = inject(ChangeDetectorRef);

  readonly isLoading = signal(true);
  readonly errorMessage = signal<string | null>(null);
  readonly projects = signal<Project[]>([]);
  readonly developers = signal<Developer[]>([]);
  readonly sortedDevelopers = computed(() => {
    return [...this.developers()].sort((a, b) => {
      const nameA = (a.developerName || '').toLowerCase();
      const nameB = (b.developerName || '').toLowerCase();
      return nameA.localeCompare(nameB);
    });
  });
  readonly selectedDeveloperId = signal<string | null>(null);
  readonly searchTerm = signal('');
  readonly logoBaseUrl = environment.apiUrl.replace('/api', '');

  readonly editProjectModal = signal<Project | null>(null);
  readonly isAddMode = signal(false);
  readonly projectForm = signal<ProjectFormState>(this.createEmptyForm());

  readonly statusOptions = [
    { value: 'new', label: 'New' },
    { value: 'active', label: 'Active' },
    { value: 'on hold', label: 'On Hold' },
    { value: 'finished', label: 'Finished' },
  ];

  readonly filteredProjects = computed(() => {
    const term = this.searchTerm().toLowerCase().trim();
    const projects = this.projects();
    const filtered = term
      ? projects.filter(
          (proj) =>
            proj.projectName?.toLowerCase().includes(term) ||
            proj.projectTag?.toLowerCase().includes(term) ||
            proj.description?.toLowerCase().includes(term),
        )
      : projects;
    return filtered;
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
        if (!this.selectedDeveloperId()) {
          this.loadProjects(null);
        }
      });
  }

  loadProjects(developerId: string | null): void {
    this.isLoading.set(true);
    this.errorMessage.set(null);

    const request = developerId
      ? this.projectService.getByDeveloper(developerId)
      : this.projectService.getAll(true);

    request
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        catchError((error) => {
          console.error('Failed to load projects', error);
          this.errorMessage.set('Unable to load projects from the backend.');
          return of<Project[]>([]);
        }),
        finalize(() => this.isLoading.set(false)),
      )
      .subscribe((projects) => {
        this.projects.set(projects ?? []);
      });
  }

  onDeveloperChange(developerId: string): void {
    this.selectedDeveloperId.set(developerId || null);
    this.loadProjects(developerId || null);
  }

  onSearchChange(value: string): void {
    this.searchTerm.set(value);
  }

  openAddProjectModal(): void {
    const developerId = this.selectedDeveloperId();
    if (!developerId) {
      this.errorMessage.set('Please select a developer first.');
      return;
    }
    this.isAddMode.set(true);
    this.editProjectModal.set(null);
    this.projectForm.set({
      ...this.createEmptyForm(),
      developerId,
      status: 'new',
    });
  }

  openEditProjectModal(project: Project): void {
    this.isAddMode.set(false);
    this.editProjectModal.set(project);
    // Ensure developers are loaded before populating form
    if (this.developers().length === 0) {
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
          this.populateForm(project);
        });
    } else {
      this.populateForm(project);
    }
  }

  closeProjectModal(): void {
    this.editProjectModal.set(null);
    this.isAddMode.set(false);
    this.projectForm.set(this.createEmptyForm());
  }

  onLogoChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      const file = input.files[0];
      this.projectForm.update((state) => ({
        ...state,
        logoFile: file,
        error: null,
      }));

      const reader = new FileReader();
      reader.onload = () => {
        this.projectForm.update((state) => ({
          ...state,
          logoPreview: reader.result as string,
        }));
      };
      reader.readAsDataURL(file);
    }
  }

  onInternalAttachmentsChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) {
      return;
    }
    const files = Array.from(input.files);
    this.projectForm.update((state) => ({
      ...state,
      internalAttachments: [...state.internalAttachments, ...files],
      error: null,
    }));
    input.value = '';
  }

  removeInternalAttachment(index: number): void {
    this.projectForm.update((state) => {
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
    const project = this.editProjectModal();
    if (!project) {
      return;
    }

    this.projectForm.update((state) => ({ ...state, isSaving: true, error: null }));

    this.projectService
      .deleteInternalAttachment(project._id, attachmentId)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        catchError((error) => {
          console.error('Failed to delete attachment', error);
          this.projectForm.update((state) => ({
            ...state,
            isSaving: false,
            error: 'Unable to delete attachment. Please try again.',
          }));
          return of<Project | null>(null);
        }),
      )
      .subscribe((updatedProject) => {
        if (updatedProject) {
          this.projectForm.update((state) => ({
            ...state,
            existingInternalAttachments: updatedProject.internalAttachments ?? [],
            isSaving: false,
            error: null,
          }));
          this.editProjectModal.set(updatedProject);
        }
      });
  }

  formatFileSize(bytes: number | undefined): string {
    if (!bytes || bytes === 0) {
      return '0 Bytes';
    }
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
  }

  getAttachmentUrl(attachment: ProjectInternalAttachment): string {
    if (!attachment.url) {
      return '';
    }
    const sanitized = attachment.url.startsWith('/') ? attachment.url : `/${attachment.url}`;
    const mediaBaseUrl = environment.apiUrl.replace('/api', '');
    return `${mediaBaseUrl}${sanitized}`;
  }

  updateFormField(field: string, value: string | boolean): void {
    this.projectForm.update((state) => ({
      ...state,
      [field]: value,
      error: null,
    }));
  }

  saveProject(): void {
    const form = this.projectForm();
    if (!form.projectName.trim() || !form.projectTag.trim() || !form.description.trim() || !form.developerId) {
      this.projectForm.update((state) => ({
        ...state,
        error: 'Project name, tag, description, and developer are required.',
      }));
      return;
    }

    const formData = this.buildFormData(form);
    const project = this.editProjectModal();

    this.projectForm.update((state) => ({ ...state, isSaving: true, error: null }));

    const request = project ? this.projectService.update(project._id, formData) : this.projectService.create(formData);

    request
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        catchError((error) => {
          console.error('Failed to save project', error);
          this.projectForm.update((state) => ({
            ...state,
            isSaving: false,
            error: 'Unable to save project. Please try again.',
          }));
          return of<Project | null>(null);
        }),
      )
      .subscribe((saved) => {
        if (saved) {
          this.closeProjectModal();
          const developerId = this.selectedDeveloperId();
          if (developerId) {
            this.loadProjects(developerId);
          }
        }
      });
  }

  updateProjectStatus(project: Project, status: string): void {
    this.projectService
      .updateStatus(project._id, status)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        catchError((error) => {
          console.error('Failed to update project status', error);
          const developerId = this.selectedDeveloperId();
          if (developerId) {
            this.loadProjects(developerId);
          }
          return of<Project | null>(null);
        }),
      )
      .subscribe((updated) => {
        if (updated) {
          this.projects.update((projects) =>
            projects.map((p) => (p._id === updated._id ? { ...p, status: updated.status } : p)),
          );
        }
      });
  }

  toggleBlockStatus(project: Project): void {
    const newBlocked = !project.blocked;
    this.projectService
      .updateBlockStatus(project._id, newBlocked)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        catchError((error) => {
          console.error('Failed to update block status', error);
          const developerId = this.selectedDeveloperId();
          if (developerId) {
            this.loadProjects(developerId);
          }
          return of<Project | null>(null);
        }),
      )
      .subscribe((updated) => {
        if (updated) {
          this.projects.update((projects) =>
            projects.map((p) => (p._id === updated._id ? { ...p, blocked: updated.blocked } : p)),
          );
        }
      });
  }

  private createEmptyForm(): ProjectFormState {
    return {
      projectName: '',
      projectTag: '',
      description: '',
      developerId: '',
      index: '0',
      lat: '',
      lng: '',
      isActive: true,
      status: 'new',
      internalDescription: '',
      internalAttachments: [],
      existingInternalAttachments: [],
      logoFile: null,
      logoPreview: null,
      isSaving: false,
      error: null,
    };
  }

  private populateForm(project: Project): void {
    let developerId = '';
    if (typeof project.developer === 'string') {
      developerId = project.developer.trim();
    } else if (project.developer && typeof project.developer === 'object') {
      developerId = ((project.developer as { _id?: string })?._id || '').trim();
    }

    // Debug: Log the extracted developer ID
    console.log('Populating form with developerId:', developerId);
    console.log('Available developers:', this.developers().map(d => ({ id: d._id, name: d.developerName })));

    const logoPreview = project.logo ? `${this.logoBaseUrl}/${project.logo}` : null;

    this.projectForm.set({
      projectName: project.projectName || '',
      projectTag: project.projectTag || '',
      description: project.description || '',
      developerId,
      index: project.index?.toString() || '0',
      lat: (project as any).lat?.toString() || '',
      lng: (project as any).lng?.toString() || '',
      isActive: project.isActive === true || project.isActive === 'true' || project.isActive === 'True',
      status: project.status || 'new',
      internalDescription: project.internalDescription || '',
      internalAttachments: [],
      existingInternalAttachments: project.internalAttachments ?? [],
      logoFile: null,
      logoPreview,
      isSaving: false,
      error: null,
    });

    // Force change detection to ensure dropdown updates
    this.cdr.detectChanges();
    
    // Debug: Log the extracted developer ID
    setTimeout(() => {
      console.log('Form state after populate:', this.projectForm().developerId);
      console.log('Matching developer found:', this.developers().find(d => d._id === developerId));
    }, 0);
  }

  private buildFormData(form: ProjectFormState): FormData {
    const formData = new FormData();
    formData.append('projectName', form.projectName.trim());
    formData.append('projectTag', form.projectTag.trim());
    formData.append('description', form.description.trim());
    formData.append('developer', form.developerId);
    formData.append('index', form.index);
    formData.append('lat', form.lat || '');
    formData.append('lng', form.lng || '');
    formData.append('isActive', form.isActive.toString());
    formData.append('status', form.status);
    formData.append('internalDescription', form.internalDescription || '');

    if (form.logoFile) {
      formData.append('logo', form.logoFile);
    } else if (this.isAddMode() === false && this.editProjectModal()?.logo) {
      formData.append('logo', this.editProjectModal()!.logo!);
    }

    // Append internal attachments
    form.internalAttachments.forEach((file) => {
      formData.append('internalAttachments', file);
    });

    return formData;
  }

  formatDate(date: string | undefined): string {
    if (!date) {
      return '—';
    }
    try {
      return new Date(date).toLocaleDateString();
    } catch {
      return '—';
    }
  }

  getLogoUrl(project: Project): string {
    if (project.logo) {
      return `${this.logoBaseUrl}/${project.logo}`;
    }
    return '';
  }

  getDeveloperName(project: Project): string {
    if (typeof project.developer === 'string') {
      const developer = this.developers().find((d) => d._id === project.developer);
      return developer?.developerName || '';
    }
    return (project.developer as { developerName?: string })?.developerName || '';
  }
}
