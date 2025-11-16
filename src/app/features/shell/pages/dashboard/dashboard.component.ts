import { CommonModule } from '@angular/common';
import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { of, forkJoin } from 'rxjs';
import { catchError, finalize } from 'rxjs/operators';
import { CameraService } from '@core/services/camera.service';
import { DeveloperService } from '@core/services/developer.service';
import { ProjectService } from '@core/services/project.service';
import { MaintenanceService } from '@core/services/maintenance.service';
import { InventoryService } from '@core/services/inventory.service';
import { MemoryService } from '@core/services/memory.service';
import { Camera } from '@core/models/camera.model';
import { Developer } from '@core/models/developer.model';
import { Project } from '@core/models/project.model';
import { Maintenance } from '@core/models/maintenance.model';
import { InventoryItem } from '@core/models/inventory.model';
import { Memory } from '@core/models/memory.model';

interface Metric {
  label: string;
  value: string;
  delta: string;
  tone: 'positive' | 'neutral' | 'negative';
}

interface TimelineItem {
  time: string;
  title: string;
  description: string;
  type: 'camera' | 'maintenance' | 'project' | 'inventory';
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './dashboard.component.html',
})
export class DashboardComponent implements OnInit {
  private readonly cameraService = inject(CameraService);
  private readonly developerService = inject(DeveloperService);
  private readonly projectService = inject(ProjectService);
  private readonly maintenanceService = inject(MaintenanceService);
  private readonly inventoryService = inject(InventoryService);
  private readonly memoryService = inject(MemoryService);
  private readonly destroyRef = inject(DestroyRef);

  readonly isLoading = signal(true);
  readonly cameras = signal<Camera[]>([]);
  readonly developers = signal<Developer[]>([]);
  readonly projects = signal<Project[]>([]);
  readonly maintenanceTasks = signal<Maintenance[]>([]);
  readonly inventoryItems = signal<InventoryItem[]>([]);
  readonly memories = signal<Memory[]>([]);

  readonly metrics = computed<Metric[]>(() => {
    const cameras = this.cameras();
    const projects = this.projects();
    const maintenance = this.maintenanceTasks();
    const inventory = this.inventoryItems();

    const totalCameras = cameras.length;
    const onlineCameras = cameras.filter((c) => c.status === 'online').length;
    const offlineCameras = cameras.filter((c) => c.status === 'offline').length;

    const totalProjects = projects.length;
    const onTrackProjects = projects.filter(
      (p) => !p.status || p.status.toLowerCase() === 'on track' || p.status.toLowerCase() === 'active',
    ).length;

    const totalMaintenance = maintenance.length;
    const openMaintenance = maintenance.filter(
      (m) => m.status === 'pending' || m.status === 'in-progress',
    ).length;
    const completedMaintenance = maintenance.filter((m) => m.status === 'completed').length;

    const totalInventory = inventory.length;
    const assignedInventory = inventory.filter(
      (item) => !!item.currentAssignment || !!item.currentUserAssignment,
    ).length;

    return [
      {
        label: 'Live cameras',
        value: totalCameras
          ? `${onlineCameras} / ${totalCameras}`
          : '0',
        delta: offlineCameras
          ? `${offlineCameras} offline`
          : 'All online',
        tone: offlineCameras === 0 ? 'positive' : 'negative',
      },
      {
        label: 'Projects on track',
        value: totalProjects ? `${onTrackProjects} / ${totalProjects}` : '0',
        delta: onTrackProjects === totalProjects || totalProjects === 0
          ? 'All on track'
          : `${totalProjects - onTrackProjects} at risk`,
        tone: onTrackProjects === totalProjects ? 'positive' : 'negative',
      },
      {
        label: 'Maintenance load',
        value: totalMaintenance ? `${openMaintenance} open` : '0',
        delta: completedMaintenance
          ? `${completedMaintenance} completed`
          : 'No completed tasks yet',
        tone: openMaintenance > 0 ? 'negative' : 'positive',
      },
      {
        label: 'Inventory readiness',
        value: totalInventory
          ? `${assignedInventory} / ${totalInventory}`
          : '0',
        delta: assignedInventory === totalInventory || totalInventory === 0
          ? 'All assigned'
          : `${totalInventory - assignedInventory} unassigned`,
        tone: assignedInventory === totalInventory ? 'positive' : 'neutral',
      },
    ];
  });

