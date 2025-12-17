import { CommonModule } from '@angular/common';
import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { of } from 'rxjs';
import { catchError, finalize } from 'rxjs/operators';
import { TaskService } from '@core/services/task.service';
import { UserService } from '@core/services/user.service';
import { Task, TaskNote, TaskType, TASK_TYPE_OPTIONS, getTaskTypeLabel } from '@core/models/task.model';
import { User } from '@core/models/user.model';
import { AuthStore } from '@core/auth/auth.store';

interface TaskFormState {
  title: string;
  description: string;
  type: TaskType | '';
  assignee: string;
  approver: string | null;
  notes: string;
  attachments: File[];
  isSaving: boolean;
  error: string | null;
}

@Component({
  selector: 'app-tasks-overview',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './tasks-overview.component.html',
})
export class TasksOverviewComponent implements OnInit {
  private readonly taskService = inject(TaskService);
  private readonly userService = inject(UserService);
  private readonly authStore = inject(AuthStore);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly isLoading = signal(true);
  readonly errorMessage = signal<string | null>(null);
  readonly tasks = signal<Task[]>([]);
  readonly users = signal<User[]>([]);
  readonly searchTerm = signal('');
  readonly statusFilter = signal<'all' | 'open' | 'closed'>('all');
  readonly typeFilter = signal<'all' | TaskType>('all');

  readonly editTaskModal = signal<Task | null>(null);
  readonly isAddMode = signal(false);
  readonly taskForm = signal<TaskFormState>(this.createEmptyForm());

  readonly currentUser = computed(() => this.authStore.user());

  // Filter users by current user's country
  readonly filteredUsers = computed(() => {
    const allUsers = this.users();
    const currentUser = this.currentUser();
    
    if (!currentUser?.country || currentUser.country === 'All') {
      return allUsers;
    }
    
    // Only show users from the same country
    return allUsers.filter((user) => user.country === currentUser.country);
  });

  readonly taskTypes = TASK_TYPE_OPTIONS;

  readonly filteredTasks = computed(() => {
    let tasks = this.tasks();
    const term = this.searchTerm().toLowerCase().trim();
    const status = this.statusFilter();
    const type = this.typeFilter();

    // Filter by status
    if (status !== 'all') {
      tasks = tasks.filter((task) => task.status === status);
    }

    // Filter by type
    if (type !== 'all') {
      tasks = tasks.filter((task) => task.type === type);
    }

    // Filter by search term
    if (term) {
      tasks = tasks.filter(
        (task) =>
          task.title?.toLowerCase().includes(term) ||
          task.description?.toLowerCase().includes(term) ||
          task.assigneeName?.toLowerCase().includes(term) ||
          task.assignedName?.toLowerCase().includes(term),
      );
    }

    return tasks;
  });

  ngOnInit(): void {
    this.loadTasks();
    this.loadUsers();
  }

  loadTasks(): void {
    this.isLoading.set(true);
    this.errorMessage.set(null);

    this.taskService
      .getAll()
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        catchError((error) => {
          console.error('Failed to load tasks', error);
          this.errorMessage.set('Unable to load tasks from the backend.');
          return of<Task[]>([]);
        }),
        finalize(() => this.isLoading.set(false)),
      )
      .subscribe((tasks) => {
        this.tasks.set(tasks ?? []);
      });
  }

  loadUsers(): void {
    this.userService
      .getAll()
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        catchError((error) => {
          console.error('Failed to load users', error);
          return of<User[]>([]);
        }),
      )
      .subscribe((users) => {
        this.users.set(users ?? []);
      });
  }

  onSearchChange(value: string): void {
    this.searchTerm.set(value);
  }

  onStatusFilterChange(value: 'all' | 'open' | 'closed'): void {
    this.statusFilter.set(value);
  }

  onTypeFilterChange(value: string): void {
    const normalized = (value || 'all').toString().trim().toLowerCase();
    if (normalized === 'all') {
      this.typeFilter.set('all');
      return;
    } else {
      const allowed: TaskType[] = ['operation', 'finance', 'media', 'other'];
      this.typeFilter.set(allowed.includes(normalized as TaskType) ? (normalized as TaskType) : 'all');
    }
  }

  openAddTaskModal(): void {
    this.isAddMode.set(true);
    this.editTaskModal.set(null);
    this.taskForm.set(this.createEmptyForm());
  }

  openTaskDetails(task: Task): void {
    this.router.navigate(['/tasks', task._id]);
  }

  closeTaskModal(): void {
    this.editTaskModal.set(null);
    this.isAddMode.set(false);
    this.taskForm.set(this.createEmptyForm());
  }

  onAttachmentsChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) {
      return;
    }
    const files = Array.from(input.files);
    this.taskForm.update((state) => ({
      ...state,
      attachments: [...state.attachments, ...files],
      error: null,
    }));
    input.value = '';
  }

  removeAttachment(index: number): void {
    this.taskForm.update((state) => {
      const updated = [...state.attachments];
      updated.splice(index, 1);
      return {
        ...state,
        attachments: updated,
        error: null,
      };
    });
  }

  updateFormField(field: keyof TaskFormState, value: string | TaskType | null): void {
    this.taskForm.update((state) => ({
      ...state,
      [field]: value,
      error: null,
    }));
  }

  saveTask(): void {
    const form = this.taskForm();
    if (!form.title.trim()) {
      this.taskForm.update((state) => ({
        ...state,
        error: 'Task title is required.',
      }));
      return;
    }
    if (!form.type) {
      this.taskForm.update((state) => ({
        ...state,
        error: 'Task type is required.',
      }));
      return;
    }
    if (!form.assignee) {
      this.taskForm.update((state) => ({
        ...state,
        error: 'Assignee is required.',
      }));
      return;
    }

    const formData = new FormData();
    formData.append('title', form.title.trim());
    formData.append('description', form.description || '');
    formData.append('type', form.type);
    formData.append('assignee', form.assignee);
    if (form.approver) {
      formData.append('approver', form.approver);
    }
    if (form.notes && form.notes.trim()) {
      formData.append('notes', form.notes.trim());
    }

    form.attachments.forEach((file) => {
      formData.append('attachments', file, file.name);
    });

    this.taskForm.update((state) => ({ ...state, isSaving: true, error: null }));

    this.taskService
      .create(formData)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        catchError((error) => {
          console.error('Failed to save task', error);
          this.taskForm.update((state) => ({
            ...state,
            isSaving: false,
            error: 'Unable to save task. Please try again.',
          }));
          return of<Task | null>(null);
        }),
      )
      .subscribe((saved) => {
        if (saved) {
          this.closeTaskModal();
          this.loadTasks();
        }
      });
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

  formatDateTime(date: string | undefined): string {
    if (!date) {
      return '—';
    }
    try {
      return new Date(date).toLocaleString();
    } catch {
      return '—';
    }
  }

  getTaskTypeLabel(type: string): string {
    return getTaskTypeLabel(type);
  }

  getLatestNote(task: Task): TaskNote | null {
    const notes = task.notes ?? [];
    if (!notes.length) {
      return null;
    }
    return notes.reduce((latest, note) => {
      const latestTs = new Date(latest.createdAt).getTime();
      const noteTs = new Date(note.createdAt).getTime();
      return noteTs > latestTs ? note : latest;
    }, notes[0]);
  }

  private createEmptyForm(): TaskFormState {
    return {
      title: '',
      description: '',
      type: '',
      assignee: '',
      approver: null,
      notes: '',
      attachments: [],
      isSaving: false,
      error: null,
    };
  }
}

