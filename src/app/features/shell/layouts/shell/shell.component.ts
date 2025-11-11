import { CommonModule } from '@angular/common';
import { Component, DestroyRef, inject, signal } from '@angular/core';
import {
  Router,
  RouterLink,
  RouterLinkActive,
  RouterOutlet,
} from '@angular/router';
import { AuthService } from '@core/auth/auth.service';
import { AuthStore } from '@core/auth/auth.store';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize } from 'rxjs';

interface NavItem {
  label: string;
  path: string;
  description: string;
}

@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [CommonModule, RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './shell.component.html',
  styleUrl: './shell.component.css',
})
export class ShellComponent {
  private readonly authService = inject(AuthService);
  private readonly authStore = inject(AuthStore);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly mobileSidebarOpen = signal(false);
  readonly isSigningOut = signal(false);

  readonly navItems: NavItem[] = [
    {
      label: 'Dashboard',
      path: '/dashboard',
      description: 'Executive overview and live metrics',
    },
    {
      label: 'Users',
      path: '/users',
      description: 'Manage roles, access, and sessions',
    },
    {
      label: 'Developers',
      path: '/developers',
      description: 'Partner roster and onboarding status',
    },
    {
      label: 'Projects',
      path: '/projects',
      description: 'Project health and milestones',
    },
    {
      label: 'Cameras',
      path: '/cameras',
      description: 'Fleet visibility and stream quality',
    },
    {
      label: 'Inventory',
      path: '/inventory',
      description: 'Device lifecycle and logistics',
    },
    {
      label: 'Maintenance',
      path: '/maintenance',
      description: 'Preventive tasks and escalations',
    },
    {
      label: 'Memories',
      path: '/memories',
      description: 'Marketing assets and curated media',
    },
  ];

  readonly user = this.authStore.user;

  toggleSidebar(): void {
    this.mobileSidebarOpen.update((open) => !open);
  }

  closeSidebar(): void {
    this.mobileSidebarOpen.set(false);
  }

  onLogout(): void {
    if (this.isSigningOut()) {
      return;
    }

    this.isSigningOut.set(true);

    this.authService
      .logout()
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.isSigningOut.set(false)),
      )
      .subscribe(() => {
        this.router.navigate(['/auth/login']);
      });
  }
}
