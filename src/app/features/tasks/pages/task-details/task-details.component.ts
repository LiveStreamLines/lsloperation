import { CommonModule } from '@angular/common';
import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { of } from 'rxjs';
import { catchError, finalize } from 'rxjs/operators';
import { TaskService } from '@core/services/task.service';
import { Task, getTaskTypeLabel } from '@core/models/task.model';
import { AuthStore } from '@core/auth/auth.store';
import { environment } from '@env';

interface NoteFormState {
  content: string;
  attachments: File[];
  isSaving: boolean;
  error: string | null;
}

@Component({
  selector: 'app-task-details',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './task-details.component.html',
})
export class TaskDetailsComponent implements OnInit {
  private readonly taskService = inject(TaskService);
  private readonly authStore = inject(AuthStore);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly isLoading = signal(true);
  readonly errorMessage = signal<string | null>(null);
  readonly task = signal<Task | null>(null);
  readonly noteForm = signal<NoteFormState>(this.createEmptyNoteForm());

  readonly currentUser = computed(() => this.authStore.user());
  readonly currentUserId = computed(() => this.currentUser()?.id || '');

  readonly canAddNote = computed(() => {
    const task = this.task();
    const userId = this.currentUserId();
    if (!task || !userId || task.status === 'closed') {
      return false;
    }
    return (
      task.assignee === userId ||
      task.assigned === userId ||
      (task.concernedUsers ?? []).includes(userId)
    );
  });

  readonly canCloseTask = computed(() => {
    const task = this.task();
    const userId = this.currentUserId();
    if (!task || !userId || task.status === 'closed') {
      return false;
    }
    return task.assignee === userId || (task.concernedUsers ?? []).includes(userId);
  });

  readonly mediaBaseUrl = environment.apiUrl.replace('/api', '');

  ngOnInit(): void {
    const taskId = this.route.snapshot.paramMap.get('id');
    if (taskId) {
      this.loadTask(taskId);
    } else {
      this.errorMessage.set('Task ID not provided');
      this.isLoading.set(false);
    }
  }

  loadTask(taskId: string): void {
    this.isLoading.set(true);
    this.errorMessage.set(null);

    this.taskService
      .getById(taskId)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        catchError((error) => {
          console.error('Failed to load task', error);
          this.errorMessage.set('Unable to load task from the backend.');
          return of<Task | null>(null);
        }),
        finalize(() => this.isLoading.set(false)),
      )
      .subscribe((task) => {
        if (task) {
          this.task.set(task);
        } else {
          this.errorMessage.set('Task not found');
        }
      });
  }

  onNoteAttachmentsChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) {
      return;
    }
    const files = Array.from(input.files);
    this.noteForm.update((state) => ({
      ...state,
      attachments: [...state.attachments, ...files],
      error: null,
    }));
    input.value = '';
  }

  removeNoteAttachment(index: number): void {
    this.noteForm.update((state) => {
      const updated = [...state.attachments];
      updated.splice(index, 1);
      return {
        ...state,
        attachments: updated,
        error: null,
      };
    });
  }

  updateNoteContent(value: string): void {
    this.noteForm.update((state) => ({
      ...state,
      content: value,
      error: null,
    }));
  }

  addNote(): void {
    const form = this.noteForm();
    const task = this.task();
    
    if (!task) {
      return;
    }

    if (!form.content.trim()) {
      this.noteForm.update((state) => ({
        ...state,
        error: 'Note content is required.',
      }));
      return;
    }

    this.noteForm.update((state) => ({ ...state, isSaving: true, error: null }));

    this.taskService
      .addNote(task._id, form.content, form.attachments)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        catchError((error) => {
          console.error('Failed to add note', error);
          this.noteForm.update((state) => ({
            ...state,
            isSaving: false,
            error: 'Unable to add note. Please try again.',
          }));
          return of<Task | null>(null);
        }),
      )
      .subscribe((updatedTask) => {
        if (updatedTask) {
          this.task.set(updatedTask);
          this.noteForm.set(this.createEmptyNoteForm());
        }
      });
  }

  closeTask(): void {
    const task = this.task();
    if (!task) {
      return;
    }

    if (!confirm('Are you sure you want to close this task?')) {
      return;
    }

    this.taskService
      .close(task._id)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        catchError((error) => {
          console.error('Failed to close task', error);
          alert('Unable to close task. Please try again.');
          return of<Task | null>(null);
        }),
      )
      .subscribe((updatedTask) => {
        if (updatedTask) {
          this.task.set(updatedTask);
        }
      });
  }

  getAttachmentUrl(url: string): string {
    if (!url) {
      return '';
    }
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return url;
    }
    const sanitized = url.startsWith('/') ? url : `/${url}`;
    return `${this.mediaBaseUrl}${sanitized}`;
  }

  formatDate(date: string | undefined): string {
    if (!date) {
      return '—';
    }
    try {
      return new Date(date).toLocaleString();
    } catch {
      return '—';
    }
  }

  getTaskTypeLabel(type: string | undefined): string {
    return getTaskTypeLabel(type);
  }

  goBack(): void {
    this.router.navigate(['/tasks']);
  }

  private createEmptyNoteForm(): NoteFormState {
    return {
      content: '',
      attachments: [],
      isSaving: false,
      error: null,
    };
  }
}

