import { Routes } from '@angular/router';
import { authGuard } from '@core/auth/auth.guard';
import { ShellComponent } from '@features/shell/layouts/shell/shell.component';

const routes: Routes = [
  {
    path: '',
    component: ShellComponent,
    canActivate: [authGuard],
    children: [
      {
        path: '',
        pathMatch: 'full',
        redirectTo: 'camera-monitor',
      },
      {
        path: 'dashboard',
        loadComponent: () =>
          import('@features/shell/pages/dashboard/dashboard.component').then(
            (m) => m.DashboardComponent,
          ),
      },
      {
        path: 'users',
        loadComponent: () =>
          import('@features/users/pages/users-overview/users-overview.component').then(
            (m) => m.UsersOverviewComponent,
          ),
      },
      {
        path: 'users/add',
        loadComponent: () =>
          import('@features/users/pages/user-form/user-form.component').then(
            (m) => m.UserFormComponent,
          ),
      },
      {
        path: 'users/edit/:id',
        loadComponent: () =>
          import('@features/users/pages/user-form/user-form.component').then(
            (m) => m.UserFormComponent,
          ),
      },
      {
        path: 'developers',
        loadComponent: () =>
          import('@features/developers/pages/developers-overview/developers-overview.component').then(
            (m) => m.DevelopersOverviewComponent,
          ),
      },
      {
        path: 'projects',
        loadComponent: () =>
          import('@features/projects/pages/projects-overview/projects-overview.component').then(
            (m) => m.ProjectsOverviewComponent,
          ),
      },
      {
        path: 'cameras',
        loadComponent: () =>
          import('@features/cameras/pages/cameras-overview/cameras-overview.component').then(
            (m) => m.CamerasOverviewComponent,
          ),
      },
      {
        path: 'camera-form/:id',
        loadComponent: () =>
          import('@features/cameras/pages/camera-form/camera-form.component').then(
            (m) => m.CameraFormComponent,
          ),
      },
      {
        path: 'camera-form',
        loadComponent: () =>
          import('@features/cameras/pages/camera-form/camera-form.component').then(
            (m) => m.CameraFormComponent,
          ),
      },
      {
        path: 'camera-monitor',
        loadComponent: () =>
          import('@features/camera-monitor/pages/camera-monitor/camera-monitor.component').then(
            (m) => m.CameraMonitorComponent,
          ),
      },
      {
        path: 'camera-history/:cameraId',
        loadComponent: () =>
          import('@features/camera-history/pages/camera-history/camera-history.component').then(
            (m) => m.CameraHistoryComponent,
          ),
      },
      {
        path: 'inventory',
        loadComponent: () =>
          import('@features/inventory/pages/inventory-overview/inventory-overview.component').then(
            (m) => m.InventoryOverviewComponent,
          ),
      },
      {
        path: 'maintenance',
        loadComponent: () =>
          import('@features/maintenance/pages/maintenance-overview/maintenance-overview.component').then(
            (m) => m.MaintenanceOverviewComponent,
          ),
      },
      {
        path: 'memories',
        loadComponent: () =>
          import('@features/memories/pages/memories-overview/memories-overview.component').then(
            (m) => m.MemoriesOverviewComponent,
          ),
      },
    ],
  },
];

export default routes;