  readonly timeline = computed<TimelineItem[]>(() => {
    const cameras = this.cameras();
    const maintenance = this.maintenanceTasks();
    const memories = this.memories();

    const items: TimelineItem[] = [];

    const latestMaintenance = [...maintenance]
      .filter((m) => !!m.completionTime || !!m.startTime || !!m.dateOfRequest)
      .sort((a, b) => {
        const aTime = new Date(a.completionTime || a.startTime || a.dateOfRequest || 0).getTime();
        const bTime = new Date(b.completionTime || b.startTime || b.dateOfRequest || 0).getTime();
        return bTime - aTime;
      })
      .slice(0, 3);

    for (const task of latestMaintenance) {
      items.push({
        time: this.formatTime(task.completionTime || task.startTime || task.dateOfRequest),
        title: task.taskType || 'Maintenance task',
        description: task.taskDescription || `Status: ${task.status}`,
        type: 'maintenance',
      });
    }

    const offlineCameras = cameras.filter((c) => c.status === 'offline').slice(0, 2);
    for (const camera of offlineCameras) {
      items.push({
        time: '',
        title: `Camera offline - ${camera.camera || camera.cameraDescription || 'Unknown camera'}`,
        description: `Project: ${
          (camera.project as any)?.projectName || (camera.project as string) || 'Unknown project'
        }`,
        type: 'camera',
      });
    }

    const latestMemories = [...memories]
      .filter((m) => !!m.createdDate || !!m.dateOfReceive || !!m.dateOfRemoval)
      .sort((a, b) => {
        const aTime = new Date(a.dateOfReceive || a.dateOfRemoval || a.createdDate || 0).getTime();
        const bTime = new Date(b.dateOfReceive || b.dateOfRemoval || b.createdDate || 0).getTime();
        return bTime - aTime;
      })
      .slice(0, 2);

    for (const memory of latestMemories) {
      items.push({
        time: this.formatTime(memory.dateOfReceive || memory.dateOfRemoval || memory.createdDate),
        title: `Memory ${memory.status || 'active'} - ${memory.camera || 'Unknown camera'}`,
        description: `Developer: ${memory.developer} · Project: ${memory.project}`,
        type: 'project',
      });
    }

    return items.slice(0, 6);
  });

  ngOnInit(): void {
    this.isLoading.set(true);

    forkJoin({
      cameras: this.cameraService.getAll(true).pipe(catchError(() => of<Camera[]>([]))),
      developers: this.developerService.getAll({ forceRefresh: true }).pipe(catchError(() => of<Developer[]>([]))),
      projects: this.projectService.getAll(true).pipe(catchError(() => of<Project[]>([]))),
      maintenance: this.maintenanceService.getAll().pipe(catchError(() => of<Maintenance[]>([]))),
      inventory: this.inventoryService.getAll().pipe(catchError(() => of<InventoryItem[]>([]))),
      memories: this.memoryService.getAll().pipe(catchError(() => of<Memory[]>([]))),
    })
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.isLoading.set(false)),
      )
      .subscribe(({ cameras, developers, projects, maintenance, inventory, memories }) => {
        this.cameras.set(cameras ?? []);
        this.developers.set(developers ?? []);
        this.projects.set(projects ?? []);
        this.maintenanceTasks.set(maintenance ?? []);
        this.inventoryItems.set(inventory ?? []);
        this.memories.set(memories ?? []);
      });
  }

  metricToneClass(tone: Metric['tone']): string {
    switch (tone) {
      case 'positive':
        return 'text-emerald-600';
      case 'negative':
        return 'text-rose-600';
      default:
        return 'text-slate-500';
    }
  }

  timelineAccent(type: TimelineItem['type']): string {
    switch (type) {
      case 'camera':
        return 'bg-indigo-500';
      case 'maintenance':
        return 'bg-emerald-500';
      case 'project':
        return 'bg-sky-500';
      case 'inventory':
        return 'bg-amber-500';
    }

    return 'bg-slate-400';
  }

  private formatTime(value?: string | number | Date | null): string {
    if (!value) {
      return '';
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return '';
    }
    return date.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
    });
  }
}
