import { CommonModule } from '@angular/common';
import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { of } from 'rxjs';
import { catchError, finalize } from 'rxjs/operators';
import { DeveloperService } from '@core/services/developer.service';
import { Developer, DeveloperInternalAttachment } from '@core/models/developer.model';
import { environment } from '@env';
import { AuthStore } from '@core/auth/auth.store';

interface DeveloperFormState {
  developerName: string;
  developerTag: string;
  description: string;
  internalDescription: string;
  internalAttachments: File[];
  existingInternalAttachments: DeveloperInternalAttachment[];
  isActive: boolean;
  email: string;
  phone: string;
  website: string;
  vatNumber: string;
  taxId: string;
  businessLicense: string;
  address: {
    street: string;
    city: string;
    state: string;
    zipCode: string;
    country: string;
  };
  contactPerson: {
    name: string;
    position: string;
    email: string;
    phone: string;
  };
  bankDetails: {
    bankName: string;
    accountNumber: string;
    iban: string;
    swiftCode: string;
  };
  logoFile: File | null;
  logoPreview: string | null;
  isSaving: boolean;
  error: string | null;
}

@Component({
  selector: 'app-developers-overview',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './developers-overview.component.html',
})
export class DevelopersOverviewComponent implements OnInit {
  private readonly developerService = inject(DeveloperService);
  private readonly authStore = inject(AuthStore);
  private readonly destroyRef = inject(DestroyRef);

  readonly isLoading = signal(true);
  readonly errorMessage = signal<string | null>(null);
  readonly developers = signal<Developer[]>([]);
  readonly searchTerm = signal('');
  readonly backendUrl = environment.apiUrl;
  readonly logoBaseUrl = environment.apiUrl.replace('/api', '');

  readonly editDeveloperModal = signal<Developer | null>(null);
  readonly isAddMode = signal(false);
  readonly developerForm = signal<DeveloperFormState>(this.createEmptyForm());

  readonly isSuperAdmin = computed(() => this.authStore.user()?.role === 'Super Admin');

  readonly filteredDevelopers = computed(() => {
    let developers = this.developers();
    
    // Filter by country: Only users with "All" see all developers
    const user = this.authStore.user();
    if (user?.country && user.country !== 'All') {
      const userCountry = user.country;
      developers = developers.filter((dev) => {
        // Only show developers where address.country matches user's country
        // Check address.country (preferred) or top-level country (fallback for legacy data)
        const devCountry = dev.address?.country || dev['country'];
        // Only show if country matches user's country
        return devCountry === userCountry;
      });
    } else if (!user?.country) {
      // If user has no country set, don't show any developers
      developers = [];
    }
    // If country is "All", show all developers (no filtering)
    
    // Apply search filter
    const term = this.searchTerm().toLowerCase().trim();
    if (term) {
      developers = developers.filter(
        (dev) =>
          dev.developerName?.toLowerCase().includes(term) ||
          dev.developerTag?.toLowerCase().includes(term) ||
          dev.description?.toLowerCase().includes(term),
      );
    }
    
    // Sort alphabetically by developer name
    return developers.sort((a, b) => {
      const nameA = (a.developerName || '').toLowerCase();
      const nameB = (b.developerName || '').toLowerCase();
      return nameA.localeCompare(nameB);
    });
  });

  ngOnInit(): void {
    this.loadDevelopers();
  }

