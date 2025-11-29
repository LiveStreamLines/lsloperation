import { CommonModule } from '@angular/common';
import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { of } from 'rxjs';
import { catchError, finalize } from 'rxjs/operators';
import { ContactService } from '@core/services/contact.service';
import { DeveloperService } from '@core/services/developer.service';
import { ProjectService } from '@core/services/project.service';
import { CameraService } from '@core/services/camera.service';
import { Contact } from '@core/models/contact.model';
import { Developer } from '@core/models/developer.model';
import { Project } from '@core/models/project.model';
import { Camera } from '@core/models/camera.model';
import { AuthStore } from '@core/auth/auth.store';

interface ContactFormState {
  name: string;
  phone: string;
  email: string;
  company: string;
  designation: string;
  notes: string;
  developerId: string | null;
  projectId: string | null;
  cameraId: string | null;
  isSaving: boolean;
  error: string | null;
}

type AssociationType = 'developer' | 'project' | 'camera';

@Component({
  selector: 'app-contacts-overview',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './contacts-overview.component.html',
})
export class ContactsOverviewComponent implements OnInit {
  private readonly contactService = inject(ContactService);
  private readonly developerService = inject(DeveloperService);
  private readonly projectService = inject(ProjectService);
  private readonly cameraService = inject(CameraService);
  private readonly authStore = inject(AuthStore);
  private readonly destroyRef = inject(DestroyRef);

  readonly isLoading = signal(true);
  readonly errorMessage = signal<string | null>(null);
  readonly contacts = signal<Contact[]>([]);
  readonly developers = signal<Developer[]>([]);
  readonly projects = signal<Project[]>([]);
  readonly cameras = signal<Camera[]>([]);
  readonly searchTerm = signal('');

  readonly associationType = signal<AssociationType>('developer');
  readonly selectedDeveloperId = signal<string | null>(null);
  readonly selectedProjectId = signal<string | null>(null);
  readonly selectedCameraId = signal<string | null>(null);

  readonly editContactModal = signal<Contact | null>(null);
  readonly isAddMode = signal(false);
  readonly contactForm = signal<ContactFormState>(this.createEmptyForm());

  readonly isSuperAdmin = computed(() => this.authStore.user()?.role === 'Super Admin');

  readonly filteredDevelopers = computed(() => {
    let developers = this.developers();
    const user = this.authStore.user();
    
    if (user?.country && user.country !== 'All') {
      developers = developers.filter((dev) => {
        const devCountry = dev.address?.country || dev['country'];
        return devCountry === user.country;
      });
    } else if (!user?.country) {
      developers = [];
    }
    
    return developers;
  });

  readonly sortedDevelopers = computed(() => {
    return [...this.filteredDevelopers()].sort((a, b) => {
      const nameA = (a.developerName || '').toLowerCase();
      const nameB = (b.developerName || '').toLowerCase();
      return nameA.localeCompare(nameB);
    });
  });

  readonly filteredProjects = computed(() => {
    const developerId = this.selectedDeveloperId();
    if (!developerId) {
      return [];
    }
    return this.projects().filter((proj) => {
      const projectDeveloperId = typeof proj.developer === 'object' 
        ? (proj.developer as any)?._id 
        : proj.developer;
      return projectDeveloperId === developerId;
    });
  });

  readonly filteredCameras = computed(() => {
    const projectId = this.selectedProjectId();
    if (!projectId) {
      return [];
    }
    return this.cameras().filter((cam) => {
      const cameraProjectId = typeof cam.project === 'object' 
        ? (cam.project as any)?._id 
        : cam.project;
      return cameraProjectId === projectId;
    });
  });

  readonly filteredContacts = computed(() => {
    const term = this.searchTerm().toLowerCase().trim();
    let contacts = this.contacts();

    if (term) {
      contacts = contacts.filter(
        (contact) =>
          contact.name?.toLowerCase().includes(term) ||
          contact.email?.toLowerCase().includes(term) ||
          contact.phone?.toLowerCase().includes(term) ||
          contact.company?.toLowerCase().includes(term) ||
          contact.designation?.toLowerCase().includes(term),
      );
    }

    return contacts;
  });

