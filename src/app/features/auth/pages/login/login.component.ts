import { CommonModule } from '@angular/common';
import { Component, DestroyRef, signal, inject } from '@angular/core';
import {
  FormBuilder,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '@core/auth/auth.service';
import { catchError, finalize, throwError } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  templateUrl: './login.component.html',
})
export class LoginComponent {
  private readonly fb = inject(FormBuilder);
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly isSubmitting = signal(false);
  readonly errorMessage = signal<string | null>(null);

  readonly form = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(8)]],
    rememberMe: [true],
  });

  onSubmit(): void {
    if (this.form.invalid || this.isSubmitting()) {
      this.form.markAllAsTouched();
      return;
    }

    const { email, password } = this.form.getRawValue();

    this.isSubmitting.set(true);
    this.errorMessage.set(null);

    this.authService
      .login({ email, password })
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        catchError((error) => {
          const message =
            (error?.error?.message as string) ??
            'Unable to sign in. Please check your credentials and try again.';
          this.errorMessage.set(message);
          return throwError(() => error);
        }),
        finalize(() => this.isSubmitting.set(false)),
      )
      .subscribe({
        next: () => {
          const returnUrl = this.router.parseUrl(
            this.router.routerState.snapshot.root.queryParamMap.get(
              'returnUrl',
            ) ?? '/dashboard',
          );
          this.router.navigateByUrl(returnUrl);
        },
        error: () => {
          // already handled in catchError
        },
      });
  }

  controlInvalid(controlName: 'email' | 'password'): boolean {
    const control = this.form.controls[controlName];
    return control.invalid && (control.dirty || control.touched);
  }
}