  loadDevelopers(): void {
    this.isLoading.set(true);
    this.errorMessage.set(null);

    this.developerService
      .getAll({ forceRefresh: true })
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        catchError((error) => {
          console.error('Failed to load developers', error);
          this.errorMessage.set('Unable to load developers from the backend.');
          return of<Developer[]>([]);
        }),
        finalize(() => this.isLoading.set(false)),
      )
      .subscribe((developers) => {
        this.developers.set(developers ?? []);
      });
  }

  onSearchChange(value: string): void {
    this.searchTerm.set(value);
  }

  openAddDeveloperModal(): void {
    this.isAddMode.set(true);
    this.editDeveloperModal.set(null);
    this.developerForm.set(this.createEmptyForm());
  }

  openEditDeveloperModal(developer: Developer): void {
    this.isAddMode.set(false);
    this.editDeveloperModal.set(developer);
    this.populateForm(developer);
  }

  closeDeveloperModal(): void {
    this.editDeveloperModal.set(null);
    this.isAddMode.set(false);
    this.developerForm.set(this.createEmptyForm());
  }

  onLogoChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      const file = input.files[0];
      this.developerForm.update((state) => ({
        ...state,
        logoFile: file,
        error: null,
      }));

      const reader = new FileReader();
      reader.onload = () => {
        this.developerForm.update((state) => ({
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
    this.developerForm.update((state) => ({
      ...state,
      internalAttachments: [...state.internalAttachments, ...files],
      error: null,
    }));
    input.value = '';
  }

  removeInternalAttachment(index: number): void {
    this.developerForm.update((state) => {
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
    const developer = this.editDeveloperModal();
    if (!developer) {
      return;
    }

    this.developerForm.update((state) => ({ ...state, isSaving: true, error: null }));

    this.developerService
      .deleteAttachment(developer._id, attachmentId)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        catchError((error) => {
          console.error('Failed to delete attachment', error);
          this.developerForm.update((state) => ({
            ...state,
            isSaving: false,
            error: 'Unable to delete attachment. Please try again.',
          }));
          return of<Developer | null>(null);
        }),
      )
      .subscribe((updatedDeveloper) => {
        if (updatedDeveloper) {
          this.developerForm.update((state) => ({
            ...state,
            existingInternalAttachments: updatedDeveloper.internalAttachments ?? [],
            isSaving: false,
            error: null,
          }));
          this.editDeveloperModal.set(updatedDeveloper);
        }
      });
  }

  updateFormField(section: 'basic' | 'contact' | 'business' | 'address' | 'contactPerson' | 'bankDetails', field: string, value: string | boolean): void {
    this.developerForm.update((state) => {
      if (section === 'basic') {
        return { ...state, [field]: value, error: null };
      }
      if (section === 'contact' || section === 'business') {
        return { ...state, [field]: value, error: null };
      }
      if (section === 'address') {
        return {
          ...state,
          address: { ...state.address, [field]: value },
          error: null,
        };
      }
      if (section === 'contactPerson') {
        return {
          ...state,
          contactPerson: { ...state.contactPerson, [field]: value },
          error: null,
        };
      }
      if (section === 'bankDetails') {
        return {
          ...state,
          bankDetails: { ...state.bankDetails, [field]: value },
          error: null,
        };
      }
      return state;
    });
  }

  saveDeveloper(): void {
    const form = this.developerForm();
    if (!form.developerName.trim() || !form.developerTag.trim() || !form.description.trim()) {
      this.developerForm.update((state) => ({
        ...state,
        error: 'Developer name, tag, and description are required.',
      }));
      return;
    }

    // Set country from logged-in user's country if available
    const user = this.authStore.user();
    let formToUse = form;
    if (user?.country && user.country !== 'All' && typeof user.country === 'string') {
      // Update form with user's country before building FormData
      this.developerForm.update((state) => ({
        ...state,
        address: {
          ...state.address,
          country: user.country as string,
        },
      }));
      // Get updated form with country set
      formToUse = this.developerForm();
    }

    const formData = this.buildFormData(formToUse);

    const developer = this.editDeveloperModal();

    this.developerForm.update((state) => ({ ...state, isSaving: true, error: null }));

    const request = developer
      ? this.developerService.update(developer._id, formData)
      : this.developerService.create(formData);

    request
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        catchError((error) => {
          console.error('Failed to save developer', error);
          this.developerForm.update((state) => ({
            ...state,
            isSaving: false,
            error: 'Unable to save developer. Please try again.',
          }));
          return of<Developer | null>(null);
        }),
      )
      .subscribe((saved) => {
        if (saved) {
          this.closeDeveloperModal();
          this.loadDevelopers();
        }
      });
  }

  private createEmptyForm(): DeveloperFormState {
    return {
      developerName: '',
      developerTag: '',
      description: '',
      internalDescription: '',
      internalAttachments: [],
      existingInternalAttachments: [],
      isActive: true,
      email: '',
      phone: '',
      website: '',
      vatNumber: '',
      taxId: '',
      businessLicense: '',
      address: {
        street: '',
        city: '',
        state: '',
        zipCode: '',
        country: '',
      },
      contactPerson: {
        name: '',
        position: '',
        email: '',
        phone: '',
      },
      bankDetails: {
        bankName: '',
        accountNumber: '',
        iban: '',
        swiftCode: '',
      },
      logoFile: null,
      logoPreview: null,
      isSaving: false,
      error: null,
    };
  }

  private populateForm(developer: Developer): void {
    const logoPreview = developer.logo
      ? `${this.logoBaseUrl}/${developer.logo}`
      : null;

    this.developerForm.set({
      developerName: developer.developerName || '',
      developerTag: developer.developerTag || '',
      description: developer.description || '',
      internalDescription: developer.internalDescription || '',
      internalAttachments: [],
      existingInternalAttachments: developer.internalAttachments ?? [],
      isActive: developer.isActive === true || developer.isActive === 'true' || developer.isActive === 'True',
      email: developer.email || '',
      phone: developer.phone || '',
      website: developer.website || '',
      vatNumber: developer.vatNumber || '',
      taxId: developer.taxId || '',
      businessLicense: developer.businessLicense || '',
      address: {
        street: developer.address?.street || '',
        city: developer.address?.city || '',
        state: developer.address?.state || '',
        zipCode: developer.address?.zipCode || '',
        country: developer.address?.country || '',
      },
      contactPerson: {
        name: developer.contactPerson?.name || '',
        position: developer.contactPerson?.position || '',
        email: developer.contactPerson?.email || '',
        phone: developer.contactPerson?.phone || '',
      },
      bankDetails: {
        bankName: developer.bankDetails?.bankName || '',
        accountNumber: developer.bankDetails?.accountNumber || '',
        iban: developer.bankDetails?.iban || '',
        swiftCode: developer.bankDetails?.swiftCode || '',
      },
      logoFile: null,
      logoPreview,
      isSaving: false,
      error: null,
    });
  }

  private buildFormData(form: DeveloperFormState): FormData {
    const formData = new FormData();
    formData.append('developerName', form.developerName.trim());
    formData.append('developerTag', form.developerTag.trim());
    formData.append('description', form.description.trim());
    formData.append('internalDescription', form.internalDescription || '');
    formData.append('isActive', form.isActive.toString());

    formData.append('email', form.email || '');
    formData.append('phone', form.phone || '');
    formData.append('website', form.website || '');

    formData.append('vatNumber', form.vatNumber || '');
    formData.append('taxId', form.taxId || '');
    formData.append('businessLicense', form.businessLicense || '');

    formData.append('address[street]', form.address.street || '');
    formData.append('address[city]', form.address.city || '');
    formData.append('address[state]', form.address.state || '');
    formData.append('address[zipCode]', form.address.zipCode || '');
    formData.append('address[country]', form.address.country || '');

    formData.append('contactPerson[name]', form.contactPerson.name || '');
    formData.append('contactPerson[position]', form.contactPerson.position || '');
    formData.append('contactPerson[email]', form.contactPerson.email || '');
    formData.append('contactPerson[phone]', form.contactPerson.phone || '');

    formData.append('bankDetails[bankName]', form.bankDetails.bankName || '');
    formData.append('bankDetails[accountNumber]', form.bankDetails.accountNumber || '');
    formData.append('bankDetails[iban]', form.bankDetails.iban || '');
    formData.append('bankDetails[swiftCode]', form.bankDetails.swiftCode || '');
    
    // Append internal attachments to FormData - backend will upload to iDrive
    form.internalAttachments.forEach((file) => {
      formData.append('internalAttachments', file, file.name);
    });

    if (form.logoFile) {
      formData.append('logo', form.logoFile);
    } else if (this.isAddMode() === false && this.editDeveloperModal()?.logo) {
      formData.append('logo', this.editDeveloperModal()!.logo!);
    }

    return formData;
  }

  formatFileSize(bytes: number): string {
    if (!bytes && bytes !== 0) {
      return '';
    }
    if (bytes === 0) {
      return '0 B';
    }
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    const value = bytes / Math.pow(k, i);
    return `${value.toFixed(value >= 10 || i === 0 ? 0 : 1)} ${sizes[i]}`;
  }

  getAttachmentUrl(attachment: DeveloperInternalAttachment): string {
    if (!attachment?.url) {
      return '';
    }
    if (attachment.url.startsWith('http://') || attachment.url.startsWith('https://')) {
      return attachment.url;
    }
    const sanitized = attachment.url.startsWith('/') ? attachment.url : `/${attachment.url}`;
    const mediaBaseUrl = environment.apiUrl.replace('/api', '');
    return `${mediaBaseUrl}${sanitized}`;
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

  getLogoUrl(developer: Developer): string {
    if (developer.logo) {
      return `${this.logoBaseUrl}/${developer.logo}`;
    }
    return '';
  }
}
