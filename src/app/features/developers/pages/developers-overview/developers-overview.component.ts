import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';

interface DeveloperSummary {
  name: string;
  tag: string;
  activeProjects: number;
  camerasOnline: number;
  lastSync: string;
  status: 'On Track' | 'At Risk' | 'Blocked';
}

@Component({
  selector: 'app-developers-overview',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './developers-overview.component.html',
})
export class DevelopersOverviewComponent {
  readonly developers: DeveloperSummary[] = [
    {
      name: 'Skyline Properties',
      tag: 'skyline',
      activeProjects: 18,
      camerasOnline: 243,
      lastSync: '12 minutes ago',
      status: 'On Track',
    },
    {
      name: 'Gulf Horizon',
      tag: 'gulf-hzn',
      activeProjects: 9,
      camerasOnline: 96,
      lastSync: '58 minutes ago',
      status: 'At Risk',
    },
    {
      name: 'Desert Bloom',
      tag: 'desert-bloom',
      activeProjects: 5,
      camerasOnline: 61,
      lastSync: '2 hours ago',
      status: 'On Track',
    },
    {
      name: 'Marina Heights',
      tag: 'marina',
      activeProjects: 12,
      camerasOnline: 144,
      lastSync: '45 minutes ago',
      status: 'Blocked',
    },
  ];

  badge(status: DeveloperSummary['status']): string {
    switch (status) {
      case 'On Track':
        return 'bg-emerald-100 text-emerald-700';
      case 'At Risk':
        return 'bg-amber-100 text-amber-700';
      case 'Blocked':
        return 'bg-rose-100 text-rose-700';
    }

    return 'bg-slate-200 text-slate-700';
  }
}
