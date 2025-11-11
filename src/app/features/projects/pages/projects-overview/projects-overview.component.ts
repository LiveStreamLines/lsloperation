import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';

interface ProjectSummary {
  name: string;
  developer: string;
  stage: 'Planning' | 'Construction' | 'Handover';
  startDate: string;
  goLive: string;
  completion: number;
  camerasOnline: number;
}

@Component({
  selector: 'app-projects-overview',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './projects-overview.component.html',
})
export class ProjectsOverviewComponent {
  readonly projects: ProjectSummary[] = [
    {
      name: 'Marasi Business District',
      developer: 'Skyline Properties',
      stage: 'Construction',
      startDate: 'Mar 2024',
      goLive: 'Sep 2024',
      completion: 68,
      camerasOnline: 38,
    },
    {
      name: 'Palm Vista Residences',
      developer: 'Gulf Horizon',
      stage: 'Planning',
      startDate: 'Jun 2024',
      goLive: 'Jan 2025',
      completion: 24,
      camerasOnline: 12,
    },
    {
      name: 'Harbour Heights',
      developer: 'Marina Heights',
      stage: 'Handover',
      startDate: 'Nov 2023',
      goLive: 'Aug 2024',
      completion: 92,
      camerasOnline: 44,
    },
  ];

  stageBadge(stage: ProjectSummary['stage']): string {
    switch (stage) {
      case 'Planning':
        return 'bg-slate-200 text-slate-700';
      case 'Construction':
        return 'bg-indigo-100 text-indigo-700';
      case 'Handover':
        return 'bg-emerald-100 text-emerald-700';
    }

    return 'bg-slate-200 text-slate-700';
  }
}