  ngOnInit(): void {
    this.loadDevelopers();
    this.loadProjects();
    this.loadCameras();
    this.loadContacts();
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
      });
  }

  loadProjects(): void {
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
      });
  }

  loadCameras(): void {
    this.cameraService
      .getAll(true)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        catchError((error) => {
          console.error('Failed to load cameras', error);
          return of<Camera[]>([]);
        }),
      )
      .subscribe((cameras) => {
        this.cameras.set(cameras ?? []);
      });
  }

  loadContacts(): void {
    this.isLoading.set(true);
    this.errorMessage.set(null);

    const options: any = { forceRefresh: true };
    if (this.selectedCameraId()) {
      options.cameraId = this.selectedCameraId();
    } else if (this.selectedProjectId()) {
      options.projectId = this.selectedProjectId();
    } else if (this.selectedDeveloperId()) {
      options.developerId = this.selectedDeveloperId();
    }

    this.contactService
      .getAll(options)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        catchError((error) => {
          console.error('Failed to load contacts', error);
          this.errorMessage.set('Unable to load contacts from the backend.');
          return of<Contact[]>([]);
        }),
        finalize(() => this.isLoading.set(false)),
      )
      .subscribe((contacts) => {
        this.contacts.set(contacts ?? []);
      });
  }

  onAssociationTypeChange(type: AssociationType): void {
    this.associationType.set(type);
    this.selectedDeveloperId.set(null);
    this.selectedProjectId.set(null);
    this.selectedCameraId.set(null);
    this.loadContacts();
  }

  onDeveloperChange(developerId: string): void {
    this.selectedDeveloperId.set(developerId || null);
    this.selectedProjectId.set(null);
    this.selectedCameraId.set(null);
    this.loadContacts();
  }

  onProjectChange(projectId: string): void {
    this.selectedProjectId.set(projectId || null);
    this.selectedCameraId.set(null);
    this.loadContacts();
  }

  onCameraChange(cameraId: string): void {
    this.selectedCameraId.set(cameraId || null);
    this.loadContacts();
  }

  onSearchChange(value: string): void {
    this.searchTerm.set(value);
  }

  openAddContactModal(): void {
    this.isAddMode.set(true);
    this.editContactModal.set(null);
    
    const form = this.createEmptyForm();
    form.developerId = this.selectedDeveloperId();
    form.projectId = this.selectedProjectId();
    form.cameraId = this.selectedCameraId();
    
    this.contactForm.set(form);
  }

  openEditContactModal(contact: Contact): void {
    this.isAddMode.set(false);
    this.editContactModal.set(contact);
    this.populateForm(contact);
  }

  closeContactModal(): void {
    this.editContactModal.set(null);
    this.isAddMode.set(false);
    this.contactForm.set(this.createEmptyForm());
  }

  updateFormField(field: keyof ContactFormState, value: string | null): void {
    this.contactForm.update((state) => ({
      ...state,
      [field]: value,
      error: null,
    }));
  }

  saveContact(): void {
    const form = this.contactForm();
    if (!form.name.trim()) {
      this.contactForm.update((state) => ({
        ...state,
        error: 'Contact name is required.',
      }));
      return;
    }

    if (!form.developerId && !form.projectId && !form.cameraId) {
      this.contactForm.update((state) => ({
        ...state,
        error: 'Contact must be associated with a developer, project, or camera.',
      }));
      return;
    }

    const contactData: Partial<Contact> = {
      name: form.name.trim(),
      phone: form.phone || '',
      email: form.email || '',
      company: form.company || '',
      designation: form.designation || '',
      notes: form.notes || '',
      developerId: form.developerId || null,
      projectId: form.projectId || null,
      cameraId: form.cameraId || null,
    };

    this.contactForm.update((state) => ({ ...state, isSaving: true, error: null }));

    const contact = this.editContactModal();
    const request = contact
      ? this.contactService.update(contact._id, contactData)
      : this.contactService.create(contactData);

    request
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        catchError((error) => {
          console.error('Failed to save contact', error);
          this.contactForm.update((state) => ({
            ...state,
            isSaving: false,
            error: 'Unable to save contact. Please try again.',
          }));
          return of<Contact | null>(null);
        }),
      )
      .subscribe((saved) => {
        if (saved) {
          this.closeContactModal();
          this.loadContacts();
        }
      });
  }

  deleteContact(contact: Contact): void {
    if (!confirm(`Are you sure you want to delete contact "${contact.name}"?`)) {
      return;
    }

    this.contactService
      .delete(contact._id)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        catchError((error) => {
          console.error('Failed to delete contact', error);
          alert('Unable to delete contact. Please try again.');
          return of<void>();
        }),
      )
      .subscribe(() => {
        this.loadContacts();
      });
  }

  getDeveloperName(developerId: string | null | undefined): string {
    if (!developerId) return '—';
    const developer = this.developers().find((d) => d._id === developerId);
    return developer?.developerName || '—';
  }

  getProjectName(projectId: string | null | undefined): string {
    if (!projectId) return '—';
    const project = this.projects().find((p) => p._id === projectId);
    return project?.projectName || '—';
  }

  getCameraName(cameraId: string | null | undefined): string {
    if (!cameraId) return '—';
    const camera = this.cameras().find((c) => c._id === cameraId);
    return camera?.cameraName || '—';
  }

  getAssociationLabel(contact: Contact): string {
    if (contact.cameraId) {
      return `Camera: ${this.getCameraName(contact.cameraId)}`;
    }
    if (contact.projectId) {
      return `Project: ${this.getProjectName(contact.projectId)}`;
    }
    if (contact.developerId) {
      return `Developer: ${this.getDeveloperName(contact.developerId)}`;
    }
    return '—';
  }

  private createEmptyForm(): ContactFormState {
    return {
      name: '',
      phone: '',
      email: '',
      company: '',
      designation: '',
      notes: '',
      developerId: null,
      projectId: null,
      cameraId: null,
      isSaving: false,
      error: null,
    };
  }

  private populateForm(contact: Contact): void {
    this.contactForm.set({
      name: contact.name || '',
      phone: contact.phone || '',
      email: contact.email || '',
      company: contact.company || '',
      designation: contact.designation || '',
      notes: contact.notes || '',
      developerId: contact.developerId || null,
      projectId: contact.projectId || null,
      cameraId: contact.cameraId || null,
      isSaving: false,
      error: null,
    });
  }
}

