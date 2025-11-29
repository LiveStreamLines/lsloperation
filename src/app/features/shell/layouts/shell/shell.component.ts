import { CommonModule } from '@angular/common';
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
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
import { environment } from '@env';

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

  readonly user = this.authStore.user;

  readonly userImageUrl = computed(() => {
    const currentUser = this.user();
    if (!currentUser) return undefined;
    // Backend stores image in 'logo' field (path like 'logos/user/filename')
    // Support both 'logo' and 'image' for compatibility
    const imagePath = (currentUser as any).logo || currentUser.image;
    if (!imagePath) {
      return undefined;
    }
    // If it's already a full URL, return as-is
    if (imagePath.startsWith('http://') || imagePath.startsWith('https://') || imagePath.startsWith('data:')) {
      return imagePath;
    }
    // Build full URL from logo path (e.g., 'logos/user/filename.jpg')
    const sanitized = imagePath.startsWith('/') ? imagePath.slice(1) : imagePath;
    const mediaBaseUrl = environment.apiUrl.replace('/api', '');
    return `${mediaBaseUrl}/${sanitized}`;
  });

  readonly navItems = computed(() => {
    const currentUser = this.user();
    if (!currentUser) return [];

    const isSuperAdmin = currentUser.role === 'Super Admin';
    const items: NavItem[] = [];

    // Super Admin sees everything, others see based on permissions
    if (isSuperAdmin || (currentUser as any).hasCameraMonitorAccess) {
      items.push({
        label: 'Camera monitor',
        path: '/camera-monitor',
        description: 'Live updates and real-time snapshots',
      });
    }

    // Users - only show for Super Admin
    if (isSuperAdmin) {
      items.push({
        label: 'Users',
        path: '/users',
        description: 'Manage roles, access, and sessions',
      });
    }

    // Developers, Projects, Cameras - Super Admin sees all, others based on manage permission
    const canManageDevProjCam = (currentUser as any).canManageDevProjCam;
    const hasAllPermission = canManageDevProjCam === 'all';
    const hasCameraConfigPermission = canManageDevProjCam === 'camera_configuration';
    
    if (isSuperAdmin || hasAllPermission) {
      // Super Admin or "All" permission: Show all: Developers, Projects, and Cameras
      items.push({
        label: 'Developers',
        path: '/developers',
        description: 'Partner roster and onboarding status',
      });
      items.push({
        label: 'Projects',
        path: '/projects',
        description: 'Project health and milestones',
      });
      items.push({
        label: 'Cameras',
        path: '/cameras',
        description: 'Fleet visibility and stream quality',
      });
    } else if (hasCameraConfigPermission) {
      // "Camera Configuration" permission: Show only Cameras
      items.push({
        label: 'Cameras',
        path: '/cameras',
        description: 'Fleet visibility and stream quality',
      });
    }
    // If none or null, don't show any of these modules

    // Inventory - Super Admin or users with inventory access
    if (isSuperAdmin || (currentUser as any).hasInventoryAccess) {
      items.push({
        label: 'Inventory',
        path: '/inventory',
        description: 'Device lifecycle and logistics',
      });
    }

    // Task Management - always show
    items.push({
      label: 'Task Management',
      path: '/maintenance',
      description: 'Preventive tasks and escalations',
    });

    // Memories - All authenticated users can see the module
    // Permission-based filtering is handled in the component itself
    items.push({
      label: 'Memories',
      path: '/memories',
      description: 'Marketing assets and curated media',
    });

    // Contacts - Super Admin or users with developer/project/camera management access
    if (isSuperAdmin || hasAllPermission) {
      items.push({
        label: 'Contacts',
        path: '/contacts',
        description: 'Manage contacts for developers, projects, and cameras',
      });
    }

    // Debug: Log to verify items are being added
    console.log('Navigation items:', items.map(i => i.label));

    return items;
  });

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
