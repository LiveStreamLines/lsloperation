import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';

interface CameraNode {
  name: string;
  developer: string;
  project: string;
  status: 'Online' | 'Degraded' | 'Offline';
  lastFrame: string;
  uptime: string;
}

@Component({
  selector: 'app-cameras-overview',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './cameras-overview.component.html',
})
export class CamerasOverviewComponent {
  readonly cameraNodes: CameraNode[] = [
    {
      name: 'Tower A - North (4K)',
      developer: 'Skyline Properties',
      project: 'Marasi Business District',
      status: 'Online',
      lastFrame: '12:41 GST',
      uptime: '99.998%',
    },
    {
      name: 'Podium Entrance',
      developer: 'Gulf Horizon',
      project: 'Palm Vista Residences',
      status: 'Degraded',
      lastFrame: '12:37 GST',
      uptime: '96.120%',
    },
    {
      name: 'Crane Cam - West',
      developer: 'Marina Heights',
      project: 'Harbour Heights',
      status: 'Online',
      lastFrame: '12:42 GST',
      uptime: '99.945%',
    },
    {
      name: 'Logistics Gate',
      developer: 'Desert Bloom',
      project: 'Logistics Hub',
      status: 'Offline',
      lastFrame: '10:18 GST',
      uptime: '87.311%',
    },
  ];

  statusBadge(status: CameraNode['status']): string {
    switch (status) {
      case 'Online':
        return 'bg-emerald-100 text-emerald-700';
      case 'Degraded':
        return 'bg-amber-100 text-amber-700';
      case 'Offline':
        return 'bg-rose-100 text-rose-700';
    }

    return 'bg-slate-200 text-slate-700';
  }
}
